import { NextResponse } from "next/server";
import { env } from "./env";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorResponse(message: string, status: number, code = "error") {
  return json({ error: { code, message } }, status);
}

/**
 * Proteção contra CSRF: requisições que alteram dados precisam vir do próprio site.
 * Navegadores sempre enviam o cabeçalho Origin em POST/PUT/DELETE de fetch.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(env.appUrl).origin;
  } catch {
    return false;
  }
}

/**
 * IP do cliente. Atrás do proxy da hospedagem, o último endereço do
 * X-Forwarded-For é o adicionado pelo proxy confiável.
 */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function readJson(request: Request, maxBytes = 16_384): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("payload_too_large");
  const text = await request.text();
  if (text.length > maxBytes) throw new Error("payload_too_large");
  return JSON.parse(text);
}
