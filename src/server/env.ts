import "server-only";

function optional(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name: string): string {
  const value = optional(name);
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

export const env = {
  get databaseUrl() {
    return required("DATABASE_URL");
  },
  /** URL pública do site, sem barra no final (ex.: https://ingressos.invictus.com.br). */
  get appUrl() {
    return (optional("APP_URL") ?? "http://localhost:3000").replace(/\/+$/, "");
  },
  get isSecure() {
    return this.appUrl.startsWith("https://");
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get mpAccessToken() {
    return optional("MP_ACCESS_TOKEN");
  },
  get mpWebhookSecret() {
    return optional("MP_WEBHOOK_SECRET");
  },
  /** Usado apenas em testes automatizados para apontar para um servidor simulado. */
  get mpApiBaseUrl() {
    return (optional("MP_API_BASE_URL") ?? "https://api.mercadopago.com").replace(/\/+$/, "");
  },
  /** Segredo usado para gerar hashes de IP no limite de requisições. */
  get appSecret() {
    return required("APP_SECRET");
  },
  get cronSecret() {
    return optional("CRON_SECRET");
  },
};
