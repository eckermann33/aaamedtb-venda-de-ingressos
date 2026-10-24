import { randomBytes, randomUUID } from "node:crypto";
import { MAX_TICKETS_PER_ORDER, PAYMENT_WINDOW_MINUTES, RESERVATION_GRACE_MINUTES } from "@/config/event";
import { phoneDigits } from "@/lib/contact";
import { cleanName, searchableName, validateFullName, type PurchaseRequest } from "@/lib/validation";
import type { Sql, TxSql } from "./db";
import { errorInfo, logger } from "./logger";
import type { MercadoPagoClient, MpPayment } from "./mercadopago";
import { loadSettings, readiness } from "./settings";

export type PurchaseStatus = "pending" | "confirmed" | "rejected" | "cancelled" | "expired" | "refunded" | "failed";

export type PurchaseRow = {
  id: string;
  client_request_id: string;
  full_name: string;
  buyer_phone: string | null;
  category_id: string;
  category_label: string;
  ticket_price_cents: number;
  fee_cents: number;
  amount_cents: number;
  camarote: boolean;
  camarote_extra_cents: number | null;
  payment_method: "pix" | "card" | "manual";
  lead_id: string | null;
  source: "online" | "manual";
  note: string | null;
  status: PurchaseStatus;
  payment_status: string | null;
  payment_status_detail: string | null;
  mp_payment_id: string | null;
  mp_preference_id: string | null;
  checkout_url: string | null;
  ticket_code: string | null;
  expires_at: Date;
  confirmed_at: Date | null;
  refunded_at: Date | null;
  attention: string | null;
  last_checked_at: Date | null;
  terms_version_id: number;
  terms_accepted_at: Date;
  anonymized_at: Date | null;
  created_at: Date;
};

export class PurchaseError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "PurchaseError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Código interno do ingresso (ex.: INV-7K2M9QXA4C). Não é exibido ao comprador. */
export function generateTicketCode(): string {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += alphabet[b % 32];
  return `INV-${out}`;
}

/**
 * Ingressos que ocupam vaga: confirmados + reservas pendentes ainda válidas.
 * `excludeLeadId` ignora todos os ingressos de um pedido (o próprio, ao confirmá-lo).
 */
