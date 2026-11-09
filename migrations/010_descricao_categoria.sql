-- Texto curto exibido junto da categoria no site (ex.: "Com carteira de estudante na entrada").
ALTER TABLE ticket_categories
  ADD COLUMN description text CHECK (description IS NULL OR length(description) <= 160);
