-- Camarote adicionado pela organização a um ingresso já confirmado. O valor recebido por fora
-- fica separado: amount_cents continua sendo exatamente o que foi cobrado no Mercado Pago.
ALTER TABLE purchases
  ADD COLUMN camarote_extra_cents integer CHECK (camarote_extra_cents IS NULL OR camarote_extra_cents >= 0);
