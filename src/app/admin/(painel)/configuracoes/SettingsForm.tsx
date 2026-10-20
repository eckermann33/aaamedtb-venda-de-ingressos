"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EventInfo, TermsContent } from "@/config/event";
import { IconAlert, IconCheck } from "@/components/icons";
import { formatBRL } from "@/lib/money";

type Category = { id: string; label: string; priceCents: number; active: boolean; sortOrder: number };
type Initial = {
  event: EventInfo;
  capacity: number | null;
  serviceFeeCents: number;
  terms: TermsContent;
  categories: Category[];
};

const toReais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");
const toCents = (text: string) => {
  const n = Number(text.replace(/\./g, "").replace(",", ".").trim());
  return Number.isFinite(n) ? Math.round(n * 100) : NaN;
};

export default function SettingsForm({ initial, pending }: { initial: Initial; pending: string[] }) {
  const router = useRouter();
  const [event, setEvent] = useState<EventInfo>(initial.event);
  const [capacity, setCapacity] = useState(initial.capacity === null ? "" : String(initial.capacity));
  const [fee, setFee] = useState(toReais(initial.serviceFeeCents));
  const [rules, setRules] = useState(initial.terms.rules.join("\n"));
  const [refund, setRefund] = useState(initial.terms.refundPolicy ?? "");
  const [cancel, setCancel] = useState(initial.terms.cancellationPolicy ?? "");
  const [transfer, setTransfer] = useState(initial.terms.transferPolicy ?? "");
  const [cats, setCats] = useState(initial.categories.map((c) => ({ ...c, price: toReais(c.priceCents) })));
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof EventInfo>(k: K, v: EventInfo[K]) => setEvent((e) => ({ ...e, [k]: v }));
  const missing = (k: string) => pending.includes(k);
  const text = (k: keyof EventInfo, label: string, opts: { type?: string; span?: boolean; placeholder?: string; area?: boolean } = {}) => (
    <div className={`field${opts.span ? " span-2" : ""}`}>
      <label htmlFor={`s-${k}`}>
        {label} {missing(k) && <span className="badge badge-warn">pendente</span>}
      </label>
      {opts.area ? (
        <textarea id={`s-${k}`} className="input" value={(event[k] as string | null) ?? ""} onChange={(e) => set(k, e.target.value as never)} />
      ) : (
        <input
          id={`s-${k}`}
          className="input"
          type={opts.type ?? "text"}
          placeholder={opts.placeholder}
          value={(event[k] as string | number | null) ?? ""}
          onChange={(e) => set(k, (opts.type === "number" ? Number(e.target.value) : e.target.value) as never)}
        />
      )}
    </div>
  );

  async function save(ev: React.FormEvent) {
    ev.preventDefault();
    const feeCents = toCents(fee);
    const categories = cats.map((c, i) => ({
      id: c.id.trim().toLowerCase(),
      label: c.label,
      priceCents: toCents(c.price),
      active: c.active,
      sortOrder: i + 1,
    }));
    if (!Number.isFinite(feeCents) || categories.some((c) => !Number.isFinite(c.priceCents))) {
      setStatus({ ok: false, msg: "Confira os valores (use o formato 20,00)." });
      return;
    }
    setSaving(true);
    setStatus(null);
    const res = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: { ...event, retentionDays: Number(event.retentionDays) },
        capacity: capacity.trim() === "" ? null : Number(capacity),
        serviceFeeCents: feeCents,
        terms: {
          rules: rules.split("\n").map((r) => r.trim()).filter(Boolean),
          refundPolicy: refund,
          cancellationPolicy: cancel,
          transferPolicy: transfer,
        },
        categories,
      }),
    });
    const data = await res.json().catch(() => null);
    setSaving(false);
    if (!res.ok) {
      setStatus({ ok: false, msg: data?.error?.message ?? "Erro ao salvar." });
      return;
    }
    setStatus({
      ok: true,
      msg: data.closedSales
        ? "Salvo. As vendas foram FECHADAS porque um campo obrigatório ficou vazio."
        : "Configurações salvas.",
    });
    router.refresh();
  }

  return (
    <form onSubmit={save}>
      <section className="panel" style={{ marginTop: 0 }}>
        <h2>Evento</h2>
        <div className="form-grid">
          {text("name", "Nome da festa")}
          {text("tagline", "Frase do cartaz")}
          {text("date", "Data", { type: "date" })}
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {text("startTime", "Início", { type: "time" })}
            {text("endTime", "Término (opcional)", { type: "time" })}
          </div>
          {text("venueName", "Nome do local", { placeholder: "Ex.: Espaço X" })}
          {text("venueAddress", "Endereço do local", { placeholder: "Rua, número — bairro, cidade/UF" })}
          {text("partner", "Parceiro")}
          {text("ageRating", "Classificação etária")}
          {text("about", "Sobre a festa", { span: true, area: true })}
          {text("camarote", "Texto do camarote", { span: true, area: true })}
        </div>
      </section>

      <section className="panel">
        <h2>Organização e contato</h2>
        <div className="form-grid">
          {text("organizer", "Nome da organização", { span: true })}
          {text("organizerShort", "Nome curto")}
          {text("contactEmail", "E-mail de contato (LGPD e suporte)", { type: "email" })}
          {text("contactInstagram", "Instagram (opcional)", { placeholder: "@atleticainvictus" })}
          {text("statementDescriptor", "Nome na fatura do cartão (até 13)")}
          {text("retentionDays", "Anonimizar nomes após (dias do evento)", { type: "number" })}
        </div>
      </section>

      <section className="panel">
        <h2>Ingressos, taxa e lotação</h2>
        <div className="table-wrap" style={{ marginBottom: 14 }}>
          <table className="data">
            <thead>
              <tr>
                <th>Identificador</th>
                <th>Nome</th>
                <th>Preço (R$)</th>
                <th>Ativa</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {cats.map((c, i) => (
                <tr key={i}>
                  <td>
                    <input
                      className="input"
                      style={{ minHeight: 40, width: 140 }}
                      value={c.id}
                      disabled={initial.categories.some((x) => x.id === c.id)}
                      onChange={(e) => setCats((all) => all.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)))}
                      aria-label="Identificador"
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      style={{ minHeight: 40, width: 160 }}
                      value={c.label}
                      onChange={(e) => setCats((all) => all.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                      aria-label="Nome da categoria"
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      style={{ minHeight: 40, width: 110 }}
                      inputMode="decimal"
                      value={c.price}
                      onChange={(e) => setCats((all) => all.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))}
                      aria-label="Preço"
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={c.active}
                      onChange={(e) => setCats((all) => all.map((x, j) => (j === i ? { ...x, active: e.target.checked } : x)))}
                      aria-label="Ativa"
                    />
                  </td>
                  <td>
                    {!initial.categories.some((x) => x.id === c.id) && (
                      <button type="button" className="back-link" onClick={() => setCats((all) => all.filter((_, j) => j !== i))}>
                        remover
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setCats((all) => [...all, { id: "", label: "", price: "", priceCents: 0, active: true, sortOrder: all.length + 1 }])}
        >
          + Adicionar categoria
        </button>
        <div className="form-grid" style={{ marginTop: 18 }}>
          <div className="field">
            <label htmlFor="s-fee">Taxa de serviço por ingresso (R$)</label>
            <input id="s-fee" className="input" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
            <span className="hint">
              Exibida separadamente ao comprador. Atual: {Number.isFinite(toCents(fee)) ? formatBRL(toCents(fee)) : "—"} · use 0,00
              para não cobrar.
            </span>
          </div>
          <div className="field">
            <label htmlFor="s-cap">Limite total de ingressos</label>
            <input id="s-cap" className="input" inputMode="numeric" placeholder="Vazio = sem limite" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))} />
            <span className="hint">Conta ingressos confirmados + reservas em pagamento.</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Regras e políticas</h2>
        <div className="field">
          <label htmlFor="s-rules">Regras de entrada (uma por linha)</label>
          <textarea id="s-rules" className="input" style={{ minHeight: 200 }} value={rules} onChange={(e) => setRules(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="s-refund">
            Política de reembolso {missing("refundPolicy") && <span className="badge badge-warn">pendente</span>}
          </label>
          <textarea id="s-refund" className="input" value={refund} onChange={(e) => setRefund(e.target.value)} />
          <span className="hint">Lembrete: o Código de Defesa do Consumidor garante arrependimento em até 7 dias em compras online (art. 49). Consulte a diretoria/jurídico.</span>
        </div>
        <div className="field">
          <label htmlFor="s-cancel">
            Política em caso de cancelamento do evento {missing("cancellationPolicy") && <span className="badge badge-warn">pendente</span>}
          </label>
          <textarea id="s-cancel" className="input" value={cancel} onChange={(e) => setCancel(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="s-transfer">
            Política de transferência de ingresso {missing("transferPolicy") && <span className="badge badge-warn">pendente</span>}
          </label>
          <textarea id="s-transfer" className="input" value={transfer} onChange={(e) => setTransfer(e.target.value)} />
        </div>
      </section>

      <div className="sticky-save">
        <button className="btn" disabled={saving}>
          {saving ? "Salvando…" : "Salvar configurações"}
        </button>
        {status && (
          <span className={status.ok ? "hint" : "field-error"} role="status" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {status.ok ? <IconCheck size={16} /> : <IconAlert size={16} />} {status.msg}
          </span>
        )}
      </div>
    </form>
  );
}
