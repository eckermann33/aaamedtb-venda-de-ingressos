import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAthleticTickets,
  setAthletic,
  addCamarote,
  removeCamarote,
  applyPayment,
  cancelManualTicket,
  createManualTickets,
  createPurchase,
  getOrder,
  getOrderTickets,
  getPurchase,
  PurchaseError,
  reconcilePurchase,
  refundPurchasePayment,
  toPublic,
} from "@/server/purchases";
import { getStats, officialList } from "@/server/reports";
import { deps, FakeMp, request, resetDb, sql } from "./helpers";

let terms: number;
let mp: FakeMp;

beforeEach(async () => {
  terms = await resetDb();
  mp = new FakeMp();
});

afterAll(async () => {
  await sql().end();
});

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof PurchaseError && e.code === code);
}

const trio = {
  fullName: "Maria Eduarda Souza",
  categoryId: "feminino",
  extraTickets: [
    { fullName: "Ana Clara Lima", categoryId: "feminino" },
    { fullName: "João Pedro Alves", categoryId: "masculino" },
  ],
};

describe("pedido com vários ingressos", () => {
  it("cria um pedido de 3 ingressos com um único pagamento (2 feminino + 1 masculino)", async () => {
    const lead = await createPurchase(deps(mp), request(terms, trio));
    const order = (await getOrder(sql(), lead.id))!;
    expect(order.tickets).toHaveLength(3);
    expect(order.lead.lead_id).toBeNull();
    expect(order.tickets.filter((t) => t.lead_id === lead.id)).toHaveLength(2);

    expect(mp.prefCalls).toHaveLength(1);
    expect(mp.prefCalls[0].purchaseId).toBe(lead.id);
    expect(mp.prefCalls[0].items).toEqual([
      expect.objectContaining({ id: "feminino", quantity: 2, unitPriceCents: 2000 }),
      expect.objectContaining({ id: "masculino", quantity: 1, unitPriceCents: 3000 }),
      expect.objectContaining({ id: "taxa-servico", quantity: 3, unitPriceCents: 300 }),
    ]);

    const pub = toPublic(order.lead, order.tickets);
    expect(pub.tickets.map((t) => t.fullName).sort()).toEqual(["Ana Clara Lima", "João Pedro Alves", "Maria Eduarda Souza"]);
    expect(pub.ticketPriceCents).toBe(7000);
    expect(pub.feeCents).toBe(900);
    expect(pub.amountCents).toBe(7900);
    expect(pub.state).toBe("awaiting_payment");
  });

  it("pagamento aprovado confirma todos os ingressos, cada um com seu código", async () => {
    const lead = await createPurchase(deps(mp), request(terms, trio));
    const pay = mp.pay({ id: lead.id, amount_cents: 7900, payment_method: "pix" }, "approved");
    expect(await applyPayment(sql(), pay)).toBe("confirmed");
    // idempotente
    expect(await applyPayment(sql(), pay)).toBe("already_confirmed");

    const tickets = await getOrderTickets(sql(), lead.id);
    expect(tickets.every((t) => t.status === "confirmed")).toBe(true);
    const codes = tickets.map((t) => t.ticket_code);
    expect(new Set(codes).size).toBe(3);
    expect(tickets.filter((t) => t.mp_payment_id !== null)).toHaveLength(1);

    expect(await officialList(sql())).toHaveLength(3);
    const stats = await getStats(sql());
    expect(stats.confirmed).toBe(3);
    expect(stats.grossRevenueCents).toBe(7900);
    expect(stats.feeRevenueCents).toBe(900);
    expect(stats.approvedPayments).toBe(1);
  });

  it("pagamento com o valor de um ingresso só não confirma o pedido de 3", async () => {
    const lead = await createPurchase(deps(mp), request(terms, trio));
    const pay = mp.pay({ id: lead.id, amount_cents: 2300, payment_method: "pix" }, "approved");
    expect(await applyPayment(sql(), pay)).toBe("invalid_payment");
    expect((await getPurchase(sql(), lead.id))!.status).toBe("pending");
    expect((await getPurchase(sql(), lead.id))!.attention).toBe("amount_mismatch");
    expect(await officialList(sql())).toHaveLength(0);
  });

  it("estorno devolve o pedido inteiro e tira todos da lista", async () => {
    const lead = await createPurchase(deps(mp), request(terms, trio));
    const pay = mp.pay({ id: lead.id, amount_cents: 7900, payment_method: "pix" }, "approved");
    await applyPayment(sql(), pay);
    await refundPurchasePayment(sql(), mp, lead.id, String(pay.id));
    const tickets = await getOrderTickets(sql(), lead.id);
    expect(tickets.map((t) => t.status)).toEqual(["refunded", "refunded", "refunded"]);
    expect(await officialList(sql())).toHaveLength(0);
  });

  it("respeita a lotação pelo número de ingressos do pedido", async () => {
    await resetDb({ capacity: 2 });
    await expectError(createPurchase(deps(mp), request(terms, trio)), "not_enough");
    const two = await createPurchase(deps(mp), request(terms, { ...trio, extraTickets: [trio.extraTickets[0]] }));
    expect(two.id).toBeTruthy();
    await expectError(createPurchase(deps(mp), request(terms, { fullName: "Carlos Eduardo Dias" })), "sold_out");
  });

  it("reserva vencida libera todas as vagas do pedido", async () => {
    await resetDb({ capacity: 2 });
    const lead = await createPurchase(deps(mp), request(terms, { ...trio, extraTickets: [trio.extraTickets[0]] }));
    await sql()`UPDATE purchases SET expires_at = now() - interval '1 minute' WHERE id = ${lead.id} OR lead_id = ${lead.id}`;
    await reconcilePurchase(sql(), mp, lead.id, { minIntervalSeconds: 0 });
    const tickets = await getOrderTickets(sql(), lead.id);
    expect(tickets.map((t) => t.status)).toEqual(["expired", "expired"]);
    const again = await createPurchase(deps(mp), request(terms, { ...trio, extraTickets: [trio.extraTickets[0]] }));
    expect(again.id).not.toBe(lead.id);
  });

  it("aprovação tardia de pedido grande acima da lotação não entra na lista", async () => {
    await resetDb({ capacity: 2 });
    const a = await createPurchase(deps(mp), request(terms, { ...trio, extraTickets: [trio.extraTickets[0]] }));
    await sql()`UPDATE purchases SET expires_at = now() - interval '1 minute' WHERE id = ${a.id} OR lead_id = ${a.id}`;
    const b = await createPurchase(
      deps(mp),
      request(terms, {
        fullName: "Pessoa Outra Teste",
        extraTickets: [{ fullName: "Mais Uma Pessoa", categoryId: "feminino" }],
      }),
    );
    await applyPayment(sql(), mp.pay({ id: b.id, amount_cents: 4600, payment_method: "pix" }, "approved"));
    expect(await applyPayment(sql(), mp.pay({ id: a.id, amount_cents: 4600, payment_method: "pix" }, "approved"))).toBe(
      "over_capacity",
    );
    expect(await officialList(sql())).toHaveLength(2);
  });

  it("clique duplo com os mesmos ingressos cria um único pedido; dados diferentes com a mesma chave são recusados", async () => {
    const req = request(terms, trio);
    const results = await Promise.all([1, 2, 3].map(() => createPurchase(deps(mp), req)));
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM purchases`;
    expect(n).toBe(3);
    expect(mp.prefCalls).toHaveLength(1);
    await expectError(
      createPurchase(deps(mp), { ...req, extraTickets: [trio.extraTickets[0]] }),
      "conflict",
    );
  });

  it("limites: máximo de 10 ingressos, nomes repetidos e nome inválido em ingresso extra", async () => {
    const eleven = Array.from({ length: 10 }, (_, i) => ({ fullName: `Pessoa Numero ${"abcdefghij"[i]}`, categoryId: "feminino" }));
    await expectError(createPurchase(deps(mp), request(terms, { extraTickets: eleven })), "too_many");
    const nine = eleven.slice(0, 9);
    const ten = await createPurchase(deps(mp), request(terms, { extraTickets: nine }));
    expect((await getOrderTickets(sql(), ten.id)).length).toBe(10);

    await expectError(
      createPurchase(deps(mp), request(terms, { extraTickets: [{ fullName: "maria  eduarda souza", categoryId: "feminino" }] })),
      "duplicate_name",
    );
    await expectError(
      createPurchase(deps(mp), request(terms, { extraTickets: [{ fullName: "Fulano", categoryId: "feminino" }] })),
      "invalid_name",
    );
    await expectError(
      createPurchase(deps(mp), request(terms, { extraTickets: [{ fullName: "Fulano de Tal", categoryId: "vip" }] })),
      "invalid_category",
    );
  });

  it("falha no Mercado Pago marca todos os ingressos do pedido como falhos e libera as vagas", async () => {
    await resetDb({ capacity: 3 });
    mp.fail = true;
    await expectError(createPurchase(deps(mp), request(terms, trio)), "payment_unavailable");
    mp.fail = false;
    const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM purchases WHERE status = 'failed'`;
    expect(n).toBe(3);
    const ok = await createPurchase(deps(mp), request(terms, trio));
    expect(ok.status).toBe("pending");
  });

  it("pedido com um ingresso só continua igual (sem extras)", async () => {
    const lead = await createPurchase(deps(mp), request(terms));
    const order = (await getOrder(sql(), lead.id))!;
    expect(order.tickets).toHaveLength(1);
    expect(toPublic(order.lead, order.tickets).amountCents).toBe(2300);
  });
});

