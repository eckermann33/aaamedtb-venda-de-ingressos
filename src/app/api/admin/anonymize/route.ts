import { z } from "zod";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, json, readJson } from "@/server/http";
import { anonymizeAll } from "@/server/purchases";

const schema = z.object({ confirm: z.literal("ANONIMIZAR") });

/** Remove os nomes de todas as compras finalizadas (fim do prazo de retenção). */
export async function POST(request: Request) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const parsed = schema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return errorResponse('Digite "ANONIMIZAR" para confirmar.', 400);
  const sql = getSql();
  const count = await anonymizeAll(sql);
  await audit(sql, admin.id, "anonymize_all", { count });
  return json({ ok: true, count });
}
