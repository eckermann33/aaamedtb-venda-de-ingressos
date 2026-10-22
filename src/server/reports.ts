import { searchableName } from "@/lib/validation";
import type { Sql } from "./db";

export type Stats = {
  confirmed: number;
  manualConfirmed: number;
  manualRevenueCents: number;
  byCategory: { categoryId: string; label: string; confirmed: number; revenueCents: number }[];
  approvedPayments: number;
  pendingActive: number;
  notCompleted: number;
  refunded: number;
  refundedCents: number;
  grossRevenueCents: number;
  ticketRevenueCents: number;
  feeRevenueCents: number;
  attention: number;
  capacity: number | null;
  available: number | null;
  lastWebhookAt: Date | null;
  lastWebhookOk: boolean | null;
};

export async function getStats(sql: Sql): Promise<Stats> {
  const [totals] = await sql<
    {
      confirmed: number;
      manual_confirmed: number;
      manual_revenue: number;
      gross: number;
      tickets: number;
      fees: number;
      pending_active: number;
      not_completed: number;
      refunded: number;
      refunded_cents: number;
      attention: number;
    }[]
  >`
    SELECT
      count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
      count(*) FILTER (WHERE status = 'confirmed' AND source = 'manual')::int AS manual_confirmed,
      coalesce(sum(amount_cents) FILTER (WHERE status = 'confirmed' AND source = 'manual'), 0)::int AS manual_revenue,
      coalesce(sum(amount_cents) FILTER (WHERE status = 'confirmed'), 0)::int AS gross,
      coalesce(sum(ticket_price_cents) FILTER (WHERE status = 'confirmed'), 0)::int AS tickets,
      coalesce(sum(fee_cents) FILTER (WHERE status = 'confirmed'), 0)::int AS fees,
      count(*) FILTER (WHERE status = 'pending' AND expires_at > now())::int AS pending_active,
      count(*) FILTER (WHERE status IN ('rejected', 'cancelled', 'expired', 'failed')
                          OR (status = 'pending' AND expires_at <= now()))::int AS not_completed,
      count(*) FILTER (WHERE status = 'refunded')::int AS refunded,
      coalesce(sum(amount_cents) FILTER (WHERE status = 'refunded'), 0)::int AS refunded_cents,
      count(*) FILTER (WHERE attention IS NOT NULL)::int AS attention
    FROM purchases
  `;
  const [payments] = await sql<{ approved: number }[]>`
    SELECT count(*)::int AS approved FROM payments WHERE status = 'approved' AND validation_error IS NULL
  `;
  const byCategory = await sql<{ category_id: string; label: string; confirmed: number; revenue: number }[]>`
    SELECT c.id AS category_id, c.label,
           count(p.id) FILTER (WHERE p.status = 'confirmed')::int AS confirmed,
           coalesce(sum(p.amount_cents) FILTER (WHERE p.status = 'confirmed'), 0)::int AS revenue
    FROM ticket_categories c
    LEFT JOIN purchases p ON p.category_id = c.id
    GROUP BY c.id, c.label, c.sort_order
    ORDER BY c.sort_order
  `;
  const [cfg] = await sql<{ capacity: number | null }[]>`SELECT capacity FROM settings WHERE id = 1`;
  const [hook] = await sql<{ received_at: Date; signature_ok: boolean }[]>`
    SELECT received_at, signature_ok FROM webhook_events ORDER BY received_at DESC LIMIT 1
  `;
  const capacity = cfg?.capacity ?? null;
  return {
    confirmed: totals.confirmed,
    manualConfirmed: totals.manual_confirmed,
    manualRevenueCents: totals.manual_revenue,
    byCategory: byCategory.map((r) => ({
      categoryId: r.category_id,
      label: r.label,
      confirmed: r.confirmed,
      revenueCents: r.revenue,
    })),
    approvedPayments: payments.approved,
    pendingActive: totals.pending_active,
    notCompleted: totals.not_completed,
    refunded: totals.refunded,
    refundedCents: totals.refunded_cents,
    grossRevenueCents: totals.gross,
    ticketRevenueCents: totals.tickets,
    feeRevenueCents: totals.fees,
    attention: totals.attention,
    capacity,
    available: capacity === null ? null : Math.max(0, capacity - totals.confirmed - totals.pending_active),
    lastWebhookAt: hook?.received_at ?? null,
    lastWebhookOk: hook?.signature_ok ?? null,
  };
}

