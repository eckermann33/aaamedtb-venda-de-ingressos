import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Cartazes disponíveis em public/images (arquivos cartaz-*.webp/jpg/png). */
export function listPosters(): string[] {
  try {
    return readdirSync(join(process.cwd(), "public", "images"))
      .filter((f) => /^cartaz-[a-z0-9-]+\.(webp|jpg|jpeg|png)$/.test(f))
      .sort()
      .map((f) => `/images/${f}`);
  } catch {
    return [];
  }
}