describe("ingressos manuais", () => {
  it("lança vários nomes de uma vez: confirmados, na lista, sem taxa e sem Mercado Pago", async () => {
    const rows = await createManualTickets(sql(), {
      names: ["Pedro Henrique Lima", "  Camila   Rocha Dias "],
      categoryId: "masculino",
      priceCents: null,
      phone: "(42) 99999-1111",
      note: "Pix direto, vendido pelo Bruno",
    });
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.status).toBe("confirmed");
      expect(r.source).toBe("manual");
      expect(r.payment_method).toBe("manual");
      expect(r.amount_cents).toBe(3000);
      expect(r.fee_cents).toBe(0);
      expect(r.ticket_code).toMatch(/^INV-/);
      expect(r.mp_payment_id).toBeNull();
    }
    const list = await officialList(sql());
    expect(list.map((r) => r.full_name)).toEqual(["Camila Rocha Dias", "Pedro Henrique Lima"]);
    const stats = await getStats(sql());
    expect(stats.confirmed).toBe(2);
    expect(stats.manualConfirmed).toBe(2);
    expect(stats.manualRevenueCents).toBe(6000);
    expect(stats.approvedPayments).toBe(0);
  });

  it("aceita valor diferente e cortesia (R$ 0)", async () => {
    const [custom] = await createManualTickets(sql(), { names: ["Lucas Martins Reis"], categoryId: "feminino", priceCents: 1500, phone: null, note: null });
    expect(custom.amount_cents).toBe(1500);
    const [free] = await createManualTickets(sql(), { names: ["Convidada Especial Silva"], categoryId: "feminino", priceCents: 0, phone: null, note: "Cortesia" });
    expect(free.amount_cents).toBe(0);
    expect(free.status).toBe("confirmed");
  });

  it("valida nomes, valor e telefone", async () => {
    const base = { categoryId: "feminino", priceCents: null, phone: null, note: null };
    await expectError(createManualTickets(sql(), { ...base, names: [] }), "invalid_name");
    await expectError(createManualTickets(sql(), { ...base, names: ["Maria"] }), "invalid_name");
    await expectError(createManualTickets(sql(), { ...base, names: ["Maria Souza"], priceCents: -1 }), "invalid_price");
    await expectError(createManualTickets(sql(), { ...base, names: ["Maria Souza"], phone: "429l1374203" }), "invalid_phone");
    await expectError(createManualTickets(sql(), { ...base, names: ["Maria Souza"], categoryId: "vip" }), "invalid_category");
    expect(await officialList(sql())).toHaveLength(0);
  });

  it("ocupa vaga da lotação e a remoção libera a vaga", async () => {
    await resetDb({ capacity: 2 });
    const [a] = await createManualTickets(sql(), { names: ["Primeira Pessoa Teste"], categoryId: "feminino", priceCents: null, phone: null, note: null });
    await createManualTickets(sql(), { names: ["Segunda Pessoa Teste"], categoryId: "feminino", priceCents: null, phone: null, note: null });
    await expectError(
      createManualTickets(sql(), { names: ["Terceira Pessoa Teste"], categoryId: "feminino", priceCents: null, phone: null, note: null }),
      "not_enough",
    );
    // a venda online também enxerga as vagas ocupadas pelos manuais
    await expectError(createPurchase(deps(mp), request(terms)), "sold_out");

    await cancelManualTicket(sql(), a.id);
    expect((await getPurchase(sql(), a.id))!.status).toBe("cancelled");
    expect(await officialList(sql())).toHaveLength(1);
    expect((await createPurchase(deps(mp), request(terms))).status).toBe("pending");
  });

  it("remoção só vale para ingresso manual confirmado (compra online usa estorno)", async () => {
    const online = await createPurchase(deps(mp), request(terms));
    await expectError(cancelManualTicket(sql(), online.id), "not_cancellable");
    const [m] = await createManualTickets(sql(), { names: ["Quarta Pessoa Teste"], categoryId: "feminino", priceCents: null, phone: null, note: null });
    await cancelManualTicket(sql(), m.id);
    await expectError(cancelManualTicket(sql(), m.id), "not_cancellable");
  });

  it("ingresso manual não tem página pública de pedido nem entra na conciliação", async () => {
    const [m] = await createManualTickets(sql(), { names: ["Quinta Pessoa Teste"], categoryId: "feminino", priceCents: null, phone: null, note: null });
    expect(await getOrder(sql(), m.id)).toBeNull();
    expect(await applyPayment(sql(), mp.pay({ id: m.id, amount_cents: 2000, payment_method: "pix" }, "approved"))).toBe("unknown_reference");
    expect((await getPurchase(sql(), m.id))!.mp_payment_id).toBeNull();
  });

  it("o banco recusa ingresso manual com forma de pagamento online", async () => {
    const [m] = await createManualTickets(sql(), { names: ["Sexta Pessoa Teste"], categoryId: "feminino", priceCents: null, phone: null, note: null });
    await expect(sql()`UPDATE purchases SET payment_method = 'pix' WHERE id = ${m.id}`).rejects.toThrow();
  });
});

