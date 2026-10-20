import { formatDateTime } from "@/lib/dates";
import { getSql } from "@/server/db";

const ACTIONS: Record<string, string> = {
  login: "Entrou no painel",
  login_failed: "Tentativa de login falhou",
  logout: "Saiu do painel",
  sales_opened: "Abriu as vendas",
  sales_closed: "Fechou as vendas",
  settings_updated: "Alterou configurações",
  export_csv: "Exportou CSV",
  view_entry_list: "Abriu a lista de entrada",
  reconcile: "Conferiu pendentes no MP",
  refund: "Estornou pagamento",
  anonymize_one: "Removeu dados de uma compra",
  anonymize_all: "Anonimizou todas as compras",
  admin_created: "Administrador criado",
  admin_password_reset: "Senha redefinida",
};

export default async function AuditPage() {
  const sql = getSql();
  const logs = await sql<{ id: number; email: string | null; action: string; details: unknown; created_at: Date }[]>`
    SELECT l.id, a.email, l.action, l.details, l.created_at
    FROM audit_log l LEFT JOIN admins a ON a.id = l.admin_id
    ORDER BY l.created_at DESC LIMIT 200
  `;
  const hooks = await sql<{ id: number; topic: string | null; data_id: string | null; signature_ok: boolean; result: string | null; received_at: Date }[]>`
    SELECT id, topic, data_id, signature_ok, result, received_at FROM webhook_events ORDER BY received_at DESC LIMIT 50
  `;
  return (
    <>
      <h1 className="admin-title">Auditoria</h1>
      <p className="admin-sub">Últimas 200 operações administrativas e 50 notificações do Mercado Pago.</p>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Quem</th>
              <th>Ação</th>
              <th>Detalhes</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{formatDateTime(l.created_at)}</td>
                <td>{l.email ?? "—"}</td>
                <td>{ACTIONS[l.action] ?? l.action}</td>
                <td style={{ whiteSpace: "normal", fontSize: "0.82rem", color: "var(--muted)" }}>
                  {l.details ? JSON.stringify(l.details) : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="admin-title" style={{ fontSize: "1.2rem", marginTop: 28 }}>
        Webhooks recebidos
      </h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Quando</th>
              <th>Tipo</th>
              <th>ID</th>
              <th>Assinatura</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {hooks.map((h) => (
              <tr key={h.id}>
                <td>{formatDateTime(h.received_at)}</td>
                <td>{h.topic ?? "—"}</td>
                <td>{h.data_id ?? "—"}</td>
                <td>{h.signature_ok ? <span className="badge badge-ok">válida</span> : <span className="badge badge-bad">inválida</span>}</td>
                <td>{h.result}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
