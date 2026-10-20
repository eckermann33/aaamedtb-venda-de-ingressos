import { expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DB, MOCK_URL } from "../../playwright.config";
import { ADMIN_EMAIL, ADMIN_PASSWORD } from "./global-setup";

export const db = postgres(E2E_DB, { max: 2, onnotice: () => {} });

/** Evento configurado e vendas abertas (dados de TESTE, nunca de produção). */
export async function readyEvent(opts: { capacity?: number | null; salesOpen?: boolean } = {}) {
  await db`TRUNCATE payments, purchases, webhook_events, rate_limits RESTART IDENTITY CASCADE`;
  const [terms] = await db<{ id: number }[]>`
    INSERT INTO terms_versions (content, content_hash)
    SELECT content || ${db.json({
      refundPolicy: "[TESTE] Reembolso",
      cancellationPolicy: "[TESTE] Cancelamento",
      transferPolicy: "[TESTE] Transferência",
    })}, 'e2e-ready' FROM terms_versions ORDER BY id LIMIT 1
    ON CONFLICT (content_hash) DO UPDATE SET content_hash = EXCLUDED.content_hash
    RETURNING id
  `;
  await db`
    UPDATE settings SET sales_open = ${opts.salesOpen ?? true}, capacity = ${opts.capacity ?? null},
      service_fee_cents = 300, current_terms_version_id = ${terms.id},
      event = event || ${db.json({ startTime: "23:00", venueName: "[TESTE] Local", venueAddress: "[TESTE] Rua 1", contactEmail: "teste@example.com" })}
  `;
  await fetch(`${MOCK_URL}/__mock/reset`, { method: "POST" });
}

export async function mockPayment(id: string, body: Record<string, unknown>) {
  const res = await fetch(`${MOCK_URL}/__mock/payments/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function mockState() {
  return (await fetch(`${MOCK_URL}/__mock/state`)).json();
}

/** Preenche a etapa 1 do formulário de compra. */
export async function fillStep1(page: Page, name: string, category: "Feminino" | "Masculino") {
  await page.goto("/comprar");
  await page.getByLabel("Nome completo").fill(name);
  await page.getByLabel("Celular / WhatsApp").fill("(42) 99999-8888");
  await page.locator("label.choice", { hasText: category }).click();
  await page.getByText("Confirmo que tenho 18 anos ou mais").click();
  await page.getByText("Li e aceito as regras de entrada").click();
  await page.getByRole("button", { name: /Continuar/ }).click();
  await expect(page.getByText("Confira seu pedido")).toBeVisible();
}

export async function loginAdmin(page: Page) {
  await page.goto("/admin/login");
  await page.getByLabel("E-mail").fill(ADMIN_EMAIL);
  await page.getByLabel("Senha").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForURL("**/admin");
}
