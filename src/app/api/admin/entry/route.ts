import { z } from "zod";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { setEntryMode } from "@/server/checkin";
import { getSql } from "@/server/db";
import { errorResponse, json, readJson } from "@/server/http";
import { PurchaseError } from "@/server/purchases";

const schema = z.object({
  mode: z.enum(["list", "qrcode"]),
  // Novo código de acesso da portaria (opcional: mantém o atual se vier vazio).
  doorCode: z.string().max(64).nullable().optional(),
});

/** Escolhe como a portaria confere a entrada: lista impressa ou QR Code. */
export async function POST(request: Request) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const parsed = schema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return errorResponse("Confira os dados.", 400, "validation");

  const sql = getSql();
  try {
    await setEntryMode(sql, parsed.data);
    // O código em si nunca vai para a auditoria.
    await audit(sql, admin.id, "entry_mode", {
      mode: parsed.data.mode,
      doorCodeChanged: Boolean(parsed.data.doorCode?.trim()),
    });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    throw err;
  }
}
