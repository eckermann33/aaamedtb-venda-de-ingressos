import { z } from "zod";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, json, readJson } from "@/server/http";
import { createManualTickets, PurchaseError } from "@/server/purchases";

const schema = z.object({
  // Um nome completo por ingresso.
  names: z.array(z.string().max(200)).min(1).max(50),
  categoryId: z.string().regex(/^[a-z0-9-]{2,32}$/),
  // Em centavos. Ausente = preço da categoria; 0 = cortesia.
  priceCents: z.number().int().min(0).max(100_000).nullable(),
  phone: z.string().max(30).nullable(),
  note: z.string().max(200).nullable(),
  // Cortesia da diretoria da Atlética: vai para a seção "Atlética" da lista.
  athletic: z.boolean().optional(),
  adultConfirmed: z.literal(true),
});

/** Lança ingressos manualmente (venda por WhatsApp, cortesia, convidado). */
export async function POST(request: Request) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const parsed = schema.safeParse(await readJson(request, 65_536).catch(() => null));
  if (!parsed.success) {
    const adult = parsed.error.issues.some((i) => i.path[0] === "adultConfirmed");
    return errorResponse(adult ? "Confirme que todas as pessoas têm 18 anos ou mais." : "Confira os dados do formulário.", 400, "validation");
  }
  const { adultConfirmed: _adult, ...input } = parsed.data;

  const sql = getSql();
  try {
    const tickets = await createManualTickets(sql, input);
    // Os nomes não vão para a auditoria (dados pessoais): só a quantidade, o valor e a observação.
    await audit(sql, admin.id, "manual_tickets", {
      count: tickets.length,
      categoryId: input.categoryId,
      priceCents: tickets[0].ticket_price_cents,
      note: tickets[0].note,
      ids: tickets.map((t) => t.id),
    });
    return json({ count: tickets.length }, 201);
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    throw err;
  }
}