async function countOccupied(tx: TxSql, excludeLeadId: string | null): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM purchases
    WHERE (status = 'confirmed' OR (status = 'pending' AND expires_at > now()))
      AND ${excludeLeadId ? tx`id <> ${excludeLeadId} AND lead_id IS DISTINCT FROM ${excludeLeadId}` : tx`true`}
  `;
  return row.n;
}

export type CreateDeps = {
  sql: Sql;
  mp: MercadoPagoClient;
  appUrl: string;
  envState: { mpAccessToken: boolean; mpWebhookSecret: boolean };
};

export type TicketHolder = { fullName: string; categoryId: string; camarote?: boolean };

/** Id da categoria que define o preço do camarote (adicional ou ingresso só de camarote). */
export const CAMAROTE_CATEGORY = "camarote";

/**
 * Cria o pedido pendente (com reserva de vagas) e inicia o pagamento no Mercado Pago.
 * O pedido tem de 1 a MAX_TICKETS_PER_ORDER ingressos, cada um com o nome do titular; o
 * pagamento é único. O preço vem SEMPRE do banco de dados — nenhum valor do navegador é usado.
 * Retorna a linha principal do pedido (os demais ingressos apontam para ela em lead_id).
 */
export async function createPurchase(deps: CreateDeps, input: PurchaseRequest): Promise<PurchaseRow> {
  const { sql, mp } = deps;
  const holders: TicketHolder[] = [
    { fullName: input.fullName, categoryId: input.categoryId, camarote: input.camarote },
    ...(input.extraTickets ?? []),
  ];
  if (holders.length > MAX_TICKETS_PER_ORDER) {
    throw new PurchaseError("too_many", `Você pode comprar até ${MAX_TICKETS_PER_ORDER} ingressos por pedido.`, 400);
  }
  for (const [i, h] of holders.entries()) {
    const nameError = validateFullName(h.fullName);
    if (nameError) {
      throw new PurchaseError("invalid_name", holders.length > 1 ? `Ingresso ${i + 1}: ${nameError}` : nameError, 400);
    }
  }
  const buyerPhone = phoneDigits(input.buyerPhone);
  if (!buyerPhone) {
    throw new PurchaseError("invalid_phone", "Informe um celular/WhatsApp com DDD, só com números.", 400);
  }
  const tickets = holders.map((h) => ({
    fullName: cleanName(h.fullName),
    categoryId: h.categoryId,
    camarote: h.categoryId === CAMAROTE_CATEGORY ? true : !!h.camarote,
  }));
  const searchKeys = tickets.map((t) => searchableName(t.fullName));
  if (new Set(searchKeys).size !== searchKeys.length) {
    throw new PurchaseError("duplicate_name", "Há nomes repetidos no pedido. Cada ingresso precisa de uma pessoa diferente.", 400);
  }

  const existing = await findByClientRequestId(sql, input.clientRequestId);
  if (existing) return sameRequestOrThrow(sql, existing, tickets, input);

  const windowMs = PAYMENT_WINDOW_MINUTES * 60_000;
  const reservationMs = windowMs + RESERVATION_GRACE_MINUTES * 60_000;

  const created = await sql.begin(async (tx) => {
    // Trava a linha de configuração: serializa reservas e respeita a lotação mesmo com compras simultâneas.
    const settings = await loadSettings(tx, { forUpdate: true });
    if (!settings.salesOpen) {
      throw new PurchaseError("sales_closed", "As vendas estão fechadas no momento.", 409);
    }
    if (readiness(settings, deps.envState).some((i) => i.blocking)) {
      throw new PurchaseError("not_ready", "As vendas ainda não estão disponíveis.", 409);
    }
    if (input.termsVersionId !== settings.termsVersionId) {
      throw new PurchaseError(
        "terms_changed",
        "As regras do evento foram atualizadas. Recarregue a página, revise e aceite novamente.",
        409,
      );
    }
    const camaroteCategory = settings.categories.find((c) => c.id === CAMAROTE_CATEGORY && c.active) ?? null;
    const priced = tickets.map((t) => {
      const category = settings.categories.find((c) => c.id === t.categoryId && c.active);
      if (!category) throw new PurchaseError("invalid_category", "Categoria de ingresso inválida.", 400);
      // Adicional de camarote: soma o valor da categoria "camarote" ao ingresso escolhido.
      const addon = t.camarote && category.id !== CAMAROTE_CATEGORY ? camaroteCategory : null;
      if (t.camarote && category.id !== CAMAROTE_CATEGORY && !addon) {
        throw new PurchaseError("invalid_category", "O camarote não está disponível no momento.", 400);
      }
      return {
        ...t,
        category,
        addon,
        priceCents: category.priceCents + (addon?.priceCents ?? 0),
        label: addon ? `${category.label} + Camarote` : category.label,
      };
    });

    if (settings.capacity !== null) {
      const occupied = await countOccupied(tx, null);
      const left = settings.capacity - occupied;
      if (left <= 0) {
        throw new PurchaseError("sold_out", "Os ingressos esgotaram (ou estão todos reservados no momento).", 409);
      }
      if (priced.length > left) {
        throw new PurchaseError(
          "not_enough",
          `Restam apenas ${left} ${left === 1 ? "ingresso disponível" : "ingressos disponíveis"}. Diminua a quantidade do pedido.`,
          409,
        );
      }
    }

    const insert = (t: (typeof priced)[number], clientRequestId: string, leadId: string | null) => tx<PurchaseRow[]>`
      INSERT INTO purchases (
        client_request_id, lead_id, full_name, name_search, buyer_phone, category_id, category_label, camarote,
        ticket_price_cents, fee_cents, amount_cents, payment_method, adult_confirmed, terms_version_id, terms_accepted_at, expires_at
      ) VALUES (
        ${clientRequestId}, ${leadId}, ${t.fullName}, ${searchableName(t.fullName)}, ${buyerPhone}, ${t.category.id}, ${t.label}, ${t.camarote},
        ${t.priceCents}, ${settings.serviceFeeCents}, ${t.priceCents + settings.serviceFeeCents},
        ${input.paymentMethod}, true, ${settings.termsVersionId}, now(),
        now() + ${reservationMs / 1000} * interval '1 second'
      )
      ON CONFLICT (client_request_id) DO NOTHING
      RETURNING *
    `;
    const [leadRow] = await insert(priced[0], input.clientRequestId, null);
    if (!leadRow) return null;
    for (const t of priced.slice(1)) await insert(t, randomUUID(), leadRow.id);
    return { lead: leadRow, priced, eventName: settings.event.name, statementDescriptor: settings.event.statementDescriptor, fee: settings.serviceFeeCents };
  });

  if (!created) {
    // Outra requisição com a mesma chave chegou primeiro (clique duplo).
    const again = await findByClientRequestId(sql, input.clientRequestId);
    if (!again) throw new PurchaseError("conflict", "Tente novamente.", 409);
    return sameRequestOrThrow(sql, again, tickets, input);
  }
  const purchase = created.lead;

  // Itens do checkout: um por categoria (com a quantidade) + a taxa de serviço por ingresso.
  const byCategory = new Map<string, { id: string; title: string; quantity: number; unitPriceCents: number }>();
  for (const t of created.priced) {
    const item = byCategory.get(t.category.id);
    if (item) item.quantity += 1;
    else {
      byCategory.set(t.category.id, {
        id: t.category.id,
        title: `Ingresso ${created.eventName} — ${t.category.label}`,
        quantity: 1,
        unitPriceCents: t.category.priceCents,
      });
    }
    if (t.addon) {
      const extra = byCategory.get(t.addon.id);
      if (extra) extra.quantity += 1;
      else {
        byCategory.set(t.addon.id, {
          id: t.addon.id,
          title: `Camarote ${created.eventName}`,
          quantity: 1,
          unitPriceCents: t.addon.priceCents,
        });
      }
    }
  }
  const items = [...byCategory.values()];
  if (created.fee > 0) {
    items.push({ id: "taxa-servico", title: "Taxa de serviço", quantity: created.priced.length, unitPriceCents: created.fee });
  }

  try {
    // Pix e cartão usam o Checkout Pro: o comprador é levado ao ambiente do Mercado Pago.
    const preference = await mp.createCheckoutPreference({
      method: purchase.payment_method as "pix" | "card",
      purchaseId: purchase.id,
      items,
      expiresAt: new Date(Date.now() + windowMs),
      backUrl: `${deps.appUrl}/pedido/${purchase.id}`,
      statementDescriptor: created.statementDescriptor,
    });
    await sql`
      UPDATE purchases SET mp_preference_id = ${preference.id}, checkout_url = ${preference.init_point}, updated_at = now()
      WHERE id = ${purchase.id}
    `;
  } catch (err) {
    logger.error("Falha ao iniciar pagamento no Mercado Pago", { purchaseId: purchase.id, ...errorInfo(err) });
    await sql`
      UPDATE purchases SET status = 'failed', updated_at = now()
      WHERE (id = ${purchase.id} OR lead_id = ${purchase.id}) AND status = 'pending'
    `;
    throw new PurchaseError(
      "payment_unavailable",
      "Não foi possível iniciar o pagamento agora. Nenhuma cobrança foi feita. Tente novamente em instantes.",
      502,
    );
  }

  return (await getPurchase(sql, purchase.id))!;
}

async function sameRequestOrThrow(
  sql: Sql,
  existing: PurchaseRow,
  tickets: { fullName: string; categoryId: string; camarote: boolean }[],
  input: PurchaseRequest,
): Promise<PurchaseRow> {
  const group = await getOrderTickets(sql, existing.id);
  const key = (name: string, category: string, camarote: boolean) => `${category}|${camarote}|${name}`;
  const sent = tickets.map((t) => key(t.fullName, t.categoryId, t.camarote)).sort();
  const saved = group.map((g) => key(g.full_name, g.category_id, g.camarote)).sort();
  const same =
    existing.lead_id === null &&
    existing.payment_method === input.paymentMethod &&
    sent.length === saved.length &&
    sent.every((k, i) => k === saved[i]);
  if (!same) throw new PurchaseError("conflict", "Esta tentativa de compra já foi usada. Recarregue a página.", 409);
  return existing;
}

async function findByClientRequestId(sql: Sql, clientRequestId: string): Promise<PurchaseRow | null> {
  const rows = await sql<PurchaseRow[]>`SELECT * FROM purchases WHERE client_request_id = ${clientRequestId}`;
  return rows[0] ?? null;
}

export async function getPurchase(sql: Sql | TxSql, id: string): Promise<PurchaseRow | null> {
  if (!isUuid(id)) return null;
  const rows = await sql<PurchaseRow[]>`SELECT * FROM purchases WHERE id = ${id}`;
  return rows[0] ?? null;
}

/** Todos os ingressos de um pedido (a linha principal primeiro), na ordem em que foram informados. */
export async function getOrderTickets(sql: Sql | TxSql, leadId: string): Promise<PurchaseRow[]> {
  return sql<PurchaseRow[]>`
    SELECT * FROM purchases WHERE id = ${leadId} OR lead_id = ${leadId}
    ORDER BY (lead_id IS NULL) DESC, name_search, id
  `;
}

/** Pedido online (linha principal + ingressos), ou null se o id não for de um pedido online. */
export async function getOrder(sql: Sql | TxSql, id: string): Promise<{ lead: PurchaseRow; tickets: PurchaseRow[] } | null> {
  const lead = await getPurchase(sql, id);
  if (!lead || lead.lead_id !== null || lead.source !== "online") return null;
  return { lead, tickets: await getOrderTickets(sql, lead.id) };
}

export type ApplyResult =
  | "unknown_reference"
  | "invalid_payment"
  | "confirmed"
  | "already_confirmed"
  | "duplicate_payment"
  | "over_capacity"
  | "refunded"
  | "updated"
  | "ignored";

/**
 * Aplica o estado REAL de um pagamento (consultado na API do Mercado Pago) à compra.
 * É idempotente: receber o mesmo pagamento várias vezes não duplica nada.
 */
export async function applyPayment(sql: Sql, payment: MpPayment): Promise<ApplyResult> {
  const purchaseId = payment.external_reference;
  if (!isUuid(purchaseId)) return "unknown_reference";
  const paymentId = String(payment.id);

  return sql.begin(async (tx) => {
    // O pagamento pertence ao pedido: a linha principal (lead_id nulo) e, se houver, os outros ingressos.
    const rows = await tx<PurchaseRow[]>`
      SELECT * FROM purchases WHERE id = ${purchaseId} AND lead_id IS NULL AND source = 'online' FOR UPDATE
    `;
    const purchase = rows[0];
    if (!purchase) return "unknown_reference" as const;
    const group = await tx<PurchaseRow[]>`
      SELECT * FROM purchases WHERE lead_id = ${purchase.id} ORDER BY name_search, id FOR UPDATE
    `;
    const inOrder = tx`(id = ${purchase.id} OR lead_id = ${purchase.id})`;
    const orderSize = group.length + 1;
    const orderAmount = group.reduce((sum, t) => sum + t.amount_cents, purchase.amount_cents);

    // Validação do pagamento contra o pedido (valor total de todos os ingressos).
    const amountCents = payment.transaction_amount == null ? null : Math.round(payment.transaction_amount * 100);
    let validationError: string | null = null;
    if (amountCents !== orderAmount) validationError = "amount_mismatch";
    else if (payment.currency_id && payment.currency_id !== "BRL") validationError = "currency_mismatch";

    await tx`
      INSERT INTO payments (mp_payment_id, purchase_id, status, status_detail, amount_cents, currency,
                            payment_method_id, payment_type_id, live_mode, date_approved, validation_error)
      VALUES (${paymentId}, ${purchase.id}, ${payment.status}, ${payment.status_detail ?? null}, ${amountCents},
              ${payment.currency_id ?? null}, ${payment.payment_method_id ?? null}, ${payment.payment_type_id ?? null},
              ${payment.live_mode ?? null}, ${payment.date_approved ? new Date(payment.date_approved) : null},
              ${validationError})
      ON CONFLICT (mp_payment_id) DO UPDATE SET
        status = EXCLUDED.status,
        status_detail = EXCLUDED.status_detail,
        amount_cents = EXCLUDED.amount_cents,
        date_approved = EXCLUDED.date_approved,
        validation_error = EXCLUDED.validation_error,
        updated_at = now()
      WHERE payments.purchase_id = EXCLUDED.purchase_id
    `;

    if (validationError) {
      logger.warn("Pagamento com dados divergentes da compra", { purchaseId, paymentId, validationError });
      if (payment.status === "approved" && purchase.status !== "confirmed") {
        await tx`UPDATE purchases SET attention = 'amount_mismatch', updated_at = now() WHERE id = ${purchase.id}`;
      }
      return "invalid_payment" as const;
    }

    const isConfirmingPayment = purchase.mp_payment_id === paymentId;

    switch (payment.status) {
      case "approved": {
        if (purchase.status === "confirmed" || purchase.status === "refunded") {
          if (isConfirmingPayment) return "already_confirmed" as const;
          // Segundo pagamento aprovado para a mesma compra: precisa ser estornado.
          await tx`UPDATE purchases SET attention = 'duplicate_payment', updated_at = now() WHERE id = ${purchase.id}`;
          return "duplicate_payment" as const;
        }
        // Confirmação respeitando a lotação (trava a configuração para evitar corrida).
        const [cfg] = await tx<{ capacity: number | null }[]>`SELECT capacity FROM settings WHERE id = 1 FOR UPDATE`;
        if (cfg.capacity !== null) {
          const occupied = await countOccupied(tx, purchase.id);
          if (occupied + orderSize > cfg.capacity) {
            await tx`
              UPDATE purchases SET attention = 'over_capacity', payment_status = 'approved', updated_at = now()
              WHERE id = ${purchase.id}
            `;
            logger.warn("Pagamento aprovado acima da lotação: requer estorno", { purchaseId, paymentId });
            return "over_capacity" as const;
          }
        }
        const confirmedAt = payment.date_approved ? new Date(payment.date_approved) : new Date();
        // Cada ingresso do pedido recebe o seu código; o pagamento fica registrado na linha principal.
        for (const t of [purchase, ...group]) {
          await tx`
            UPDATE purchases SET
              status = 'confirmed',
              payment_status = 'approved',
              payment_status_detail = ${payment.status_detail ?? null},
              mp_payment_id = ${t.id === purchase.id ? paymentId : null},
              ticket_code = ${generateTicketCode()},
              confirmed_at = ${confirmedAt},
              attention = CASE WHEN attention IN ('over_capacity', 'amount_mismatch') THEN NULL ELSE attention END,
              updated_at = now()
            WHERE id = ${t.id} AND status <> 'confirmed'
          `;
        }
        logger.info("Compra confirmada", { purchaseId, paymentId, tickets: orderSize });
        return "confirmed" as const;
      }

      case "refunded":
      case "charged_back": {
        if (isConfirmingPayment && purchase.status === "confirmed") {
          await tx`
            UPDATE purchases SET status = 'refunded', payment_status = ${payment.status},
              payment_status_detail = ${payment.status_detail ?? null}, refunded_at = now(), updated_at = now()
            WHERE ${inOrder} AND status = 'confirmed'
          `;
          return "refunded" as const;
        }
        if (!isConfirmingPayment) {
          // Estorno de um pagamento excedente: limpa o alerta se não houver outro aprovado pendente.
          const [left] = await tx<{ n: number }[]>`
            SELECT count(*)::int AS n FROM payments
            WHERE purchase_id = ${purchase.id} AND status = 'approved'
              AND mp_payment_id IS DISTINCT FROM ${purchase.mp_payment_id}
          `;
          if (left.n === 0 && purchase.attention !== "in_mediation") {
            await tx`UPDATE purchases SET attention = NULL, updated_at = now() WHERE id = ${purchase.id}`;
          }
        }
        return "updated" as const;
      }

      case "rejected":
      case "cancelled": {
        if (purchase.status !== "pending") return "ignored" as const;
        // O comprador pode tentar de novo (outro cartão, novo Pix) enquanto a reserva estiver válida.
        await tx`
          UPDATE purchases SET payment_status = ${payment.status},
            payment_status_detail = ${payment.status_detail ?? null}, updated_at = now()
          WHERE id = ${purchase.id}
        `;
        return "updated" as const;
      }

      case "in_mediation": {
        if (isConfirmingPayment) {
          await tx`
            UPDATE purchases SET attention = 'in_mediation', payment_status = 'in_mediation', updated_at = now()
            WHERE id = ${purchase.id}
          `;
        }
        return "updated" as const;
      }

      default: {
        // pending, in_process, authorized: aguardando.
        if (purchase.status === "pending") {
          await tx`
            UPDATE purchases SET payment_status = ${payment.status},
              payment_status_detail = ${payment.status_detail ?? null}, updated_at = now()
            WHERE id = ${purchase.id}
          `;
        }
        return "updated" as const;
      }
    }
  });
}

/** Encerra reservas vencidas que não foram pagas. */
export async function expireIfStale(sql: Sql, id: string) {
  await sql.begin(async (tx) => {
    const lead = await tx<{ status: string }[]>`
      UPDATE purchases
      SET status = CASE WHEN payment_status = 'rejected' THEN 'rejected' ELSE 'expired' END, updated_at = now()
      WHERE id = ${id} AND lead_id IS NULL AND status = 'pending' AND expires_at < now()
      RETURNING status
    `;
    // Os demais ingressos do pedido acompanham a linha principal.
    if (lead[0]) {
      await tx`
        UPDATE purchases SET status = ${lead[0].status}, updated_at = now()
        WHERE lead_id = ${id} AND status = 'pending'
      `;
    }
  });
}

/**
 * Consulta o Mercado Pago e atualiza a compra. Usado quando o comprador volta
 * para a página, pelo painel e pela rotina periódica — complementa o webhook.
 */
export async function reconcilePurchase(
  sql: Sql,
  mp: MercadoPagoClient,
  id: string,
  opts: { minIntervalSeconds?: number; hintPaymentId?: string } = {},
): Promise<void> {
  const interval = opts.minIntervalSeconds ?? 10;
  const claimed = await sql<PurchaseRow[]>`
    UPDATE purchases SET last_checked_at = now()
    WHERE id = ${id} AND lead_id IS NULL AND source = 'online'
      AND (status = 'pending' OR attention IS NOT NULL)
      AND (last_checked_at IS NULL OR last_checked_at < now() - ${interval} * interval '1 second')
    RETURNING *
  `;
  const purchase = claimed[0];
  if (!purchase) return;

  try {
    // Uma compra pode ter várias tentativas de pagamento: busca todas pela referência externa.
    const payments: MpPayment[] = await mp.searchPaymentsByReference(purchase.id);
    if (opts.hintPaymentId && /^\d{1,20}$/.test(opts.hintPaymentId) && !payments.some((p) => String(p.id) === opts.hintPaymentId)) {
      const hinted = await mp.getPayment(opts.hintPaymentId);
      if (hinted.external_reference === purchase.id) payments.push(hinted);
    }
    // Processa aprovados por último para que prevaleçam sobre tentativas recusadas.
    payments.sort((a, b) => Number(a.status === "approved") - Number(b.status === "approved"));
    for (const p of payments) {
      if (p.external_reference === purchase.id) await applyPayment(sql, p);
    }
  } catch (err) {
    logger.warn("Falha ao consultar pagamento no Mercado Pago", { purchaseId: id, ...errorInfo(err) });
  }
  await expireIfStale(sql, id);
}

export async function reconcilePending(sql: Sql, mp: MercadoPagoClient, limit = 50): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM purchases
    WHERE lead_id IS NULL AND source = 'online'
      AND (status = 'pending' OR (attention IS NOT NULL AND attention <> 'in_mediation'))
    ORDER BY created_at
    LIMIT ${limit}
  `;
  for (const r of rows) await reconcilePurchase(sql, mp, r.id, { minIntervalSeconds: 0 });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Visão pública da compra (o que o comprador vê na página do pedido).
