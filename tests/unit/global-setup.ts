import { execSync } from "node:child_process";
import postgres from "postgres";

/** Recria o esquema do banco de testes e aplica as migrações uma vez. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://invictus:devpass@localhost:5432/invictus_test";
  if (!/test/.test(url)) throw new Error("TEST_DATABASE_URL precisa apontar para um banco de TESTE.");
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await sql.end();
  execSync("npx tsx scripts/migrate.ts", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
