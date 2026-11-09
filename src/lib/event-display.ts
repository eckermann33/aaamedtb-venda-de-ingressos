import type { EventInfo } from "@/config/event";

/** Cartazes ficam em public/images com o nome cartaz-<festa>.<ext>. */
export const POSTER_PATTERN = /^\/images\/cartaz-[a-z0-9-]+\.(webp|jpg|jpeg|png)$/;

/** Cartaz da primeira festa: usado quando a configuração é anterior ao campo "poster". */
const LEGACY_POSTER = "/images/cartaz-party-do-saco-cheio.webp";

/**
 * Título da página em duas partes (linha menor + linha de destaque). Sem os campos preenchidos,
 * divide o nome: "Party do Saco Cheio" → "Party do" / "Saco Cheio".
 */
export function heroTitle(e: Pick<EventInfo, "name" | "titleTop" | "titleMain">): { top: string; main: string } {
  const top = e.titleTop?.trim() ?? "";
  const main = e.titleMain?.trim() ?? "";
  if (top || main) return { top, main: main || e.name };
  const words = e.name.trim().split(/\s+/);
  if (words.length <= 2) return { top: "", main: e.name.trim() };
  return { top: words.slice(0, 2).join(" "), main: words.slice(2).join(" ") };
}

export function posterOf(e: Pick<EventInfo, "poster">): string | null {
  if (e.poster === undefined) return LEGACY_POSTER;
  return e.poster && POSTER_PATTERN.test(e.poster) ? e.poster : null;
}

/**
 * Variáveis CSS da cor de destaque da festa (ex.: o roxo do cartaz da Chopada). Sem cor
 * definida, o site usa só o verde da Invictus.
 */
export function accentStyle(e: Pick<EventInfo, "accent">): Record<string, string> | undefined {
  const hex = e.accent?.trim();
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return undefined;
  const n = parseInt(hex.slice(1), 16);
  return { "--accent": hex, "--accent-rgb": `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}` };
}
