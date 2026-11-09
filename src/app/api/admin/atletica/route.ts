import { z } from "zod";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, json, readJson } from "@/server/http";
import { createAthleticTickets, PurchaseError } from "@/server/purchases";

const schema = z.object({
  names: z.array(z.string().max(200)).min(1).max(100),
  adultConfirmed: z.literal(true),
});

/** Cadastra nomes da diretoria da Atlética (cortesia), direto na seção Atlética da lista. */
export async function POST(request: Request) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const parsed = schema.safeParse(await readJson(request, 65_536).catch(() => null));
  if (!parsed.success) {
    const adult = parsed.error.issues.some((i) => i.path[0] === "adultConfirmed");
    return errorResponse(adult ? "Confirme que todos têm 18 anos ou mais." : "Confira os nomes.", 400, "validation");
  }
  const sql = getSql();
  try {
    const rows = await createAthleticTickets(sql, parsed.data.names);
    await audit(sql, admin.id, "athletic_tickets", { count: rows.length, ids: rows.map((r) => r.id) });
    return json({ count: rows.length }, 201);
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    throw err;
  }
}
