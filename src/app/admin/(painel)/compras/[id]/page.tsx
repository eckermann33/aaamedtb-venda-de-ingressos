import Link from "next/link";
import { notFound } from "next/navigation";
import { ATTENTION_LABEL, MP_STATUS_LABEL, StatusBadge } from "@/components/admin";
import { formatDateTime } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { getSql } from "@/server/db";
import { getPurchase, isUuid } from "@/server/purchases";
import { AnonymizeButton, RefundButton, TransferForm } from "../../actions";

export default async function PurchaseDetail(props: PageProps<"/admin/compras/[id]">) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();
  const sql = getSql();
  const p = await getPurchase(sql, id);
  if (!p) notFound();
  const payments = await sql<
    { mp_payment_id: string; status: string; status_detail: string | null; amount_cents: number | null; payment_method_id: string | null; live_mode: boolean | null; validation_error: string | null; updated_at: Date }[]
  >`SELECT mp_payment_id, status, status_detail, amount_cents, payment_method_id, live_mode, validation_error, updated_at
    FROM payments WHERE purchase_id = ${id} ORDER BY created_at`;
  const [terms] = await sql<{ created_at: Date }[]>`SELECT created_at FROM terms_versions WHERE id = ${p.terms_version_id}`;
  const row = p;

  return (
    <>
      <p>
        <Link href="/admin/compras">← Voltar para compras</Link>
      </p>
      <h1 className="admin-title">{p.full_name}</h1>
      <p className="admin-sub">
        <StatusBadge status={p.status} /> {p.attention && <span className="badge badge-warn">⚠ {ATTENTION_LABEL[p.attention]}</span>}
      </p>

      <div className="grid-2">
        <div className="panel" style={{ marginTop: 0 }}>
          <h2>Compra</h2>
          <dl className="summary">
            <div><dt>Categoria</dt><dd>{p.category_label}</dd></div>
            <div><dt>Ingresso</dt><dd>{formatBRL(p.ticket_price_cents)}</dd></div>
            <div><dt>Taxa de serviço</dt><dd>{formatBRL(p.fee_cents)}</dd></div>
            <div><dt>Total</dt><dd>{formatBRL(p.amount_cents)}</dd></div>
            <div><dt>Forma</dt><dd>{p.payment_method === "pix" ? "Pix" : "Cartão (Checkout Pro)"}</dd></div>
            <div><dt>Código interno</dt><dd>{p.ticket_code ?? "—"}</dd></div>
            <div><dt>Criada em</dt><dd>{formatDateTime(p.created_at)}</dd></div>
            <div><dt>Confirmada em</dt><dd>{formatDateTime(p.confirmed_at)}</dd></div>
            {p.refunded_at && <div><dt>Estornada em</dt><dd>{formatDateTime(p.refunded_at)}</dd></div>}
            <div><dt>Aceite dos termos</dt><dd>v{row.terms_version_id} ({formatDateTime(terms?.created_at)}) em {formatDateTime(row.terms_accepted_at)}</dd></div>
            <div><dt>Maioridade</dt><dd>Declarada</dd></div>
            <div><dt>ID interno</dt><dd style={{ fontSize: "0.8rem" }}>{p.id}</dd></div>
          </dl>
        </div>
        <div className="panel" style={{ marginTop: 0 }}>
          <h2>Pagamentos no Mercado Pago</h2>
          {payments.length === 0 && <p className="hint">Nenhum pagamento registrado.</p>}
          <ul className="checklist" style={{ gap: 14 }}>
            {payments.map((pay) => (
              <li key={pay.mp_payment_id} style={{ display: "block" }}>
                <strong>#{pay.mp_payment_id}</strong> · {MP_STATUS_LABEL[pay.status] ?? pay.status}
                {pay.status_detail && <span className="hint"> ({pay.status_detail})</span>}
                <br />
                <span className="hint">
                  {pay.amount_cents !== null && formatBRL(pay.amount_cents)} · {pay.payment_method_id ?? "—"} ·{" "}
                  {pay.live_mode === false ? "TESTE" : "produção"} · atualizado {formatDateTime(pay.updated_at)}
                </span>
                {pay.validation_error && <div className="field-error">Divergência: {pay.validation_error}</div>}
                {pay.status === "approved" && (
                  <div style={{ marginTop: 8 }}>
                    <RefundButton purchaseId={p.id} mpPaymentId={pay.mp_payment_id} label={formatBRL(pay.amount_cents ?? 0)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {p.status === "confirmed" && !row.anonymized_at && (
        <div className="panel">
          <h2>Transferir ingresso</h2>
          <p className="hint">
            Troca o nome na lista oficial (ex.: pedido recebido por mensagem). Confirme que a nova pessoa tem 18 anos ou
            mais. O código interno do ingresso continua o mesmo.
          </p>
          <TransferForm purchaseId={p.id} currentName={p.full_name} />
        </div>
      )}

      <div className="panel">
        <h2>Privacidade (LGPD)</h2>
        {row.anonymized_at ? (
          <p className="hint">Dados pessoais removidos em {formatDateTime(row.anonymized_at)}.</p>
        ) : (
          <>
            <p className="hint">Use somente se o titular pedir a exclusão dos dados. A compra sai da busca por nome.</p>
            <AnonymizeButton purchaseId={p.id} />
          </>
        )}
      </div>
    </>
  );
}
