import Link from "next/link";
import { DEFAULT_EVENT, DEFAULT_SERVICE_FEE_CENTS } from "@/config/event";
import { eventDateParts } from "@/lib/dates";
import { posterOf } from "@/lib/event-display";
import { getSql } from "@/server/db";
import { listArchivedEditions } from "@/server/editions";
import { listPosters } from "@/server/posters";
import { getStats } from "@/server/reports";
import { loadSettings } from "@/server/settings";
import { NewEditionForm } from "../actions";

/** Começar a próxima festa: arquiva a atual (com os ingressos) e configura a nova. */
export default async function NewEditionPage() {
  const sql = getSql();
  const [settings, stats, archived] = await Promise.all([loadSettings(sql), getStats(sql), listArchivedEditions(sql)]);
  const e = settings.event;
  // Sugestão para a próxima festa: os dados preparados em src/config/event.ts, se ainda não estão em uso.
  const next = DEFAULT_EVENT.name !== e.name ? DEFAULT_EVENT : null;
  const date = eventDateParts(e.date);

  return (
    <>
      <p>
        <Link href="/admin/configuracoes">← Voltar para configurações</Link>
      </p>
      <h1 className="admin-title">Começar nova festa</h1>
      <p className="admin-sub">
        A festa atual vai para o arquivo com todos os ingressos guardados (nada é apagado). A lotação, a lista de
        entrada, o resumo e o leitor da portaria passam a contar só a nova festa.
      </p>

      <div className="panel" style={{ marginTop: 0 }}>
        <h2>Festa atual (nº {settings.edition})</h2>
        <p>
          <strong>{e.name}</strong>
          {date && <> · {date.short}</>} · {stats.confirmed} ingresso(s) confirmado(s)
        </p>
        <p className="hint">Antes de começar a nova festa, baixe as planilhas da festa atual para guardar:</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <a className="btn btn-ghost btn-sm" href="/api/admin/export?scope=official">
            Baixar lista oficial (CSV)
          </a>
          <a className="btn btn-ghost btn-sm" href="/api/admin/export?scope=all">
            Baixar todas as compras (CSV)
          </a>
        </div>
        {settings.salesOpen && (
          <p className="field-error" style={{ marginTop: 12 }}>
            As vendas estão abertas. Feche as vendas no Resumo antes de começar a nova festa.
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Dados da nova festa</h2>
        <NewEditionForm
          initial={{
            name: next?.name ?? "",
            titleTop: next?.titleTop ?? "",
            titleMain: next?.titleMain ?? "",
            poster: (next ? posterOf(next) : null) ?? "",
            tagline: next?.tagline ?? "",
            date: next?.date ?? "",
            startTime: next?.startTime ?? "",
            venueName: next?.venueName ?? "",
            venueAddress: next?.venueAddress ?? "",
            partner: next?.partner ?? "",
            about: next?.about ?? "",
            camarote: next?.camarote ?? "",
            capacity: settings.capacity === null ? "" : String(settings.capacity),
            serviceFee: ((next ? DEFAULT_SERVICE_FEE_CENTS : settings.serviceFeeCents) / 100)
              .toFixed(2)
              .replace(".", ","),
          }}
          posters={listPosters()}
          salesOpen={settings.salesOpen}
        />
      </div>

      {archived.length > 0 && (
        <div className="panel">
          <h2>Festas anteriores</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Nº</th>
                  <th>Festa</th>
                  <th>Data</th>
                  <th>Confirmados</th>
                  <th>Planilhas</th>
                </tr>
              </thead>
              <tbody>
                {archived.map((a) => (
                  <tr key={a.edition}>
                    <td>{a.edition}</td>
                    <td className="name">{a.event.name}</td>
                    <td>{eventDateParts(a.event.date)?.short ?? "—"}</td>
                    <td className="num">{a.confirmed}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      <a href={`/api/admin/export?scope=official&edicao=${a.edition}`}>Lista</a> ·{" "}
                      <a href={`/api/admin/export?scope=all&edicao=${a.edition}`}>Compras</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
