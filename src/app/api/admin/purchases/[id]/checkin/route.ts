import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { undoCheckIn } from "@/server/checkin";
import { getSql } from "@/server/db";
import { errorResponse, json } from "@/server/http";
import { isUuid, PurchaseError } from "@/server/purchases";

/** Desfaz a entrada registrada pelo leitor (ex.: confirmada por engano). */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/purchases/[id]/checkin">) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Ingresso não encontrado.", 404);
  const sql = getSql();
  try {
    await undoCheckIn(sql, id);
    await audit(sql, admin.id, "checkin_undo", { purchaseId: id });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    throw err;
  }
}
