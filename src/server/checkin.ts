import { normalizeEntryCode, type EntryMode } from "@/lib/entry-code";
import type { Sql } from "./db";
import { hashPassword } from "./password";
import { PurchaseError } from "./purchases";

/** O que a portaria vê ao ler um QR Code: só o necessário para conferir o documento. */
export type DoorTicket = {
  fullName: string;
  categoryLabel: string;
  camarote: boolean;
  athletic: boolean;
  checkedInAt: string | null;
  checkedInBy: string | null;
};

export type DoorStats = { checkedIn: number; total: number };

export type LookupResult =
  | { result: "valid"; ticket: DoorTicket }
  | { result: "already"; ticket: DoorTicket }
  | { result: "invalid"; ticket: DoorTicket; reason: string }
  | { result: "not_found" };

export type CheckInResult = LookupResult | { result: "checked_in"; ticket: DoorTicket };

type Row = {
  id: string;
  full_name: string;
  category_label: string;
  camarote: boolean;
  athletic: boolean;
  status: string;
  checked_in_at: Date | null;
  checked_in_by: string | null;
};

const INVALID_REASON: Record<string, string> = {
  refunded: "Ingresso estornado: o valor foi devolvido.",
  cancelled: "Ingresso cancelado.",
  pending: "Pagamento ainda não confirmado.",
  expired: "Pagamento não concluído.",
  rejected: "Pagamento recusado.",
  failed: "Pagamento não concluído.",
};

function toDoor(r: Row): DoorTicket {
  return {
    fullName: r.full_name,
    categoryLabel: r.category_label,
    camarote: r.camarote,
    athletic: r.athletic,
    checkedInAt: r.checked_in_at?.toISOString() ?? null,
    checkedInBy: r.checked_in_by,
  };
}

function classify(r: Row | undefined): LookupResult {
  if (!r) return { result: "not_found" };
  if (r.status !== "confirmed") {
    return { result: "invalid", ticket: toDoor(r), reason: INVALID_REASON[r.status] ?? "Ingresso inválido." };
  }
  if (r.checked_in_at) return { result: "already", ticket: toDoor(r) };
  return { result: "valid", ticket: toDoor(r) };
}

async function findByCode(sql: Sql, code: string): Promise<Row | undefined> {
  const rows = await sql<Row[]>`
    SELECT id, full_name, category_label, camarote, athletic, status, checked_in_at, checked_in_by
    FROM purchases WHERE entry_code = ${code}
  `;
  return rows[0];
}

/** Consulta um ingresso pelo QR Code (ou código digitado), sem registrar a entrada. */
export async function lookupTicket(sql: Sql, raw: unknown): Promise<LookupResult> {
  const code = normalizeEntryCode(raw);
  if (!code) return { result: "not_found" };
  return classify(await findByCode(sql, code));
}

/**
 * Registra a entrada. É atômico: se dois leitores confirmarem o mesmo QR ao mesmo tempo,
 * só um consegue e o outro recebe "já entrou".
 */
export async function checkIn(sql: Sql, raw: unknown, by: string): Promise<CheckInResult> {
  const code = normalizeEntryCode(raw);
  if (!code) return { result: "not_found" };
  const rows = await sql<Row[]>`
    UPDATE purchases SET checked_in_at = now(), checked_in_by = ${by.slice(0, 60)}, updated_at = now()
    WHERE entry_code = ${code} AND status = 'confirmed' AND checked_in_at IS NULL
    RETURNING id, full_name, category_label, camarote, athletic, status, checked_in_at, checked_in_by
  `;
  if (rows[0]) return { result: "checked_in", ticket: toDoor(rows[0]) };
  return classify(await findByCode(sql, code));
}

/** Desfaz uma entrada registrada por engano (só pelo painel). */
export async function undoCheckIn(sql: Sql, id: string): Promise<void> {
  const rows = await sql`
    UPDATE purchases SET checked_in_at = NULL, checked_in_by = NULL, updated_at = now()
    WHERE id = ${id} AND checked_in_at IS NOT NULL
    RETURNING id
  `;
  if (!rows[0]) throw new PurchaseError("not_applicable", "Este ingresso não tem entrada registrada.", 409);
}

export async function entryStats(sql: Sql): Promise<DoorStats> {
  const [row] = await sql<{ checked_in: number; total: number }[]>`
    SELECT count(*) FILTER (WHERE checked_in_at IS NOT NULL)::int AS checked_in, count(*)::int AS total
    FROM purchases WHERE status = 'confirmed'
  `;
  return { checkedIn: row.checked_in, total: row.total };
}

/** Encerra todas as sessões da portaria (troca do código ou volta ao modo de lista). */
export async function revokeDoorSessions(sql: Sql) {
  await sql`DELETE FROM door_sessions`;
}

/** Regras do código de acesso da portaria. */
export function doorCodeProblem(code: string): string | null {
  if (code.trim().length < 6) return "O código da portaria precisa ter pelo menos 6 caracteres.";
  if (code.length > 64) return "Código longo demais.";
  return null;
}

/**
 * Troca o modo de entrada e/ou o código de acesso da portaria. Mudar o código ou voltar
 * para a lista impressa encerra todas as sessões abertas no leitor.
 */
export async function setEntryMode(sql: Sql, input: { mode: EntryMode; doorCode?: string | null }): Promise<void> {
  const newCode = input.doorCode?.trim() ? input.doorCode.trim() : null;
  if (newCode) {
    const problem = doorCodeProblem(newCode);
    if (problem) throw new PurchaseError("invalid_door_code", problem, 400);
  }
  const hash = newCode ? await hashPassword(newCode) : null;
  await sql.begin(async (tx) => {
    const [cur] = await tx<
      { door_code_hash: string | null }[]
    >`SELECT door_code_hash FROM settings WHERE id = 1 FOR UPDATE`;
    if (input.mode === "qrcode" && !hash && !cur?.door_code_hash) {
      throw new PurchaseError(
        "door_code_required",
        "Defina o código de acesso da portaria para ativar o QR Code.",
        400,
      );
    }
    await tx`
      UPDATE settings SET entry_mode = ${input.mode}, door_code_hash = coalesce(${hash}, door_code_hash), updated_at = now()
      WHERE id = 1
    `;
  });
  if (hash || input.mode === "list") await revokeDoorSessions(sql);
}
