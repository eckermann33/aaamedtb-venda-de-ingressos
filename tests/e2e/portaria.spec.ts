import { expect, test, type Page } from "@playwright/test";
import { FAKE_CAMERA_CODE } from "./fake-camera";
import { createPurchaseViaApi, db, loginAdmin, payViaMock, readyEvent } from "./helpers";

const DOOR_CODE = "PORTA-2026";

test.beforeEach(async () => {
  await readyEvent();
  await db`UPDATE settings SET entry_mode = 'list', door_code_hash = NULL`;
  await db`DELETE FROM door_sessions`;
});

async function enableQr(page: Page) {
  await loginAdmin(page);
  await page.goto("/admin/portaria");
  await page.getByRole("radio", { name: /QR Code na portaria/ }).check();
  await page.getByLabel("Código de acesso da portaria").fill(DOOR_CODE);
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(
    page.getByText(`Anote o código da portaria agora (ele não aparece de novo): ${DOOR_CODE}`),
  ).toBeVisible();
}

async function doorLogin(page: Page, name = "Segurança 1") {
  await page.goto("/portaria");
  await page.getByLabel("Seu nome").fill(name);
  await page.getByLabel("Código da portaria").fill(DOOR_CODE);
  await page.getByRole("button", { name: "Abrir leitor" }).click();
  await expect(page.getByText(/Entraram/)).toBeVisible();
}

test("QR Code: painel liga, comprador recebe o QR, portaria confere e confirma uma única vez", async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  const p = await createPurchaseViaApi(request, baseURL!, { name: "Bianca Rocha Teixeira", category: "feminino" });
  await payViaMock(p, "approved");
  await enableQr(page);
  const [mode] = await db`SELECT entry_mode FROM settings`;
  expect(mode.entry_mode).toBe("qrcode");

  // Comprador: página do pedido mostra o QR Code e o código.
  const buyer = await browser.newContext({ baseURL });
  const bp = await buyer.newPage();
  await bp.goto(`/pedido/${p.id}`);
  await expect(bp.getByText("Seu ingresso está pronto")).toBeVisible();
  await expect(bp.locator(".ticket-qr-img svg")).toBeVisible();
  const [t] = await db`SELECT entry_code FROM purchases WHERE id = ${p.id}`;
  const formatted = `${t.entry_code.slice(0, 4)}-${t.entry_code.slice(4, 8)}-${t.entry_code.slice(8)}`;
  await expect(bp.getByText(formatted)).toBeVisible();
  const [ticketPage] = await Promise.all([
    buyer.waitForEvent("page"),
    bp.getByRole("link", { name: /Abrir só este ingresso/ }).click(),
  ]);
  await expect(ticketPage.getByRole("heading", { name: "Bianca Rocha Teixeira" })).toBeVisible();
  await expect(ticketPage.locator(".ticket-qr-img svg")).toBeVisible();

  // Portaria: outro aparelho, sem acesso ao painel (e sem câmera: testa a digitação do código).
  const door = await browser.newContext({ baseURL });
  await door.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () =>
      Promise.reject(Object.assign(new Error("sem câmera"), { name: "NotFoundError" }));
  });
  const dp = await door.newPage();
  await dp.goto("/portaria");
  await dp.getByLabel("Seu nome").fill("Segurança 1");
  await dp.getByLabel("Código da portaria").fill("errado-123");
  await dp.getByRole("button", { name: "Abrir leitor" }).click();
  await expect(dp.getByText("Código da portaria incorreto.")).toBeVisible();
  await doorLogin(dp);
  await expect(dp.getByText("Entraram 0 de 1")).toBeVisible();
  await expect(dp.getByText("Câmera indisponível neste aparelho. Digite o código abaixo.")).toBeVisible();

  // Digita o código (minúsculo, com traços): mostra o nome para conferir o documento.
  await dp.getByLabel(/Digite o código/).fill(formatted.toLowerCase());
  await dp.getByRole("button", { name: "Buscar" }).click();
  await expect(dp.getByRole("heading", { name: "Bianca Rocha Teixeira" })).toBeVisible();
  await expect(dp.getByText("Confira o documento com foto")).toBeVisible();
  await dp.getByRole("button", { name: "Confirmar entrada" }).click();
  await expect(dp.getByText("✓ ENTRADA LIBERADA")).toBeVisible();
  await expect(dp.getByText("Entraram 1 de 1")).toBeVisible();

  // Mesmo QR de novo: bloqueado.
  await expect(dp.getByLabel(/Digite o código/)).toBeVisible({ timeout: 5000 });
  await dp.getByLabel(/Digite o código/).fill(t.entry_code);
  await dp.getByRole("button", { name: "Buscar" }).click();
  await expect(dp.getByText("✕ JÁ ENTROU")).toBeVisible();
  await expect(dp.getByText(/Segurança 1/).last()).toBeVisible();
  await expect(dp.getByRole("button", { name: "Confirmar entrada" })).toHaveCount(0);

  // Código que não existe.
  await dp.getByRole("button", { name: "Voltar ao leitor" }).click();
  await dp.getByLabel(/Digite o código/).fill("AAAA-AAAA-AAAA");
  await dp.getByRole("button", { name: "Buscar" }).click();
  await expect(dp.getByText("✕ NÃO ENCONTRADO")).toBeVisible();

  // A portaria não entra no painel nem nas APIs do painel.
  await dp.goto("/admin");
  await expect(dp).toHaveURL(/\/admin\/login/);
  expect((await door.request.get("/api/admin/export?scope=official")).status()).toBe(401);

  // Painel: vê a entrada, com quem confirmou, e desfaz.
  await page.goto("/admin/portaria");
  await expect(page.getByText("Entraram 1 de 1 ingressos confirmados.", { exact: false })).toBeVisible();
  await expect(page.getByRole("row", { name: /Bianca Rocha Teixeira.*Segurança 1/ })).toBeVisible();
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Desfazer entrada" }).click();
  await expect(page.getByText("Ninguém entrou ainda.")).toBeVisible();

  // Trocar o código desconecta o leitor.
  await page.getByLabel(/Trocar o código da portaria/).fill("NOVO-CODIGO-1");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText(/Anote o código da portaria/)).toBeVisible();
  await dp.goto("/portaria");
  await expect(dp.getByRole("button", { name: "Abrir leitor" })).toBeVisible();

  await buyer.close();
  await door.close();
});

