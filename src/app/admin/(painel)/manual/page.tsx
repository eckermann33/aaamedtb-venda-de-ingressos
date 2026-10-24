import Link from "next/link";
import { StatusBadge } from "@/components/admin";
import { formatDateTime } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { getSql } from "@/server/db";
import { getStats } from "@/server/reports";
import { loadCategories } from "@/server/settings";
import { CancelManualButton, ManualTicketsForm } from "../actions";

type ManualRow = {
  id: string;
  full_name: string;
  category_label: string;
  amount_cents: number;
  note: string | null;
  status: string;
  created_at: Date;
};

export default async function ManualTicketsPage() {
  const sql = getSql();
  const [categories, stats, recent] = await Promise.all([
    loadCategories(sql, true),
    getStats(sql),
    sql<ManualRow[]>`
      SELECT id, full_name, category_label, amount_cents, note, status, created_at
      FROM purchases WHERE source = 'manual' ORDER BY created_at DESC, full_name LIMIT 100
    `,
  ]);

  return (
    <>
      <h1 className="admin-title">Ingresso manual</h1>
      <p className="admin-sub">
        Para quem pagou fora do site (WhatsApp, Pix direto, dinheiro), cortesias e convidados. O ingresso já nasce
        confirmado, entra na lista de entrada e ocupa uma vaga da lotação.{" "}
        {stats.capacity !== null && (
          <strong>
            Vagas livres agora: {stats.available} de {stats.capacity}.
          </strong>
        )}
      </p>

      <div className="panel" style={{ marginTop: 0 }}>
        <h2>Lançar ingressos</h2>
        {categories.length === 0 ? (
          <p className="hint">Nenhuma categoria ativa. Cadastre em Configurações.</p>
        ) : (
          <ManualTicketsForm categories={categories.map((c) => ({ id: c.id, label: c.label, priceCents: c.priceCents }))} />
        )}
      </div>

      <div className="panel">
        <h2>Lançados manualmente ({recent.filter((r) => r.status === "confirmed").length} ativos)</h2>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Categoria</th>
                <th>Valor</th>
                <th>Observação</th>
                <th>Status</th>
                <th>Lançado em</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--muted)", padding: 24 }}>
                    Nenhum ingresso manual ainda.
                  </td>
                </tr>
              )}
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="name">{r.full_name}</td>
                  <td>{r.category_label}</td>
                  <td className="num">{r.amount_cents === 0 ? "Cortesia" : formatBRL(r.amount_cents)}</td>
                  <td>{r.note ?? "—"}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td>{formatDateTime(r.created_at)}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <Link href={`/admin/compras/${r.id}`}>Detalhes</Link>{" "}
                    {r.status === "confirmed" && <CancelManualButton purchaseId={r.id} name={r.full_name} />}
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
