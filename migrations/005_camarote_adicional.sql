-- Camarote como adicional do ingresso: o valor entra em ticket_price_cents e o rótulo vira
-- "Feminino + Camarote". A coluna permite contar e filtrar quem tem camarote.
ALTER TABLE purchases ADD COLUMN camarote boolean NOT NULL DEFAULT false;
