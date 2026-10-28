import { expect, test } from "@playwright/test";
import { createPurchaseViaApi, db, fillStep1, loginAdmin, mockPayment, mockState, payViaMock, readyEvent } from "./helpers";

test.beforeEach(async () => {
  await readyEvent();
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
  await expect(page.getByText("Informe um celular/WhatsApp com DDD, só com números.")).toBeVisible();
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

test("1/6/8/11. compra feminina por Pix no Checkout Pro: pendente, webhook repetido e confirmação na tela", async ({ page }) => {
  await fillStep1(page, "Ana Beatriz Moreira", "Feminino");
  await expect(page.locator(".summary")).toContainText("R$ 20,00");
  await expect(page.locator(".summary")).toContainText("(42) 99999-8888");
  await expect(page.locator(".summary")).toContainText("Taxa de serviço");
  await expect(page.locator(".summary .total")).toContainText("R$ 23,00");
  // Pix não pede e-mail: o comprador digita o que for preciso direto no Mercado Pago.
  await expect(page.getByLabel("E-mail para o Pix")).toHaveCount(0);
  await page.getByRole("button", { name: "Pagar R$ 23,00 com Pix" }).click();

  // Redirecionado ao checkout do Mercado Pago (simulado), só com Pix.
  await expect(page.getByText("SIMULADOR LOCAL")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pagar com Pix" })).toBeVisible();
  const [purchase] = await db`SELECT id, amount_cents, status FROM purchases`;
  expect(purchase).toMatchObject({ amount_cents: 2300, status: "pending" });
  const state = await mockState();
  const pref = state.preferences[0];
  expect(pref.items.map((i: { unit_price: number }) => i.unit_price)).toEqual([20, 3]);
  const excluded = pref.payment_methods.excluded_payment_types.map((t: { id: string }) => t.id);
  expect(excluded).toContain("credit_card");
  expect(excluded).not.toContain("bank_transfer"); // Pix é "bank_transfer" no Mercado Pago
  expect(pref.external_reference).toBe(purchase.id);
  const call = state.requests.find((r: { path: string }) => r.path.startsWith("/checkout/preferences"));
  expect(call.idempotencyKey).toBe(`pref-${purchase.id}`);

  // O comprador gera o Pix e volta ao site para esperar: pendente, nada confirmado.
  await page.locator("#pix-gerar").click();
  await expect(page.getByRole("heading", { name: /Aguardando pagamento/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Ir para o Pix no Mercado Pago/ })).toBeVisible();
  expect((await db`SELECT status FROM purchases`)[0].status).toBe("pending");

  // Mercado Pago aprova e envia o mesmo webhook 3 vezes.
  const [pay] = await db`SELECT mp_payment_id FROM payments`;
  const r = await mockPayment(pay.mp_payment_id, { status: "approved", times: 3 });
  expect(r.webhookStatuses).toEqual([200, 200, 200]);
  await expect(page.getByRole("heading", { name: "Pagamento aprovado!" })).toBeVisible({ timeout: 20_000 });

  const rows = await db`SELECT status, ticket_code FROM purchases`;
  expect(rows).toHaveLength(1);
  expect(rows[0].status).toBe("confirmed");
  const events = await db`SELECT result FROM webhook_events ORDER BY id`;
  expect(events.map((e) => e.result)).toEqual(["updated", "confirmed", "already_confirmed", "already_confirmed"]);
});

test("vários ingressos: 2 pessoas no mesmo pedido, um pagamento só, os dois nomes na lista", async ({ page }) => {
  await fillStep1(page, "Aline Teixeira Mota", "Feminino", { keepOnForm: true });
  // Ingresso extra para outra pessoa, de outra categoria.
  await page.getByRole("button", { name: /Adicionar outro ingresso/ }).click();
  await page.getByLabel("Nome completo do ingresso 2").fill("Rodrigo Pires Neto");
  await page.getByLabel("Categoria do ingresso 2").selectOption("masculino");
  await expect(page.getByRole("button", { name: /Continuar · 2 ingressos · R\$ 56,00/ })).toBeVisible();
  await page.getByRole("button", { name: /Continuar/ }).click();

  await expect(page.getByText("Confira seu pedido")).toBeVisible();
  await expect(page.locator(".summary")).toContainText("Ingresso 1");
  await expect(page.locator(".summary")).toContainText("Aline Teixeira Mota · Feminino · R$ 20,00");
  await expect(page.locator(".summary")).toContainText("Rodrigo Pires Neto · Masculino · R$ 30,00");
  await expect(page.locator(".summary")).toContainText("Taxa de serviço (2 × R$ 3,00)");
  await expect(page.locator(".summary .total")).toContainText("R$ 56,00");
  await page.getByRole("button", { name: "Pagar R$ 56,00 com Pix" }).click();

  await expect(page.getByText("SIMULADOR LOCAL")).toBeVisible();
  const pref = (await mockState()).preferences[0];
  expect(pref.items.map((i: { quantity: number; unit_price: number }) => [i.quantity, i.unit_price])).toEqual([
    [1, 20],
    [1, 30],
    [2, 3],
  ]);
  await page.locator("#pix-gerar").click();
  await expect(page.getByRole("heading", { name: /Aguardando pagamento/ })).toBeVisible();
  const [pay] = await db`SELECT mp_payment_id, amount_cents FROM payments`;
  expect(pay.amount_cents).toBe(5600);
  await mockPayment(pay.mp_payment_id, { status: "approved" });
  await expect(page.getByRole("heading", { name: "Pagamento aprovado!" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".summary")).toContainText("Rodrigo Pires Neto");

  const rows = await db`SELECT full_name, status, ticket_code FROM purchases ORDER BY full_name`;
  expect(rows.map((r) => [r.full_name, r.status])).toEqual([
    ["Aline Teixeira Mota", "confirmed"],
    ["Rodrigo Pires Neto", "confirmed"],
  ]);
  expect(new Set(rows.map((r) => r.ticket_code)).size).toBe(2);
});

test("vários ingressos: valida nome do ingresso extra e limita a 10 por pedido", async ({ page }) => {
  await fillStep1(page, "Aline Teixeira Mota", "Feminino", { keepOnForm: true });
  await page.getByRole("button", { name: /Adicionar outro ingresso/ }).click();
  await page.getByLabel("Nome completo do ingresso 2").fill("Fulano");
  await page.getByRole("button", { name: /Continuar/ }).click();
  await expect(page.getByText("Ingresso 2: Informe nome e sobrenome, como no documento.")).toBeVisible();
  await page.getByLabel("Nome completo do ingresso 2").fill("aline  teixeira mota");
  await page.getByRole("button", { name: /Continuar/ }).click();
  await expect(page.getByText("Ingresso 2: este nome já está no pedido.")).toBeVisible();
  await expect(page.getByText("Confira seu pedido")).toHaveCount(0);

  await page.getByRole("button", { name: "Remover" }).click();
  for (let i = 0; i < 9; i++) await page.getByRole("button", { name: /Adicionar outro ingresso/ }).click();
  await expect(page.getByText("Limite de 10 ingressos por pedido.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Adicionar outro ingresso/ })).toHaveCount(0);
});

test("API recusa mais de 10 ingressos e pedido maior que as vagas restantes", async ({ request, baseURL }) => {
  const [settings] = await db`SELECT current_terms_version_id AS t FROM settings`;
  const mk = (n: number) => ({
    clientRequestId: crypto.randomUUID(),
    fullName: "Pessoa Principal Teste",
    categoryId: "feminino",
    extraTickets: Array.from({ length: n }, (_, i) => ({ fullName: `Pessoa Extra ${"abcdefghijkl"[i]}`, categoryId: "feminino" })),
    adultConfirmed: true,
    termsAccepted: true,
    termsVersionId: settings.t,
    paymentMethod: "pix",
    buyerPhone: "42999998888",
  });
  const tooMany = await request.post("/api/purchases", { headers: { Origin: baseURL! }, data: mk(10) });
  expect(tooMany.status()).toBe(400);
  await db`UPDATE settings SET capacity = 2`;
  const notEnough = await request.post("/api/purchases", { headers: { Origin: baseURL! }, data: mk(2) });
  expect(notEnough.status()).toBe(409);
  expect((await notEnough.json()).error.code).toBe("not_enough");
  expect((await db`SELECT 1 FROM purchases`).length).toBe(0);
});

test("camarote como adicional: marcar na compra soma R$ 30 e só-camarote aparece como opção", async ({ page }) => {
  await db`INSERT INTO ticket_categories (id, label, price_cents, active, sort_order)
           VALUES ('camarote', 'Camarote', 3000, true, 3)
           ON CONFLICT (id) DO UPDATE SET active = true, price_cents = 3000`;
  try {
    await page.goto("/");
    await expect(page.getByText(/O camarote é um adicional de R\$\s30,00/)).toBeVisible();
    await expect(page.locator("article.ticket")).toHaveCount(2); // camarote não vira card de ingresso

    await fillStep1(page, "Helena Duarte Campos", "Feminino", { keepOnForm: true });
    await expect(page.getByText("Só o camarote")).toBeVisible();
    await page.getByText(/Quero camarote junto com o meu ingresso/).click();
    await expect(page.getByRole("button", { name: /Continuar · R\$ 53,00/ })).toBeVisible();
    await page.getByRole("button", { name: /Continuar/ }).click();
    await expect(page.locator(".summary")).toContainText("Feminino + Camarote");
    await expect(page.locator(".summary .total")).toContainText("R$ 53,00");
    await page.getByRole("button", { name: "Pagar R$ 53,00 com Pix" }).click();
    await expect(page.getByText("SIMULADOR LOCAL")).toBeVisible();
    const [row] = await db`SELECT amount_cents, camarote, category_label FROM purchases`;
    expect(row).toMatchObject({ amount_cents: 5300, camarote: true, category_label: "Feminino + Camarote" });
  } finally {
    await db`DELETE FROM ticket_categories WHERE id = 'camarote'`;
  }
});

test("2/7. compra masculina por cartão: redireciona ao checkout e volta aprovado", async ({ page }) => {
  await fillStep1(page, "Carlos Henrique Prado", "Masculino");
  await page.getByRole("radio", { name: /Cartão/ }).check();
  await expect(page.getByText("ambiente seguro do Mercado Pago")).toBeVisible();
  await page.getByRole("button", { name: "Pagar R$ 33,00 com cartão" }).click();

  await expect(page.getByText("SIMULADOR LOCAL")).toBeVisible();
  await expect(page.getByText("Taxa de serviço: R$ 3.00")).toBeVisible();
  await expect(page.getByText("parcelas: 1")).toBeVisible();
  const pref = (await mockState()).preferences[0];
  expect(pref.payment_methods.excluded_payment_types.map((t: { id: string }) => t.id)).toContain("bank_transfer");
  expect(pref.binary_mode).toBe(true);
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
  await expect(page.getByText("O último pagamento não foi concluído")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Ir para o Mercado Pago" })).toBeVisible();
  const [row] = await db`SELECT status, payment_status FROM purchases`;
  expect(row).toMatchObject({ status: "pending", payment_status: "rejected" });
});

test("9. Pix pendente continua aguardando; se o MP cancelar, pode tentar de novo; vencida a reserva, expira", async ({ page }) => {
  await fillStep1(page, "Julia Fernandes Rocha", "Feminino");
  await page.getByRole("button", { name: /com Pix/ }).click();
  await page.locator("#pix-gerar").click();
  await expect(page.getByRole("heading", { name: /Aguardando pagamento/ })).toBeVisible();

  const [pay] = await db`SELECT mp_payment_id FROM payments`;
  await mockPayment(pay.mp_payment_id, { status: "cancelled", status_detail: "expired" });
  await expect(page.getByText("O último pagamento não foi concluído")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: /Ir para o Pix no Mercado Pago/ })).toBeVisible();

  await db`UPDATE purchases SET expires_at = now() - interval '1 minute'`;
  await expect(page.getByRole("heading", { name: "Pagamento expirado" })).toBeVisible({ timeout: 20_000 });
});

test("12. comprador fecha o navegador antes da confirmação: webhook confirma mesmo assim", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await fillStep1(page, "Larissa Campos Dias", "Feminino");
  await page.getByRole("button", { name: /com Pix/ }).click();
  await page.locator("#pix-gerar").click();
  await expect(page.getByRole("heading", { name: /Aguardando pagamento/ })).toBeVisible();
  const [p] = await db`SELECT purchases.id, payments.mp_payment_id FROM purchases JOIN payments ON payments.purchase_id = purchases.id`;
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
    buyerPhone: "42999998888",
    amountCents: 1,
    priceCents: 1,
  };
  const forged = await request.post("/api/purchases", { data: body, headers: { Origin: "https://evil.example" } });
  expect(forged.status()).toBe(403);

  const res = await request.post("/api/purchases", { data: body, headers: { Origin: baseURL! } });
  expect(res.status()).toBe(201);
  const json = await res.json();
  expect(json.purchase.amountCents).toBe(3300);
  const pref = (await mockState()).preferences.at(-1);
  expect(pref.items.map((i: { unit_price: number }) => i.unit_price)).toEqual([30, 3]);

  const minor = await request.post("/api/purchases", {
    data: { ...body, clientRequestId: crypto.randomUUID(), adultConfirmed: false },
    headers: { Origin: baseURL! },
  });
  expect(minor.status()).toBe(400);
  expect((await minor.json()).error.message).toContain("18 anos");
});

test("webhook com assinatura inválida é recusado, registrado e não confirma a compra", async ({ request, baseURL }) => {
  const purchase = await createPurchaseViaApi(request, baseURL!, { name: "Rafael Gomes Teixeira", category: "masculino" });
  // O pagamento foi aprovado no Mercado Pago, mas o webhook chega com assinatura forjada.
  const r = await payViaMock(purchase, "approved", { badSignature: true });
  expect(r.webhookStatuses).toEqual([401]);
  const [ev] = await db`SELECT signature_ok, result FROM webhook_events`;
  expect(ev.signature_ok).toBe(false);
  expect(ev.result).toMatch(/^invalid_signature/);
  const [row] = await db`SELECT status FROM purchases WHERE id = ${purchase.id}`;
  expect(row.status).toBe("pending");
});

test("valor divergente no pagamento não confirma a compra", async ({ request, baseURL }) => {
  const purchase = await createPurchaseViaApi(request, baseURL!, { name: "Bruno Costa Nunes", category: "masculino" });
  const r = await payViaMock(purchase, "approved", { transaction_amount: 1 });
  expect(r.webhookStatuses).toEqual([200]);
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
      buyerPhone: "42999998888",
    },
  });
  expect(res.status()).toBe(409);
});

