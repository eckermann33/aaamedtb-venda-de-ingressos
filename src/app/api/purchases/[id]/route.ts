import { getSql } from "@/server/db";
import { getMercadoPago } from "@/server/mercadopago";
import { clientIp, errorResponse, json } from "@/server/http";
import { getOrder, isUuid, reconcilePurchase, toPublic } from "@/server/purchases";
import { checkRateLimit, rateKey } from "@/server/rate-limit";

/** Estado atual da compra, sempre lido do banco (e conferido no Mercado Pago se pendente). */
export async function GET(request: Request, ctx: RouteContext<"/api/purchases/[id]">) {
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Pedido não encontrado.", 404, "not_found");

  const sql = getSql();
  if (!(await checkRateLimit(sql, rateKey("status", clientIp(request)), 120, 60))) {
    return errorResponse("Muitas consultas. Aguarde um pouco.", 429, "rate_limited");
  }

  let order = await getOrder(sql, id);
  if (!order) return errorResponse("Pedido não encontrado.", 404, "not_found");

  if (order.lead.status === "pending") {
    const hint = new URL(request.url).searchParams.get("payment_id") ?? undefined;
    await reconcilePurchase(sql, getMercadoPago(), id, { hintPaymentId: hint });
    order = (await getOrder(sql, id))!;
  }
  // QR Code só no modo de entrada por QR e para pedidos da festa atual.
  const [cfg] = await sql<
    { entry_mode: string; edition: number }[]
  >`SELECT entry_mode, edition FROM settings WHERE id = 1`;
  const showEntry = cfg?.entry_mode === "qrcode" && order.lead.edition === cfg.edition;
  return json({ purchase: toPublic(order.lead, order.tickets, { showEntry }) });
}
