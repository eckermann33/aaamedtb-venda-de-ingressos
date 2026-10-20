import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { validateFullName } from "@/lib/validation";
import { toMpDate } from "@/server/mercadopago";
import { hashPassword, passwordProblem, verifyPassword } from "@/server/password";
import { signWebhook, verifyWebhookSignature } from "@/server/webhook-signature";

describe("assinatura do webhook do Mercado Pago", () => {
  const secret = "segredo";
  const ts = "1742505638";
  const reqId = "bb56a2f1-6aae-46ac-982e-9dcd3581d08e";

  it("aceita assinatura válida (manifesto id;request-id;ts)", () => {
    const v1 = signWebhook("123456", reqId, ts, secret);
    expect(verifyWebhookSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: reqId, dataId: "123456", secret })).toEqual({ ok: true });
  });

  it("manifesto segue o formato documentado", async () => {
    const { buildManifest } = await import("@/server/webhook-signature");
    expect(buildManifest("123456", reqId, ts)).toBe(`id:123456;request-id:${reqId};ts:${ts};`);
    expect(buildManifest(undefined, undefined, ts)).toBe(`ts:${ts};`);
  });

  it("recusa id adulterado, segredo errado, cabeçalho ausente ou malformado", () => {
    const v1 = signWebhook("123456", reqId, ts, secret);
    const header = `ts=${ts},v1=${v1}`;
    expect(verifyWebhookSignature({ xSignature: header, xRequestId: reqId, dataId: "999999", secret }).ok).toBe(false);
    expect(verifyWebhookSignature({ xSignature: header, xRequestId: reqId, dataId: "123456", secret: "outro" }).ok).toBe(false);
    expect(verifyWebhookSignature({ xSignature: null, xRequestId: reqId, dataId: "123456", secret }).ok).toBe(false);
    expect(verifyWebhookSignature({ xSignature: "lixo", xRequestId: reqId, dataId: "123456", secret }).ok).toBe(false);
    expect(verifyWebhookSignature({ xSignature: `v1=${v1}`, xRequestId: reqId, dataId: "123456", secret }).ok).toBe(false);
  });
});

describe("senhas", () => {
  it("hash scrypt com sal único e verificação", async () => {
    const a = await hashPassword("SenhaForte123!");
    const b = await hashPassword("SenhaForte123!");
    expect(a).not.toBe(b);
    expect(a).not.toContain("SenhaForte");
    expect(await verifyPassword("SenhaForte123!", a)).toBe(true);
    expect(await verifyPassword("senhaforte123!", a)).toBe(false);
  });
  it("exige senha forte", () => {
    expect(passwordProblem("curta1")).not.toBeNull();
    expect(passwordProblem("somenteletrasaqui")).not.toBeNull();
    expect(passwordProblem("letrasE123numeros")).toBeNull();
  });
});

describe("17. CSV", () => {
  it("UTF-8 com BOM, separador ; e acentos preservados", () => {
    const csv = toCsv(["Nome", "Categoria"], [["João Ávila", "Feminino"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain("João Ávila;Feminino");
  });
  it("neutraliza fórmulas (CSV injection) e escapa aspas/;", () => {
    const csv = toCsv(["a"], [["=HYPERLINK(\"x\")"], ["+1"], ["a;b"]]);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain("'+1");
    expect(csv).toContain('"a;b"');
  });
});

describe("diversos", () => {
  it("datas no fuso de Brasília para o Mercado Pago", () => {
    expect(toMpDate(new Date("2026-10-24T23:30:00.000Z"))).toBe("2026-10-24T20:30:00.000-03:00");
  });
  it("validação de nome", () => {
    expect(validateFullName("Ana Lúcia D'Ávila-Souza")).toBeNull();
    expect(validateFullName("   ")).not.toBeNull();
    expect(validateFullName(123)).not.toBeNull();
  });
});
