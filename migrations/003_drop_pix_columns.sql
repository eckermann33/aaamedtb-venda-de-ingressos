-- O Pix agora é pago no Checkout Pro do Mercado Pago (não mostramos mais o QR Code
-- no nosso site), então estas colunas não são mais usadas.
ALTER TABLE purchases
  DROP COLUMN IF EXISTS pix_qr_code,
  DROP COLUMN IF EXISTS pix_qr_code_base64,
  DROP COLUMN IF EXISTS pix_ticket_url,
  DROP COLUMN IF EXISTS pix_expires_at;