test("19. lotação: com 1 vaga reservada, o próximo comprador vê 'esgotado'", async ({ page }) => {
  await readyEvent({ capacity: 1 });
  await fillStep1(page, "Primeira Pessoa Teste", "Feminino");
  await page.getByRole("button", { name: /com Pix/ }).click();
  await expect(page.getByText("SIMULADOR LOCAL")).toBeVisible();
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

  test("15/17/20. busca por nome, dashboard, lista impressa e CSV (no celular)", async ({ page, request, baseURL }) => {
    // Duas compras confirmadas e uma pendente.
    for (const [name, cat, paid] of [
      ["Ana Clara Ribeiro", "feminino", true],
      ["Otávio Mendes Luz", "masculino", true],
      ["Zé Pendente Silva", "masculino", false],
    ] as const) {
      const purchase = await createPurchaseViaApi(request, baseURL!, { name, category: cat });
      if (paid) await payViaMock(purchase, "approved");
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

  test("transferência: organização troca o nome e a lista impressa já mostra a nova pessoa", async ({ page, request, baseURL }) => {
    const p = await createPurchaseViaApi(request, baseURL!, { name: "Fernanda Lopes Prado" });
    await payViaMock(p, "approved");

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

  test("ingresso manual: organização lança nomes, entram na lista impressa e a remoção libera a vaga", async ({ page }) => {
    await db`UPDATE settings SET capacity = 3`;
    await loginAdmin(page);
    await page.getByRole("link", { name: "Ingresso manual", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Ingresso manual", level: 1 })).toBeVisible();
    await expect(page.getByText("Vagas livres agora: 3 de 3.")).toBeVisible();
    page.on("dialog", (d) => d.accept());

    await page.getByLabel("Categoria").selectOption("masculino");
    await expect(page.getByLabel("Valor pago por ingresso (R$)")).toHaveValue("30,00");
    await page.getByLabel("Nome completo de cada pessoa (um por linha)").fill("Marcos Vinicius Prado\nLuana Ribeiro Costa");
    await page.getByLabel("Observação interna (opcional)").fill("Pix direto, vendido pelo Bruno");
    const launch = page.getByRole("button", { name: /Lançar 2 ingresso/ });
    await expect(launch).toBeDisabled(); // falta confirmar a maioridade/pagamento
    await page.getByText("Confirmo que todas as pessoas acima têm 18 anos").click();
    await launch.click();
    await expect(page.getByText("2 ingresso(s) lançado(s) e já na lista oficial.")).toBeVisible();

    const rows = await db`SELECT full_name, status, source, amount_cents, fee_cents, note, mp_payment_id FROM purchases ORDER BY full_name`;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ full_name: "Luana Ribeiro Costa", status: "confirmed", source: "manual", amount_cents: 3000, fee_cents: 0, mp_payment_id: null });
    expect(rows[0].note).toBe("Pix direto, vendido pelo Bruno");
    await expect(page.getByText("Vagas livres agora: 1 de 3.")).toBeVisible();

    await page.goto("/admin/lista");
    await expect(page.locator(".print-list tbody")).toContainText("Marcos Vinicius Prado");
    await expect(page.locator(".print-list tbody")).toContainText("Luana Ribeiro Costa");

    // Venda online enxerga as vagas ocupadas pelos manuais: sobra 1.
    const resp = await page.request.get("/comprar");
    expect(resp.status()).toBe(200);

    await page.goto("/admin/manual");
    await page.getByRole("row", { name: /Marcos Vinicius Prado/ }).getByRole("button", { name: "Remover" }).click();
    await expect(page.getByText("Vagas livres agora: 2 de 3.")).toBeVisible();
    await page.goto("/admin/lista");
    await expect(page.locator(".print-list tbody")).not.toContainText("Marcos Vinicius Prado");

    // Exportação marca a origem manual.
    const csv = await page.request.get("/api/admin/export?scope=all");
    const text = await csv.text();
    expect(text).toContain("Manual");
    expect(text).toContain("Pix direto, vendido pelo Bruno");
  });

  test("ingresso manual: exige login e recusa lotação estourada", async ({ page, request, baseURL }) => {
    const anon = await request.post("/api/admin/manual", {
      headers: { Origin: baseURL! },
      data: { names: ["Fulano de Tal"], categoryId: "feminino", priceCents: null, phone: null, note: null, adultConfirmed: true },
    });
    expect(anon.status()).toBe(401);

    await db`UPDATE settings SET capacity = 1`;
    await loginAdmin(page);
    await page.goto("/admin/manual");
    page.on("dialog", (d) => d.accept());
    await page.getByLabel("Nome completo de cada pessoa (um por linha)").fill("Ana Paula Ribeiro\nBia Souza Lima");
    await page.getByText("Confirmo que todas as pessoas acima têm 18 anos").click();
    await page.getByRole("button", { name: /Lançar 2 ingresso/ }).click();
    await expect(page.getByText(/Restam apenas 1 vagas na lotação/)).toBeVisible();
    expect((await db`SELECT 1 FROM purchases`).length).toBe(0);
  });

  test("camarote pelo painel: organização adiciona ao nome já comprado e a lista impressa mostra", async ({ page, request, baseURL }) => {
    const p = await createPurchaseViaApi(request, baseURL!, { name: "Isabela Moraes Tavares" });
    await payViaMock(p, "approved");
    await loginAdmin(page);
    page.on("dialog", (d) => d.accept());
    await page.goto(`/admin/compras/${p.id}`);
    await expect(page.getByLabel("Valor do camarote recebido (R$)")).toHaveValue("30,00");
    await page.getByRole("button", { name: "Adicionar camarote" }).click();
    await expect(page.getByText(/já tem camarote/)).toBeVisible();
    const [row] = await db`SELECT amount_cents, camarote, camarote_extra_cents, category_label FROM purchases`;
    expect(row).toMatchObject({ amount_cents: 2300, camarote: true, camarote_extra_cents: 3000, category_label: "Feminino + Camarote" });

    await page.goto("/admin/lista");
    await expect(page.locator(".print-list tbody")).toContainText("Feminino + Camarote");
    await page.goto(`/admin/compras/${p.id}`);
    await page.getByRole("button", { name: "Remover camarote" }).click();
    await expect(page.getByRole("button", { name: "Adicionar camarote" })).toBeVisible();
  });

  test("Atlética: marcar ingresso e lançar cortesia da diretoria; lista impressa tem seção separada", async ({ page, request, baseURL }) => {
    const p = await createPurchaseViaApi(request, baseURL!, { name: "Tesoureira Clara Mendes" });
    await payViaMock(p, "approved");
    await loginAdmin(page);
    page.on("dialog", (d) => d.accept());
    await page.goto(`/admin/compras/${p.id}`);
    await page.getByRole("button", { name: "Marcar como Atlética" }).click();
    await expect(page.getByRole("button", { name: "Tirar da Atlética" })).toBeVisible();

    await page.goto("/admin/manual");
    await page.getByLabel("Nome completo de cada pessoa (um por linha)").fill("Presidente Joao Batista");
    await page.getByText(/Atlética.* \(diretoria\)/).click();
    await page.getByText("Confirmo que todas as pessoas acima têm 18 anos").click();
    await page.getByRole("button", { name: /Lançar 1 ingresso/ }).click();
    await expect(page.getByText("1 ingresso(s) lançado(s)")).toBeVisible();
    await db`INSERT INTO purchases (client_request_id, full_name, name_search, category_id, category_label, ticket_price_cents, fee_cents, amount_cents, payment_method, source, status, adult_confirmed, terms_version_id, terms_accepted_at, ticket_code, expires_at, confirmed_at)
             SELECT gen_random_uuid(), 'Convidado Geral Souza', 'convidado geral souza', 'feminino', 'Feminino', 2000, 0, 2000, 'manual', 'manual', 'confirmed', true, current_terms_version_id, now(), 'INV-GERAL00001', now(), now() FROM settings`;

    await page.goto("/admin/lista");
    await expect(page.getByRole("heading", { name: "Lista geral" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Atlética (diretoria)" })).toBeVisible();
    const sections = page.locator(".print-list table");
    await expect(sections.nth(0)).toContainText("Convidado Geral Souza");
    await expect(sections.nth(0)).not.toContainText("Tesoureira Clara Mendes");
    await expect(sections.nth(1)).toContainText("Tesoureira Clara Mendes");
    await expect(sections.nth(1)).toContainText("Presidente Joao Batista");
    const csv = await (await page.request.get("/api/admin/export?scope=official")).text();
    expect(csv).toContain("Atlética;Presidente Joao Batista");
  });

  test("página Atlética: cola os nomes da diretoria e saem na seção separada da lista", async ({ page, request }) => {
    const anon = await request.post("/api/admin/atletica", { headers: { Origin: "http://localhost" }, data: {} });
    expect([401, 403]).toContain(anon.status());
    await loginAdmin(page);
    await page.getByRole("link", { name: "Atlética", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Atlética (diretoria)", level: 1 })).toBeVisible();
    await page.getByLabel("Nome completo de cada pessoa (um por linha)").fill("Presidente Joao Batista\nTesoureira Maria Clara Reis");
    const add = page.getByRole("button", { name: /Adicionar 2 à Atlética/ });
    await expect(add).toBeDisabled();
    await page.getByText("Confirmo que todas as pessoas acima têm 18 anos").click();
    await add.click();
    await expect(page.getByText("2 nome(s) adicionado(s) à seção Atlética.")).toBeVisible();
    await expect(page.getByRole("row", { name: /Presidente Joao Batista/ })).toBeVisible();

    await page.goto("/admin/lista");
    await expect(page.getByRole("heading", { name: "Atlética (diretoria)" })).toBeVisible();
    await expect(page.locator(".print-list table").nth(1)).toContainText("Tesoureira Maria Clara Reis");
    const csv = await (await page.request.get("/api/admin/export?scope=official")).text();
    expect(csv).toContain("Atlética;Presidente Joao Batista");
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
