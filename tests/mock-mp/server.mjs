/**
 * SIMULADOR LOCAL DO MERCADO PAGO — somente para desenvolvimento e testes.
 *
 * Imita os endpoints da API usados pela plataforma e envia webhooks assinados
 * (x-signature) para o app, permitindo testar o fluxo completo sem cobranças reais.
 * NÃO substitui os testes no ambiente de testes oficial do Mercado Pago.
 *
 * Uso:
 *   MOCK_MP_PORT=4010 APP_URL=http://localhost:3000 MP_WEBHOOK_SECRET=segredo node tests/mock-mp/server.mjs
 * e no .env do app:  MP_API_BASE_URL=http://127.0.0.1:4010  MP_ACCESS_TOKEN=TEST-mock
 */
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";

const PORT = Number(process.env.MOCK_MP_PORT ?? 4010);
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const SECRET = process.env.MP_WEBHOOK_SECRET ?? "segredo-de-teste";
const SELF = `http://127.0.0.1:${PORT}`;

let nextId = 1_000_000_001;
const payments = new Map(); // id -> payment
const preferences = new Map(); // id -> preference
const idempotency = new Map(); // key -> response body
const requests = []; // log das chamadas recebidas (para os testes)

function send(res, status, body, headers = {}) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json", ...headers });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return Object.fromEntries(new URLSearchParams(raw));
  }
}

export function sign(dataId, requestId, ts, secret = SECRET) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