export const STATUS_FILTERS = [
  "confirmed",
  "pending",
  "rejected",
  "cancelled",
  "expired",
  "refunded",
  "failed",
  "attention",
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export type ListFilters = {
  q?: string;
  category?: string;
  status?: StatusFilter;
  sort?: "name" | "date";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
};

export type ListRow = {
  id: string;
  full_name: string;
  buyer_phone: string | null;
  category_label: string;
  amount_cents: number;
  fee_cents: number;
  payment_method: string;
  source: string;
  note: string | null;
  lead_id: string | null;
  status: string;
  payment_status: string | null;
  attention: string | null;
  mp_payment_id: string | null;
  ticket_code: string | null;
  created_at: Date;
  confirmed_at: Date | null;
};

function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listPurchases(sql: Sql, f: ListFilters): Promise<{ rows: ListRow[]; total: number }> {
  const pageSize = Math.min(Math.max(f.pageSize ?? 50, 10), 200);
  const page = Math.max(f.page ?? 1, 1);
  const term = f.q ? searchableName(f.q).slice(0, 80) : "";

  const where = sql`
    WHERE true
    ${term ? sql`AND name_search LIKE ${likePattern(term)}` : sql``}
    ${f.category ? sql`AND category_id = ${f.category}` : sql``}
    ${
      f.status === "attention"
        ? sql`AND attention IS NOT NULL`
        : f.status
          ? sql`AND status = ${f.status}`
          : sql``
    }
  `;
  const direction = f.dir === "asc" ? sql`ASC` : sql`DESC`;
  const order =
    f.sort === "name"
      ? f.dir === "desc"
        ? sql`name_search DESC, created_at DESC`
        : sql`name_search ASC, created_at ASC`
      : sql`coalesce(confirmed_at, created_at) ${direction}`;

  const [{ total }] = await sql<{ total: number }[]>`SELECT count(*)::int AS total FROM purchases ${where}`;
  const rows = await sql<ListRow[]>`
    SELECT id, full_name, buyer_phone, category_label, amount_cents, fee_cents, payment_method, source, note, lead_id,
           status, payment_status, attention, mp_payment_id, ticket_code, created_at, confirmed_at
    FROM purchases ${where}
    ORDER BY ${order}
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `;
  return { rows, total };
}

export type OfficialRow = {
  full_name: string;
  category_label: string;
  amount_cents: number;
  ticket_code: string;
  confirmed_at: Date;
};

/** Lista oficial de entrada: somente compras com pagamento aprovado e confirmado. */
export async function officialList(sql: Sql): Promise<OfficialRow[]> {
  return sql<OfficialRow[]>`
    SELECT full_name, category_label, amount_cents, ticket_code, confirmed_at
    FROM purchases
    WHERE status = 'confirmed'
    ORDER BY name_search ASC, confirmed_at ASC
  `;
}

/** Todas as compras (relatório financeiro), da mais antiga para a mais recente. */
export async function allPurchases(sql: Sql): Promise<ListRow[]> {
  return sql<ListRow[]>`
    SELECT id, full_name, buyer_phone, category_label, amount_cents, fee_cents, payment_method, source, note, lead_id,
           status, payment_status, attention, mp_payment_id, ticket_code, created_at, confirmed_at
    FROM purchases
    ORDER BY created_at ASC, full_name ASC
  `;
}
