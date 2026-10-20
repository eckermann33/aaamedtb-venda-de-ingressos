import postgres from "postgres";
import { env } from "./env";

export type Sql = postgres.Sql;
export type TxSql = postgres.TransactionSql;

declare global {
  // Reaproveita a conexão entre recarregamentos no modo de desenvolvimento.
  var __invictusSql: Sql | undefined;
}

export function createSql(url: string): Sql {
  const local = /@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url);
  return postgres(url, {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    idle_timeout: 20,
    connect_timeout: 15,
    ssl: process.env.DATABASE_SSL === "disable" || local ? false : "require",
    transform: { undefined: null },
    onnotice: () => {},
  });
}

export function getSql(): Sql {
  if (!globalThis.__invictusSql) {
    globalThis.__invictusSql = createSql(env.databaseUrl);
  }
  return globalThis.__invictusSql;
}
