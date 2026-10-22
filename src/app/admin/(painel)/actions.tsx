"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/admin", label: "Resumo" },
  { href: "/admin/compras", label: "Compras" },
  { href: "/admin/manual", label: "Ingresso manual" },
  { href: "/admin/lista", label: "Lista de entrada" },
  { href: "/admin/configuracoes", label: "Configurações" },
  { href: "/admin/auditoria", label: "Auditoria" },
];

export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="admin-nav" aria-label="Painel">
      {LINKS.map((l) => {
        const active = l.href === "/admin" ? path === "/admin" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}

async function post(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, data };
}

export function LogoutButton() {
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await post("/api/admin/logout");
        window.location.assign("/admin/login");
      }}
    >
      Sair
    </button>
  );
}

export function SalesToggle({ open }: { open: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        className={open ? "btn btn-danger" : "btn"}
        disabled={busy}
        onClick={async () => {
          if (open && !confirm("Fechar as vendas agora? Ninguém mais conseguirá comprar até reabrir.")) return;
          setBusy(true);
          setError(null);
          const r = await post("/api/admin/sales", { open: !open });
          setBusy(false);
          if (!r.ok) {
            const pending: string[] = r.data?.error?.pending ?? [];
            setError(`${r.data?.error?.message ?? "Erro."}${pending.length ? " Falta: " + pending.join(", ") + "." : ""}`);
            return;
          }
          router.refresh();
        }}
      >
        {busy ? "Salvando…" : open ? "Fechar vendas" : "Abrir vendas"}
      </button>
      {error && (
        <p className="field-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </p>
      )}
    </div>
  );
}

export function ReconcileButton() {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <button
        className="btn btn-ghost btn-sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await post("/api/admin/reconcile");
          setBusy(false);
          setMsg(r.ok ? `${r.data.checked} compra(s) conferida(s) no Mercado Pago.` : "Falha ao conferir.");
          router.refresh();
        }}
      >
        {busy ? "Conferindo…" : "Conferir pendentes no Mercado Pago"}
      </button>
      {msg && <span className="hint">{msg}</span>}
    </span>
  );
}

export function RefundButton({ purchaseId, mpPaymentId, label }: { purchaseId: string; mpPaymentId: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        className="btn btn-danger btn-sm"
        disabled={busy}
        onClick={async () => {
          if (!confirm(`Estornar o pagamento ${mpPaymentId} (${label})? O dinheiro volta para o comprador e o ingresso sai da lista.`)) return;
          setBusy(true);
          const r = await post(`/api/admin/purchases/${purchaseId}/refund`, { mpPaymentId, confirm: true });
          setBusy(false);
          if (!r.ok) setError(r.data?.error?.message ?? "Falha ao estornar.");
          router.refresh();
        }}
      >
        {busy ? "Estornando…" : "Estornar"}
      </button>
      {error && <span className="field-error"> {error}</span>}
    </span>
  );
}

export function TransferForm({ purchaseId, currentName }: { purchaseId: string; currentName: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form
      className="toolbar"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!confirm(`Transferir o ingresso de "${currentName}" para "${name.trim()}"?`)) return;
        setBusy(true);
        const r = await post(`/api/admin/purchases/${purchaseId}/transfer`, { fullName: name });
        setBusy(false);
        setMsg(r.ok ? { ok: true, text: "Nome atualizado na lista oficial." } : { ok: false, text: r.data?.error?.message ?? "Erro." });
        if (r.ok) {
          setName("");
          router.refresh();
        }
      }}
    >
      <div className="field" style={{ flex: "2 1 240px" }}>
        <label htmlFor="novo-nome">Nome completo da nova pessoa</label>
        <input id="novo-nome" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </div>
      <button className="btn btn-sm" style={{ minHeight: 46 }} disabled={busy || name.trim().length < 5}>
        {busy ? "Salvando…" : "Transferir"}
      </button>
      {msg && <p className={msg.ok ? "hint" : "field-error"}>{msg.text}</p>}
    </form>
  );
}

export function AnonymizeButton({ purchaseId }: { purchaseId: string }) {
  const router = useRouter();
  return (
    <button
      className="btn btn-danger btn-sm"
      onClick={async () => {
        if (!confirm("Remover o nome desta compra (pedido do titular)? Isso não pode ser desfeito.")) return;
        await post(`/api/admin/purchases/${purchaseId}/anonymize`);
        router.refresh();
      }}
    >
      Remover dados pessoais
    </button>
  );
}

