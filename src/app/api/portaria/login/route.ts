import { cookies } from "next/headers";
import { z } from "zod";
import { audit } from "@/server/audit";
import { createDoorSession, doorCookieName, verifyDoorCode } from "@/server/auth";
import { getSql } from "@/server/db";
import { env } from "@/server/env";
import { clientIp, errorResponse, isSameOrigin, json, readJson } from "@/server/http";
import { checkRateLimit, rateKey } from "@/server/rate-limit";

const schema = z.object({ name: z.string().trim().min(2).max(40), code: z.string().max(64) });

/** Entrada da equipe da portaria no leitor de QR Code (sem acesso ao painel). */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return errorResponse("Origem não permitida.", 403, "forbidden");
  const parsed = schema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return errorResponse("Informe seu nome e o código da portaria.", 400, "validation");

  const sql = getSql();
  if (!(await checkRateLimit(sql, rateKey("door-login", clientIp(request)), 10, 600))) {
    return errorResponse("Muitas tentativas. Aguarde 10 minutos.", 429, "rate_limited");
  }
  const [cfg] = await sql<{ entry_mode: string }[]>`SELECT entry_mode FROM settings WHERE id = 1`;
  if (cfg?.entry_mode !== "qrcode") {
    return errorResponse("A entrada por QR Code está desativada.", 409, "qrcode_disabled");
  }
  if (!(await verifyDoorCode(sql, parsed.data.code))) {
    await audit(sql, null, "door_login_failed", {});
    return errorResponse("Código da portaria incorreto.", 401, "invalid_code");
  }
  const session = await createDoorSession(sql, parsed.data.name);
  await audit(sql, null, "door_login", { label: parsed.data.name });

  const store = await cookies();
  store.set(doorCookieName(), session.token, {
    httpOnly: true,
    secure: env.isSecure,
    sameSite: "strict",
    path: "/",
    expires: session.expires,
  });
  return json({ ok: true });
}
