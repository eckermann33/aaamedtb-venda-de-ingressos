import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, json } from "@/server/http";
import { isUuid, PurchaseError, restoreTicket } from "@/server/purchases";

/** Devolve à lista um ingresso removido pelo painel (se houver vaga). */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/purchases/[id]/restore">) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Ingresso não encontrado.", 404);
  const sql = getSql();
  try {
    await restoreTicket(sql, id);
    await audit(sql, admin.id, "ticket_restored", { purchaseId: id });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    throw err;
  }
}
