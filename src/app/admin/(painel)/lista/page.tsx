import { formatDateTime, eventDateParts } from "@/lib/dates";
import { audit } from "@/server/audit";
import { requireAdminPage } from "@/server/auth";
import { getSql } from "@/server/db";
import { officialList } from "@/server/reports";
import { loadSettings } from "@/server/settings";
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

  let lastLetter = "";
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
          {[...byCategory.entries()].map(([k, v]) => ` · ${k}: ${v}`).join("")} · gerada em {formatDateTime(new Date())}.
          Confira o documento oficial com foto e a idade (18+).
        </p>
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
                  Nenhum ingresso confirmado ainda.
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
      </div>
    </>
  );
}
