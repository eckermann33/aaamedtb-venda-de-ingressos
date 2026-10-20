import { z } from "zod";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { envState } from "@/server/deps";
import { errorResponse, json, readJson } from "@/server/http";
import { loadSettings, readiness, upsertTermsVersion } from "@/server/settings";

const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim())
    .nullable()
    .transform((s) => (s ? s : null));

const schema = z.object({
  event: z.object({
    name: z.string().trim().min(2).max(80),
    tagline: z.string().trim().max(160),
    organizer: z.string().trim().min(2).max(200),
    organizerShort: z.string().trim().min(2).max(60),
    partner: text(80),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .or(z.literal("").transform(() => null)),
    startTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .or(z.literal("").transform(() => null)),
    endTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullable()
      .or(z.literal("").transform(() => null)),
    venueName: text(120),
    venueAddress: text(250),
    ageRating: z.string().trim().min(2).max(200),
    about: z.string().trim().max(1500),
    camarote: z.string().trim().max(800),
    contactEmail: z.email().max(254).nullable().or(z.literal("").transform(() => null)),
    contactInstagram: text(60),
    statementDescriptor: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 ]{3,13}$/, "Use até 13 letras/números"),
    retentionDays: z.number().int().min(1).max(3650),
  }),
  capacity: z.number().int().positive().max(100000).nullable(),
  serviceFeeCents: z.number().int().min(0).max(10000),
  terms: z.object({
    rules: z.array(z.string().trim().min(3).max(400)).min(1).max(30),
    refundPolicy: text(3000),
    cancellationPolicy: text(3000),
    transferPolicy: text(3000),
  }),
  categories: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{2,32}$/),
        label: z.string().trim().min(2).max(40),
        priceCents: z.number().int().min(100).max(100000),
        active: z.boolean(),
        sortOrder: z.number().int().min(0).max(100),
      }),
    )
    .min(1)
    .max(10),
});

export async function PUT(request: Request) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const parsed = schema.safeParse(await readJson(request, 64_000).catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return errorResponse(`Campo inválido: ${issue.path.join(".")} — ${issue.message}`, 400, "validation");
  }
  const data = parsed.data;
  const ids = new Set(data.categories.map((c) => c.id));
  if (ids.size !== data.categories.length) return errorResponse("Há categorias com o mesmo identificador.", 400);

  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const before = await loadSettings(tx, { forUpdate: true });
    const termsVersionId = await upsertTermsVersion(tx, data.terms);
    await tx`
      UPDATE settings SET
        event = ${tx.json(data.event as never)},
        capacity = ${data.capacity},
        service_fee_cents = ${data.serviceFeeCents},
        current_terms_version_id = ${termsVersionId},
        updated_at = now()
      WHERE id = 1
    `;
    for (const c of data.categories) {
      await tx`
        INSERT INTO ticket_categories (id, label, price_cents, active, sort_order)
        VALUES (${c.id}, ${c.label}, ${c.priceCents}, ${c.active}, ${c.sortOrder})
        ON CONFLICT (id) DO UPDATE SET
          label = EXCLUDED.label, price_cents = EXCLUDED.price_cents,
          active = EXCLUDED.active, sort_order = EXCLUDED.sort_order, updated_at = now()
      `;
    }
    // Categorias removidas do formulário ficam inativas (o histórico de compras é preservado).
    await tx`UPDATE ticket_categories SET active = false, updated_at = now() WHERE id <> ALL(${[...ids]})`;

    const after = await loadSettings(tx);
    // Se algo obrigatório foi apagado com as vendas abertas, fecha as vendas por segurança.
    let closedSales = false;
    if (after.salesOpen && readiness(after, envState()).some((i) => i.blocking)) {
      await tx`UPDATE settings SET sales_open = false WHERE id = 1`;
      closedSales = true;
    }
    await audit(tx, admin.id, "settings_updated", {
      termsChanged: termsVersionId !== before.termsVersionId,
      termsVersionId,
      prices: data.categories.map((c) => `${c.id}:${c.priceCents}:${c.active ? "on" : "off"}`),
      serviceFeeCents: data.serviceFeeCents,
      capacity: data.capacity,
      closedSales,
    });
    return { termsVersionId, closedSales };
  });
  return json({ ok: true, ...result });
}
