import { createHash } from "node:crypto";
import type { Sql } from "./db";
import { env } from "./env";

/** Hash do identificador (ex.: IP) — não guardamos IPs em texto puro. */
export function rateKey(scope: string, identifier: string): string {
  const h = createHash("sha256").update(`${env.appSecret}:${identifier}`).digest("hex").slice(0, 32);
  return `${scope}:${h}`;
}

/**
 * Janela fixa armazenada no banco (funciona com várias instâncias do servidor).
 * Retorna true se a requisição está dentro do limite.
 */
export async function checkRateLimit(sql: Sql, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const [row] = await sql<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start < now() - ${windowSeconds} * interval '1 second'
                   THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start < now() - ${windowSeconds} * interval '1 second'
                          THEN now() ELSE rate_limits.window_start END
    RETURNING count
  `;
  // Limpeza ocasional de chaves antigas.
  if (Math.random() < 0.01) await sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
  return row.count <= limit;
}

export async function resetRateLimit(sql: Sql, key: string) {
  await sql`DELETE FROM rate_limits WHERE key = ${key}`;
}
