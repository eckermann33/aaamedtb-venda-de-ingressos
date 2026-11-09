import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { lookupTicket } from "@/server/checkin";
import {
  applyPayment,
  cancelManualTicket,
  createManualTickets,
  createPurchase,
  getOrderTickets,
  getPurchase,
  PurchaseError,
  refundPurchasePayment,
  removeTicket,
  restoreTicket,
} from "@/server/purchases";
import { getStats, officialList } from "@/server/reports";
import { deps, FakeMp, request, resetDb, sql } from "./helpers";

let terms: number;
let mp: FakeMp;

beforeEach(async () => {
  terms = await resetDb({ capacity: 3 });
  mp = new FakeMp();
});

afterAll(async () => {
  await sql().end();
});

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof PurchaseError && e.code === code);
}

async function paidOrder(extra: string[] = []) {
  const lead = await createPurchase(
    deps(mp),
    request(terms, { extraTickets: extra.map((fullName) => ({ fullName, categoryId: "feminino" })) }),
  );
  const pay = mp.pay({ id: lead.id, amount_cents: 2300 * (extra.length + 1), payment_method: "pix" }, "approved");
  await applyPayment(sql(), pay);
  return { tickets: await getOrderTickets(sql(), lead.id), pay };
}

describe("remover ingresso da lista", () => {
  it("tira da lista, libera a vaga, invalida o QR e guarda o motivo", async () => {
    const { tickets } = await paidOrder();
    const t = tickets[0];
    const removed = await removeTicket(sql(), t.id, "Comprou duas vezes, devolvemos por Pix");
    expect(removed).toMatchObject({ status: "cancelled", removed_reason: "Comprou duas vezes, devolvemos por Pix" });
    expect(removed.removed_at).toBeInstanceOf(Date);
    expect(await officialList(sql())).toHaveLength(0);
    expect((await getStats(sql())).confirmed).toBe(0);
    expect((await lookupTicket(sql(), t.entry_code!)).result).toBe("invalid");
    // A vaga voltou: cabem 3 de novo.
    await paidOrder(["Pessoa Dois Teste", "Pessoa Tres Teste"]);
  });

  it("aviso repetido do Mercado Pago não devolve o ingresso removido à lista", async () => {
    const { tickets, pay } = await paidOrder(["Ana Clara Lima"]);
    const lead = tickets.find((t) => t.lead_id === null)!;
    await removeTicket(sql(), lead.id, "Removido para teste");
    expect(await applyPayment(sql(), mp.set(pay.id, "approved"))).toBe("already_confirmed");
    expect((await getPurchase(sql(), lead.id))!.status).toBe("cancelled");
    // O outro ingresso do pedido continua valendo.
    const other = tickets.find((t) => t.lead_id !== null)!;
    expect((await getPurchase(sql(), other.id))!.status).toBe("confirmed");
    expect(await officialList(sql())).toHaveLength(1);
  });

  it("remove só um ingresso do pedido", async () => {
    const { tickets } = await paidOrder(["Ana Clara Lima", "Bia Souza Rocha"]);
    const sibling = tickets.find((t) => t.lead_id !== null)!;
    await removeTicket(sql(), sibling.id, "Desistiu");
    const after = await getOrderTickets(sql(), tickets[0].id);
    expect(after.filter((t) => t.status === "confirmed")).toHaveLength(2);
  });

  it("exige motivo e só vale para ingresso confirmado", async () => {
    const { tickets } = await paidOrder();
    await expectError(removeTicket(sql(), tickets[0].id, "  "), "invalid_reason");
    const pending = await createPurchase(deps(mp), request(terms, { fullName: "Pessoa Pendente Teste" }));
    await expectError(removeTicket(sql(), pending.id, "Motivo qualquer"), "not_removable");
  });

  it("restaurar devolve à lista; sem vaga, recusa", async () => {
    const { tickets } = await paidOrder();
    await removeTicket(sql(), tickets[0].id, "Engano");
    await paidOrder(["Pessoa Dois Teste", "Pessoa Tres Teste"]); // lotação 3 completa
    await expectError(restoreTicket(sql(), tickets[0].id), "not_enough");
    await sql()`UPDATE settings SET capacity = 4`;
    const back = await restoreTicket(sql(), tickets[0].id);
    expect(back).toMatchObject({ status: "confirmed", removed_at: null, removed_reason: null });
    expect(await officialList(sql())).toHaveLength(4);
    await expectError(restoreTicket(sql(), tickets[0].id), "not_restorable");
  });

  it("estorno depois de remover marca o ingresso como estornado", async () => {
    const { tickets, pay } = await paidOrder();
    await removeTicket(sql(), tickets[0].id, "Vai estornar");
    await refundPurchasePayment(sql(), mp, tickets[0].id, String(pay.id));
    expect((await getPurchase(sql(), tickets[0].id))!.status).toBe("refunded");
    await expectError(restoreTicket(sql(), tickets[0].id), "not_restorable");
  });

  it("ingresso manual removido também pode ser restaurado", async () => {
    const [m] = await createManualTickets(sql(), {
      names: ["Manual Pessoa Teste"],
      categoryId: "feminino",
      priceCents: 0,
      phone: null,
      note: null,
    });
    await cancelManualTicket(sql(), m.id);
    expect((await getPurchase(sql(), m.id))!.removed_at).toBeInstanceOf(Date);
    expect((await restoreTicket(sql(), m.id)).status).toBe("confirmed");
  });
});
