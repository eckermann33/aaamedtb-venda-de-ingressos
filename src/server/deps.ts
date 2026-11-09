import { getSql } from "./db";
import { env } from "./env";
import { getMercadoPago } from "./mercadopago";

export function envState() {
  return { mpAccessToken: Boolean(env.mpAccessToken), mpWebhookSecret: Boolean(env.mpWebhookSecret) };
}

export function purchaseDeps() {
  return { sql: getSql(), mp: getMercadoPago(), appUrl: env.appUrl, envState: envState() };
}