// ---------------------------------------------------------------------------

export type PublicState =
  | "preparing"
  | "awaiting_payment"
  | "payment_rejected"
  | "approved"
  | "rejected"
  | "expired"
  | "cancelled"
  | "refunded"
  | "failed"
  | "attention";

export type PublicTicket = { fullName: string; categoryLabel: string; ticketPriceCents: number };

export type PublicPurchase = {
  id: string;
  /** Titular do primeiro ingresso (quem fez o pedido). */
  fullName: string;
  categoryLabel: string;
  /** Todos os ingressos do pedido. */
  tickets: PublicTicket[];
  /** Totais do pedido: soma dos ingressos, das taxas e valor final. */
  ticketPriceCents: number;
  feeCents: number;
  amountCents: number;
  paymentMethod: "pix" | "card";
  state: PublicState;
  expiresAt: string;
  confirmedAt: string | null;
  checkoutUrl: string | null;
};

export function publicState(p: PurchaseRow, now = new Date()): PublicState {
  switch (p.status) {
    case "confirmed":
      return "approved";
    case "refunded":
      return "refunded";
    case "failed":
      return "failed";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "expired":
      return p.attention === "over_capacity" || p.attention === "amount_mismatch" ? "attention" : "expired";
    case "pending": {
      if (p.attention === "over_capacity" || p.attention === "amount_mismatch") return "attention";
      if (p.expires_at < now) return p.payment_status === "rejected" ? "rejected" : "expired";
      // Última tentativa não concluída (recusada, cancelada ou Pix expirado): pode tentar de novo.
      if (p.payment_status === "rejected" || p.payment_status === "cancelled") return "payment_rejected";
      if (!p.checkout_url) return "preparing";
      return "awaiting_payment";
    }
  }
}

