import Link from "next/link";
import { IconAlert, IconCheck, IconInfo } from "@/components/icons";
import { formatDateTime } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { getSql } from "@/server/db";
import { envState } from "@/server/deps";
import { getStats } from "@/server/reports";
import { loadSettings, readiness } from "@/server/settings";
import { ReconcileButton, SalesToggle } from "./actions";

export default async function Dashboard() {
  const sql = getSql();
  const [stats, settings] = await Promise.all([getStats(sql), loadSettings(sql)]);
  const items = readiness(settings, envState());
  const blocking = items.filter((i) => i.blocking);

  return (
    <>
      <h1 className="admin-title">{settings.event.name}</h1>
      <p className="admin-sub">Valores calculados somente com pagamentos aprovados e confirmados.</p>

      <div className="panel" style={{ marginTop: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <h2 style={{ marginBottom: 4 }}>
              Vendas:{" "}
              {settings.salesOpen ? (
                <span className="badge badge-ok">Abertas</span>
              ) : (
                <span className="badge badge-bad">Fechadas</span>
              )}
            </h2>
            <span className="hint">
              {stats.capacity === null
                ? "Sem limite de lotação definido."
                : `Lotação: ${stats.capacity} · disponíveis agora: ${stats.available}`}
            </span>
          </div>
          <SalesToggle open={settings.salesOpen} />
        </div>
        {blocking.length > 0 && (
          <div className="notice notice-warn" style={{ marginTop: 14 }}>
            <IconAlert size={20} />
            <div>
              <strong>Pendências antes de abrir as vendas:</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {blocking.map((i) => (
                  <li key={i.key}>{i.label}</li>
                ))}
              </ul>
              <Link href="/admin/configuracoes">Preencher nas configurações →</Link>
            </div>
          </div>
        )}
        {items
          .filter((i) => !i.blocking)
          .map((i) => (
            <div className="notice" key={i.key} style={{ marginTop: 10 }}>
              <IconInfo size={20} />
              <span>{i.label}</span>
            </div>
          ))}
      </div>

      {stats.attention > 0 && (
        <div className="notice notice-danger" style={{ marginTop: 18 }}>
          <IconAlert size={20} />
          <span>
            <strong>{stats.attention} compra(s) precisam de atenção</strong> (pagamento acima da lotação, duplicado ou
            divergente). <Link href="/admin/compras?status=attention">Ver agora →</Link>
          </span>
        </div>
      )}

      <section className="stats" style={{ marginTop: 18 }} aria-label="Indicadores">
        <div className="stat">
          <div className="k">Ingressos confirmados</div>
          <div className="v neon">{stats.confirmed}</div>
          <div className="d">
            na lista oficial{stats.camarotes > 0 && <> · {stats.camarotes} com camarote</>}{stats.athletic > 0 && <> · {stats.athletic} da Atlética</>}{stats.manualConfirmed > 0 && <> · {stats.manualConfirmed} lançado(s) manualmente</>}
          </div>
        </div>
        {stats.byCategory.map((c) => (
          <div className="stat" key={c.categoryId}>
            <div className="k">{c.label}</div>
            <div className="v">{c.confirmed}</div>
            <div className="d">{formatBRL(c.revenueCents)}</div>
          </div>
        ))}
        <div className="stat">
          <div className="k">Pagamentos aprovados</div>
          <div className="v">{stats.approvedPayments}</div>
          <div className="d">registrados no Mercado Pago</div>
        </div>
        <div className="stat stat-wide">
          <div className="k">Faturamento bruto confirmado</div>
          <div className="v neon">{formatBRL(stats.grossRevenueCents)}</div>
          <div className="d">
            Ingressos {formatBRL(stats.ticketRevenueCents)} + taxas {formatBRL(stats.feeRevenueCents)} · antes das tarifas
            do Mercado Pago
            {stats.camaroteExtraCents > 0 && <> · + {formatBRL(stats.camaroteExtraCents)} de camarote adicionado pelo painel (fora do Mercado Pago)</>}
            {stats.manualConfirmed > 0 && <> · inclui {formatBRL(stats.manualRevenueCents)} de ingressos manuais</>}
          </div>
        </div>
        <div className="stat">
          <div className="k">Pendentes</div>
          <div className="v">{stats.pendingActive}</div>
          <div className="d">aguardando pagamento (não é receita)</div>
        </div>
        <div className="stat">
          <div className="k">Recusados / cancelados</div>
          <div className="v">{stats.notCompleted}</div>
          <div className="d">inclui expirados</div>
        </div>
        <div className="stat">
          <div className="k">Estornados</div>
          <div className="v">{stats.refunded}</div>
          <div className="d">{formatBRL(stats.refundedCents)}</div>
        </div>
        <div className="stat">
          <div className="k">Disponíveis</div>
          <div className="v">{stats.available ?? "∞"}</div>
          <div className="d">{stats.capacity === null ? "sem limite" : `de ${stats.capacity}`}</div>
        </div>
      </section>

      <div className="panel">
        <h2>Ações rápidas</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link className="btn btn-sm" href="/admin/manual">
            Lançar ingresso manual
          </Link>
          <Link className="btn btn-ghost btn-sm" href="/admin/lista">
            Lista de entrada (imprimir)
          </Link>
          <a className="btn btn-ghost btn-sm" href="/api/admin/export?scope=official">
            Baixar lista oficial (CSV)
          </a>
          <a className="btn btn-ghost btn-sm" href="/api/admin/export?scope=all">
            Baixar todas as compras (CSV)
          </a>
          <ReconcileButton />
        </div>
      </div>

      <div className="panel">
        <h2>Integração Mercado Pago</h2>
        <ul className="checklist">
          <li>
            {envState().mpAccessToken ? <IconCheck size={18} /> : <IconAlert size={18} />} Access Token{" "}
            {envState().mpAccessToken ? "configurado" : "NÃO configurado"}
          </li>
          <li>
            {envState().mpWebhookSecret ? <IconCheck size={18} /> : <IconAlert size={18} />} Assinatura do webhook{" "}
            {envState().mpWebhookSecret ? "configurada" : "NÃO configurada"}
          </li>
          <li>
            {stats.lastWebhookAt ? <IconCheck size={18} /> : <IconInfo size={18} />} Último webhook recebido:{" "}
            {stats.lastWebhookAt
              ? `${formatDateTime(stats.lastWebhookAt)} (${stats.lastWebhookOk ? "assinatura válida" : "assinatura INVÁLIDA"})`
              : "nenhum ainda"}
          </li>
        </ul>
      </div>
    </>
  );
}
