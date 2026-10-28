/**
 * Código de entrada do ingresso (conteúdo do QR Code), usado no modo de entrada por QR Code.
 * 12 caracteres do alfabeto Crockford (sem I, L, O e U, que confundem na digitação).
 */
export const ENTRY_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const ENTRY_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{12}$/;

/** Prefixo do QR Code: identifica que o QR é um ingresso da Invictus. */
const QR_PREFIX = "INV1:";

export type EntryMode = "list" | "qrcode";

export function qrPayload(code: string): string {
  return `${QR_PREFIX}${code}`;
}

/** "K7M2Q9XA4C0B" → "K7M2-Q9XA-4C0B" (mais fácil de ler e digitar). */
export function formatEntryCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}

/**
 * Aceita o conteúdo lido do QR Code ou um código digitado (com traços, espaços, minúsculas e
 * as trocas comuns O→0 e I/L→1). Retorna o código normalizado ou null se não for válido.
 */
export function normalizeEntryCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 200) return null;
  let text = raw.trim().toUpperCase();
  if (text.startsWith(QR_PREFIX)) text = text.slice(QR_PREFIX.length);
  const code = text.replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return ENTRY_CODE_PATTERN.test(code) ? code : null;
}
