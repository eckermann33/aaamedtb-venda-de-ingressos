import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { purchaseRequestSchema } from "@/lib/validation";
import {
  applyPayment,
  createPurchase,
  getPurchase,
  publicState,
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

describe("preços e categorias", () => {
  it("1. ingresso feminino: R$ 20,00 + taxa de R$ 3,00", async () => {
    const p = await createPurchase(deps(mp), request(terms, { categoryId: "feminino" }));
    expect(p.ticket_price_cents).toBe(2000);
    expect(p.fee_cents).toBe(300);
    expect(p.amount_cents).toBe(2300);
    expect(mp.pixCalls[0].amountCents).toBe(2300);
    expect(p.status).toBe("pending");
  });

  it("2. ingresso masculino: R$ 30,00 + taxa de R$ 3,00", async () => {
    const p = await createPurchase(deps(mp), request(terms, { categoryId: "masculino", paymentMethod: "card" }));
    expect(p.amount_cents).toBe(3300);
    expect(mp.prefCalls[0].ticketPriceCents).toBe(3000);
    expect(mp.prefCalls[0].feeCents).toBe(300);
    expect(p.checkout_url).toContain("https://mp.example/checkout/");
  });

  it("3. usa o preço atual do banco (alteração administrativa vale para novas compras)", async () => {
    await sql()`UPDATE ticket_categories SET price_cents = 3000 WHERE id = 'feminino'`;
    await sql()`UPDATE settings SET service_fee_cents = 0`;
    const p = await createPurchase(deps(mp), request(terms));
    expect(p.amount_cents).toBe(3000);
    expect(p.fee_cents).toBe(0);
  });

  it("13. ignora qualquer preço enviado pelo navegador", async () => {
    const tampered = purchaseRequestSchema.parse({
      ...request(terms),
      amountCents: 1,
      priceCents: 1,
      price: 0.01,
      feeCents: 0,
    });
    expect(tampered).not.toHaveProperty("amountCents");
    const p = await createPurchase(deps(mp), tampered);
    expect(p.amount_cents).toBe(2300);
    expect(mp.pixCalls[0].amountCents).toBe(2300);
  });

  it("rejeita categoria inexistente ou inativa", async () => {
    await expectError(createPurchase(deps(mp), request(terms, { categoryId: "vip" })), "invalid_category");
    await sql()`UPDATE ticket_categories SET active = false WHERE id = 'masculino'`;
    await expectError(createPurchase(deps(mp), request(terms, { categoryId: "masculino" })), "invalid_category");
  });
});

describe("validação do formulário (backend)", () => {
  it("4. nome vazio, só espaços ou sem sobrenome é recusado", async () => {
    await expectError(createPurchase(deps(mp), request(terms, { fullName: "" })), "invalid_name");
    await expectError(createPurchase(deps(mp), request(terms, { fullName: "      " })), "invalid_name");
    await expectError(createPurchase(deps(mp), request(terms, { fullName: "Maria" })), "invalid_name");
    await expectError(createPurchase(deps(mp), request(terms, { fullName: "<script>x</script> a" })), "invalid_name");
    const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM purchases`;
    expect(n).toBe(0);
  });

  it("exige celular/WhatsApp válido e guarda só os dígitos", async () => {
    await expectError(createPurchase(deps(mp), request(terms, { buyerPhone: "" })), "invalid_phone");
    await expectError(createPurchase(deps(mp), request(terms, { buyerPhone: "429l1374203" })), "invalid_phone");
    const p = await createPurchase(deps(mp), request(terms, { buyerPhone: "(42) 99137-4203" }));
    expect(p.buyer_phone).toBe("42991374203");
  });

  it("anonimização apaga nome e telefone", async () => {
    const { anonymizePurchase } = await import("@/server/purchases");
    const p = await createPurchase(deps(mp), request(terms));
    await anonymizePurchase(sql(), p.id);
    const after = (await getPurchase(sql(), p.id))!;
    expect(after.buyer_phone).toBeNull();
    expect(after.full_name).toBe("Titular removido");
  });

  it("normaliza espaços extras no nome", async () => {
    const p = await createPurchase(deps(mp), request(terms, { fullName: "  João   da  Silva  " }));
    expect(p.full_name).toBe("João da Silva");
  });

  it("5. bloqueia quem não confirma maioridade ou não aceita os termos", () => {
    expect(purchaseRequestSchema.safeParse({ ...request(terms), adultConfirmed: false }).success).toBe(false);
    expect(purchaseRequestSchema.safeParse({ ...request(terms), adultConfirmed: undefined }).success).toBe(false);
    expect(purchaseRequestSchema.safeParse({ ...request(terms), termsAccepted: false }).success).toBe(false);
  });

  it("Pix exige e-mail (pedido pelo Mercado Pago), mas ele não é salvo no banco", async () => {
    await expectError(createPurchase(deps(mp), request(terms, { payerEmail: undefined })), "email_required");
    const p = await createPurchase(deps(mp), request(terms));
    const [row] = await sql()`SELECT row_to_json(purchases)::text AS j FROM purchases WHERE id = ${p.id}`;
    expect(row.j).not.toContain("maria@example.com");
  });

  it("registra versão e data/hora do aceite dos termos", async () => {
    const p = await createPurchase(deps(mp), request(terms));
    expect(p.terms_version_id).toBe(terms);
    expect(p.terms_accepted_at).toBeInstanceOf(Date);
  });

  it("recusa aceite de uma versão antiga dos termos", async () => {
    await expectError(createPurchase(deps(mp), request(terms, { termsVersionId: terms + 999 })), "terms_changed");
  });
});

describe("controle de vendas", () => {
  it("18. vendas fechadas impedem novas compras", async () => {
    await resetDb({ salesOpen: false });
    await expectError(createPurchase(deps(mp), request(terms)), "sales_closed");
  });

  it("não vende se informação obrigatória estiver pendente", async () => {
    await sql()`UPDATE settings SET event = event || '{"venueName": null}'::jsonb`;
    await expectError(createPurchase(deps(mp), request(terms)), "not_ready");
  });

  it("19. respeita a lotação mesmo com compras simultâneas", async () => {
    await resetDb({ capacity: 3 });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => createPurchase(deps(mp), request(terms, { fullName: `Pessoa Teste ${"abcdefghij"[i]}` }))),
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const soldOut = results.filter((r) => r.status === "rejected" && (r.reason as PurchaseError).code === "sold_out");
    expect(ok).toHaveLength(3);
    expect(soldOut).toHaveLength(7);
  });

  it("reserva expirada libera a vaga", async () => {
    await resetDb({ capacity: 1 });
    const p = await createPurchase(deps(mp), request(terms));
    await expectError(createPurchase(deps(mp), request(terms)), "sold_out");
    await sql()`UPDATE purchases SET expires_at = now() - interval '1 minute' WHERE id = ${p.id}`;
    const second = await createPurchase(deps(mp), request(terms));
    expect(second.status).toBe("pending");
  });

  it("cliques repetidos (mesma chave) criam uma única compra e um único pagamento", async () => {
    const req = request(terms);
    const results = await Promise.all([1, 2, 3, 4].map(() => createPurchase(deps(mp), req).catch((e) => e)));
    const ids = new Set(results.filter((r) => !(r instanceof Error)).map((r) => r.id));
    expect(ids.size).toBe(1);
    const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM purchases`;
    expect(n).toBe(1);
    expect(mp.pixCalls).toHaveLength(1);
  });

  it("falha no Mercado Pago: compra marcada como falha, sem reserva presa", async () => {
    await resetDb({ capacity: 1 });
    mp.fail = true;
    await expectError(createPurchase(deps(mp), request(terms)), "payment_unavailable");
    mp.fail = false;
    const p = await createPurchase(deps(mp), request(terms));
    expect(p.status).toBe("pending");
  });
});

describe("pagamentos e webhooks", () => {
  it("8. Pix aprovado confirma a compra e gera código interno", async () => {
    const p = await createPurchase(deps(mp), request(terms));
    const result = await applyPayment(sql(), mp.set(p.mp_payment_id!, "approved"));
    expect(result).toBe("confirmed");
    const after = (await getPurchase(sql(), p.id))!;
    expect(after.status).toBe("confirmed");
    expect(after.ticket_code).toMatch(/^INV-[0-9A-Z]{10}$/);
    expect(after.confirmed_at).toBeInstanceOf(Date);
    expect(toPublic(after).state).toBe("approved");
    expect((await officialList(sql())).map((r) => r.full_name)).toEqual(["Maria Eduarda Souza"]);
  });

  it("11. webhook repetido não duplica confirmação nem ingresso", async () => {
    const p = await createPurchase(deps(mp), request(terms));
    const approved = mp.set(p.mp_payment_id!, "approved");
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => applyPayment(sql(), approved)));
    expect(results.filter((r) => r === "confirmed")).toHaveLength(1);
    expect(results.filter((r) => r === "already_confirmed")).toHaveLength(4);
    const first = (await getPurchase(sql(), p.id))!;
    await applyPayment(sql(), approved);
    const again = (await getPurchase(sql(), p.id))!;
    expect(again.ticket_code).toBe(first.ticket_code);
    expect(await officialList(sql())).toHaveLength(1);
    const [{ n }] = await sql()<{ n: number }[]>`SELECT count(*)::int AS n FROM payments`;
    expect(n).toBe(1);
  });

  it("9. pagamento pendente não entra na lista nem na receita", async () => {
    const p = await createPurchase(deps(mp), request(terms));
    await applyPayment(sql(), mp.set(p.mp_payment_id!, "in_process"));
    expect((await getPurchase(sql(), p.id))!.status).toBe("pending");
    expect(await officialList(sql())).toHaveLength(0);
    const stats = await getStats(sql());
    expect(stats.grossRevenueCents).toBe(0);
    expect(stats.pendingActive).toBe(1);
  });

  it("10. pagamento recusado (Pix) marca a compra como recusada", async () => {
    const p = await createPurchase(deps(mp), request(terms));
    await applyPayment(sql(), mp.set(p.mp_payment_id!, "rejected"));
    const after = (await getPurchase(sql(), p.id))!;
    expect(after.status).toBe("rejected");
    expect(publicState(after)).toBe("rejected");
  });

  it("Pix expirado (cancelado pelo MP) aparece como expirado", async () => {
    const p = await createPurchase(deps(mp), request(terms));
    await applyPayment(sql(), mp.set(p.mp_payment_id!, "cancelled", { status_detail: "expired" }));
    expect((await getPurchase(sql(), p.id))!.status).toBe("expired");
  });

  it("cartão recusado permite tentar de novo; aprovado depois confirma", async () => {
    const p = await createPurchase(deps(mp), request(terms, { paymentMethod: "card", payerEmail: undefined }));
    await applyPayment(sql(), mp.cardPayment(p.id, 2300, "rejected"));
    let after = (await getPurchase(sql(), p.id))!;
    expect(after.status).toBe("pending");
    expect(publicState(after)).toBe("payment_rejected");
    await applyPayment(sql(), mp.cardPayment(p.id, 2300, "approved"));
    after = (await getPurchase(sql(), p.id))!;
    expect(after.status).toBe("confirmed");
  });

  it("valor divergente NÃO confirma e sinaliza para a organização", async () => {
    const p = await createPurchase(deps(mp), request(terms, { paymentMethod: "card", payerEmail: undefined }));
    const result = await applyPayment(sql(), mp.cardPayment(p.id, 100, "approved"));
    expect(result).toBe("invalid_payment");
    const after = (await getPurchase(sql(), p.id))!;
    expect(after.status).toBe("pending");
    expect(after.attention).toBe("amount_mismatch");
    expect(await officialList(sql())).toHaveLength(0);
  });

  it("referência desconhecida é ignorada", async () => {
    expect(
      await applyPayment(sql(), { id: 1, status: "approved", external_reference: "x", transaction_amount: 23 }),
    ).toBe("unknown_reference");
  });

  it("segundo pagamento aprovado na mesma compra é sinalizado como duplicado", async () => {
    const p = await createPurchase(deps(mp), request(terms, { paymentMethod: "card", payerEmail: undefined }));
    await applyPayment(sql(), mp.cardPayment(p.id, 2300, "approved"));
    const dup = mp.cardPayment(p.id, 2300, "approved");
    expect(await applyPayment(sql(), dup)).toBe("duplicate_payment");
    expect((await getPurchase(sql(), p.id))!.attention).toBe("duplicate_payment");
    expect(await officialList(sql())).toHaveLength(1);
    // Estornar o excedente limpa o alerta e mantém o ingresso.
    await refundPurchasePayment(sql(), mp, p.id, String(dup.id));
    const after = (await getPurchase(sql(), p.id))!;
    expect(after.attention).toBeNull();
    expect(after.status).toBe("confirmed");
  });

  it("estorno remove da lista oficial e é identificável", async () => {
    const p = await createPurchase(deps(mp), request(terms));
    await applyPayment(sql(), mp.set(p.mp_payment_id!, "approved"));
    await refundPurchasePayment(sql(), mp, p.id, p.mp_payment_id!);
    const after = (await getPurchase(sql(), p.id))!;
    expect(after.status).toBe("refunded");
    expect(after.refunded_at).toBeInstanceOf(Date);
    expect(await officialList(sql())).toHaveLength(0);
    const stats = await getStats(sql());
    expect(stats.refunded).toBe(1);
    expect(stats.grossRevenueCents).toBe(0);
  });

  it("chargeback também remove da lista", async () => {
    const p = await createPurchase(deps(mp), request(terms));
    await applyPayment(sql(), mp.set(p.mp_payment_id!, "approved"));
    await applyPayment(sql(), mp.set(p.mp_payment_id!, "charged_back"));
    expect((await getPurchase(sql(), p.id))!.status).toBe("refunded");
  });

  it("aprovação tardia acima da lotação não entra na lista (exige estorno)", async () => {
    await resetDb({ capacity: 1 });
    const a = await createPurchase(deps(mp), request(terms, { fullName: "Pessoa Um Teste" }));
    await sql()`UPDATE purchases SET expires_at = now() - interval '1 minute' WHERE id = ${a.id}`;
    const b = await createPurchase(deps(mp), request(terms, { fullName: "Pessoa Dois Teste" }));
    await applyPayment(sql(), mp.set(b.mp_payment_id!, "approved"));
    // O pagamento de A chega depois que a vaga foi para B.
    expect(await applyPayment(sql(), mp.set(a.mp_payment_id!, "approved"))).toBe("over_capacity");
    const after = (await getPurchase(sql(), a.id))!;
    expect(after.status).not.toBe("confirmed");
    expect(after.attention).toBe("over_capacity");
    expect(publicState(after)).toBe("attention");
    expect(await officialList(sql())).toHaveLength(1);
  });
});

