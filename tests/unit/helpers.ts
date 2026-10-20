import { randomUUID } from "node:crypto";
import { getSql } from "@/server/db";
import type { MercadoPagoClient, MpPayment, PixInput, PreferenceInput } from "@/server/mercadopago";
import type { PurchaseRequest } from "@/lib/validation";

export const sql = () => getSql();

/** Deixa o banco limpo e com o evento pronto para vender. */
export async function resetDb(opts: { capacity?: number | null; salesOpen?: boolean; feeCents?: number } = {}) {
  const db = sql();
  await db`TRUNCATE payments, purchases, webhook_events, audit_log, rate_limits RESTART IDENTITY CASCADE`;
  const [terms] = await db<{ id: number }[]>`
    INSERT INTO terms_versions (content, content_hash)
    VALUES (${db.json({
      rules: ["Regra de teste"],
      refundPolicy: "Reembolso de teste",
      cancellationPolicy: "Cancelamento de teste",
      transferPolicy: "Transferência de teste",
    })}, 'unit-ready')
    ON CONFLICT (content_hash) DO UPDATE SET content_hash = EXCLUDED.content_hash
    RETURNING id
  `;
  await db`
    UPDATE settings SET
      sales_open = ${opts.salesOpen ?? true},
      capacity = ${opts.capacity ?? null},
      service_fee_cents = ${opts.feeCents ?? 300},
      current_terms_version_id = ${terms.id},
      event = event || ${db.json({
        startTime: "23:00",
        venueName: "Local Teste",
        venueAddress: "Rua Teste, 1",
        contactEmail: "contato@example.com",
      })}
  `;
  await db`UPDATE ticket_categories SET active = true, price_cents = CASE id WHEN 'feminino' THEN 2000 ELSE 3000 END`;
  return terms.id;
}

/** Cliente falso do Mercado Pago que guarda os pagamentos em memória. */
export class FakeMp implements MercadoPagoClient {
  payments = new Map<string, MpPayment>();
  pixCalls: PixInput[] = [];
  prefCalls: PreferenceInput[] = [];
  refunds: string[] = [];
  fail = false;
  private seq = 5000;

  async createPixPayment(input: PixInput): Promise<MpPayment> {
    if (this.fail) throw new Error("MP fora do ar");
    this.pixCalls.push(input);
    const p: MpPayment = {
      id: this.seq++,
      status: "pending",
      status_detail: "pending_waiting_transfer",
      external_reference: input.purchaseId,
      transaction_amount: input.amountCents / 100,
      currency_id: "BRL",
      payment_method_id: "pix",
      date_of_expiration: input.expiresAt.toISOString(),
      point_of_interaction: { transaction_data: { qr_code: "000201PIX", qr_code_base64: "iVBOR", ticket_url: null } },
    };
    this.payments.set(String(p.id), p);
    return p;
  }
  async createCardPreference(input: PreferenceInput) {
    if (this.fail) throw new Error("MP fora do ar");
    this.prefCalls.push(input);
    return { id: `pref-${input.purchaseId}`, init_point: `https://mp.example/checkout/${input.purchaseId}` };
  }
  async getPayment(id: string) {
    const p = this.payments.get(id);
    if (!p) throw new Error("not found");
    return { ...p };
  }
  async searchPaymentsByReference(ref: string) {
    return [...this.payments.values()].filter((p) => p.external_reference === ref);
  }
  async refundPayment(id: string) {
    this.refunds.push(id);
    const p = this.payments.get(id)!;
    p.status = "refunded";
  }
  /** Simula um pagamento de cartão feito no Checkout Pro. */
  cardPayment(purchaseId: string, amountCents: number, status: string): MpPayment {
    const p: MpPayment = {
      id: this.seq++,
      status,
      external_reference: purchaseId,
      transaction_amount: amountCents / 100,
      currency_id: "BRL",
      payment_method_id: "master",
      date_approved: status === "approved" ? new Date().toISOString() : null,
    };
    this.payments.set(String(p.id), p);
    return p;
  }
  set(id: string | number, status: string, extra: Partial<MpPayment> = {}) {
    const p = this.payments.get(String(id))!;
    Object.assign(p, { status, ...extra });
    if (status === "approved") p.date_approved = new Date().toISOString();
    return { ...p };
  }
}

export function request(termsVersionId: number, over: Partial<PurchaseRequest> = {}): PurchaseRequest {
  return {
    clientRequestId: randomUUID(),
    fullName: "Maria Eduarda Souza",
    categoryId: "feminino",
    adultConfirmed: true,
    termsAccepted: true,
    termsVersionId,
    paymentMethod: "pix",
    payerEmail: "maria@example.com",
    ...over,
  };
}

export function deps(mp: FakeMp) {
  return {
    sql: sql(),
    mp,
    appUrl: "http://localhost:3000",
    envState: { mpAccessToken: true, mpWebhookSecret: true },
  };
}
