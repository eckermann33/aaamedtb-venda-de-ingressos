import { z } from "zod";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, json, readJson } from "@/server/http";
import { errorInfo, logger } from "@/server/logger";
import { getMercadoPago, MercadoPagoError } from "@/server/mercadopago";
import { isUuid, PurchaseError, refundPurchasePayment } from "@/server/purchases";

const schema = z.object({ mpPaymentId: z.string().regex(/^\d{1,20}$/), confirm: z.literal(true) });

export async function POST(request: Request, ctx: RouteContext<"/api/admin/purchases/[id]/refund">) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Compra não encontrada.", 404);
  const parsed = schema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return errorResponse("Confirme o estorno.", 400);

  const sql = getSql();
  try {
    const result = await refundPurchasePayment(sql, getMercadoPago(), id, parsed.data.mpPaymentId);
    await audit(sql, admin.id, "refund", { purchaseId: id, mpPaymentId: parsed.data.mpPaymentId, result });
    return json({ ok: true, result });
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    logger.error("Falha ao estornar", { purchaseId: id, ...errorInfo(err) });
    const msg =
      err instanceof MercadoPagoError
        ? "O Mercado Pago recusou o estorno. Verifique o saldo e tente pelo painel do Mercado Pago."
        : "Falha ao estornar.";
    return errorResponse(msg, 502);
  }
}
