/**
 * Cliente da API REST oficial do Mercado Pago (https://api.mercadopago.com).
 *
 * Endpoints utilizados:
 *  - POST /checkout/preferences     → cria o checkout (Checkout Pro) para Pix ou cartão
 *  - GET  /v1/payments/{id}         → consulta o estado real de um pagamento
 *  - GET  /v1/payments/search       → busca pagamentos pela external_reference
 *  - POST /v1/payments/{id}/refunds → estorna um pagamento
 *
 * O Access Token só existe no servidor (variável MP_ACCESS_TOKEN).
 */
import { env } from "./env";

export type MpPayment = {
  id: number | string;
  status: string;
  status_detail?: string | null;
  external_reference?: string | null;
  transaction_amount?: number | null;
  currency_id?: string | null;
  payment_method_id?: string | null;
  payment_type_id?: string | null;
  live_mode?: boolean | null;
  date_approved?: string | null;
  date_of_expiration?: string | null;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string | null;
      qr_code_base64?: string | null;
      ticket_url?: string | null;
    } | null;
  } | null;
};

export type MpPreference = {
  id: string;
  init_point: string;
  sandbox_init_point?: string;
};

export class MercadoPagoError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "MercadoPagoError";
  }
}

export type PreferenceInput = {
  /** Forma de pagamento oferecida no checkout: só Pix ou só cartão de crédito. */
  method: "pix" | "card";
  purchaseId: string;
  ticketPriceCents: number;
  feeCents: number;
  title: string;
  categoryId: string;
  expiresAt: Date;
  backUrl: string;
  statementDescriptor: string;
};

export interface MercadoPagoClient {
  createCheckoutPreference(input: PreferenceInput): Promise<MpPreference>;
  getPayment(id: string): Promise<MpPayment>;
  searchPaymentsByReference(externalReference: string): Promise<MpPayment[]>;
  refundPayment(id: string, idempotencyKey: string): Promise<void>;
}

/** Formata a data no padrão aceito pelo Mercado Pago, no fuso de Brasília. */
export function toMpDate(date: Date): string {
  const offsetMs = 3 * 60 * 60 * 1000;
  const local = new Date(date.getTime() - offsetMs);
  return local.toISOString().replace("Z", "-03:00");
}

function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}

export function createMercadoPagoClient(
  accessToken: string,
  baseUrl = "https://api.mercadopago.com",
): MercadoPagoClient {
  async function call<T>(method: string, path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
    } catch (err) {
      throw new MercadoPagoError(`Falha de rede ao chamar ${method} ${path}: ${(err as Error).message}`, 0);
    }

    const text = await response.text();
    if (!response.ok) {
      // Mensagem de erro da API (não contém dados de cartão, pois não enviamos nenhum).
      let detail = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { message?: string; error?: string };
        detail = parsed.message ?? parsed.error ?? detail;
      } catch {
        /* resposta não-JSON */
      }
      throw new MercadoPagoError(`${method} ${path} → HTTP ${response.status}: ${detail}`, response.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  return {
    createCheckoutPreference(input) {
      const now = new Date();
      return call<MpPreference>(
        "POST",
        "/checkout/preferences",
        {
          // A taxa de serviço aparece como item separado no checkout.
          items: [
            {
              id: input.categoryId,
              title: input.title,
              quantity: 1,
              currency_id: "BRL",
              unit_price: centsToAmount(input.ticketPriceCents),
            },
            ...(input.feeCents > 0
              ? [
                  {
                    id: "taxa-servico",
                    title: "Taxa de serviço",
                    quantity: 1,
                    currency_id: "BRL",
                    unit_price: centsToAmount(input.feeCents),
                  },
                ]
              : []),
          ],
          external_reference: input.purchaseId,
          back_urls: { success: input.backUrl, failure: input.backUrl, pending: input.backUrl },
          auto_return: "approved",
          // Cartão: aprovado ou recusado na hora, sem ficar preso em análise.
          // (Não usamos no Pix, que é pendente por natureza até o comprador pagar.)
          ...(input.method === "card" ? { binary_mode: true } : {}),
          expires: true,
          expiration_date_from: toMpDate(now),
          expiration_date_to: toMpDate(input.expiresAt),
          statement_descriptor: input.statementDescriptor.slice(0, 13),
          payment_methods: {
            // Cada forma de pagamento tem o seu botão no nosso site: aqui oferecemos só a escolhida.
            excluded_payment_types:
              input.method === "pix"
                ? [{ id: "credit_card" }, { id: "debit_card" }, { id: "ticket" }, { id: "atm" }, { id: "digital_currency" }]
                : [{ id: "ticket" }, { id: "atm" }, { id: "debit_card" }, { id: "bank_transfer" }, { id: "digital_currency" }],
            // Parcela única: o comprador paga exatamente o valor anunciado.
            installments: 1,
            default_installments: 1,
          },
        },
        `pref-${input.purchaseId}`,
      );
    },

    getPayment(id) {
      return call<MpPayment>("GET", `/v1/payments/${encodeURIComponent(id)}`);
    },

    async searchPaymentsByReference(externalReference) {
      const params = new URLSearchParams({
        external_reference: externalReference,
        sort: "date_created",
        criteria: "desc",
        limit: "20",
      });
      const result = await call<{ results?: MpPayment[] }>("GET", `/v1/payments/search?${params}`);
      return result.results ?? [];
    },

    async refundPayment(id, idempotencyKey) {
      await call("POST", `/v1/payments/${encodeURIComponent(id)}/refunds`, {}, idempotencyKey);
    },
  };
}

let override: MercadoPagoClient | null = null;

/** Permite substituir o cliente em testes automatizados. */
export function setMercadoPagoClientForTests(client: MercadoPagoClient | null) {
  override = client;
}

export function getMercadoPago(): MercadoPagoClient {
  if (override) return override;
  const token = env.mpAccessToken;
  if (!token) {
    const fail = async (): Promise<never> => {
      throw new MercadoPagoError("MP_ACCESS_TOKEN não configurado", 0);
    };
    return {
      createCheckoutPreference: fail,
      getPayment: fail,
      searchPaymentsByReference: fail,
      refundPayment: fail,
    };
  }
  return createMercadoPagoClient(token, env.mpApiBaseUrl);
}
