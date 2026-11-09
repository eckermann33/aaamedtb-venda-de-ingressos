import { z } from "zod";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, json, readJson } from "@/server/http";
import { isUuid, PurchaseError, removeTicket } from "@/server/purchases";

const schema = z.object({ reason: z.string().max(200) });

/** Remove o ingresso da lista de entrada (sem estorno), com o motivo. */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/purchases/[id]/remove">) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Ingresso não encontrado.", 404);
  const parsed = schema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return errorResponse("Informe o motivo da remoção.", 400, "validation");
  const sql = getSql();
  try {
    const t = await removeTicket(sql, id, parsed.data.reason);
    // O motivo pode citar a pessoa; na auditoria fica só a referência do ingresso.
    await audit(sql, admin.id, "ticket_removed", { purchaseId: id, source: t.source });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    throw err;
  }
}
