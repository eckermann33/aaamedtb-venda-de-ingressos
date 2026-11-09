-- Vários ingressos por pedido e ingressos lançados manualmente pelo painel.
--
-- * Pedido com vários ingressos: continua uma linha por ingresso/pessoa. A primeira linha é a
--   "principal" (lead_id nulo) e leva o pagamento do Mercado Pago; as demais apontam para ela em lead_id.
-- * Ingresso manual (source = 'manual'): lançado pela organização no painel (venda por WhatsApp,
--   cortesia, convidado). Nasce confirmado, sem pagamento no Mercado Pago.
ALTER TABLE purchases
  ADD COLUMN lead_id uuid REFERENCES purchases(id),
  ADD COLUMN source  text NOT NULL DEFAULT 'online' CHECK (source IN ('online', 'manual')),
  ADD COLUMN note    text CHECK (note IS NULL OR length(note) <= 200);

CREATE INDEX purchases_lead_idx ON purchases (lead_id) WHERE lead_id IS NOT NULL;

ALTER TABLE purchases DROP CONSTRAINT purchases_payment_method_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_payment_method_check
  CHECK (payment_method IN ('pix', 'card', 'manual'));

-- Cortesias podem ter valor zero.
ALTER TABLE purchases DROP CONSTRAINT purchases_ticket_price_cents_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_ticket_price_cents_check CHECK (ticket_price_cents >= 0);
ALTER TABLE purchases DROP CONSTRAINT purchases_amount_cents_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_amount_cents_check CHECK (amount_cents >= 0);

-- Confirmado exige código e data; o pagamento do MP é exigido só do ingresso online principal.
ALTER TABLE purchases DROP CONSTRAINT confirmed_requires_payment;
ALTER TABLE purchases ADD CONSTRAINT confirmed_requires_payment CHECK (
  status <> 'confirmed'
  OR (
    ticket_code IS NOT NULL AND confirmed_at IS NOT NULL
    AND (mp_payment_id IS NOT NULL OR source = 'manual' OR lead_id IS NOT NULL)
  )
);

-- Ingresso manual não tem pagamento online nem pedido agrupado; ingresso online pago tem valor.
ALTER TABLE purchases ADD CONSTRAINT manual_is_standalone CHECK (
  (source = 'manual') = (payment_method = 'manual') AND (source <> 'manual' OR lead_id IS NULL)
);
