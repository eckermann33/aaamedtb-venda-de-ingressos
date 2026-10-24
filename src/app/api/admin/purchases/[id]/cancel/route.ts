import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, json } from "@/server/http";
import { cancelManualTicket, isUuid, PurchaseError } from "@/server/purchases";

/** Remove um ingresso manual da lista (lançado por engano). Não vale para compras online (use o estorno). */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/purchases/[id]/cancel">) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Ingresso não encontrado.", 404);

  const sql = getSql();
  try {
    await cancelManualTicket(sql, id);
    await audit(sql, admin.id, "manual_ticket_cancel", { purchaseId: id });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    throw err;
  }
}
