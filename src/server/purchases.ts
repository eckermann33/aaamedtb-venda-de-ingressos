import { randomBytes } from "node:crypto";
import { PAYMENT_WINDOW_MINUTES } from "@/config/event";
import { cleanName, searchableName, validateFullName, type PurchaseRequest } from "@/lib/validation";
import type { Sql, TxSql } from "./db";
import { errorInfo, logger } from "./logger";
import { MercadoPagoError, type MercadoPagoClient, type MpPayment } from "./mercadopago";
import { loadSettings, readiness } from "./settings";

export type PurchaseStatus = "pending" | "confirmed" | "rejected" | "cancelled" | "expired" | "refunded" | "failed";

export type PurchaseRow = {
  id: string;
  client_request_id: string;
  full_name: string;
  category_id: string;
  category_label: string;
  ticket_price_cents: number;
  fee_cents: number;
  amount_cents: number;
  payment_method: "pix" | "card";
  status: PurchaseStatus;
  payment_status: string | null;
  payment_status_detail: string | null;
  mp_payment_id: string | null;
  mp_preference_id: string | null;
  checkout_url: string | null;
  pix_qr_code: string | null;
  pix_qr_code_base64: string | null;
  pix_ticket_url: string | null;
  pix_expires_at: Date | null;
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

/** Ingressos que ocupam vaga: confirmados + reservas pendentes ainda válidas. */
async function countOccupied(tx: TxSql, excludeId: string | null): Promise<number> {
  const [row] = await tx<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM purchases
    WHERE (status = 'confirmed' OR (status = 'pending' AND expires_at > now()))
      AND ${excludeId ? tx`id <> ${excludeId}` : tx`true`}
  `;
  return row.n;
}

export type CreateDeps = {
  sql: Sql;
  mp: MercadoPagoClient;
  appUrl: string;
  envState: { mpAccessToken: boolean; mpWebhookSecret: boolean };
};

/**
 * Cria a compra pendente (com reserva de vaga) e inicia o pagamento no Mercado Pago.
 * O preço vem SEMPRE do banco de dados — nenhum valor enviado pelo navegador é usado.
 */
export async function createPurchase(deps: CreateDeps, input: PurchaseRequest): Promise<PurchaseRow> {
  const { sql, mp } = deps;
  const nameError = validateFullName(input.fullName);
  if (nameError) throw new PurchaseError("invalid_name", nameError, 400);
  if (input.paymentMethod === "pix" && !input.payerEmail) {
    throw new PurchaseError("email_required", "Informe um e-mail para gerar o Pix.", 400);
  }
  const fullName = cleanName(input.fullName);

  const existing = await findByClientRequestId(sql, input.clientRequestId);
  if (existing) return sameRequestOrThrow(existing, fullName, input);

  const windowMs = PAYMENT_WINDOW_MINUTES * 60_000;
  // A reserva dura um pouco mais que o prazo de pagamento para absorver atrasos de notificação.
  const reservationMs = windowMs + 5 * 60_000;

  const purchase = await sql.begin(async (tx) => {
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
    const category = settings.categories.find((c) => c.id === input.categoryId && c.active);
    if (!category) throw new PurchaseError("invalid_category", "Categoria de ingresso inválida.", 400);

    if (settings.capacity !== null) {
      const occupied = await countOccupied(tx, null);
      if (occupied >= settings.capacity) {
        throw new PurchaseError("sold_out", "Os ingressos esgotaram (ou estão todos reservados no momento).", 409);
      }
    }

    const rows = await tx<PurchaseRow[]>`
      INSERT INTO purchases (
        client_request_id, full_name, name_search, category_id, category_label,
        ticket_price_cents, fee_cents, amount_cents, payment_method, adult_confirmed, terms_version_id, terms_accepted_at, expires_at
      ) VALUES (
        ${input.clientRequestId}, ${fullName}, ${searchableName(fullName)}, ${category.id}, ${category.label},
        ${category.priceCents}, ${settings.serviceFeeCents}, ${category.priceCents + settings.serviceFeeCents},
        ${input.paymentMethod}, true, ${settings.termsVersionId}, now(),
        now() + ${reservationMs / 1000} * interval '1 second'
      )
      ON CONFLICT (client_request_id) DO NOTHING
      RETURNING *
    `;
    return rows[0] ?? null;
  });

  if (!purchase) {
    // Outra requisição com a mesma chave chegou primeiro (clique duplo).
    const again = await findByClientRequestId(sql, input.clientRequestId);
    if (!again) throw new PurchaseError("conflict", "Tente novamente.", 409);
    return sameRequestOrThrow(again, fullName, input);
  }

  const settings = await loadSettings(sql);
  const title = `Ingresso ${settings.event.name} — ${purchase.category_label}`;

  try {
    if (purchase.payment_method === "pix") {
      const payment = await mp.createPixPayment({
        purchaseId: purchase.id,
        amountCents: purchase.amount_cents,
        description: purchase.fee_cents > 0 ? `${title} (inclui taxa de serviço)` : title,
        payerEmail: input.payerEmail!,
        expiresAt: new Date(Date.now() + windowMs),
      });
      const data = payment.point_of_interaction?.transaction_data;
      if (!data?.qr_code) throw new MercadoPagoError("Resposta do Pix sem QR Code", 0);
      await sql`
        UPDATE purchases SET
          mp_payment_id = ${String(payment.id)},
          pix_qr_code = ${data.qr_code},
          pix_qr_code_base64 = ${data.qr_code_base64 ?? null},
          pix_ticket_url = ${data.ticket_url ?? null},
          pix_expires_at = ${payment.date_of_expiration ? new Date(payment.date_of_expiration) : new Date(Date.now() + windowMs)},
          payment_status = ${payment.status},
          updated_at = now()
        WHERE id = ${purchase.id}
      `;
      await applyPayment(sql, payment);
    } else {
      const preference = await mp.createCardPreference({
        purchaseId: purchase.id,
        ticketPriceCents: purchase.ticket_price_cents,
        feeCents: purchase.fee_cents,
        title,
        categoryId: purchase.category_id,
        expiresAt: new Date(Date.now() + windowMs),
        backUrl: `${deps.appUrl}/pedido/${purchase.id}`,
        statementDescriptor: settings.event.statementDescriptor,
      });
      await sql`
        UPDATE purchases SET mp_preference_id = ${preference.id}, checkout_url = ${preference.init_point}, updated_at = now()
        WHERE id = ${purchase.id}
      `;
    }
  } catch (err) {
    logger.error("Falha ao iniciar pagamento no Mercado Pago", { purchaseId: purchase.id, ...errorInfo(err) });
    await sql`UPDATE purchases SET status = 'failed', updated_at = now() WHERE id = ${purchase.id} AND status = 'pending'`;
    throw new PurchaseError(
      "payment_unavailable",
      "Não foi possível iniciar o pagamento agora. Nenhuma cobrança foi feita. Tente novamente em instantes.",
      502,
    );
  }

  return (await getPurchase(sql, purchase.id))!;
}

function sameRequestOrThrow(existing: PurchaseRow, fullName: string, input: PurchaseRequest): PurchaseRow {
  if (
    existing.full_name !== fullName ||
    existing.category_id !== input.categoryId ||
    existing.payment_method !== input.paymentMethod
  ) {
    throw new PurchaseError("conflict", "Esta tentativa de compra já foi usada. Recarregue a página.", 409);
  }
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
    const rows = await tx<PurchaseRow[]>`SELECT * FROM purchases WHERE id = ${purchaseId} FOR UPDATE`;
    const purchase = rows[0];
    if (!purchase) return "unknown_reference" as const;

    // Validação do pagamento contra a compra.
    const amountCents = payment.transaction_amount == null ? null : Math.round(payment.transaction_amount * 100);
    let validationError: string | null = null;
    if (amountCents !== purchase.amount_cents) validationError = "amount_mismatch";
    else if (payment.currency_id && payment.currency_id !== "BRL") validationError = "currency_mismatch";
    else if (purchase.payment_method === "pix" && purchase.mp_payment_id && purchase.mp_payment_id !== paymentId) {
      validationError = "payment_id_mismatch";
    }

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
          if (occupied >= cfg.capacity) {
            await tx`
              UPDATE purchases SET attention = 'over_capacity', payment_status = 'approved', updated_at = now()
              WHERE id = ${purchase.id}
            `;
            logger.warn("Pagamento aprovado acima da lotação: requer estorno", { purchaseId, paymentId });
            return "over_capacity" as const;
          }
        }
        await tx`
          UPDATE purchases SET
            status = 'confirmed',
            payment_status = 'approved',
            payment_status_detail = ${payment.status_detail ?? null},
            mp_payment_id = ${paymentId},
            ticket_code = ${generateTicketCode()},
            confirmed_at = ${payment.date_approved ? new Date(payment.date_approved) : new Date()},
            attention = CASE WHEN attention IN ('over_capacity', 'amount_mismatch') THEN NULL ELSE attention END,
            updated_at = now()
          WHERE id = ${purchase.id} AND status <> 'confirmed'
        `;
        logger.info("Compra confirmada", { purchaseId, paymentId });
        return "confirmed" as const;
      }

      case "refunded":
      case "charged_back": {
        if (isConfirmingPayment && purchase.status === "confirmed") {
          await tx`
            UPDATE purchases SET status = 'refunded', payment_status = ${payment.status},
              payment_status_detail = ${payment.status_detail ?? null}, refunded_at = now(), updated_at = now()
            WHERE id = ${purchase.id}
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
          if (purchase.status === "pending" && purchase.payment_method === "pix") {
            await tx`
              UPDATE purchases SET status = 'refunded', payment_status = ${payment.status}, refunded_at = now(), updated_at = now()
              WHERE id = ${purchase.id}
            `;
          }
        }
        return "updated" as const;
      }

      case "rejected":
      case "cancelled": {
        if (purchase.status !== "pending") return "ignored" as const;
        if (purchase.payment_method === "pix" && isConfirmingPayment) {
          const next =
            payment.status === "rejected" ? "rejected" : payment.status_detail === "expired" ? "expired" : "cancelled";
          await tx`
            UPDATE purchases SET status = ${next}, payment_status = ${payment.status},
              payment_status_detail = ${payment.status_detail ?? null}, updated_at = now()
            WHERE id = ${purchase.id}
          `;
        } else {
          // Cartão: o comprador pode tentar outro cartão enquanto a reserva estiver válida.
          await tx`
            UPDATE purchases SET payment_status = ${payment.status},
              payment_status_detail = ${payment.status_detail ?? null}, updated_at = now()
            WHERE id = ${purchase.id}
          `;
        }
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
  await sql`
    UPDATE purchases
    SET status = CASE WHEN payment_status = 'rejected' THEN 'rejected' ELSE 'expired' END, updated_at = now()
    WHERE id = ${id} AND status = 'pending' AND expires_at < now()
  `;
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
    WHERE id = ${id}
      AND (status = 'pending' OR attention IS NOT NULL)
      AND (last_checked_at IS NULL OR last_checked_at < now() - ${interval} * interval '1 second')
    RETURNING *
  `;
  const purchase = claimed[0];
  if (!purchase) return;

  try {
    let payments: MpPayment[] = [];
    if (purchase.payment_method === "pix" && purchase.mp_payment_id) {
      payments = [await mp.getPayment(purchase.mp_payment_id)];
    } else if (purchase.payment_method === "card") {
      payments = await mp.searchPaymentsByReference(purchase.id);
      if (opts.hintPaymentId && /^\d{1,20}$/.test(opts.hintPaymentId) && !payments.some((p) => String(p.id) === opts.hintPaymentId)) {
        const hinted = await mp.getPayment(opts.hintPaymentId);
        if (hinted.external_reference === purchase.id) payments.push(hinted);
      }
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
    WHERE status = 'pending' OR (attention IS NOT NULL AND attention <> 'in_mediation')
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

export type PublicPurchase = {
  id: string;
  fullName: string;
  categoryLabel: string;
  ticketPriceCents: number;
  feeCents: number;
  amountCents: number;
  paymentMethod: "pix" | "card";
  state: PublicState;
  expiresAt: string;
  confirmedAt: string | null;
  checkoutUrl: string | null;
  pix: { qrCode: string; qrCodeBase64: string | null; ticketUrl: string | null; expiresAt: string | null } | null;
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
      if (p.payment_status === "rejected") return "payment_rejected";
      if (p.payment_method === "pix" && !p.pix_qr_code) return "preparing";
      if (p.payment_method === "card" && !p.checkout_url) return "preparing";
      return "awaiting_payment";
    }
  }
}

export function toPublic(p: PurchaseRow): PublicPurchase {
  const state = publicState(p);
  const awaiting = state === "awaiting_payment" || state === "payment_rejected";
  return {
    id: p.id,
    fullName: p.full_name,
    categoryLabel: p.category_label,
    ticketPriceCents: p.ticket_price_cents,
    feeCents: p.fee_cents,
    amountCents: p.amount_cents,
    paymentMethod: p.payment_method,
    state,
    expiresAt: p.expires_at.toISOString(),
    confirmedAt: p.confirmed_at?.toISOString() ?? null,
    checkoutUrl: awaiting && p.payment_method === "card" ? p.checkout_url : null,
    pix:
      awaiting && p.payment_method === "pix" && p.pix_qr_code
        ? {
            qrCode: p.pix_qr_code,
            qrCodeBase64: p.pix_qr_code_base64,
            ticketUrl: p.pix_ticket_url,
            expiresAt: p.pix_expires_at?.toISOString() ?? null,
          }
        : null,
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

export const ANONYMIZED_NAME = "Titular removido";

/** Remove o nome de uma compra (pedido do titular ou fim do prazo de retenção). */
export async function anonymizePurchase(sql: Sql | TxSql, id: string): Promise<boolean> {
  const rows = await sql`
    UPDATE purchases SET full_name = ${ANONYMIZED_NAME}, name_search = '', pix_qr_code = NULL,
      pix_qr_code_base64 = NULL, pix_ticket_url = NULL, anonymized_at = now(), updated_at = now()
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
    UPDATE purchases SET full_name = ${ANONYMIZED_NAME}, name_search = '', pix_qr_code = NULL,
      pix_qr_code_base64 = NULL, pix_ticket_url = NULL, anonymized_at = now(), updated_at = now()
    WHERE anonymized_at IS NULL AND NOT (status = 'pending' AND expires_at > now())
    RETURNING id
  `;
  return rows.length;
}
