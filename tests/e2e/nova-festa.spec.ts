import { expect, test } from "@playwright/test";
import { createPurchaseViaApi, db, loginAdmin, payViaMock, readyEvent } from "./helpers";

test.beforeEach(async () => {
  await readyEvent();
});

test("nova festa: arquiva a Party do Saco Cheio e o site passa a mostrar a Chopada Final", async ({
  page,
  request,
  baseURL,
}) => {
  // Configuração da festa anterior (sem os campos novos de título e cartaz, como no banco de produção).
  await db`UPDATE settings SET event = (event - 'titleTop' - 'titleMain' - 'poster') || '{"name": "Party do Saco Cheio", "camarote": "Camarote vendido na entrada."}'::jsonb`;
  const p = await createPurchaseViaApi(request, baseURL!, { name: "Comprador Antigo Silva" });
  await payViaMock(p, "approved");

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Party do\s*Saco Cheio/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Camarote" })).toBeVisible();

  await loginAdmin(page);
  page.on("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Fechar vendas" }).click();
  await expect(page.getByRole("button", { name: "Abrir vendas" })).toBeVisible();
  await page.getByRole("link", { name: "Começar nova festa" }).click();
  await expect(page.getByText("Party do Saco Cheio").first()).toBeVisible();
  // O formulário já vem com a Chopada Final (dados preparados no código).
  await expect(page.getByLabel("Nome da festa")).toHaveValue("Chopada Final da Invictus");
  await expect(page.getByLabel("Data")).toHaveValue("2026-11-21");
  await expect(page.getByLabel("Cartaz", { exact: true })).toHaveValue("/images/cartaz-chopada-final.webp");
  await expect(page.getByLabel("Taxa de serviço por ingresso (R$)")).toHaveValue("5,00");
  await expect(page.getByLabel("Nome da categoria 1")).toHaveValue("Universitária feminina");
  await expect(page.getByLabel("Preço da categoria 1")).toHaveValue("45,00");
  await expect(page.getByLabel("Preço da categoria 2")).toHaveValue("55,00");
  await expect(page.getByLabel("Preço da categoria 3")).toHaveValue("75,00");
  await expect(page.getByLabel("Regras de entrada (uma por linha)")).toHaveValue(/carteira de estudante/);
  const start = page.getByRole("button", { name: "Começar nova festa" });
  await expect(start).toBeDisabled();
  await page.getByLabel(/Digite NOVA FESTA/).fill("nova festa");
  await start.click();
  await expect(page.getByText(/A festa nº 2 começou/)).toBeVisible();
  await expect(page.getByRole("row", { name: /Party do Saco Cheio/ })).toContainText("1");

  // Site da nova festa: título, cartaz, cor roxa, local, categorias universitárias e sem camarote.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Chopada\s*Final/i })).toBeVisible();
  await expect(page.locator(".poster-mobile img")).toHaveAttribute("src", "/images/cartaz-chopada-final.webp");
  await expect(page.locator("body")).toHaveAttribute("data-accent", "");
  await expect(page.getByText("Sítio Contatto").first()).toBeVisible();
  await expect(page.locator("article.ticket")).toHaveCount(3);
  await expect(page.locator("article.ticket").first()).toContainText("Universitária feminina");
  await expect(page.locator("article.ticket").first()).toContainText("45,00");
  await expect(page.locator("article.ticket").first()).toContainText("Com carteira de estudante na entrada");
  await expect(page.locator("article.ticket").nth(2)).toContainText("75,00");
  await expect(page.getByText("+ R$ 5,00 de taxa de serviço por ingresso · total R$ 50,00")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Camarote" })).toHaveCount(0);
  await expect(page.getByText(/Pulseira universitária \(preço especial\)/)).toBeVisible();
  await expect(page.getByText("Vendas em breve").first()).toBeVisible();
  await expect(page).toHaveTitle(/Chopada Final da Invictus/);

  // Lista e resumo começam vazios; a festa anterior continua exportável.
  await page.goto("/admin/lista");
  await expect(page.getByText("Nenhum ingresso confirmado ainda.")).toBeVisible();
  const csv = await (await page.request.get("/api/admin/export?scope=official&edicao=1")).text();
  expect(csv).toContain("Comprador Antigo Silva");
  const current = await (await page.request.get("/api/admin/export?scope=official")).text();
  expect(current).not.toContain("Comprador Antigo Silva");

  // O pedido antigo mostra que a festa já aconteceu.
  await page.goto(`/pedido/${p.id}`);
  await expect(page.getByRole("heading", { name: "Festa encerrada" })).toBeVisible();

  // Salvar as configurações mantém o título e o cartaz novos.
  await page.goto("/admin/configuracoes");
  await expect(page.getByLabel("Cartaz", { exact: true })).toHaveValue("/images/cartaz-chopada-final.webp");
  await page
    .getByRole("button", { name: /Salvar/ })
    .first()
    .click();
  await expect(page.getByText(/Configurações salvas|Salvo/)).toBeVisible();
  const [s] =
    await db`SELECT event->>'titleTop' AS top, event->>'poster' AS poster, edition, service_fee_cents FROM settings`;
  expect(s).toMatchObject({
    top: "Chopada",
    poster: "/images/cartaz-chopada-final.webp",
    edition: 2,
    service_fee_cents: 500,
  });
});
