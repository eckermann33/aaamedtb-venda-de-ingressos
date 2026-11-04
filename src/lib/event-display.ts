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
