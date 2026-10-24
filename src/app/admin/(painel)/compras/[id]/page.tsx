import Link from "next/link";
import { notFound } from "next/navigation";
import { ATTENTION_LABEL, MP_STATUS_LABEL, StatusBadge } from "@/components/admin";
import { formatPhone } from "@/lib/contact";
import { formatDateTime } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { getSql } from "@/server/db";
import { getOrderTickets, getPurchase, isUuid } from "@/server/purchases";
import { AnonymizeButton, CamaroteForm, CancelManualButton, RefundButton, TransferForm } from "../../actions";

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
  const manual = p.source === "manual";
  const [camaroteCat] = await sql<{ price_cents: number }[]>`SELECT price_cents FROM ticket_categories WHERE id = 'camarote'`;
  const camaroteDefault = camaroteCat?.price_cents ?? 3000;
  // Pedido com vários ingressos: o pagamento e o estorno ficam na linha principal.
  const orderLeadId = p.lead_id ?? p.id;
  const order = manual ? [] : await getOrderTickets(sql, orderLeadId);

  return (
    <>
      <p>
        <Link href="/admin/compras">← Voltar para compras</Link>
      </p>
      <h1 className="admin-title">{p.full_name}</h1>
      <p className="admin-sub">
        <StatusBadge status={p.status} /> {p.attention && <span className="badge badge-warn">⚠ {ATTENTION_LABEL[p.attention]}</span>}
      </p>

      {p.lead_id && (
        <div className="notice" style={{ marginBottom: 16 }}>
          <span>
            Este ingresso faz parte de um pedido com {order.length} ingressos. O pagamento e o estorno ficam na{" "}
            <Link href={`/admin/compras/${p.lead_id}`}>compra principal</Link>.
          </span>
        </div>
      )}
      {!p.lead_id && order.length > 1 && (
        <div className="panel" style={{ marginTop: 0 }}>
          <h2>Pedido com {order.length} ingressos</h2>
          <p className="hint">Um único pagamento cobre todos. O estorno devolve o valor do pedido inteiro.</p>
          <ul className="checklist" style={{ gap: 8 }}>
            {order.map((t) => (
              <li key={t.id} style={{ display: "block" }}>
                <Link href={`/admin/compras/${t.id}`}>{t.full_name}</Link> · {t.category_label} · {formatBRL(t.amount_cents)}{" "}
                <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid-2">
        <div className="panel" style={{ marginTop: 0 }}>
          <h2>{manual ? "Ingresso manual" : "Compra"}</h2>
          <dl className="summary">
            <div>
              <dt>Celular / WhatsApp</dt>
              <dd>
                {p.buyer_phone ? (
                  <a href={`https://wa.me/55${p.buyer_phone}`} target="_blank" rel="noopener noreferrer">
                    {formatPhone(p.buyer_phone)}
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div><dt>Categoria</dt><dd>{p.category_label}</dd></div>
            <div><dt>Ingresso</dt><dd>{formatBRL(p.ticket_price_cents)}</dd></div>
            <div><dt>Taxa de serviço</dt><dd>{formatBRL(p.fee_cents)}</dd></div>
            <div><dt>Total</dt><dd>{formatBRL(p.amount_cents)}</dd></div>
            <div>
              <dt>Forma</dt>
              <dd>{manual ? "Lançamento manual" : p.payment_method === "pix" ? "Pix" : "Cartão (Checkout Pro)"}</dd>
            </div>
            {p.note && <div><dt>Observação</dt><dd>{p.note}</dd></div>}
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
          {manual && <p className="hint">Ingresso lançado manualmente: não há pagamento no Mercado Pago.</p>}
          {!manual && payments.length === 0 && <p className="hint">Nenhum pagamento registrado.</p>}
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

      {p.status === "confirmed" && !row.anonymized_at && (
        <div className="panel">
          <h2>Camarote</h2>
          <CamaroteForm
            purchaseId={p.id}
            hasCamarote={p.camarote}
            addedByPanel={p.camarote_extra_cents !== null}
            extraCents={p.camarote_extra_cents}
            defaultPriceCents={camaroteDefault}
          />
        </div>
      )}

      {manual && p.status === "confirmed" && (
        <div className="panel">
          <h2>Remover da lista</h2>
          <p className="hint">Use se o ingresso foi lançado por engano. A vaga é liberada e o nome sai da lista de entrada.</p>
          <CancelManualButton purchaseId={p.id} name={p.full_name} />
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