describe("12. comprador fecha o navegador / webhook não chega", () => {
  it("conciliação confirma Pix consultando o Mercado Pago", async () => {
    const p = await createPurchase(deps(mp), request(terms));
    mp.set(p.mp_payment_id!, "approved"); // pago, mas nenhum webhook processado
    await reconcilePurchase(sql(), mp, p.id, { minIntervalSeconds: 0 });
    expect((await getPurchase(sql(), p.id))!.status).toBe("confirmed");
  });

  it("conciliação de cartão busca pagamentos pela referência externa", async () => {
    const p = await createPurchase(deps(mp), request(terms, { paymentMethod: "card", payerEmail: undefined }));
    mp.cardPayment(p.id, 2300, "rejected");
    mp.cardPayment(p.id, 2300, "approved");
    await reconcilePurchase(sql(), mp, p.id, { minIntervalSeconds: 0 });
    expect((await getPurchase(sql(), p.id))!.status).toBe("confirmed");
  });

  it("reserva vencida e não paga vira expirada", async () => {
    const p = await createPurchase(deps(mp), request(terms));
    await sql()`UPDATE purchases SET expires_at = now() - interval '1 minute' WHERE id = ${p.id}`;
    await reconcilePurchase(sql(), mp, p.id, { minIntervalSeconds: 0 });
    expect((await getPurchase(sql(), p.id))!.status).toBe("expired");
  });

  it("dica de payment_id na URL de retorno só vale se pertencer à compra", async () => {
    const p = await createPurchase(deps(mp), request(terms, { paymentMethod: "card", payerEmail: undefined }));
    const other = await createPurchase(deps(mp), request(terms, { paymentMethod: "card", payerEmail: undefined }));
    const otherPayment = mp.cardPayment(other.id, 2300, "approved");
    // Remove da busca para forçar o uso da dica.
    mp.searchPaymentsByReference = async () => [];
    await reconcilePurchase(sql(), mp, p.id, { minIntervalSeconds: 0, hintPaymentId: String(otherPayment.id) });
    expect((await getPurchase(sql(), p.id))!.status).toBe("pending");
    expect((await getPurchase(sql(), other.id))!.status).toBe("pending");
  });
});

