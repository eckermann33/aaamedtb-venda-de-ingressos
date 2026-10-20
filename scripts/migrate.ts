/**
 * Aplica as migrações SQL pendentes e cria a configuração inicial do evento.
 * Uso: npm run db:migrate  (lê DATABASE_URL do ambiente ou do arquivo .env)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import postgres from "postgres";
import { DEFAULT_CATEGORIES, DEFAULT_EVENT, DEFAULT_SERVICE_FEE_CENTS, DEFAULT_TERMS } from "../src/config/event";

if (existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Defina DATABASE_URL (veja .env.example).");
  process.exit(1);
}
const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
const sql = postgres(url, {
  max: 1,
  ssl: process.env.DATABASE_SSL === "disable" || local ? false : "require",
  onnotice: () => {},
});

function termsHash(content: typeof DEFAULT_TERMS) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        rules: content.rules,
        refundPolicy: content.refundPolicy,
        cancellationPolicy: content.cancellationPolicy,
        transferPolicy: content.transferPolicy,
      }),
    )
    .digest("hex");
}

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
  const dir = path.join(process.cwd(), "migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) continue;
    const content = readFileSync(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
    });
    console.log(`✔ migração aplicada: ${file}`);
  }

  // Configuração inicial (somente se ainda não existir).
  const [exists] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM settings`;
  if (exists.n === 0) {
    await sql.begin(async (tx) => {
      const [terms] = await tx<{ id: number }[]>`
        INSERT INTO terms_versions (content, content_hash)
        VALUES (${tx.json(DEFAULT_TERMS as never)}, ${termsHash(DEFAULT_TERMS)})
        RETURNING id
      `;
      await tx`
        INSERT INTO settings (id, event, sales_open, capacity, service_fee_cents, current_terms_version_id)
        VALUES (1, ${tx.json(DEFAULT_EVENT as never)}, false, NULL, ${DEFAULT_SERVICE_FEE_CENTS}, ${terms.id})
      `;
      for (const c of DEFAULT_CATEGORIES) {
        await tx`
          INSERT INTO ticket_categories (id, label, price_cents, sort_order)
          VALUES (${c.id}, ${c.label}, ${c.priceCents}, ${c.sortOrder})
          ON CONFLICT (id) DO NOTHING
        `;
      }
    });
    console.log("✔ configuração inicial do evento criada (vendas FECHADAS).");
  }
  console.log("Banco de dados atualizado.");
}

main()
  .catch((err) => {
    console.error("Erro na migração:", err.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