async function notify(paymentId, { times = 1, badSignature = false } = {}) {
  const results = [];
  for (let i = 0; i < times; i++) {
    const requestId = randomUUID();
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = badSignature ? "0".repeat(64) : sign(String(paymentId), requestId, ts);
    const res = await fetch(`${APP_URL}/api/webhooks/mercadopago?data.id=${paymentId}&type=payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-signature": `ts=${ts},v1=${v1}`, "x-request-id": requestId },
      body: JSON.stringify({ action: "payment.updated", type: "payment", data: { id: String(paymentId) }, live_mode: false }),
    }).catch((e) => ({ status: 0, error: e.message }));
    results.push(res.status);
  }
  return results;
}

function newPayment(fields) {
  const id = nextId++;
  const p = {
    id,
    status: "pending",
    status_detail: "pending_waiting_transfer",
    currency_id: "BRL",
    live_mode: false,
    date_created: new Date().toISOString(),
    date_approved: null,
    ...fields,
  };
  payments.set(String(id), p);
  return p;
}

function setStatus(p, status, detail) {
  p.status = status;
  p.status_detail = detail ?? { approved: "accredited", rejected: "cc_rejected_other_reason", cancelled: "by_collector", refunded: "refunded" }[status] ?? status;
  if (status === "approved") p.date_approved = new Date().toISOString();
}

function checkoutPage(pref) {
  const total = pref.items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
  const excluded = (pref.payment_methods?.excluded_payment_types ?? []).map((t) => t.id);
  const pixOnly = excluded.includes("credit_card");
  const buttons = pixOnly
    ? `<form method="post" action="/checkout/${pref.id}/pay"><input type="hidden" name="result" value="pix_pending"><button class="no" id="pix-gerar">Gerar Pix (pagar depois)</button></form>
<form method="post" action="/checkout/${pref.id}/pay"><input type="hidden" name="result" value="approved_pix"><button class="ok" id="pix-pagar">Pagar o Pix agora</button></form>`
    : `<form method="post" action="/checkout/${pref.id}/pay"><input type="hidden" name="result" value="approved"><button class="ok" id="aprovar">Aprovar pagamento (APRO)</button></form>
<form method="post" action="/checkout/${pref.id}/pay"><input type="hidden" name="result" value="rejected"><button class="no" id="recusar">Recusar pagamento (OTHE)</button></form>`;
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mercado Pago (SIMULADOR)</title>
<style>body{font-family:system-ui;background:#ededed;margin:0;padding:24px}main{max-width:420px;margin:auto;background:#fff;border-radius:12px;padding:24px}
.tag{background:#ffe600;padding:4px 8px;border-radius:6px;font-size:12px;font-weight:700}button{width:100%;padding:14px;margin-top:10px;border:0;border-radius:8px;font-size:16px;cursor:pointer}
.ok{background:#009ee3;color:#fff}.no{background:#eee}li{margin:4px 0}</style>
<main><span class="tag">SIMULADOR LOCAL — NÃO É O MERCADO PAGO</span><h1>${pixOnly ? "Pagar com Pix" : "Pagar com cartão"}</h1>
<ul>${pref.items.map((i) => `<li>${i.title}: R$ ${i.unit_price.toFixed(2)}</li>`).join("")}</ul>
<p><strong>Total: R$ ${total.toFixed(2)}</strong> · parcelas: ${pref.payment_methods?.installments ?? "?"}</p>
${buttons}
</main></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, SELF);
  const p = url.pathname;
  const isApi = p.startsWith("/v1/") || p.startsWith("/checkout/preferences");
  if (isApi && !(req.headers.authorization ?? "").startsWith("Bearer ")) return send(res, 401, { message: "unauthorized" });

  try {
    // ---- API ----------------------------------------------------------------
    if (req.method === "POST" && p.replace(/\/$/, "") === "/checkout/preferences") {
      const body = await readBody(req);
      const key = req.headers["x-idempotency-key"];
      requests.push({ method: "POST", path: p, body, idempotencyKey: key });
      if (key && idempotency.has(key)) return send(res, 201, idempotency.get(key));
      const id = `pref-${randomUUID()}`;
      const pref = { ...body, id, init_point: `${SELF}/checkout/${id}`, sandbox_init_point: `${SELF}/checkout/${id}` };
      preferences.set(id, pref);
      if (key) idempotency.set(key, pref);
      return send(res, 201, pref);
    }

    if (req.method === "GET" && p === "/v1/payments/search") {
      const ref = url.searchParams.get("external_reference");
      const results = [...payments.values()].filter((x) => x.external_reference === ref).reverse();
      return send(res, 200, { paging: { total: results.length }, results });
    }

    let m = p.match(/^\/v1\/payments\/(\d+)$/);
    if (req.method === "GET" && m) {
      const pay = payments.get(m[1]);
      return pay ? send(res, 200, pay) : send(res, 404, { message: "Payment not found" });
    }

    m = p.match(/^\/v1\/payments\/(\d+)\/refunds$/);
    if (req.method === "POST" && m) {
      const pay = payments.get(m[1]);
      if (!pay) return send(res, 404, { message: "Payment not found" });
      requests.push({ method: "POST", path: p, idempotencyKey: req.headers["x-idempotency-key"] });
      setStatus(pay, "refunded");
      return send(res, 201, { id: nextId++, payment_id: pay.id, amount: pay.transaction_amount, status: "approved" });
    }

    // ---- Checkout hospedado simulado ---------------------------------------
    m = p.match(/^\/checkout\/(pref-[\w-]+)$/);
    if (req.method === "GET" && m) {
      const pref = preferences.get(m[1]);
      return pref ? send(res, 200, checkoutPage(pref)) : send(res, 404, "preferência não encontrada");
    }
    m = p.match(/^\/checkout\/(pref-[\w-]+)\/pay$/);
    if (req.method === "POST" && m) {
      const pref = preferences.get(m[1]);
      const { result } = await readBody(req);
      const total = pref.items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
      const pix = result === "pix_pending" || result === "approved_pix";
      const pay = newPayment({
        transaction_amount: Math.round(total * 100) / 100,
        external_reference: pref.external_reference,
        payment_method_id: pix ? "pix" : "master",
        payment_type_id: pix ? "bank_transfer" : "credit_card",
        date_of_expiration: pref.expiration_date_to,
      });
      if (result !== "pix_pending") setStatus(pay, result.startsWith("approved") ? "approved" : "rejected");
      await notify(pay.id);
      const back = pay.status === "approved" ? pref.back_urls.success : pay.status === "pending" ? pref.back_urls.pending : pref.back_urls.failure;
      res.writeHead(302, { Location: `${back}?payment_id=${pay.id}&status=${pay.status}&external_reference=${pref.external_reference}` });
      return res.end();
    }

    // ---- Controle do simulador (usado pelos testes) -------------------------
    m = p.match(/^\/__mock\/payments\/(\d+)$/);
    if (req.method === "POST" && m) {
      const pay = payments.get(m[1]);
      if (!pay) return send(res, 404, { message: "not found" });
      const body = await readBody(req);
      if (body.status) setStatus(pay, body.status, body.status_detail);
      if (body.transaction_amount) pay.transaction_amount = body.transaction_amount;
      const statuses = body.notify === false ? [] : await notify(pay.id, { times: body.times ?? 1, badSignature: body.badSignature });
      return send(res, 200, { payment: pay, webhookStatuses: statuses });
    }
    if (req.method === "POST" && p === "/__mock/payments") {
      // Cria um pagamento arbitrário (ex.: para simular pagamento com valor adulterado).
      const body = await readBody(req);
      const pay = newPayment(body);
      return send(res, 201, pay);
    }
    if (req.method === "GET" && p === "/__mock/state") {
      return send(res, 200, { payments: [...payments.values()], preferences: [...preferences.values()], requests });
    }
    if (req.method === "POST" && p === "/__mock/reset") {
      payments.clear();
      preferences.clear();
      idempotency.clear();
      requests.length = 0;
      return send(res, 200, { ok: true });
    }
    send(res, 404, { message: "not found" });
  } catch (err) {
    send(res, 500, { message: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`[mock-mp] simulador ouvindo em ${SELF} → webhooks para ${APP_URL}`));
