-- Entrada por QR Code (opcional). A organização escolhe no painel entre o modelo de lista
-- impressa (padrão) e o QR Code conferido na portaria por um leitor no celular.

-- Código de entrada de cada ingresso: é o conteúdo do QR Code. Diferente do ticket_code, não
-- aparece na lista impressa nem no CSV, então quem tem a lista não consegue forjar um QR.
ALTER TABLE purchases
  ADD COLUMN entry_code    text UNIQUE CHECK (entry_code IS NULL OR entry_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  ADD COLUMN checked_in_at timestamptz,
  ADD COLUMN checked_in_by text CHECK (checked_in_by IS NULL OR length(checked_in_by) <= 60);

-- Ingressos já confirmados ganham um código (hexadecimal é um subconjunto do alfabeto acima).
UPDATE purchases
SET entry_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
WHERE ticket_code IS NOT NULL AND entry_code IS NULL;

CREATE INDEX purchases_checked_in_idx ON purchases (checked_in_at) WHERE checked_in_at IS NOT NULL;

ALTER TABLE settings
  ADD COLUMN entry_mode     text NOT NULL DEFAULT 'list' CHECK (entry_mode IN ('list', 'qrcode')),
  -- Hash (scrypt) do código de acesso que a organização passa para a equipe da portaria.
  ADD COLUMN door_code_hash text;

-- Sessões da portaria: acesso só ao leitor de QR Code, nada do painel administrativo.
CREATE TABLE door_sessions (
  token_hash text        PRIMARY KEY,
  -- Nome informado por quem entrou (ex.: "Segurança 1"), registrado em cada entrada.
  label      text        NOT NULL CHECK (length(btrim(label)) BETWEEN 2 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX door_sessions_expires_idx ON door_sessions (expires_at);