export function AnonymizeAll() {
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="toolbar">
      <div className="field">
        <label htmlFor="anon">Digite ANONIMIZAR para confirmar</label>
        <input id="anon" className="input" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
      </div>
      <button
        className="btn btn-danger"
        disabled={text !== "ANONIMIZAR"}
        onClick={async () => {
          const r = await post("/api/admin/anonymize", { confirm: text });
          setMsg(r.ok ? `${r.data.count} compra(s) anonimizada(s).` : r.data?.error?.message ?? "Erro.");
          setText("");
        }}
      >
        Anonimizar todas as compras
      </button>
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}

export function PrintButton() {
  return (
    <button className="btn" onClick={() => window.print()}>
      Imprimir lista
    </button>
  );
}

export type ManualCategory = { id: string; label: string; priceCents: number };

const reais = (cents: number) => (cents / 100).toFixed(2).replace(".", ",");

/** Lança ingressos pagos fora do site (WhatsApp, Pix direto, dinheiro) ou cortesias. */
export function ManualTicketsForm({ categories }: { categories: ManualCategory[] }) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [names, setNames] = useState("");
  const [price, setPrice] = useState(categories[0] ? reais(categories[0].priceCents) : "");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const list = names.split("\n").map((n) => n.trim()).filter(Boolean);
  const cents = Math.round(Number(price.replace(/\./g, "").replace(",", ".").trim()) * 100);
  const priceOk = Number.isFinite(cents) && cents >= 0;

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!priceOk) return setMsg({ ok: false, text: "Valor inválido." });
        const total = reais(cents * list.length);
        if (!confirm(`Lançar ${list.length} ingresso(s) manual(is), ${reais(cents)} cada (total R$ ${total})? Eles entram na lista oficial agora.`)) return;
        setBusy(true);
        setMsg(null);
        const r = await post("/api/admin/manual", {
          names: list,
          categoryId,
          priceCents: cents,
          phone: phone.trim() ? phone : null,
          note: note.trim() ? note : null,
          adultConfirmed: adult,
        });
        setBusy(false);
        if (!r.ok) return setMsg({ ok: false, text: r.data?.error?.message ?? "Erro ao lançar." });
        setMsg({ ok: true, text: `${r.data.count} ingresso(s) lançado(s) e já na lista oficial.` });
        setNames("");
        setNote("");
        setPhone("");
        setAdult(false);
        router.refresh();
      }}
    >
      <div className="field">
        <label htmlFor="m-cat">Categoria</label>
        <select
          id="m-cat"
          className="input"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            const c = categories.find((x) => x.id === e.target.value);
            if (c) setPrice(reais(c.priceCents));
          }}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="m-price">Valor pago por ingresso (R$)</label>
        <input id="m-price" className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        <span className="hint">Já vem com o preço da categoria. Coloque 0 para cortesia/convidado. Sem taxa de serviço.</span>
      </div>
      <div className="field span-2">
        <label htmlFor="m-names">Nome completo de cada pessoa (um por linha)</label>
        <textarea
          id="m-names"
          className="input"
          style={{ minHeight: 130 }}
          value={names}
          onChange={(e) => setNames(e.target.value)}
          placeholder={"Maria Eduarda Souza\nJoão Pedro Lima"}
        />
        <span className="hint">{list.length} ingresso(s). Máximo 50 por vez.</span>
      </div>
      <div className="field">
        <label htmlFor="m-phone">Celular / WhatsApp de quem comprou (opcional)</label>
        <input id="m-phone" className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(42) 99999-9999" />
      </div>
      <div className="field">
        <label htmlFor="m-note">Observação interna (opcional)</label>
        <input
          id="m-note"
          className="input"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex.: Pix direto, vendido pelo Fulano, cortesia"
        />
      </div>
      <label className="checkbox span-2">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        <span>Confirmo que todas as pessoas acima têm 18 anos ou mais e que o pagamento já foi recebido (ou é cortesia).</span>
      </label>
      <div className="span-2">
        <button className="btn" disabled={busy || list.length === 0 || !adult || !priceOk}>
          {busy ? "Lançando…" : `Lançar ${list.length || ""} ingresso(s)`.replace("  ", " ")}
        </button>
        {msg && (
          <p className={msg.ok ? "hint" : "field-error"} role={msg.ok ? "status" : "alert"} style={{ marginTop: 10 }}>
            {msg.text}
          </p>
        )}
      </div>
    </form>
  );
}

export function CancelManualButton({ purchaseId, name }: { purchaseId: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        className="btn btn-danger btn-sm"
        onClick={async () => {
          if (!confirm(`Remover o ingresso manual de "${name}" da lista? A vaga é liberada.`)) return;
          const r = await post(`/api/admin/purchases/${purchaseId}/cancel`);
          if (!r.ok) setError(r.data?.error?.message ?? "Falha ao remover.");
          router.refresh();
        }}
      >
        Remover
      </button>
      {error && <span className="field-error"> {error}</span>}
    </span>
  );
}
