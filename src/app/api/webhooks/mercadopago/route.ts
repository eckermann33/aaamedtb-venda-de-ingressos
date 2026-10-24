import { getSql } from "@/server/db";
import { env } from "@/server/env";
import { json } from "@/server/http";
import { errorInfo, logger } from "@/server/logger";
import { getMercadoPago } from "@/server/mercadopago";
import { applyPayment } from "@/server/purchases";
import { verifyWebhookSignature } from "@/server/webhook-signature";

/**
 * Webhook do Mercado Pago (configurado em "Suas integrações" > Webhooks, evento "Pagamentos").
 *
 * 1. Valida a assinatura x-signature com a assinatura secreta (MP_WEBHOOK_SECRET).
 * 2. Nunca confia no conteúdo da notificação: consulta o pagamento na API do Mercado Pago.
 * 3. Aplica o estado de forma idempotente (notificações repetidas não duplicam nada).
 */
export async function POST(request: Request) {
  const sql = getSql();
  const url = new URL(request.url);
  const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id");
  const topic = url.searchParams.get("type") ?? url.searchParams.get("topic");
  const requestId = request.headers.get("x-request-id");

  let body: { type?: string; action?: string; data?: { id?: string | number } } = {};
  try {
    const text = await request.text();
    if (text.length < 20_000 && text) body = JSON.parse(text);
  } catch {
    /* corpo opcional */
  }
  const type = topic ?? body.type ?? null;

  const record = (signatureOk: boolean, result: string) =>
    sql`
      INSERT INTO webhook_events (request_id, topic, data_id, signature_ok, result)
      VALUES (${requestId?.slice(0, 100) ?? null}, ${type?.slice(0, 50) ?? null}, ${dataId?.slice(0, 50) ?? null},
              ${signatureOk}, ${result})
    `;

  const secret = env.mpWebhookSecret;
  if (!secret) {
    logger.error("Webhook recebido, mas MP_WEBHOOK_SECRET não está configurado");
    await record(false, "secret_not_configured");
    return json({ ok: false }, 503);
  }

  const check = verifyWebhookSignature({
    xSignature: request.headers.get("x-signature"),
    xRequestId: requestId,
    dataId,
    secret,
  });
  if (!check.ok) {
    logger.warn("Webhook com assinatura inválida", { reason: check.reason, requestId });
    await record(false, `invalid_signature:${check.reason}`);
    return json({ ok: false }, 401);
  }

  if (type !== "payment" || !dataId || !/^\d{1,20}$/.test(dataId)) {
    await record(true, "ignored");
    return json({ ok: true });
  }

  try {
    const payment = await getMercadoPago().getPayment(dataId);
    const result = await applyPayment(sql, payment);
    await record(true, result);
    return json({ ok: true });
  } catch (err) {
    logger.error("Falha ao processar webhook", { dataId, ...errorInfo(err) });
    await record(true, "processing_error");
    // Erro 500 faz o Mercado Pago reenviar a notificação mais tarde.
    return json({ ok: false }, 500);
  }
}
