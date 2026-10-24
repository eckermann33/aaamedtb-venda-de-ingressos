import { timingSafeEqual } from "node:crypto";
import { getSql } from "@/server/db";
import { env } from "@/server/env";
import { errorResponse, json } from "@/server/http";
import { getMercadoPago } from "@/server/mercadopago";
import { reconcilePending } from "@/server/purchases";

/**
 * Rotina de segurança: confere no Mercado Pago as compras pendentes, caso algum
 * webhook não tenha chegado. Chamar a cada 5–10 min com:
 *   Authorization: Bearer <CRON_SECRET>
 */
export async function GET(request: Request) {
  const secret = env.cronSecret;
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const ok = secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return errorResponse("Não autorizado.", 401, "unauthorized");
  const checked = await reconcilePending(getSql(), getMercadoPago());
  return json({ ok: true, checked });
}