describe("camarote como adicional", () => {
  const withCamarote = async () => {
    await sql()`
      INSERT INTO ticket_categories (id, label, price_cents, active, sort_order)
      VALUES ('camarote', 'Camarote', 3000, true, 3)
      ON CONFLICT (id) DO UPDATE SET active = true, price_cents = 3000
    `;
  };

  it("adicional soma o valor ao ingresso, vira item do checkout e conta no painel", async () => {
    await withCamarote();
    const lead = await createPurchase(deps(mp), request(terms, { camarote: true }));
    expect(lead.camarote).toBe(true);
    expect(lead.category_id).toBe("feminino");
    expect(lead.category_label).toBe("Feminino + Camarote");
    expect(lead.ticket_price_cents).toBe(5000);
    expect(lead.amount_cents).toBe(5300);
    expect(mp.prefCalls[0].items).toEqual([
      expect.objectContaining({ id: "feminino", quantity: 1, unitPriceCents: 2000 }),
      expect.objectContaining({ id: "camarote", quantity: 1, unitPriceCents: 3000 }),
      expect.objectContaining({ id: "taxa-servico", quantity: 1, unitPriceCents: 300 }),
    ]);
    const total = mp.prefCalls[0].items.reduce((n, i) => n + i.quantity * i.unitPriceCents, 0);
    expect(total).toBe(5300);
    await applyPayment(sql(), mp.pay({ id: lead.id, amount_cents: 5300, payment_method: "pix" }, "approved"));
    expect((await getStats(sql())).camarotes).toBe(1);
    expect((await officialList(sql()))[0].category_label).toBe("Feminino + Camarote");
  });

  it("pedido misto: um com adicional, um sem e um só de camarote (quem já tem ingresso)", async () => {
    await withCamarote();
    const lead = await createPurchase(
      deps(mp),
      request(terms, {
        camarote: true,
        extraTickets: [
          { fullName: "Ana Clara Lima", categoryId: "masculino" },
          { fullName: "João Pedro Alves", categoryId: "camarote" },
        ],
      }),
    );
    const tickets = await getOrderTickets(sql(), lead.id);
    const byName = Object.fromEntries(tickets.map((t) => [t.full_name, t]));
    expect(byName["Maria Eduarda Souza"].amount_cents).toBe(5300);
    expect(byName["Ana Clara Lima"].amount_cents).toBe(3300);
    expect(byName["João Pedro Alves"].amount_cents).toBe(3300);
    expect(byName["João Pedro Alves"].camarote).toBe(true);
    expect(mp.prefCalls[0].items).toEqual([
      expect.objectContaining({ id: "feminino", quantity: 1, unitPriceCents: 2000 }),
      expect.objectContaining({ id: "camarote", quantity: 2, unitPriceCents: 3000 }),
      expect.objectContaining({ id: "masculino", quantity: 1, unitPriceCents: 3000 }),
      expect.objectContaining({ id: "taxa-servico", quantity: 3, unitPriceCents: 300 }),
    ]);
    await applyPayment(sql(), mp.pay({ id: lead.id, amount_cents: 11900, payment_method: "pix" }, "approved"));
    expect((await getStats(sql())).camarotes).toBe(2);
  });

  it("sem a categoria camarote ativa, o adicional é recusado", async () => {
    await sql()`DELETE FROM ticket_categories WHERE id = 'camarote'`;
    await expectError(createPurchase(deps(mp), request(terms, { camarote: true })), "invalid_category");
    await withCamarote();
    await sql()`UPDATE ticket_categories SET active = false WHERE id = 'camarote'`;
    await expectError(createPurchase(deps(mp), request(terms, { camarote: true })), "invalid_category");
  });

  it("preço do camarote vem do banco, não do navegador", async () => {
    await withCamarote();
    await sql()`UPDATE ticket_categories SET price_cents = 4000 WHERE id = 'camarote'`;
    const lead = await createPurchase(deps(mp), request(terms, { camarote: true, ...({ camarotePriceCents: 1 } as object) }));
    expect(lead.amount_cents).toBe(2000 + 4000 + 300);
  });
});

