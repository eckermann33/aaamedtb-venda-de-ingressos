import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, json } from "@/server/http";
import { anonymizePurchase, isUuid } from "@/server/purchases";

/** Atende a um pedido de exclusão de dados (LGPD, art. 18) de um titular. */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/purchases/[id]/anonymize">) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Compra não encontrada.", 404);
  const sql = getSql();
  const done = await anonymizePurchase(sql, id);
  if (done) await audit(sql, admin.id, "anonymize_one", { purchaseId: id });
  return json({ ok: true, anonymized: done });
}
