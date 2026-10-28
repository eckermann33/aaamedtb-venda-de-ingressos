-- Telefone/WhatsApp do comprador: usado somente para avisos sobre o evento
-- (ex.: cancelamento ou mudança). Apenas dígitos, com DDD.
ALTER TABLE purchases
  ADD COLUMN buyer_phone text CHECK (buyer_phone IS NULL OR buyer_phone ~ '^[0-9]{10,11}$');
