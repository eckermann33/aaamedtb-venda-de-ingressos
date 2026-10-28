import { execSync } from "node:child_process";
import postgres from "postgres";
import { E2E_DB } from "../../playwright.config";

export const ADMIN_EMAIL = "diretoria@example.com";
export const ADMIN_PASSWORD = "SenhaDeTeste123";

export default async function setup() {
  if (!/e2e|test/.test(E2E_DB)) throw new Error("E2E_DATABASE_URL precisa ser um banco de TESTE.");
  const sql = postgres(E2E_DB, { max: 1, onnotice: () => {} });
  await sql.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await sql.end();
  const env = { ...process.env, DATABASE_URL: E2E_DB };
  execSync("npx tsx scripts/migrate.ts", { env, stdio: "inherit" });
  execSync(`npx tsx scripts/create-admin.ts ${ADMIN_EMAIL}`, { env: { ...env, ADMIN_PASSWORD }, stdio: "inherit" });
}