describe("camarote adicionado pelo painel", () => {
  it("adiciona ao ingresso confirmado sem mexer no valor cobrado e desfaz", async () => {
    const lead = await createPurchase(deps(mp), request(terms));
    await expectError(addCamarote(sql(), lead.id, 3000), "not_applicable"); // ainda pendente
    await applyPayment(sql(), mp.pay({ id: lead.id, amount_cents: 2300, payment_method: "pix" }, "approved"));

    const t = await addCamarote(sql(), lead.id, 3000);
    expect(t.camarote).toBe(true);
    expect(t.category_label).toBe("Feminino + Camarote");
    expect(t.amount_cents).toBe(2300);
    expect(t.camarote_extra_cents).toBe(3000);
    expect((await officialList(sql()))[0].category_label).toBe("Feminino + Camarote");
    const stats = await getStats(sql());
    expect(stats.camarotes).toBe(1);
    expect(stats.camaroteExtraCents).toBe(3000);
    expect(stats.grossRevenueCents).toBe(2300);

    await expectError(addCamarote(sql(), lead.id, 3000), "not_applicable"); // já tem
    // estorno do Mercado Pago continua valendo (valor cobrado intacto)
    const pay = [...mp.payments.values()][0];
    await refundPurchasePayment(sql(), mp, lead.id, String(pay.id));
    expect((await getPurchase(sql(), lead.id))!.status).toBe("refunded");

    const second = await createManualTickets(sql(), { names: ["Segunda Pessoa Teste"], categoryId: "masculino", priceCents: null, phone: null, note: null });
    await addCamarote(sql(), second[0].id, 2500);
    const back = await removeCamarote(sql(), second[0].id);
    expect(back.camarote).toBe(false);
    expect(back.category_label).toBe("Masculino");
    expect(back.camarote_extra_cents).toBeNull();
    await expectError(removeCamarote(sql(), second[0].id), "not_applicable");
  });

  it("sem valor informado usa o preço da categoria camarote; sem categoria exige valor", async () => {
    const [m] = await createManualTickets(sql(), { names: ["Terceira Pessoa Teste"], categoryId: "feminino", priceCents: null, phone: null, note: null });
    await sql()`DELETE FROM ticket_categories WHERE id = 'camarote'`;
    await expectError(addCamarote(sql(), m.id, null), "no_camarote_price");
    await sql()`INSERT INTO ticket_categories (id, label, price_cents, active, sort_order) VALUES ('camarote', 'Camarote', 3000, false, 3)`;
    expect((await addCamarote(sql(), m.id, null)).camarote_extra_cents).toBe(3000);
    await sql()`DELETE FROM ticket_categories WHERE id = 'camarote'`;
  });

  it("ingresso comprado já com camarote não aceita o adicional nem a remoção", async () => {
    await sql()`INSERT INTO ticket_categories (id, label, price_cents, active, sort_order) VALUES ('camarote', 'Camarote', 3000, true, 3) ON CONFLICT (id) DO UPDATE SET active = true`;
    const lead = await createPurchase(deps(mp), request(terms, { camarote: true }));
    await applyPayment(sql(), mp.pay({ id: lead.id, amount_cents: 5300, payment_method: "pix" }, "approved"));
    await expectError(addCamarote(sql(), lead.id, 3000), "not_applicable");
    await expectError(removeCamarote(sql(), lead.id), "not_applicable");
    await sql()`DELETE FROM ticket_categories WHERE id = 'camarote'`;
  });
});

