import { createHash } from "node:crypto";
import type { EventInfo, TermsContent } from "@/config/event";
import type { Sql, TxSql } from "./db";

export type Category = {
  id: string;
  label: string;
  priceCents: number;
  active: boolean;
  sortOrder: number;
};

export type Settings = {
  event: EventInfo;
  salesOpen: boolean;
  capacity: number | null;
  serviceFeeCents: number;
  termsVersionId: number;
  terms: TermsContent;
  categories: Category[];
  updatedAt: Date;
};

export type ReadinessItem = { key: string; label: string; blocking: boolean };

type SettingsRow = {
  event: EventInfo;
  sales_open: boolean;
  capacity: number | null;
  service_fee_cents: number;
  current_terms_version_id: number;
  terms_content: TermsContent;
  updated_at: Date;
};

export function termsHash(content: TermsContent): string {
  const canonical = JSON.stringify({
    rules: content.rules,
    refundPolicy: content.refundPolicy,
    cancellationPolicy: content.cancellationPolicy,
    transferPolicy: content.transferPolicy,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export async function loadCategories(sql: Sql | TxSql, onlyActive = false): Promise<Category[]> {
  const rows = await sql<{ id: string; label: string; price_cents: number; active: boolean; sort_order: number }[]>`
    SELECT id, label, price_cents, active, sort_order
    FROM ticket_categories
    WHERE ${onlyActive ? sql`active` : sql`true`}
    ORDER BY sort_order, label
  `;
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    priceCents: r.price_cents,
    active: r.active,
    sortOrder: r.sort_order,
  }));
}

export async function loadSettings(sql: Sql | TxSql, opts: { forUpdate?: boolean } = {}): Promise<Settings> {
  const rows = await sql<SettingsRow[]>`
    SELECT s.event, s.sales_open, s.capacity, s.service_fee_cents, s.current_terms_version_id, s.updated_at,
           t.content AS terms_content
    FROM settings s
    JOIN terms_versions t ON t.id = s.current_terms_version_id
    WHERE s.id = 1
    ${opts.forUpdate ? sql`FOR UPDATE OF s` : sql``}
  `;
  if (rows.length === 0) {
    throw new Error("Configuração não encontrada. Rode `npm run db:migrate`.");
  }
  const row = rows[0];
  return {
    event: row.event,
    salesOpen: row.sales_open,
    capacity: row.capacity,
    serviceFeeCents: row.service_fee_cents,
    termsVersionId: row.current_terms_version_id,
    terms: row.terms_content,
    categories: await loadCategories(sql),
    updatedAt: row.updated_at,
  };
}

/** Lista o que falta configurar antes de abrir as vendas. */
export function readiness(
  settings: Pick<Settings, "event" | "terms" | "capacity" | "categories">,
  envState: { mpAccessToken: boolean; mpWebhookSecret: boolean },
): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const e = settings.event;
  const t = settings.terms;
  const blank = (v: string | null | undefined) => !v || v.trim().length === 0;

  if (blank(e.date)) items.push({ key: "date", label: "Data do evento", blocking: true });
  if (blank(e.startTime)) items.push({ key: "startTime", label: "Horário de início", blocking: true });
  if (blank(e.venueName)) items.push({ key: "venueName", label: "Nome do local", blocking: true });
  if (blank(e.venueAddress)) items.push({ key: "venueAddress", label: "Endereço do local", blocking: true });
  if (blank(e.contactEmail)) {
    items.push({ key: "contactEmail", label: "E-mail de contato da organização (exigido pela LGPD)", blocking: true });
  }
  if (blank(t.refundPolicy)) items.push({ key: "refundPolicy", label: "Política de reembolso", blocking: true });
  if (blank(t.cancellationPolicy)) {
    items.push({ key: "cancellationPolicy", label: "Política de cancelamento do evento", blocking: true });
  }
  if (blank(t.transferPolicy)) items.push({ key: "transferPolicy", label: "Política de transferência de ingresso", blocking: true });
  if (!settings.categories.some((c) => c.active)) {
    items.push({ key: "categories", label: "Pelo menos uma categoria de ingresso ativa", blocking: true });
  }
  if (!envState.mpAccessToken) {
    items.push({ key: "mpAccessToken", label: "Credencial do Mercado Pago (MP_ACCESS_TOKEN)", blocking: true });
  }
  if (!envState.mpWebhookSecret) {
    items.push({ key: "mpWebhookSecret", label: "Assinatura secreta do webhook (MP_WEBHOOK_SECRET)", blocking: true });
  }
  if (settings.capacity === null) {
    items.push({ key: "capacity", label: "Limite de ingressos não definido (vendas sem limite)", blocking: false });
  }
  return items;
}

/** Salva uma nova versão dos termos se o conteúdo mudou. Retorna o id da versão atual. */
export async function upsertTermsVersion(sql: Sql | TxSql, content: TermsContent): Promise<number> {
  const hash = termsHash(content);
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO terms_versions (content, content_hash)
    VALUES (${sql.json(content)}, ${hash})
    ON CONFLICT (content_hash) DO UPDATE SET content_hash = EXCLUDED.content_hash
    RETURNING id
  `;
  return row.id;
}
