import { expect, test } from "@playwright/test";
import { db, fillStep1, loginAdmin, mockPayment, mockState, readyEvent } from "./helpers";

test.beforeEach(async () => {
  await readyEvent();
});

test.afterAll(async () => {
  await db.end();
});

test("página do evento mostra preços com a taxa e não exibe nomes de participantes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Party do\s*Saco Cheio/i })).toBeVisible();
  await expect(page.getByText("+ R$ 3,00 de taxa de serviço · total R$ 23,00")).toBeVisible();
  await expect(page.getByText("+ R$ 3,00 de taxa de serviço · total R$ 33,00")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Camarote" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});

test("4/5. formulário bloqueia campos vazios, nome só com espaços e falta de maioridade", async ({ page }) => {
  await page.goto("/comprar");
  await page.getByRole("button", { name: /Continuar/ }).click();
  await expect(page.getByText("Informe seu nome completo.")).toBeVisible();
  await expect(page.getByText("Escolha a categoria do ingresso.")).toBeVisible();
  await expect(page.getByText("É obrigatório confirmar que você tem 18 anos ou mais.")).toBeVisible();
  await page.getByLabel("Nome completo").fill("     ");
  await page.locator("label.choice", { hasText: "Feminino" }).click();
  await page.getByText("Li e aceito as regras de entrada").click();
  await page.getByRole("button", { name: /Continuar/ }).click();
  await expect(page.getByText("Informe seu nome completo.")).toBeVisible();
  await expect(page.getByText("É obrigatório confirmar que você tem 18 anos ou mais.")).toBeVisible();
  await expect(page.getByText("Confira seu pedido")).toHaveCount(0);
});

test("1/6/8/11. compra feminina por Pix: QR Code, webhook repetido e confirmação na tela", async ({ page }) => {
  await fillStep1(page, "Ana Beatriz Moreira", "Feminino");
  await expect(page.locator(".summary")).toContainText("R$ 20,00");
  await expect(page.locator(".summary")).toContainText("Taxa de serviço");
  await expect(page.locator(".summary .total")).toContainText("R$ 23,00");
  await page.getByLabel("E-mail para o Pix").fill("ana@example.com");
  await page.getByRole("button", { name: "Gerar Pix de R$ 23,00" }).click();

  await expect(page.getByRole("heading", { name: /Aguardando pagamento/ })).toBeVisible();
  await expect(page.getByAltText("QR Code do Pix")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar código Pix" })).toBeVisible();

  const [purchase] = await db`SELECT id, mp_payment_id, amount_cents, status FROM purchases`;
  expect(purchase.amount_cents).toBe(2300);
  expect(purchase.status).toBe("pending");
  // O app enviou ao Mercado Pago o valor do banco e uma chave de idempotência.
  const state = await mockState();
  const call = state.requests.find((r: { path: string }) => r.path === "/v1/payments");
  expect(call.body.transaction_amount).toBe(23);
  expect(call.idempotencyKey).toBe(`pix-${purchase.id}`);

  // Mercado Pago aprova e envia o mesmo webhook 3 vezes.
  const r = await mockPayment(purchase.mp_payment_id, { status: "approved", times: 3 });
  expect(r.webhookStatuses).toEqual([200, 200, 200]);
  await expect(page.getByRole("heading", { name: "Pagamento aprovado!" })).toBeVisible({ timeout: 20_000 });

  const rows = await db`SELECT status, ticket_code FROM purchases`;
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("confirmed");
  const events = await db`SELECT result FROM webhook_events ORDER BY id`;
  expect(events.map((e) => e.result)).toEqual(["confirmed", "already_confirmed", "already_confirmed"]);
});

test("2/7. compra masculina por cartão: redireciona ao checkout e volta aprovado", async ({ page }) => {
  await fillStep1(page, "Carlos Henrique Prado", "Masculino");
  await page.getByRole("radio", { name: /Cartão/ }).check();
  await expect(page.getByText("ambiente seguro do Mercado Pago")).toBeVisible();
  await page.getByRole("button", { name: "Pagar R$ 33,00 com cartão" }).click();

  await expect(page.getByText("SIMULADOR LOCAL")).toBeVisible();
  await expect(page.getByText("Taxa de serviço: R$ 3.00")).toBeVisible();
  await expect(page.getByText("parcelas: 1")).toBeVisible();
  await page.locator("#aprovar").click();

  await expect(page.getByRole("heading", { name: "Pagamento aprovado!" })).toBeVisible({ timeout: 20_000 });
  const [row] = await db`SELECT status, amount_cents, payment_method FROM purchases`;
  expect(row).toMatchObject({ status: "confirmed", amount_cents: 3300, payment_method: "card" });
});

test("10. cartão recusado mostra o estado e não entra na lista", async ({ page }) => {
  await fillStep1(page, "Pedro Alves Lima", "Masculino");
  await page.getByRole("radio", { name: /Cartão/ }).check();
  await page.getByRole("button", { name: /com cartão/ }).click();
  await page.locator("#recusar").click();
  await expect(page.getByText("Pagamento recusado.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Ir para o Mercado Pago" })).toBeVisible();
  const [row] = await db`SELECT status, payment_status FROM purchases`;
  expect(row).toMatchObject({ status: "pending", payment_status: "rejected" });
});

test("9. Pix pendente continua aguardando e expira quando o MP cancela", async ({ page }) => {
  await fillStep1(page, "Julia Fernandes Rocha", "Feminino");
  await page.getByLabel("E-mail para o Pix").fill("julia@example.com");
  await page.getByRole("button", { name: /Gerar Pix/ }).click();
  await expect(page.getByRole("heading", { name: /Aguardando pagamento/ })).toBeVisible();
  const [p] = await db`SELECT mp_payment_id FROM purchases`;
  await mockPayment(p.mp_payment_id, { status: "cancelled", status_detail: "expired" });
  await expect(page.getByRole("heading", { name: "Pagamento expirado" })).toBeVisible({ timeout: 20_000 });
});

test("12. comprador fecha o navegador antes da confirmação: webhook confirma mesmo assim", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await fillStep1(page, "Larissa Campos Dias", "Feminino");
  await page.getByLabel("E-mail para o Pix").fill("larissa@example.com");
  await page.getByRole("button", { name: /Gerar Pix/ }).click();
  await expect(page.getByAltText("QR Code do Pix")).toBeVisible();
  const [p] = await db`SELECT id, mp_payment_id FROM purchases`;
  await ctx.close(); // fechou o navegador

  await mockPayment(p.mp_payment_id, { status: "approved" });
  const [row] = await db`SELECT status FROM purchases WHERE id = ${p.id}`;
  expect(row.status).toBe("confirmed");
});

test("13. API ignora preço adulterado e bloqueia requisições de outra origem (CSRF)", async ({ request, baseURL }) => {
  const [settings] = await db`SELECT current_terms_version_id AS t FROM settings`;
  const body = {
    clientRequestId: crypto.randomUUID(),
    fullName: "Hacker Teste Silva",
    categoryId: "masculino",
    adultConfirmed: true,
    termsAccepted: true,
    termsVersionId: settings.t,
    paymentMethod: "pix",
    payerEmail: "h@example.com",
    amountCents: 1,
    priceCents: 1,
  };
  const forged = await request.post("/api/purchases", { data: body, headers: { Origin: "https://evil.example" } });
  expect(forged.status()).toBe(403);

  const res = await request.post("/api/purchases", { data: body, headers: { Origin: baseURL! } });
  expect(res.status()).toBe(201);
  const json = await res.json();
  expect(json.purchase.amountCents).toBe(3300);
  const state = await mockState();
  expect(state.requests.at(-1).body.transaction_amount).toBe(33);

  const minor = await request.post("/api/purchases", {
    data: { ...body, clientRequestId: crypto.randomUUID(), adultConfirmed: false },
    headers: { Origin: baseURL! },
  });
  expect(minor.status()).toBe(400);
  expect((await minor.json()).error.message).toContain("18 anos");
});

test("webhook com assinatura inválida é recusado e registrado", async ({ page }) => {
  await fillStep1(page, "Rafael Gomes Teixeira", "Masculino");
  await page.getByLabel("E-mail para o Pix").fill("rafa@example.com");
  await page.getByRole("button", { name: /Gerar Pix/ }).click();
  await expect(page.getByAltText("QR Code do Pix")).toBeVisible();
  const [p] = await db`SELECT mp_payment_id FROM purchases`;
  // Pagamento aprovado no MP, mas o webhook chega com assinatura forjada e a página não consulta o MP neste intervalo.
  const r = await mockPayment(p.mp_payment_id, { status: "approved", badSignature: true });
  expect(r.webhookStatuses).toEqual([401]);
  const [ev] = await db`SELECT signature_ok, result FROM webhook_events`;
  expect(ev.signature_ok).toBe(false);
});

test("valor divergente no pagamento não confirma a compra", async ({ request, baseURL }) => {
  const [settings] = await db`SELECT current_terms_version_id AS t FROM settings`;
  const res = await request.post("/api/purchases", {
    headers: { Origin: baseURL! },
    data: {
      clientRequestId: crypto.randomUUID(),
      fullName: "Bruno Costa Nunes",
      categoryId: "masculino",
      adultConfirmed: true,
      termsAccepted: true,
      termsVersionId: settings.t,
      paymentMethod: "pix",
      payerEmail: "b@example.com",
    },
  });
  const { purchase } = await res.json();
  const [p] = await db`SELECT mp_payment_id FROM purchases WHERE id = ${purchase.id}`;
  await mockPayment(p.mp_payment_id, { status: "approved", transaction_amount: 1 });
  const [row] = await db`SELECT status, attention FROM purchases WHERE id = ${purchase.id}`;
  expect(row).toMatchObject({ status: "pending", attention: "amount_mismatch" });
});

test("18. vendas fechadas: página e API recusam compras", async ({ page, request, baseURL }) => {
  await readyEvent({ salesOpen: false });
  await page.goto("/comprar");
  await expect(page.getByRole("heading", { name: "Vendas fechadas" })).toBeVisible();
  await page.goto("/");
  await expect(page.getByText("Vendas em breve").first()).toBeVisible();
  const [settings] = await db`SELECT current_terms_version_id AS t FROM settings`;
  const res = await request.post("/api/purchases", {
    headers: { Origin: baseURL! },
    data: {
      clientRequestId: crypto.randomUUID(),
      fullName: "Teste Fechado Silva",
      categoryId: "feminino",
      adultConfirmed: true,
      termsAccepted: true,
      termsVersionId: settings.t,
      paymentMethod: "card",
    },
  });
  expect(res.status()).toBe(409);
});

test("19. lotação: com 1 vaga reservada, o próximo comprador vê 'esgotado'", async ({ page }) => {
  await readyEvent({ capacity: 1 });
  await fillStep1(page, "Primeira Pessoa Teste", "Feminino");
  await page.getByLabel("E-mail para o Pix").fill("p1@example.com");
  await page.getByRole("button", { name: /Gerar Pix/ }).click();
  await expect(page.getByAltText("QR Code do Pix")).toBeVisible();
  await page.goto("/comprar");
  await expect(page.getByRole("heading", { name: "Ingressos esgotados" })).toBeVisible();
});

test.describe("painel administrativo", () => {
  test("14. sem login: páginas redirecionam e APIs recusam", async ({ page, request }) => {
    for (const path of ["/admin", "/admin/compras", "/admin/lista", "/admin/configuracoes"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/login$/);
    }
    expect((await request.get("/api/admin/export")).status()).toBe(401);
    expect((await request.get("/api/admin/export?scope=all")).status()).toBe(401);
    const login = await request.post("/api/admin/login", {
      data: { email: "diretoria@example.com", password: "errada" },
      headers: { Origin: "http://localhost:3100" },
    });
    expect(login.status()).toBe(401);
  });

  test("15/17/20. busca por nome, dashboard, lista impressa e CSV (no celular)", async ({ page }) => {
    // Duas compras confirmadas e uma pendente.
    for (const [name, cat] of [
      ["Ana Clara Ribeiro", "Feminino"],
      ["Otávio Mendes Luz", "Masculino"],
      ["Zé Pendente Silva", "Masculino"],
    ] as const) {
      await fillStep1(page, name, cat);
      await page.getByLabel("E-mail para o Pix").fill("x@example.com");
      await page.getByRole("button", { name: /Gerar Pix/ }).click();
      await expect(page.getByAltText("QR Code do Pix")).toBeVisible();
    }
    for (const p of await db`SELECT mp_payment_id FROM purchases WHERE full_name <> 'Zé Pendente Silva'`) {
      await mockPayment(p.mp_payment_id, { status: "approved" });
    }

    await loginAdmin(page);
    const confirmed = page.locator(".stat", { hasText: "Ingressos confirmados" });
    await expect(confirmed.locator(".v")).toHaveText("2");
    await expect(page.locator(".stat", { hasText: "Faturamento bruto" }).locator(".v")).toHaveText("R$ 56,00");
    await expect(page.locator(".stat", { hasText: "Pendentes" }).locator(".v")).toHaveText("1");

    await page.goto("/admin/compras");
    await page.getByLabel("Buscar por nome").fill("otavio");
    await page.getByRole("button", { name: "Filtrar" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody")).toContainText("Otávio Mendes Luz");

    await page.goto("/admin/lista");
    await expect(page.locator(".print-list tbody")).toContainText("Ana Clara Ribeiro");
    await expect(page.locator(".print-list tbody")).toContainText("Otávio Mendes Luz");
    await expect(page.locator(".print-list tbody")).not.toContainText("Zé Pendente");

    const csv = await page.request.get("/api/admin/export?scope=official");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const text = await csv.text();
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("Ana Clara Ribeiro;Feminino");
    expect(text).toContain("Otávio Mendes Luz;Masculino");
    expect(text).not.toContain("Pendente");

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test("transferência: organização troca o nome e a lista impressa já mostra a nova pessoa", async ({ page }) => {
    await fillStep1(page, "Fernanda Lopes Prado", "Feminino");
    await page.getByLabel("E-mail para o Pix").fill("f@example.com");
    await page.getByRole("button", { name: /Gerar Pix/ }).click();
    await expect(page.getByAltText("QR Code do Pix")).toBeVisible();
    const [p] = await db`SELECT id, mp_payment_id FROM purchases`;
    await mockPayment(p.mp_payment_id, { status: "approved" });

    await loginAdmin(page);
    await page.goto(`/admin/compras/${p.id}`);
    page.on("dialog", (d) => d.accept());
    await page.getByLabel("Nome completo da nova pessoa").fill("Gabriela Nunes Torres");
    await page.getByRole("button", { name: "Transferir" }).click();
    await expect(page.getByText("Nome atualizado na lista oficial.")).toBeVisible();
    await page.goto("/admin/lista");
    await expect(page.locator(".print-list tbody")).toContainText("Gabriela Nunes Torres");
    await expect(page.locator(".print-list tbody")).not.toContainText("Fernanda");
  });

  test("fechar vendas pelo painel e bloqueio de abertura com pendências", async ({ page }) => {
    await loginAdmin(page);
    page.on("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "Fechar vendas" }).click();
    await expect(page.getByRole("button", { name: "Abrir vendas" })).toBeVisible();
    const [s] = await db`SELECT sales_open FROM settings`;
    expect(s.sales_open).toBe(false);

    await db`UPDATE settings SET event = event || '{"venueName": null}'::jsonb`;
    await page.reload();
    await page.getByRole("button", { name: "Abrir vendas" }).click();
    await expect(page.getByText(/Falta: Nome do local/)).toBeVisible();
  });
});