/** `order` = todos os ingressos do pedido (a linha principal primeiro). */
export function toPublic(p: PurchaseRow, order: PurchaseRow[] = [p]): PublicPurchase {
  const state = publicState(p);
  const awaiting = state === "awaiting_payment" || state === "payment_rejected";
  const sum = (f: (t: PurchaseRow) => number) => order.reduce((n, t) => n + f(t), 0);
  return {
    id: p.id,
    fullName: p.full_name,
    categoryLabel: p.category_label,
    tickets: order.map((t) => ({
      fullName: t.full_name,
      categoryLabel: t.category_label,
      ticketPriceCents: t.ticket_price_cents,
    })),
    ticketPriceCents: sum((t) => t.ticket_price_cents),
    feeCents: sum((t) => t.fee_cents),
    amountCents: sum((t) => t.amount_cents),
    paymentMethod: p.payment_method === "card" ? "card" : "pix",
    state,
    // Prazo mostrado ao comprador (a reserva interna dura um pouco mais).
    expiresAt: new Date(p.expires_at.getTime() - RESERVATION_GRACE_MINUTES * 60_000).toISOString(),
    confirmedAt: p.confirmed_at?.toISOString() ?? null,
    checkoutUrl: awaiting ? p.checkout_url : null,
  };
}

