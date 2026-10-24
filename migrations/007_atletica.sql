-- Ingressos da diretoria da Atlética: marcados no painel e impressos numa seção separada da lista.
ALTER TABLE purchases ADD COLUMN athletic boolean NOT NULL DEFAULT false;
