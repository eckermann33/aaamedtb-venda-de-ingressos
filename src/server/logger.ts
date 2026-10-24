/**
 * Logger em JSON que remove dados sensíveis antes de escrever.
 * Nunca registre tokens, dados de cartão, e-mails ou códigos Pix.
 */
const SENSITIVE = /token|authorization|password|senha|secret|card|cvv|security_code|email|qr_code|cookie/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? "[omitido]" : redact(v, depth + 1);
  }
  return out;
}

function write(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) {
  if (process.env.LOG_SILENT === "1") return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...(redact(data ?? {}) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, data?: Record<string, unknown>) => write("info", message, data),
  warn: (message: string, data?: Record<string, unknown>) => write("warn", message, data),
  error: (message: string, data?: Record<string, unknown>) => write("error", message, data),
};

export function errorInfo(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.name, detail: err.message.slice(0, 300) };
  return { error: String(err).slice(0, 300) };
}
