import jsQR from "jsqr";
import QRCode from "qrcode";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { formatEntryCode, normalizeEntryCode, qrPayload } from "@/lib/entry-code";
import { createDoorSession, doorFromToken, verifyDoorCode } from "@/server/auth";
import { checkIn, entryStats, lookupTicket, setEntryMode, undoCheckIn } from "@/server/checkin";
import {
  applyPayment,
  createManualTickets,
  createPurchase,
  getOrderTickets,
  getPurchase,
  PurchaseError,
  refundPurchasePayment,
  toPublic,
  transferPurchase,
} from "@/server/purchases";
import { getEntryMode } from "@/server/settings";
import { deps, FakeMp, request, resetDb, sql } from "./helpers";

let terms: number;
let mp: FakeMp;

beforeEach(async () => {
  terms = await resetDb();
  mp = new FakeMp();
  await sql()`UPDATE settings SET entry_mode = 'list', door_code_hash = NULL`;
  await sql()`DELETE FROM door_sessions`;
});

afterAll(async () => {
  await sql().end();
});

async function expectError(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof PurchaseError && e.code === code);
}

async function paidOrder(extra = 0) {
  const extras = Array.from({ length: extra }, (_, i) => ({
    fullName: `Pessoa Extra ${"abcdef"[i]}`,
    categoryId: "feminino",
  }));
  const lead = await createPurchase(deps(mp), request(terms, { extraTickets: extras }));
  await applyPayment(
    sql(),
    mp.pay({ id: lead.id, amount_cents: 2300 * (extra + 1), payment_method: "pix" }, "approved"),
  );
  return getOrderTickets(sql(), lead.id);
}

describe("código de entrada", () => {
  it("normaliza o conteúdo do QR e códigos digitados", () => {
    expect(normalizeEntryCode("INV1:K7M2Q9XA4C0B")).toBe("K7M2Q9XA4C0B");
    expect(normalizeEntryCode(" k7m2-q9xa-4c0b ")).toBe("K7M2Q9XA4C0B");
    expect(normalizeEntryCode("K7M2 Q9XA 4COB")).toBe("K7M2Q9XA4C0B"); // O digitado no lugar de 0
    expect(normalizeEntryCode("ABCDEFGHJKMI")).toBe("ABCDEFGHJKM1"); // I vira 1
    expect(normalizeEntryCode("K7M2Q9XA4C0")).toBeNull(); // curto
    expect(normalizeEntryCode("https://exemplo.com/qualquer")).toBeNull();
    expect(normalizeEntryCode(42)).toBeNull();
    expect(formatEntryCode("K7M2Q9XA4C0B")).toBe("K7M2-Q9XA-4C0B");
  });

  it("o QR gerado é lido de volta pelo leitor (qrcode → jsQR)", () => {
    const code = "K7M2Q9XA4C0B";
    const qr = QRCode.create(qrPayload(code), { errorCorrectionLevel: "M" });
    const size = qr.modules.size;
    const scale = 6;
    const border = 4;
    const px = (size + border * 2) * scale;
    const data = new Uint8ClampedArray(px * px * 4).fill(255);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!qr.modules.get(x, y)) continue;
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            const i = (((y + border) * scale + dy) * px + (x + border) * scale + dx) * 4;
            data[i] = data[i + 1] = data[i + 2] = 0;
          }
        }
      }
    }
    const read = jsQR(data, px, px);
    expect(read?.data).toBe("INV1:K7M2Q9XA4C0B");
    expect(normalizeEntryCode(read!.data)).toBe(code);
  });

  it("cada ingresso confirmado ganha um código próprio (pedido de vários e manual)", async () => {
    const tickets = await paidOrder(2);
    const codes = tickets.map((t) => t.entry_code);
    expect(codes.every((c) => c && /^[0-9A-HJKMNP-TV-Z]{12}$/.test(c))).toBe(true);
    expect(new Set(codes).size).toBe(3);
    const [m] = await createManualTickets(sql(), {
      names: ["Manual Pessoa Teste"],
      categoryId: "feminino",
      priceCents: 0,
      phone: null,
      note: null,
    });
    expect(m.entry_code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
  });

  it("pendente não tem código; a página pública só mostra os códigos no modo QR Code", async () => {
    const pending = await createPurchase(deps(mp), request(terms));
    expect(pending.entry_code).toBeNull();
    const tickets = await paidOrder(1);
    expect(toPublic(tickets[0], tickets).tickets.every((t) => t.entryCode === null)).toBe(true);
    const shown = toPublic(tickets[0], tickets, { showEntry: true }).tickets.map((t) => t.entryCode);
    expect(shown).toEqual(tickets.map((t) => t.entry_code));
  });
});