// ---------------------------------------------------------------------------
// Operações administrativas.
// ---------------------------------------------------------------------------

/** Estorna um pagamento aprovado de uma compra (total). */
export async function refundPurchasePayment(
  sql: Sql,
  mp: MercadoPagoClient,
  purchaseId: string,
  mpPaymentId: string,
): Promise<ApplyResult> {
  const rows = await sql<{ status: string }[]>`
    SELECT status FROM payments WHERE purchase_id = ${purchaseId} AND mp_payment_id = ${mpPaymentId}
  `;
  if (!rows[0]) throw new PurchaseError("not_found", "Pagamento não encontrado para esta compra.", 404);
  if (rows[0].status !== "approved") {
    throw new PurchaseError("not_refundable", "Somente pagamentos aprovados podem ser estornados.", 409);
  }
  await mp.refundPayment(mpPaymentId, `refund-${mpPaymentId}`);
  const payment = await mp.getPayment(mpPaymentId);
  return applyPayment(sql, payment);
}

/**
 * Transferência de ingresso: troca o nome na lista oficial. Só vale para
 * compras confirmadas; o código interno do ingresso continua o mesmo.
 */
export async function transferPurchase(sql: Sql, id: string, newName: string): Promise<PurchaseRow> {
  const error = validateFullName(newName);
  if (error) throw new PurchaseError("invalid_name", error, 400);
  const name = cleanName(newName);
  const rows = await sql<PurchaseRow[]>`
    UPDATE purchases SET full_name = ${name}, name_search = ${searchableName(name)}, updated_at = now()
    WHERE id = ${id} AND status = 'confirmed' AND anonymized_at IS NULL
    RETURNING *
  `;
  if (!rows[0]) {
    throw new PurchaseError("not_transferable", "Só é possível transferir ingressos confirmados.", 409);
  }
  return rows[0];
}

