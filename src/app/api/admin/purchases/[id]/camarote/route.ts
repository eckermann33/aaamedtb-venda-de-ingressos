import { z } from "zod";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, json, readJson } from "@/server/http";
import { addCamarote, isUuid, PurchaseError, removeCamarote } from "@/server/purchases";

const schema = z.object({
  action: z.enum(["add", "remove"]),
  // Em centavos; ausente = preço da categoria camarote.
  priceCents: z.number().int().min(0).max(100_000).nullable().optional(),
});

/** Adiciona (ou desfaz) o camarote de um ingresso já confirmado. */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/purchases/[id]/camarote">) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const { id } = await ctx.params;
  if (!isUuid(id)) return errorResponse("Ingresso não encontrado.", 404);
  const parsed = schema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return errorResponse("Confira os dados.", 400, "validation");

  const sql = getSql();
  try {
    if (parsed.data.action === "add") {
      const t = await addCamarote(sql, id, parsed.data.priceCents ?? null);
      await audit(sql, admin.id, "camarote_add", { purchaseId: id, priceCents: t.camarote_extra_cents });
    } else {
      await removeCamarote(sql, id);
      await audit(sql, admin.id, "camarote_remove", { purchaseId: id });
    }
    return json({ ok: true });
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    throw err;
  }
}
