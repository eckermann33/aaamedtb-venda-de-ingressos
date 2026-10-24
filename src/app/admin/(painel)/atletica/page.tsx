import Link from "next/link";
import { StatusBadge } from "@/components/admin";
import { getSql } from "@/server/db";
import { AthleticForm, CancelManualButton } from "../actions";

type Row = { id: string; full_name: string; status: string; source: string; category_label: string };

export default async function AthleticPage() {
  const sql = getSql();
  const rows = await sql<Row[]>`
    SELECT id, full_name, status, source, category_label
    FROM purchases
    WHERE athletic AND status IN ('confirmed', 'pending')
    ORDER BY name_search
  `;
  return (
    <>
      <h1 className="admin-title">Atlética (diretoria)</h1>
      <p className="admin-sub">
        Cole os nomes da diretoria: eles entram como cortesia e saem na seção <strong>Atlética</strong> da lista de
        entrada, separados da lista geral. Não aparece nada disso no site.
      </p>

      <div className="panel" style={{ marginTop: 0 }}>
        <h2>Adicionar nomes</h2>
        <AthleticForm />
      </div>

      <div className="panel">
        <h2>Na seção Atlética ({rows.filter((r) => r.status === "confirmed").length})</h2>
        <p className="hint">
          Quem já tinha ingresso cadastrado também aparece aqui depois de marcado como Atlética (em Compras → nome →
          Marcar como Atlética).
        </p>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Ingresso</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                    Ninguém na seção Atlética ainda.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="name">{r.full_name}</td>
                  <td>{r.category_label}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link href={`/admin/compras/${r.id}`}>Detalhes</Link>{" "}
                    {r.source === "manual" && r.status === "confirmed" && <CancelManualButton purchaseId={r.id} name={r.full_name} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
