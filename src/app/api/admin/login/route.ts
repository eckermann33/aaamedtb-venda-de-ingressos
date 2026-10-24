import { z } from "zod";
import { cookies } from "next/headers";
import { audit } from "@/server/audit";
import { authenticate, createSession, sessionCookieName } from "@/server/auth";
import { getSql } from "@/server/db";
import { env } from "@/server/env";
import { clientIp, errorResponse, isSameOrigin, json, readJson } from "@/server/http";
import { checkRateLimit, rateKey, resetRateLimit } from "@/server/rate-limit";

const schema = z.object({ email: z.string().max(254), password: z.string().max(200) });

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return errorResponse("Origem não permitida.", 403, "forbidden");
  let parsed;
  try {
    parsed = schema.safeParse(await readJson(request));
  } catch {
    return errorResponse("Requisição inválida.", 400);
  }
  if (!parsed.success) return errorResponse("Informe e-mail e senha.", 400);
  const email = parsed.data.email.trim().toLowerCase();

  const sql = getSql();
  const ipKey = rateKey("login-ip", clientIp(request));
  const emailKey = rateKey("login-email", email);
  const ipOk = await checkRateLimit(sql, ipKey, 20, 900);
  const emailOk = await checkRateLimit(sql, emailKey, 5, 900);
  if (!ipOk || !emailOk) {
    return errorResponse("Muitas tentativas. Aguarde 15 minutos e tente novamente.", 429, "rate_limited");
  }

  const admin = await authenticate(sql, email, parsed.data.password);
  if (!admin) {
    await audit(sql, null, "login_failed", { email });
    return errorResponse("E-mail ou senha incorretos.", 401, "invalid_credentials");
  }
  await resetRateLimit(sql, emailKey);
  const session = await createSession(sql, admin.id);
  await audit(sql, admin.id, "login");

  const store = await cookies();
  store.set(sessionCookieName(), session.token, {
    httpOnly: true,
    secure: env.isSecure,
    sameSite: "strict",
    path: "/",
    expires: session.expires,
  });
  return json({ ok: true });
}