test("QR Code: o leitor lê o QR pela câmera do celular e mostra o nome", async ({
  page,
  browser,
  request,
  baseURL,
}) => {
  const p = await createPurchaseViaApi(request, baseURL!, { name: "Caio Henrique Moura", category: "masculino" });
  await payViaMock(p, "approved");
  await db`UPDATE purchases SET entry_code = ${FAKE_CAMERA_CODE} WHERE id = ${p.id}`;
  await enableQr(page);

  const door = await browser.newContext({ baseURL, permissions: ["camera"] });
  const dp = await door.newPage();
  await doorLogin(dp, "Segurança 2");
  // A câmera falsa mostra o QR do ingresso: o leitor encontra sozinho.
  await expect(dp.getByRole("heading", { name: "Caio Henrique Moura" })).toBeVisible({ timeout: 20_000 });
  await dp.getByRole("button", { name: "Confirmar entrada" }).click();
  await expect(dp.getByText("✓ ENTRADA LIBERADA")).toBeVisible();
  const [row] = await db`SELECT checked_in_by FROM purchases WHERE id = ${p.id}`;
  expect(row.checked_in_by).toBe("Segurança 2");
  // Volta ao leitor e lê o mesmo QR: já entrou.
  await expect(dp.getByText("✕ JÁ ENTROU")).toBeVisible({ timeout: 20_000 });
  await door.close();
});

test("lista impressa (padrão): sem QR na compra e leitor da portaria desligado", async ({ page, request, baseURL }) => {
  const p = await createPurchaseViaApi(request, baseURL!, { name: "Renata Lopes Ferraz" });
  await payViaMock(p, "approved");
  await page.goto(`/pedido/${p.id}`);
  await expect(page.getByText(/lista oficial de entrada/)).toBeVisible();
  await expect(page.locator(".ticket-qr-img")).toHaveCount(0);
  const [t] = await db`SELECT entry_code FROM purchases WHERE id = ${p.id}`;
  await page.goto(`/ingresso/${t.entry_code}`);
  await expect(page.getByText(/a entrada é feita pela/)).toBeVisible();
  await expect(page.locator(".ticket-qr-img")).toHaveCount(0);

  await page.goto("/portaria");
  await expect(page.getByText("A entrada por QR Code está desativada.", { exact: false })).toBeVisible();
  const r = await request.post("/api/portaria/login", {
    headers: { Origin: baseURL! },
    data: { name: "Fulano", code: "qualquer123" },
  });
  expect(r.status()).toBe(409);
  const lookup = await request.post("/api/portaria/lookup", {
    headers: { Origin: baseURL! },
    data: { code: t.entry_code },
  });
  expect(lookup.status()).toBe(409);
});
