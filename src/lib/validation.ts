import { z } from "zod";

/** Texto obrigatório da confirmação de maioridade (registrado junto ao aceite). */
export const AGE_TEXT =
  "Confirmo que tenho 18 anos ou mais e estou ciente de que poderá ser solicitada a apresentação de um documento oficial com foto na entrada do evento.";

/** Remove espaços extras e normaliza o nome digitado. */
export function cleanName(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Versão do nome usada na busca: minúscula e sem acentos. */
export function searchableName(raw: string): string {
  return cleanName(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Letras (com acentos), espaços, apóstrofo, hífen e ponto.
const NAME_PATTERN = /^[\p{L}][\p{L}\p{M}' .-]*$/u;

export function validateFullName(raw: unknown): string | null {
  if (typeof raw !== "string") return "Informe seu nome completo.";
  const name = cleanName(raw);
  if (name.length === 0) return "Informe seu nome completo.";
  if (name.length < 5 || name.length > 120) return "O nome deve ter entre 5 e 120 caracteres.";
  if (!NAME_PATTERN.test(name)) return "Use apenas letras no nome.";
  if (name.split(" ").filter((p) => p.length > 0).length < 2) return "Informe nome e sobrenome, como no documento.";
  return null;
}

export const purchaseRequestSchema = z.object({
  clientRequestId: z.uuid(),
  fullName: z.string().max(200),
  categoryId: z.string().regex(/^[a-z0-9-]{2,32}$/),
  adultConfirmed: z.literal(true),
  termsAccepted: z.literal(true),
  termsVersionId: z.number().int().positive(),
  paymentMethod: z.enum(["pix", "card"]),
  // Exigido pelo Mercado Pago para gerar o Pix. Não é armazenado pela plataforma.
  payerEmail: z.email().max(254).optional(),
});

export type PurchaseRequest = z.infer<typeof purchaseRequestSchema>;
