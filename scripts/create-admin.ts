/**
 * Cria (ou redefine a senha de) um administrador do painel.
 *
 * Uso interativo (recomendado):   npm run admin:create -- organizacao@exemplo.com
 * A senha é digitada sem aparecer na tela e nunca fica salva em arquivos.
 */
import { existsSync } from "node:fs";
import readline from "node:readline";
import postgres from "postgres";
import { hashPassword, passwordProblem } from "../src/server/password";

if (existsSync(".env")) process.loadEnvFile(".env");

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let muted = false;
    out._writeToOutput = (s: string) => {
      if (!muted) out.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function main() {
  const email = (process.argv[2] ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error("Uso: npm run admin:create -- email@exemplo.com");
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("Defina DATABASE_URL.");
    process.exit(1);
  }

  let password = process.env.ADMIN_PASSWORD ?? "";
  if (!password) {
    if (!process.stdin.isTTY) {
      console.error("Execute em um terminal interativo (ou defina ADMIN_PASSWORD só para esta execução).");
      process.exit(1);
    }
    password = await askHidden("Senha (mín. 12 caracteres, letras e números): ");
    const confirm = await askHidden("Repita a senha: ");
    if (password !== confirm) {
      console.error("As senhas não conferem.");
      process.exit(1);
    }
  }
  const problem = passwordProblem(password);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
  const sql = postgres(url, { max: 1, ssl: process.env.DATABASE_SSL === "disable" || local ? false : "require" });
  try {
    const hash = await hashPassword(password);
    const [row] = await sql<{ id: number; created: boolean }[]>`
      INSERT INTO admins (email, password_hash) VALUES (${email}, ${hash})
      ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, disabled = false
      RETURNING id, (xmax = 0) AS created
    `;
    // Encerra sessões antigas ao redefinir a senha.
    await sql`DELETE FROM admin_sessions WHERE admin_id = ${row.id}`;
    await sql`INSERT INTO audit_log (admin_id, action, details) VALUES (${row.id}, ${row.created ? "admin_created" : "admin_password_reset"}, NULL)`;
    console.log(row.created ? `✔ Administrador criado: ${email}` : `✔ Senha redefinida: ${email}`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("Erro:", err.message);
  process.exit(1);
});
