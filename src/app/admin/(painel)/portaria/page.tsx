import Link from "next/link";
import { formatDateTime } from "@/lib/dates";
import { entryStats } from "@/server/checkin";
import { getSql } from "@/server/db";
import { loadSettings } from "@/server/settings";
import { EntryModeForm, UndoCheckInButton } from "../actions";

type Row = { id: string; full_name: string; category_label: string; checked_in_at: Date; checked_in_by: string | null };

export default async function DoorAdminPage() {
  const sql = getSql();
  const [settings, stats, recent] = await Promise.all([
    loadSettings(sql),
    entryStats(sql),
    sql<Row[]>`
      SELECT id, full_name, category_label, checked_in_at, checked_in_by
      FROM purchases WHERE checked_in_at IS NOT NULL
      ORDER BY checked_in_at DESC LIMIT 50
    `,
  ]);
  const qr = settings.entryMode === "qrcode";

  return (
    <>
      <h1 className="admin-title">Portaria</h1>
      <p className="admin-sub">
        Escolha como a entrada é conferida. Dá para trocar a qualquer momento: os ingressos já vendidos continuam
        valendo nos dois modelos.
      </p>

      <div className="panel" style={{ marginTop: 0 }}>
        <h2>Modelo de entrada</h2>
        <EntryModeForm mode={settings.entryMode} doorCodeSet={settings.doorCodeSet} />
      </div>

      {qr && (
        <div className="panel">
          <h2>Leitor da portaria</h2>
          <p>
            Entraram <strong>{stats.checkedIn}</strong> de {stats.total} ingressos confirmados.
          </p>
          <p className="hint">
            A equipe da entrada abre <strong>/portaria</strong> no celular, informa o nome e o código da portaria e usa
            a câmera para ler os QR Codes. Ela não tem acesso a mais nada do painel. Leve a lista impressa como reserva,
            caso a internet caia.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="btn btn-sm" href="/portaria">
              Abrir o leitor neste aparelho
            </Link>
            <Link className="btn btn-ghost btn-sm" href="/admin/lista">
              Lista de entrada (reserva)
            </Link>
          </div>
        </div>
      )}

      {(qr || recent.length > 0) && (
        <div className="panel">
          <h2>Últimas entradas</h2>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Ingresso</th>
                  <th>Entrou</th>
                  <th>Por</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recent.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                      Ninguém entrou ainda.
                    </td>
                  </tr>
                )}
                {recent.map((r) => (
                  <tr key={r.id}>
                    <td className="name">
                      <Link href={`/admin/compras/${r.id}`}>{r.full_name}</Link>
                    </td>
                    <td>{r.category_label}</td>
                    <td>{formatDateTime(r.checked_in_at)}</td>
                    <td>{r.checked_in_by ?? "—"}</td>
                    <td>
                      <UndoCheckInButton purchaseId={r.id} name={r.full_name} />
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