export const ANONYMIZED_NAME = "Titular removido";

/** Remove o nome de uma compra (pedido do titular ou fim do prazo de retenção). */
export async function anonymizePurchase(sql: Sql | TxSql, id: string): Promise<boolean> {
  const rows = await sql`
    UPDATE purchases SET full_name = ${ANONYMIZED_NAME}, name_search = '', buyer_phone = NULL, anonymized_at = now(), updated_at = now()
    WHERE id = ${id} AND anonymized_at IS NULL
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Anonimiza todas as compras finalizadas. Valores, datas e identificadores do
 * Mercado Pago são mantidos para prestação de contas.
 */
export async function anonymizeAll(sql: Sql): Promise<number> {
  const rows = await sql`
    UPDATE purchases SET full_name = ${ANONYMIZED_NAME}, name_search = '', buyer_phone = NULL, anonymized_at = now(), updated_at = now()
    WHERE anonymized_at IS NULL AND NOT (status = 'pending' AND expires_at > now())
    RETURNING id
  `;
  return rows.length;
}

// ---------------------------------------------------------------------------
// Ingressos manuais (lançados pela organização no painel).
// ---------------------------------------------------------------------------

export type ManualTicketsInput = {
  /** Um nome completo por ingresso. */
  names: string[];
  categoryId: string;
  /** Valor pago por ingresso, em centavos. Nulo = preço da categoria; 0 = cortesia. */
  priceCents: number | null;
  /** Celular/WhatsApp de quem comprou (opcional). */
  phone: string | null;
  /** Observação interna: forma de pagamento, quem vendeu, convidado de quem... */
  note: string | null;
};

/**
 * Lança ingressos já pagos fora do site (venda por WhatsApp, Pix direto, dinheiro) ou cortesias.
 * Nascem confirmados, entram na lista oficial e ocupam vaga na lotação, sem taxa de serviço.
 */
export async function createManualTickets(sql: Sql, input: ManualTicketsInput): Promise<PurchaseRow[]> {
  const names = input.names.map(cleanName).filter((n) => n.length > 0);
  if (names.length === 0) throw new PurchaseError("invalid_name", "Informe pelo menos um nome.", 400);
  if (names.length > 50) throw new PurchaseError("too_many", "Lance no máximo 50 ingressos por vez.", 400);
  for (const name of names) {
    const error = validateFullName(name);
    if (error) throw new PurchaseError("invalid_name", `${name}: ${error}`, 400);
  }
  const phone = input.phone && input.phone.trim() ? phoneDigits(input.phone) : null;
  if (input.phone && input.phone.trim() && !phone) {
    throw new PurchaseError("invalid_phone", "Celular inválido. Informe com DDD, só números (ou deixe em branco).", 400);
  }
  if (input.priceCents !== null && (!Number.isInteger(input.priceCents) || input.priceCents < 0 || input.priceCents > 100_000)) {
    throw new PurchaseError("invalid_price", "Valor inválido.", 400);
  }
  const note = input.note?.trim() ? input.note.trim().slice(0, 200) : null;

  return sql.begin(async (tx) => {
    const settings = await loadSettings(tx, { forUpdate: true });
    const category = settings.categories.find((c) => c.id === input.categoryId);
    if (!category) throw new PurchaseError("invalid_category", "Categoria de ingresso inválida.", 400);
    if (settings.capacity !== null) {
      const left = settings.capacity - (await countOccupied(tx, null));
      if (names.length > left) {
        throw new PurchaseError(
          "not_enough",
          left <= 0
            ? "A lotação já foi atingida. Aumente o limite em Configurações para lançar mais ingressos."
            : `Restam apenas ${left} vagas na lotação. Aumente o limite em Configurações ou lance menos ingressos.`,
          409,
        );
      }
    }
    const price = input.priceCents ?? category.priceCents;
    const rows: PurchaseRow[] = [];
    for (const name of names) {
      const [row] = await tx<PurchaseRow[]>`
        INSERT INTO purchases (
          client_request_id, full_name, name_search, buyer_phone, category_id, category_label,
          ticket_price_cents, fee_cents, amount_cents, payment_method, source, note, status,
          adult_confirmed, terms_version_id, terms_accepted_at, ticket_code, expires_at, confirmed_at
        ) VALUES (
          ${randomUUID()}, ${name}, ${searchableName(name)}, ${phone}, ${category.id}, ${category.label},
          ${price}, 0, ${price}, 'manual', 'manual', ${note}, 'confirmed',
          true, ${settings.termsVersionId}, now(), ${generateTicketCode()}, now(), now()
        )
        RETURNING *
      `;
      rows.push(row);
    }
    return rows;
  });
}

/** Remove um ingresso manual da lista (ex.: lançado por engano). Libera a vaga. */
export async function cancelManualTicket(sql: Sql, id: string): Promise<PurchaseRow> {
  const rows = await sql<PurchaseRow[]>`
    UPDATE purchases SET status = 'cancelled', updated_at = now()
    WHERE id = ${id} AND source = 'manual' AND status = 'confirmed'
    RETURNING *
  `;
  if (!rows[0]) throw new PurchaseError("not_cancellable", "Só ingressos manuais confirmados podem ser removidos.", 409);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Camarote adicionado pela organização a um ingresso já confirmado.
// ---------------------------------------------------------------------------

const CAMAROTE_SUFFIX = " + Camarote";

/**
 * Marca o ingresso como "com camarote" (ex.: a pessoa pagou o camarote por fora). Não altera o
 * valor cobrado no Mercado Pago (amount_cents); o valor recebido do camarote fica em
 * camarote_extra_cents. Nulo = preço atual da categoria "camarote".
 */
export async function addCamarote(sql: Sql, id: string, priceCents: number | null): Promise<PurchaseRow> {
  if (priceCents !== null && (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100_000)) {
    throw new PurchaseError("invalid_price", "Valor inválido.", 400);
  }
  let price = priceCents;
  if (price === null) {
    const [cat] = await sql<{ price_cents: number }[]>`SELECT price_cents FROM ticket_categories WHERE id = ${CAMAROTE_CATEGORY}`;
    if (!cat) throw new PurchaseError("no_camarote_price", "Informe o valor do camarote (a categoria camarote não existe).", 400);
    price = cat.price_cents;
  }
  const rows = await sql<PurchaseRow[]>`
    UPDATE purchases
    SET camarote = true, camarote_extra_cents = ${price}, category_label = category_label || ${CAMAROTE_SUFFIX}, updated_at = now()
    WHERE id = ${id} AND status = 'confirmed' AND camarote = false AND anonymized_at IS NULL
    RETURNING *
  `;
  if (!rows[0]) {
    throw new PurchaseError("not_applicable", "Só ingressos confirmados que ainda não têm camarote aceitam o adicional.", 409);
  }
  return rows[0];
}

/** Desfaz o camarote que foi adicionado pelo painel (não mexe no que veio da compra online). */
export async function removeCamarote(sql: Sql, id: string): Promise<PurchaseRow> {
  const rows = await sql<PurchaseRow[]>`
    UPDATE purchases
    SET camarote = false, camarote_extra_cents = NULL,
        category_label = regexp_replace(category_label, ' \\+ Camarote$', ''), updated_at = now()
    WHERE id = ${id} AND camarote AND camarote_extra_cents IS NOT NULL
    RETURNING *
  `;
  if (!rows[0]) throw new PurchaseError("not_applicable", "Este ingresso não tem camarote adicionado pelo painel.", 409);
  return rows[0];
}
