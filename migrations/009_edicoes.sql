-- Várias festas no mesmo sistema. Cada festa é uma "edição": lotação, lista de entrada, resumo,
-- leitor da portaria e relatórios consideram só a edição atual. Ao começar uma nova festa pelo
-- painel, a edição sobe e os ingressos da festa anterior ficam guardados (nada é apagado).
ALTER TABLE settings ADD COLUMN edition integer NOT NULL DEFAULT 1 CHECK (edition >= 1);

CREATE FUNCTION current_edition() RETURNS integer
  LANGUAGE sql STABLE
  AS $$ SELECT coalesce((SELECT edition FROM settings WHERE id = 1), 1) $$;

-- Toda compra nova é gravada na edição atual automaticamente; as existentes ficam na edição 1.
ALTER TABLE purchases ADD COLUMN edition integer NOT NULL DEFAULT current_edition();

CREATE INDEX purchases_edition_status_idx ON purchases (edition, status);

-- Dados de cada festa encerrada (nome, data...), para os relatórios das festas anteriores.
CREATE TABLE editions_archive (
  edition     integer     PRIMARY KEY,
  event       jsonb       NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
