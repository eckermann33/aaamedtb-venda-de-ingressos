import type { EventInfo } from "@/config/event";
import type { Sql } from "./db";
import { PurchaseError } from "./purchases";
import { loadSettings } from "./settings";

/** Dados da nova festa informados no painel (o resto da configuração é mantido). */
export type NewEditionInput = Pick<
  EventInfo,
  | "name"
  | "titleTop"
  | "titleMain"
  | "poster"
  | "tagline"
  | "date"
  | "startTime"
  | "venueName"
  | "venueAddress"
  | "partner"
  | "about"
  | "camarote"
> & {
  capacity: number | null;
  /** Desativa as categorias até a organização definir os preços da nova festa. */
  deactivateCategories: boolean;
};

export type ArchivedEdition = {
  edition: number;
  event: EventInfo;
  archivedAt: Date;
  confirmed: number;
};

/**
 * Começa uma nova festa: a festa atual vai para o arquivo (com todos os ingressos guardados) e
 * a lotação, a lista de entrada, o resumo e o leitor da portaria passam a contar só a nova.
 * Exige as vendas fechadas. Os ingressos antigos continuam consultáveis e exportáveis.
 */
export async function startNewEdition(sql: Sql, input: NewEditionInput): Promise<number> {
  return sql.begin(async (tx) => {
    const settings = await loadSettings(tx, { forUpdate: true });
    if (settings.salesOpen) {
      throw new PurchaseError("sales_open", "Feche as vendas da festa atual antes de começar uma nova.", 409);
    }
    const { capacity, deactivateCategories, ...fields } = input;
    await tx`
      INSERT INTO editions_archive (edition, event) VALUES (${settings.edition}, ${tx.json(settings.event as never)})
      ON CONFLICT (edition) DO UPDATE SET event = EXCLUDED.event, archived_at = now()
    `;
    const event: EventInfo = { ...settings.event, ...fields, endTime: null };
    const [row] = await tx<{ edition: number }[]>`
      UPDATE settings SET edition = edition + 1, event = ${tx.json(event as never)}, capacity = ${capacity},
        sales_open = false, updated_at = now()
      WHERE id = 1
      RETURNING edition
    `;
    if (deactivateCategories) await tx`UPDATE ticket_categories SET active = false, updated_at = now()`;
    // Leitores da portaria abertos na festa anterior precisam entrar de novo.
    await tx`DELETE FROM door_sessions`;
    return row.edition;
  });
}

/** Festas anteriores, da mais recente para a mais antiga, com o total de ingressos confirmados. */
export async function listArchivedEditions(sql: Sql): Promise<ArchivedEdition[]> {
  const rows = await sql<{ edition: number; event: EventInfo; archived_at: Date; confirmed: number }[]>`
    SELECT a.edition, a.event, a.archived_at,
           (SELECT count(*) FROM purchases p WHERE p.edition = a.edition AND p.status = 'confirmed')::int AS confirmed
    FROM editions_archive a
    ORDER BY a.edition DESC
  `;
  return rows.map((r) => ({ edition: r.edition, event: r.event, archivedAt: r.archived_at, confirmed: r.confirmed }));
}

/** Dados da festa de uma edição já encerrada (null se for a atual ou não existir). */
export async function archivedEvent(sql: Sql, edition: number): Promise<EventInfo | null> {
  const [row] = await sql<{ event: EventInfo }[]>`SELECT event FROM editions_archive WHERE edition = ${edition}`;
  return row?.event ?? null;
}
