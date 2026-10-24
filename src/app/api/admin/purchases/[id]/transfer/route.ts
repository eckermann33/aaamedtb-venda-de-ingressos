import { z } from "zod";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, json, readJson } from "@/server/http";
import { isUuid, PurchaseError, transferPurchase } from "@/server/purchases";

const schema = z.object({ fullName: z.string().max(200) });

/** Transfere o ingresso para outra pessoa (troca o nome na lista oficial). */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/purchases/[id]/transfer">) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Compra não encontrada.", 404);
  const parsed = schema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return errorResponse("Informe o novo nome.", 400);

  const sql = getSql();
  try {
    await transferPurchase(sql, id, parsed.data.fullName);
    // Os nomes não vão para a auditoria (dados pessoais); registra só qual compra mudou.
    await audit(sql, admin.id, "transfer", { purchaseId: id });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    throw err;
  }
}
