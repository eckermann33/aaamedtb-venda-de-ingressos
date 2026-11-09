import { purchaseRequestSchema } from "@/lib/validation";
import { getSql } from "@/server/db";
import { purchaseDeps } from "@/server/deps";
import { clientIp, errorResponse, isSameOrigin, json, readJson } from "@/server/http";
import { errorInfo, logger } from "@/server/logger";
import { createPurchase, getOrderTickets, PurchaseError, toPublic } from "@/server/purchases";
import { checkRateLimit, rateKey } from "@/server/rate-limit";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return errorResponse("Origem não permitida.", 403, "forbidden");

  const sql = getSql();
  if (!(await checkRateLimit(sql, rateKey("purchase", clientIp(request)), 10, 600))) {
    return errorResponse("Muitas tentativas seguidas. Aguarde alguns minutos e tente novamente.", 429, "rate_limited");
  }

  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return errorResponse("Requisição inválida.", 400, "bad_request");
  }
  const parsed = purchaseRequestSchema.safeParse(body);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => String(i.path[0]));
    let message = "Confira os dados do formulário.";
    if (fields.includes("adultConfirmed")) message = "É preciso confirmar que você tem 18 anos ou mais.";
    else if (fields.includes("termsAccepted")) message = "É preciso aceitar as regras de entrada e os termos.";
    else if (fields.includes("extraTickets")) message = "Confira os ingressos do pedido (máximo de 10)."
    else if (fields.includes("buyerPhone")) message = "Informe um celular/WhatsApp com DDD.";
    return errorResponse(message, 400, "validation");
  }

  try {
    const purchase = await createPurchase(purchaseDeps(), parsed.data);
    return json({ purchase: toPublic(purchase, await getOrderTickets(sql, purchase.id)) }, 201);
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    logger.error("Erro inesperado ao criar compra", errorInfo(err));
    return errorResponse("Algo deu errado do nosso lado. Nenhuma cobrança foi feita. Tente novamente.", 500);
  }
}
