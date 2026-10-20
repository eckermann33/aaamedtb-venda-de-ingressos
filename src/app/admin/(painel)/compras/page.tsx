import Link from "next/link";
import { AttentionBadge, MP_STATUS_LABEL, StatusBadge } from "@/components/admin";
import { formatDateTime } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { getSql } from "@/server/db";
import { listPurchases, STATUS_FILTERS, type StatusFilter } from "@/server/reports";
import { loadCategories } from "@/server/settings";

const STATUS_OPTIONS: Record<StatusFilter, string> = {
  confirmed: "Confirmados",
  pending: "Pendentes",
  rejected: "Recusados",
  cancelled: "Cancelados",
  expired: "Expirados",
  refunded: "Estornados",
  failed: "Falharam",
  attention: "⚠ Precisam de atenção",
};

export default async function PurchasesPage(props: PageProps<"/admin/compras">) {
  const q = await props.searchParams;
  const str = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : "");
  const status = STATUS_FILTERS.includes(str("status") as StatusFilter) ? (str("status") as StatusFilter) : undefined;
  const sort = str("ordem") === "nome" ? "name" : "date";
  const dir = str("dir") === "asc" ? "asc" : str("dir") === "desc" ? "desc" : sort === "name" ? "asc" : "desc";
  const page = Math.max(1, Number(str("pagina")) || 1);
  const sql = getSql();
  const categories = await loadCategories(sql);
  const category = categories.some((c) => c.id === str("categoria")) ? str("categoria") : undefined;

  const { rows, total } = await listPurchases(sql, { q: str("q"), category, status, sort, dir, page, pageSize: 50 });
  const pages = Math.max(1, Math.ceil(total / 50));
  const link = (over: Record<string, string | number>) => {
    const params = new URLSearchParams();
    const base: Record<string, string> = { q: str("q"), categoria: category ?? "", status: status ?? "", ordem: sort === "name" ? "nome" : "data", dir };
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== "" && v !== undefined) params.set(k, String(v));
    return `/admin/compras?${params}`;
  };
  const now = new Date();

  return (
    <>
      <h1 className="admin-title">Compras</h1>
      <p className="admin-sub">{total} registro(s) encontrado(s).</p>

      <form className="panel toolbar" style={{ marginTop: 0 }} method="get" role="search">
        <div className="field" style={{ flex: "2 1 220px" }}>
          <label htmlFor="q">Buscar por nome</label>
          <input id="q" name="q" className="input" defaultValue={str("q")} placeholder="Ex.: maria silva" autoComplete="off" />
        </div>
        <div className="field">
          <label htmlFor="categoria">Categoria</label>
          <select id="categoria" name="categoria" className="input" defaultValue={category ?? ""}>
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="status">Situação</label>
          <select id="status" name="status" className="input" defaultValue={status ?? ""}>
            <option value="">Todas</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {STATUS_OPTIONS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ordem">Ordenar por</label>
          <select id="ordem" name="ordem" className="input" defaultValue={sort === "name" ? "nome" : "data"}>
            <option value="data">Data</option>
            <option value="nome">Nome</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="dir">Ordem</label>
          <select id="dir" name="dir" className="input" defaultValue={dir}>
            <option value="asc">Crescente (A→Z / antigas)</option>
            <option value="desc">Decrescente (Z→A / recentes)</option>
          </select>
        </div>
        <button className="btn btn-sm" style={{ minHeight: 46 }}>
          Filtrar
        </button>
      </form>

      <div className="table-wrap" style={{ marginTop: 18 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Nome completo</th>
              <th>Categoria</th>
              <th className="num">Valor</th>
              <th>Forma</th>
              <th>Compra</th>
              <th>Pagamento (MP)</th>
              <th>Confirmado em</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--muted)", padding: 28 }}>
                  Nenhuma compra encontrada.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="name">
                  {r.full_name}
                  {r.attention && (
                    <div style={{ marginTop: 4 }}>
                      <AttentionBadge attention={r.attention} />
                    </div>
                  )}
                </td>
                <td>{r.category_label}</td>
                <td className="num">{formatBRL(r.amount_cents)}</td>
                <td>{r.payment_method === "pix" ? "Pix" : "Cartão"}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
                <td>{r.payment_status ? (MP_STATUS_LABEL[r.payment_status] ?? r.payment_status) : "—"}</td>
                <td>{r.confirmed_at ? formatDateTime(r.confirmed_at) : <span className="hint">criada {formatDateTime(r.created_at)}</span>}</td>
                <td>
                  <Link href={`/admin/compras/${r.id}`}>Detalhes</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <nav className="pagination" aria-label="Paginação">
        <span>
          Página {Math.min(page, pages)} de {pages}
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          {page > 1 && (
            <Link className="btn btn-ghost btn-sm" href={link({ pagina: page - 1 })}>
              ← Anterior
            </Link>
          )}
          {page < pages && (
            <Link className="btn btn-ghost btn-sm" href={link({ pagina: page + 1 })}>
              Próxima →
            </Link>
          )}
        </span>
      </nav>
      <p className="hint" style={{ marginTop: 8 }}>Atualizado em {formatDateTime(now)}.</p>
    </>
  );
}