describe("leitura na portaria", () => {
  it("confirma uma vez; a segunda leitura avisa que já entrou", async () => {
    const [t] = await paidOrder();
    const code = t.entry_code!;
    expect((await lookupTicket(sql(), qrPayload(code))).result).toBe("valid");
    const first = await checkIn(sql(), qrPayload(code), "Segurança 1");
    expect(first).toMatchObject({
      result: "checked_in",
      ticket: { fullName: "Maria Eduarda Souza", checkedInBy: "Segurança 1" },
    });
    const again = await checkIn(sql(), formatEntryCode(code).toLowerCase(), "Segurança 2");
    expect(again).toMatchObject({ result: "already", ticket: { checkedInBy: "Segurança 1" } });
    expect((await lookupTicket(sql(), code)).result).toBe("already");
    expect(await entryStats(sql())).toEqual({ checkedIn: 1, total: 1 });
  });

  it("dois leitores ao mesmo tempo: só um registra a entrada", async () => {
    const [t] = await paidOrder();
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => checkIn(sql(), t.entry_code!, `Leitor ${i}`)));
    expect(results.filter((r) => r.result === "checked_in")).toHaveLength(1);
    expect(results.filter((r) => r.result === "already")).toHaveLength(4);
  });

  it("ingresso estornado, código inexistente e QR de outra coisa são recusados", async () => {
    const [t] = await paidOrder();
    const pay = [...mp.payments.values()][0];
    await refundPurchasePayment(sql(), mp, t.id, String(pay.id));
    const refunded = await checkIn(sql(), t.entry_code!, "Segurança");
    expect(refunded).toMatchObject({ result: "invalid" });
    expect((await getPurchase(sql(), t.id))!.checked_in_at).toBeNull();
    expect((await checkIn(sql(), "AAAAAAAAAAAA", "Segurança")).result).toBe("not_found");
    expect((await lookupTicket(sql(), "https://instagram.com/invictus")).result).toBe("not_found");
  });

  it("transferência troca o QR: o antigo deixa de valer", async () => {
    const [t] = await paidOrder();
    const old = t.entry_code!;
    const moved = await transferPurchase(sql(), t.id, "Nova Pessoa Dona");
    expect(moved.entry_code).not.toBe(old);
    expect((await lookupTicket(sql(), old)).result).toBe("not_found");
    expect(await lookupTicket(sql(), moved.entry_code!)).toMatchObject({
      result: "valid",
      ticket: { fullName: "Nova Pessoa Dona" },
    });
  });

  it("o painel desfaz uma entrada confirmada por engano", async () => {
    const [t] = await paidOrder();
    await checkIn(sql(), t.entry_code!, "Segurança");
    await undoCheckIn(sql(), t.id);
    expect((await lookupTicket(sql(), t.entry_code!)).result).toBe("valid");
    await expectError(undoCheckIn(sql(), t.id), "not_applicable");
  });

  it("a portaria vê camarote e Atlética, e não vê telefone nem valores", async () => {
    const [m] = await createManualTickets(sql(), {
      names: ["Diretora Atletica Teste"],
      categoryId: "feminino",
      priceCents: 0,
      phone: "42999990000",
      note: null,
      athletic: true,
    });
    const r = await lookupTicket(sql(), m.entry_code!);
    expect(r).toMatchObject({ result: "valid", ticket: { athletic: true, camarote: false } });
    expect(JSON.stringify(r)).not.toContain("42999990000");
    expect(Object.keys((r as { ticket: object }).ticket).sort()).toEqual(
      ["athletic", "camarote", "categoryLabel", "checkedInAt", "checkedInBy", "fullName"].sort(),
    );
  });
});

describe("interruptor e código da portaria", () => {
  it("ativar o QR Code exige código; o código é guardado só como hash", async () => {
    await expectError(setEntryMode(sql(), { mode: "qrcode" }), "door_code_required");
    await expectError(setEntryMode(sql(), { mode: "qrcode", doorCode: "123" }), "invalid_door_code");
    await setEntryMode(sql(), { mode: "qrcode", doorCode: "K7M2-Q9XA" });
    expect(await getEntryMode(sql())).toBe("qrcode");
    const [row] = await sql()<{ door_code_hash: string }[]>`SELECT door_code_hash FROM settings`;
    expect(row.door_code_hash).toMatch(/^scrypt\$/);
    expect(row.door_code_hash).not.toContain("K7M2");
    expect(await verifyDoorCode(sql(), "K7M2-Q9XA")).toBe(true);
    expect(await verifyDoorCode(sql(), "errado123")).toBe(false);
    // Volta para a lista e depois para o QR sem informar código: mantém o anterior.
    await setEntryMode(sql(), { mode: "list" });
    await setEntryMode(sql(), { mode: "qrcode" });
    expect(await verifyDoorCode(sql(), "K7M2-Q9XA")).toBe(true);
  });

  it("trocar o código ou voltar para a lista desconecta os leitores abertos", async () => {
    await setEntryMode(sql(), { mode: "qrcode", doorCode: "primeiro1" });
    const s1 = await createDoorSession(sql(), "Segurança 1");
    expect(await doorFromToken(sql(), s1.token)).toEqual({ label: "Segurança 1", adminId: null });
    await setEntryMode(sql(), { mode: "qrcode", doorCode: "segundo2" });
    expect(await doorFromToken(sql(), s1.token)).toBeNull();
    const s2 = await createDoorSession(sql(), "Segurança 2");
    await setEntryMode(sql(), { mode: "list" });
    expect(await doorFromToken(sql(), s2.token)).toBeNull();
  });

  it("sem código definido, nenhum código abre o leitor", async () => {
    expect(await verifyDoorCode(sql(), "qualquer123")).toBe(false);
  });
});
