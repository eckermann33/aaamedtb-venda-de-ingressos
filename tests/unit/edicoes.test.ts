import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { checkIn, entryStats, lookupTicket } from "@/server/checkin";
import { archivedEvent, listArchivedEditions, startNewEdition, type NewEditionInput } from "@/server/editions";
import {
  applyPayment,
  createManualTickets,
  createPurchase,
  getOrder,
  getPurchase,
  PurchaseError,
} from "@/server/purchases";
import { allPurchases, getStats, listPurchases, officialList } from "@/server/reports";
import { loadSettings } from "@/server/settings";
import { deps, FakeMp, request, resetDb, sql } from "./helpers";

let terms: number;
let mp: FakeMp;

beforeEach(async () => {
  terms = await resetDb({ capacity: 2 });
  mp = new FakeMp();
});

afterAll(async () => {
  await sql().end();
});

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof PurchaseError && e.code === code);
}

const chopada: NewEditionInput = {
  name: "Chopada Final da Invictus",
  titleTop: "Chopada",
  titleMain: "Final",
  poster: "/images/cartaz-chopada-final.webp",
  tagline: "Open chop",
  date: "2026-11-21",
  startTime: "23:00",
  venueName: "Local Teste",
  venueAddress: null,
  partner: "QG Conveniência",
  about: "Open chop e DJ HS.",
  camarote: "",
  capacity: 2,
  deactivateCategories: false,
};

async function paid(name: string) {
  const p = await createPurchase(deps(mp), request(terms, { fullName: name }));
  await applyPayment(sql(), mp.pay(p, "approved"));
  return (await getPurchase(sql(), p.id))!;
}

async function newEdition(input: NewEditionInput = chopada) {
  await sql()`UPDATE settings SET sales_open = false`;
  const edition = await startNewEdition(sql(), input);
  await sql()`UPDATE settings SET sales_open = true`;
  return edition;
}

describe("nova festa (edições)", () => {
  it("exige as vendas fechadas", async () => {
    await expectError(startNewEdition(sql(), chopada), "sales_open");
    expect((await loadSettings(sql())).edition).toBe(1);
  });

  it("arquiva a festa anterior: lotação, lista e resumo recomeçam do zero, sem apagar nada", async () => {
    const old = await paid("Pessoa Antiga Um");
    await paid("Pessoa Antiga Dois");
    // Lotação 2 esgotada na festa 1.
    await expectError(createPurchase(deps(mp), request(terms, { fullName: "Mais Uma Pessoa" })), "sold_out");

    await sql()`UPDATE settings SET event = event || '{"name": "Party do Saco Cheio"}'::jsonb`;
    const before = await loadSettings(sql());
    expect(await newEdition()).toBe(2);
    const s = await loadSettings(sql());
    expect(s.edition).toBe(2);
    expect(s.event.name).toBe("Chopada Final da Invictus");
    expect(s.event.poster).toBe("/images/cartaz-chopada-final.webp");
    expect(s.event.contactPhone).toBe(before.event.contactPhone); // o resto da configuração é mantido
    expect(s.event.organizer).toBe(before.event.organizer);

    // A nova festa começa vazia e com a lotação livre.
    expect(await officialList(sql())).toHaveLength(0);
    expect((await getStats(sql())).confirmed).toBe(0);
    expect((await listPurchases(sql(), {})).total).toBe(0);
    expect(await allPurchases(sql())).toHaveLength(0);
    const fresh = await createPurchase(deps(mp), request(terms, { fullName: "Pessoa Nova Um" }));
    expect(fresh.edition).toBe(2);

    // A festa anterior continua guardada e exportável.
    expect(await officialList(sql(), 1)).toHaveLength(2);
    expect((await listPurchases(sql(), { edition: 1 })).total).toBe(2);
    expect((await getPurchase(sql(), old.id))!.status).toBe("confirmed");
    expect((await getOrder(sql(), old.id))!.lead.edition).toBe(1);
    const archived = await listArchivedEditions(sql());
    expect(archived).toHaveLength(1);
    expect(archived[0]).toMatchObject({ edition: 1, confirmed: 2 });
    expect((await archivedEvent(sql(), 1))!.name).toBe("Party do Saco Cheio");
  });

  it("ingresso manual e da Atlética entram na festa atual", async () => {
    await newEdition();
    const [m] = await createManualTickets(sql(), {
      names: ["Diretoria Nova Teste"],
      categoryId: "feminino",
      priceCents: 0,
      phone: null,
      note: null,
      athletic: true,
    });
    expect(m.edition).toBe(2);
    expect((await getStats(sql())).athletic).toBe(1);
  });

  it("na portaria, o QR da festa anterior é recusado", async () => {
    const old = await paid("Pessoa Antiga Um");
    await newEdition();
    const r = await lookupTicket(sql(), old.entry_code!);
    expect(r).toMatchObject({ result: "invalid", reason: "Este ingresso é de uma festa anterior." });
    expect((await checkIn(sql(), old.entry_code!, "Segurança")).result).toBe("invalid");
    expect((await getPurchase(sql(), old.id))!.checked_in_at).toBeNull();
    expect(await entryStats(sql())).toEqual({ checkedIn: 0, total: 0 });
  });

  it("alertas de festas anteriores continuam aparecendo (ex.: estorno pendente)", async () => {
    const old = await paid("Pessoa Antiga Um");
    await sql()`UPDATE purchases SET attention = 'duplicate_payment' WHERE id = ${old.id}`;
    await newEdition();
    expect((await getStats(sql())).attention).toBe(1);
    expect((await listPurchases(sql(), { status: "attention" })).total).toBe(1);
  });

  it("sem horário e local, a nova festa não abre vendas (campos pendentes)", async () => {
    await newEdition({ ...chopada, startTime: null, venueName: null });
    await expectError(createPurchase(deps(mp), request(terms)), "not_ready");
  });

  it("pode desativar as categorias até definir os preços", async () => {
    await newEdition({ ...chopada, deactivateCategories: true });
    const s = await loadSettings(sql());
    expect(s.categories.every((c) => !c.active)).toBe(true);
    await sql()`UPDATE settings SET sales_open = true`;
    await expectError(createPurchase(deps(mp), request(terms)), "not_ready");
  });
});
