import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Validação da assinatura dos webhooks do Mercado Pago.
 *
 * O cabeçalho `x-signature` tem o formato `ts=<segundos>,v1=<hmac>`. O HMAC-SHA256
 * (hex) é calculado com a "assinatura secreta" da aplicação sobre o manifesto
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` — partes ausentes são omitidas.
 * Implementação equivalente ao `WebhookSignatureValidator` do SDK oficial.
 */
export type SignatureInput = {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
};

export type SignatureResult = { ok: true } | { ok: false; reason: string };

function clean(v: string | null | undefined): string | undefined {
  const t = v?.trim();
  return t ? t : undefined;
}

export function buildManifest(dataId: string | undefined, requestId: string | undefined, ts: string): string {
  const parts: string[] = [];
  if (dataId) parts.push(`id:${dataId}`);
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  return parts.join(";") + ";";
}

export function signWebhook(dataId: string | undefined, requestId: string | undefined, ts: string, secret: string) {
  return createHmac("sha256", secret).update(buildManifest(dataId, requestId, ts)).digest("hex");
}

export function verifyWebhookSignature(input: SignatureInput): SignatureResult {
  const header = clean(input.xSignature);
  if (!header) return { ok: false, reason: "missing_signature" };

  let ts: string | undefined;
  let v1: string | undefined;
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") ts = value;
    else if (key === "v1") v1 = value;
  }
  if (!ts || !/^\d+$/.test(ts)) return { ok: false, reason: "missing_timestamp" };
  if (!v1) return { ok: false, reason: "missing_hash" };

  const expected = signWebhook(clean(input.dataId), clean(input.xRequestId), ts, input.secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: "signature_mismatch" };
  // Reenvios de uma notificação válida são inofensivos: o estado do pagamento é
  // sempre consultado na API do Mercado Pago e as atualizações são idempotentes.
  return { ok: true };
}