describe("seção Atlética (diretoria)", () => {
  it("manual com athletic e marcação em ingresso existente; lista separa as seções", async () => {
    const [dir] = await createManualTickets(sql(), { names: ["Diretor Presidente Silva"], categoryId: "masculino", priceCents: 0, phone: null, note: "Diretoria", athletic: true });
    expect(dir.athletic).toBe(true);
    const lead = await createPurchase(deps(mp), request(terms, { fullName: "Aluna Comum Teste" }));
    await applyPayment(sql(), mp.pay({ id: lead.id, amount_cents: 2300, payment_method: "pix" }, "approved"));
    const other = await createPurchase(deps(mp), request(terms, { fullName: "Diretora Tesoureira Lima" }));
    await expectError(setAthletic(sql(), other.id, true), "not_applicable"); // pendente
    await applyPayment(sql(), mp.pay({ id: other.id, amount_cents: 2300, payment_method: "pix" }, "approved"));
    await setAthletic(sql(), other.id, true);

    const list = await officialList(sql());
    // Geral primeiro, Atlética depois (a ordem alfabética dentro da seção depende da collation do banco).
    expect(list.map((r) => r.athletic)).toEqual([false, true, true]);
    expect(list[0].full_name).toBe("Aluna Comum Teste");
    expect(list.slice(1).map((r) => r.full_name).sort()).toEqual(["Diretor Presidente Silva", "Diretora Tesoureira Lima"]);
    expect((await getStats(sql())).athletic).toBe(2);
    await setAthletic(sql(), other.id, false);
    expect((await getStats(sql())).athletic).toBe(1);
  });
});

describe("cadastro da diretoria da Atlética", () => {
  it("cria ingressos de cortesia na seção Atlética sem escolher categoria", async () => {
    const rows = await createAthleticTickets(sql(), ["Fulano de Tal Silva", "Beltrana Souza Lima"]);
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ status: "confirmed", athletic: true, source: "manual", amount_cents: 0, category_label: "Atlética" });
    }
    const list = await officialList(sql());
    expect(list.every((r) => r.athletic)).toBe(true);
    expect(list.map((r) => r.category_label)).toEqual(["Atlética", "Atlética"]);
    const stats = await getStats(sql());
    expect(stats.athletic).toBe(2);
    expect(stats.grossRevenueCents).toBe(0);
  });

  it("respeita a lotação e valida os nomes", async () => {
    await resetDb({ capacity: 1 });
    await expectError(createAthleticTickets(sql(), ["Fulano de Tal Silva", "Beltrana Souza Lima"]), "not_enough");
    await expectError(createAthleticTickets(sql(), ["Fulano"]), "invalid_name");
    expect((await createAthleticTickets(sql(), ["Fulano de Tal Silva"])).length).toBe(1);
  });
});
