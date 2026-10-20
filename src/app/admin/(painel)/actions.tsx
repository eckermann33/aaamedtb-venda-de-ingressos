"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/admin", label: "Resumo" },
  { href: "/admin/compras", label: "Compras" },
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
