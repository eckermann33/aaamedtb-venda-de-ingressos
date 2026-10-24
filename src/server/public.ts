import type { Sql } from "./db";
import { envState } from "./deps";
import { loadSettings, readiness, type Settings } from "./settings";

export type PublicSettings = Settings & {
  /** Vendas realmente disponíveis (abertas, configuradas e com vagas). */
  canBuy: boolean;
  soldOut: boolean;
  minPriceCents: number | null;
};

export async function getPublicSettings(sql: Sql): Promise<PublicSettings> {
  const settings = await loadSettings(sql);
  const ready = !readiness(settings, envState()).some((i) => i.blocking);
  let soldOut = false;
  if (settings.capacity !== null) {
    const [row] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM purchases
      WHERE status = 'confirmed' OR (status = 'pending' AND expires_at > now())
    `;
    soldOut = row.n >= settings.capacity;
  }
  const active = settings.categories.filter((c) => c.active);
  return {
    ...settings,
    categories: active,
    canBuy: settings.salesOpen && ready && !soldOut,
    soldOut,
    minPriceCents: active.length ? Math.min(...active.map((c) => c.priceCents)) : null,
  };
}
