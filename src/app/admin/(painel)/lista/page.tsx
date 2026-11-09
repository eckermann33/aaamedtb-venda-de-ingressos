import { formatDateTime, eventDateParts } from "@/lib/dates";
import { audit } from "@/server/audit";
import { requireAdminPage } from "@/server/auth";
import { getSql } from "@/server/db";
import { officialList } from "@/server/reports";
import { loadSettings } from "@/server/settings";
import type { OfficialRow } from "@/server/reports";
import { PrintButton } from "../actions";

/** Lista oficial de entrada, pronta para imprimir (A4), em ordem alfabética. */
export default async function EntryList() {
  const admin = await requireAdminPage();
  const sql = getSql();
  const [rows, settings] = await Promise.all([officialList(sql), loadSettings(sql)]);
  await audit(sql, admin.id, "view_entry_list", { count: rows.length });
  const date = eventDateParts(settings.event.date);
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(r.category_label, (byCategory.get(r.category_label) ?? 0) + 1);

  const generalRows = rows.filter((r) => !r.athletic);
  const athleticRows = rows.filter((r) => r.athletic);
  return (
    <>
      <div className="no-print" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <h1 className="admin-title">Lista de entrada</h1>
          <p className="admin-sub" style={{ margin: 0 }}>
            Somente pagamentos aprovados. Gere a lista o mais perto possível do evento e feche as vendas antes de imprimir.
          </p>
        </div>
        <a className="btn btn-ghost" href="/api/admin/export?scope=official">
          Baixar CSV
        </a>
        <PrintButton />
      </div>

      <div className="print-list">
        <h1>
          {settings.event.name} — Lista oficial de entrada
        </h1>
        <p className="meta">
          {date ? `${date.long}` : ""} · {rows.length} participante(s)
          {athleticRows.length > 0 && ` (${generalRows.length} na lista geral + ${athleticRows.length} da Atlética)`}
          {[...byCategory.entries()].map(([k, v]) => ` · ${k}: ${v}`).join("")} · gerada em {formatDateTime(new Date())}.
          Confira o documento oficial com foto e a idade (18+).
        </p>
        <EntryTable title={athleticRows.length > 0 ? "Lista geral" : null} rows={generalRows} empty={athleticRows.length > 0 ? "Nenhum ingresso na lista geral." : "Nenhum ingresso confirmado ainda."} />
        {athleticRows.length > 0 && (
          <EntryTable title="Atlética (diretoria)" rows={athleticRows} empty="" />
        )}
      </div>
    </>
  );
}

/** Uma seção da lista de entrada (numeração e letras próprias). */
function EntryTable({ title, rows, empty }: { title: string | null; rows: OfficialRow[]; empty: string }) {
  let lastLetter = "";
  return (
    <>
      {title && <h2 className="list-section">{title}</h2>}
      <table>
        <thead>
          <tr>
            <th className="col-check">Entrou</th>
            <th className="col-n">Nº</th>
            <th>Nome completo</th>
            <th>Categoria</th>
            <th>Código</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", padding: 20 }}>
                {empty}
              </td>
            </tr>
          )}
          {rows.map((r, i) => {
            const letter = r.full_name.normalize("NFD").charAt(0).toUpperCase();
            const header = letter !== lastLetter;
            lastLetter = letter;
            return [
              header ? (
                <tr className="letter" key={`l-${letter}-${i}`}>
                  <td colSpan={5}>{letter}</td>
                </tr>
              ) : null,
              <tr key={r.ticket_code}>
                <td className="col-check">
                  <span className="box" />
                </td>
                <td className="col-n">{i + 1}</td>
                <td>
                  <strong>{r.full_name}</strong>
                </td>
                <td>{r.category_label}</td>
                <td className="code">{r.ticket_code}</td>
              </tr>,
            ];
          })}
        </tbody>
      </table>
    </>
  );
}
