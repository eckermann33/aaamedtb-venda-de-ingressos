-- Esquema inicial da plataforma de ingressos da Invictus.
-- Valores monetários são sempre armazenados em centavos (integer).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Termos e regras: cada alteração gera uma nova versão imutável.
-- ---------------------------------------------------------------------------
CREATE TABLE terms_versions (
  id           serial PRIMARY KEY,
  content      jsonb       NOT NULL,
  content_hash text        NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Configuração do evento (linha única).
-- ---------------------------------------------------------------------------
CREATE TABLE settings (
  id                       smallint    PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  event                    jsonb       NOT NULL,
  sales_open               boolean     NOT NULL DEFAULT false,
  -- NULL = sem limite de lotação definido.
  capacity                 integer     CHECK (capacity IS NULL OR capacity > 0),
  -- Taxa de serviço cobrada por ingresso, exibida separadamente ao comprador.
  service_fee_cents        integer     NOT NULL DEFAULT 0 CHECK (service_fee_cents >= 0 AND service_fee_cents <= 10000),
  current_terms_version_id integer     REFERENCES terms_versions(id),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Categorias de ingresso e preços (configuráveis pelo painel).
-- ---------------------------------------------------------------------------
CREATE TABLE ticket_categories (
  id          text        PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{2,32}$'),
  label       text        NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 40),
  price_cents integer     NOT NULL CHECK (price_cents >= 100 AND price_cents <= 100000),
  active      boolean     NOT NULL DEFAULT true,
  sort_order  integer     NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Compras. Cada compra corresponde a um ingresso para uma pessoa.
-- ---------------------------------------------------------------------------
CREATE TABLE purchases (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Chave gerada pelo navegador para impedir compras duplicadas por clique repetido.
  client_request_id     uuid        NOT NULL UNIQUE,
  full_name             text        NOT NULL,
  -- Nome normalizado (minúsculo, sem acentos) usado na busca do painel.
  name_search           text        NOT NULL,
  category_id           text        NOT NULL REFERENCES ticket_categories(id),
  category_label        text        NOT NULL,
  -- Preço do ingresso + taxa de serviço = valor total cobrado (amount_cents).
  ticket_price_cents    integer     NOT NULL CHECK (ticket_price_cents > 0),
  fee_cents             integer     NOT NULL DEFAULT 0 CHECK (fee_cents >= 0),
  amount_cents          integer     NOT NULL CHECK (amount_cents > 0),
  payment_method        text        NOT NULL CHECK (payment_method IN ('pix', 'card')),
  status                text        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled', 'expired', 'refunded', 'failed')),
  -- Último status informado pelo Mercado Pago (pending, approved, rejected, ...).
  payment_status        text,
  payment_status_detail text,
  -- Pagamento do Mercado Pago associado (Pix: definido na criação; cartão: na aprovação).
  mp_payment_id         text        UNIQUE,
  mp_preference_id      text,
  checkout_url          text,
  pix_qr_code           text,
  pix_qr_code_base64    text,
  pix_ticket_url        text,
  pix_expires_at        timestamptz,
  adult_confirmed       boolean     NOT NULL CHECK (adult_confirmed),
  terms_version_id      integer     NOT NULL REFERENCES terms_versions(id),
  terms_accepted_at     timestamptz NOT NULL,
  -- Identificador interno do ingresso, gerado somente quando o pagamento é aprovado.
  ticket_code           text        UNIQUE,
  -- Fim da reserva de vaga enquanto o pagamento está pendente.
  expires_at            timestamptz NOT NULL,
  confirmed_at          timestamptz,
  refunded_at           timestamptz,
  -- Problemas que exigem ação da organização (ex.: pagamento acima da lotação).
  attention             text        CHECK (attention IS NULL OR attention IN
                          ('over_capacity', 'amount_mismatch', 'duplicate_payment', 'in_mediation', 'late_payment')),
  last_checked_at       timestamptz,
  anonymized_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT confirmed_requires_payment CHECK (
    status <> 'confirmed'
    OR (ticket_code IS NOT NULL AND confirmed_at IS NOT NULL AND mp_payment_id IS NOT NULL)
  ),
  CONSTRAINT amount_is_price_plus_fee CHECK (amount_cents = ticket_price_cents + fee_cents),
  CONSTRAINT refunded_requires_date CHECK (status <> 'refunded' OR refunded_at IS NOT NULL)
);

CREATE INDEX purchases_status_idx       ON purchases (status);
CREATE INDEX purchases_pending_idx      ON purchases (expires_at) WHERE status = 'pending';
CREATE INDEX purchases_confirmed_at_idx ON purchases (confirmed_at);
CREATE INDEX purchases_created_at_idx   ON purchases (created_at);
CREATE INDEX purchases_name_idx         ON purchases (name_search);

-- Busca rápida por trechos do nome (opcional: depende da extensão pg_trgm).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX purchases_name_trgm_idx ON purchases USING gin (name_search gin_trgm_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm indisponível; a busca usará o índice comum.';
END
$$;

-- ---------------------------------------------------------------------------
-- Pagamentos recebidos do Mercado Pago (uma compra pode ter várias tentativas).
-- ---------------------------------------------------------------------------
CREATE TABLE payments (
  mp_payment_id     text        PRIMARY KEY,
  purchase_id       uuid        NOT NULL REFERENCES purchases(id),
  status            text        NOT NULL,
  status_detail     text,
  amount_cents      integer,
  currency          text,
  payment_method_id text,
  payment_type_id   text,
  live_mode         boolean,
  date_approved     timestamptz,
  -- Motivo da rejeição na validação local (valor divergente, moeda errada...).
  validation_error  text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX payments_purchase_idx ON payments (purchase_id);

-- ---------------------------------------------------------------------------
-- Notificações recebidas (auditoria e diagnóstico do webhook).
-- ---------------------------------------------------------------------------
CREATE TABLE webhook_events (
  id           bigserial   PRIMARY KEY,
  request_id   text,
  topic        text,
  data_id      text,
  signature_ok boolean     NOT NULL,
  result       text,
  received_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX webhook_events_received_idx ON webhook_events (received_at DESC);

-- ---------------------------------------------------------------------------
-- Administradores e sessões.
-- ---------------------------------------------------------------------------
CREATE TABLE admins (
  id            serial      PRIMARY KEY,
  email         text        NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text        NOT NULL,
  disabled      boolean     NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE admin_sessions (
  -- Guardamos apenas o hash SHA-256 do token do cookie.
  token_hash   text        PRIMARY KEY,
  admin_id     integer     NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);

CREATE INDEX admin_sessions_expires_idx ON admin_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Auditoria de operações administrativas.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id         bigserial   PRIMARY KEY,
  admin_id   integer     REFERENCES admins(id),
  action     text        NOT NULL,
  details    jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

-- ---------------------------------------------------------------------------
-- Limite de requisições (funciona com várias instâncias do servidor).
-- ---------------------------------------------------------------------------
CREATE TABLE rate_limits (
  key          text        PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL
);
