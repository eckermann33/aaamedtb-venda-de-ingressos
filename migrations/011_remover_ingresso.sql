-- Remover um ingresso da lista pelo painel (sem estorno pelo Mercado Pago): o ingresso fica
-- "cancelled" com data e motivo, sai da lista e da lotação e pode ser restaurado.
ALTER TABLE purchases
  ADD COLUMN removed_at     timestamptz,
  ADD COLUMN removed_reason text CHECK (removed_reason IS NULL OR length(removed_reason) <= 200);
