import { z } from "zod";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, json, readJson } from "@/server/http";
import { isUuid, PurchaseError, setAthletic } from "@/server/purchases";

const schema = z.object({ athletic: z.boolean() });

/** Marca ou desmarca o ingresso como da diretoria da Atlética (seção separada da lista de entrada). */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/purchases/[id]/atletica">) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Ingresso não encontrado.", 404);
  const parsed = schema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return errorResponse("Confira os dados.", 400, "validation");

  const sql = getSql();
  try {
    await setAthletic(sql, id, parsed.data.athletic);
    await audit(sql, admin.id, parsed.data.athletic ? "athletic_add" : "athletic_remove", { purchaseId: id });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    throw err;
  }
}