describe("transferência de ingresso", () => {
  it("troca o nome na lista mantendo o código interno", async () => {
    const { transferPurchase } = await import("@/server/purchases");
    const p = await createPurchase(deps(mp), request(terms));
    await applyPayment(sql(), mp.set(p.mp_payment_id!, "approved"));
    const before = (await getPurchase(sql(), p.id))!;
    const after = await transferPurchase(sql(), p.id, "  Joana   Prado Lima ");
    expect(after.full_name).toBe("Joana Prado Lima");
    expect(after.ticket_code).toBe(before.ticket_code);
    expect((await officialList(sql())).map((r) => r.full_name)).toEqual(["Joana Prado Lima"]);
  });

  it("não transfere compra pendente nem aceita nome inválido", async () => {
    const { transferPurchase } = await import("@/server/purchases");
    const p = await createPurchase(deps(mp), request(terms));
    await expectError(transferPurchase(sql(), p.id, "Outra Pessoa Silva"), "not_transferable");
    await applyPayment(sql(), mp.set(p.mp_payment_id!, "approved"));
    await expectError(transferPurchase(sql(), p.id, "   "), "invalid_name");
  });
});

describe("pendências antes de abrir as vendas", () => {
  it("contato pode ser telefone OU e-mail; endereço é opcional", async () => {
    const { loadSettings, readiness } = await import("@/server/settings");
    const env = { mpAccessToken: true, mpWebhookSecret: true };
    await sql()`UPDATE settings SET event = event || '{"contactEmail": null, "contactPhone": null, "venueAddress": null}'::jsonb`;
    let items = readiness(await loadSettings(sql()), env);
    expect(items.find((i) => i.key === "contactPhone")?.blocking).toBe(true);
    expect(items.find((i) => i.key === "venueAddress")?.blocking).toBe(false);
    await sql()`UPDATE settings SET event = event || '{"contactPhone": "42999998888"}'::jsonb`;
    items = readiness(await loadSettings(sql()), env);
    expect(items.some((i) => i.blocking)).toBe(false);
  });
});
