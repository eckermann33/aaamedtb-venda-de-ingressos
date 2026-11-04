import { z } from "zod";
import { POSTER_PATTERN } from "@/lib/event-display";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { startNewEdition } from "@/server/editions";
import { errorResponse, json, readJson } from "@/server/http";
import { PurchaseError } from "@/server/purchases";

const text = (max: number) =>
  z
    .string()
    .max(max)
    .transform((s) => s.trim())
    .nullable()
    .transform((s) => (s ? s : null));
const time = z
  .string()
  .regex(/^\d{2}:\d{2}$/)
  .nullable()
  .or(z.literal("").transform(() => null));

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  titleTop: text(40),
  titleMain: text(40),
  poster: z
    .string()
    .regex(POSTER_PATTERN)
    .nullable()
    .or(z.literal("").transform(() => null)),
  tagline: z.string().trim().max(160),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: time,
  venueName: text(120),
  venueAddress: text(250),
  partner: text(80),
  about: z.string().trim().max(1500),
  camarote: z.string().trim().max(800),
  capacity: z.number().int().positive().max(100000).nullable(),
  deactivateCategories: z.boolean(),
  // Confirmação explícita de que a festa anterior foi exportada.
  confirm: z.literal("NOVA FESTA"),
});

/** Arquiva a festa atual e começa a próxima (nada é apagado). */
export async function POST(request: Request) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const parsed = schema.safeParse(await readJson(request, 16_000).catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message =
      issue.path[0] === "confirm"
        ? "Digite NOVA FESTA para confirmar."
        : `Campo inválido: ${issue.path.join(".")} — ${issue.message}`;
    return errorResponse(message, 400, "validation");
  }
  const { confirm: _confirm, ...input } = parsed.data;
  const sql = getSql();
  try {
    const edition = await startNewEdition(sql, input);
    await audit(sql, admin.id, "new_edition", { edition, name: input.name, date: input.date });
    return json({ ok: true, edition });
  } catch (err) {
    if (err instanceof PurchaseError) return errorResponse(err.message, err.httpStatus, err.code);
    throw err;
  }
}
