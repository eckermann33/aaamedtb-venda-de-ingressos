"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/admin", label: "Resumo" },
  { href: "/admin/compras", label: "Compras" },
  { href: "/admin/manual", label: "Ingresso manual" },
  { href: "/admin/atletica", label: "Atlética" },
  { href: "/admin/lista", label: "Lista de entrada" },
  { href: "/admin/portaria", label: "Portaria" },
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
            setError(
              `${r.data?.error?.message ?? "Erro."}${pending.length ? " Falta: " + pending.join(", ") + "." : ""}`,
            );
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

export function RefundButton({
  purchaseId,
  mpPaymentId,
  label,
}: {
  purchaseId: string;
  mpPaymentId: string;
  label: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        className="btn btn-danger btn-sm"
        disabled={busy}
        onClick={async () => {
          if (
            !confirm(
              `Estornar o pagamento ${mpPaymentId} (${label})? O dinheiro volta para o comprador e o ingresso sai da lista.`,
            )
          )
            return;
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
        setMsg(
          r.ok
            ? { ok: true, text: "Nome atualizado na lista oficial." }
            : { ok: false, text: r.data?.error?.message ?? "Erro." },
        );
        if (r.ok) {
          setName("");
          router.refresh();
        }
      }}
    >
      <div className="field" style={{ flex: "2 1 240px" }}>
        <label htmlFor="novo-nome">Nome completo da nova pessoa</label>
        <input
          id="novo-nome"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
        />
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
          setMsg(r.ok ? `${r.data.count} compra(s) anonimizada(s).` : (r.data?.error?.message ?? "Erro."));
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
  const [athletic, setAthletic] = useState(false);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const list = names
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
  const cents = Math.round(Number(price.replace(/\./g, "").replace(",", ".").trim()) * 100);
  const priceOk = Number.isFinite(cents) && cents >= 0;

  return (
    <form
      className="form-grid"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!priceOk) return setMsg({ ok: false, text: "Valor inválido." });
        const total = reais(cents * list.length);
        if (
          !confirm(
            `Lançar ${list.length} ingresso(s) manual(is), ${reais(cents)} cada (total R$ ${total})? Eles entram na lista oficial agora.`,
          )
        )
          return;
        setBusy(true);
        setMsg(null);
        const r = await post("/api/admin/manual", {
          names: list,
          categoryId,
          priceCents: cents,
          phone: phone.trim() ? phone : null,
          note: note.trim() ? note : null,
          athletic,
          adultConfirmed: adult,
        });
        setBusy(false);
        if (!r.ok) return setMsg({ ok: false, text: r.data?.error?.message ?? "Erro ao lançar." });
        setMsg({ ok: true, text: `${r.data.count} ingresso(s) lançado(s) e já na lista oficial.` });
        setNames("");
        setNote("");
        setPhone("");
        setAdult(false);
        setAthletic(false);
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
        <input
          id="m-price"
          className="input"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <span className="hint">
          Já vem com o preço da categoria. Coloque 0 para cortesia/convidado. Sem taxa de serviço.
        </span>
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
        <input
          id="m-phone"
          className="input"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(42) 99999-9999"
        />
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
        <input type="checkbox" checked={athletic} onChange={(e) => setAthletic(e.target.checked)} />
        <span>
          <strong>Atlética</strong> (diretoria): aparece na seção separada da lista de entrada
        </span>
      </label>
      <label className="checkbox span-2">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        <span>
          Confirmo que todas as pessoas acima têm 18 anos ou mais e que o pagamento já foi recebido (ou é cortesia).
        </span>
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

/** Adiciona (ou desfaz) o camarote de um ingresso já confirmado, sem a pessoa precisar fazer nada. */
export function CamaroteForm({
  purchaseId,
  hasCamarote,
  addedByPanel,
  extraCents,
  defaultPriceCents,
}: {
  purchaseId: string;
  hasCamarote: boolean;
  addedByPanel: boolean;
  extraCents: number | null;
  defaultPriceCents: number;
}) {
  const router = useRouter();
  const [price, setPrice] = useState(reais(defaultPriceCents));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cents = Math.round(Number(price.replace(/\./g, "").replace(",", ".").trim()) * 100);

  async function send(body: unknown, okText: string) {
    setBusy(true);
    setMsg(null);
    const r = await post(`/api/admin/purchases/${purchaseId}/camarote`, body);
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.data?.error?.message ?? "Erro." });
    setMsg({ ok: true, text: okText });
    router.refresh();
  }

  if (hasCamarote) {
    return (
      <div>
        <p className="hint">
          Este ingresso <strong>já tem camarote</strong>
          {addedByPanel && extraCents !== null
            ? ` (adicionado pelo painel por R$ ${reais(extraCents)})`
            : " (comprado no site)"}
          .
        </p>
        {addedByPanel && (
          <button
            className="btn btn-danger btn-sm"
            disabled={busy}
            onClick={() => {
              if (confirm("Remover o camarote deste ingresso?")) send({ action: "remove" }, "Camarote removido.");
            }}
          >
            Remover camarote
          </button>
        )}
        {msg && <p className={msg.ok ? "hint" : "field-error"}>{msg.text}</p>}
      </div>
    );
  }
  return (
    <form
      className="toolbar"
      onSubmit={(e) => {
        e.preventDefault();
        if (!Number.isFinite(cents) || cents < 0) return setMsg({ ok: false, text: "Valor inválido." });
        if (!confirm(`Adicionar camarote a este ingresso (R$ ${reais(cents)} recebidos por fora)?`)) return;
        send({ action: "add", priceCents: cents }, "Camarote adicionado. Já aparece na lista de entrada.");
      }}
    >
      <div className="field">
        <label htmlFor="camarote-valor">Valor do camarote recebido (R$)</label>
        <input
          id="camarote-valor"
          className="input"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <span className="hint">Use 0 se for cortesia. Não mexe no valor cobrado no Mercado Pago.</span>
      </div>
      <button className="btn btn-sm" style={{ minHeight: 46 }} disabled={busy}>
        {busy ? "Salvando…" : "Adicionar camarote"}
      </button>
      {msg && <p className={msg.ok ? "hint" : "field-error"}>{msg.text}</p>}
    </form>
  );
}

/** Marca o ingresso como da diretoria da Atlética (seção separada na lista de entrada). */
export function AthleticToggle({ purchaseId, athletic }: { purchaseId: string; athletic: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <p className="hint">
        {athletic
          ? "Este ingresso está na seção Atlética (diretoria) da lista de entrada."
          : "Marque se for cortesia da diretoria: o nome vai para a seção Atlética, separada da lista geral."}
      </p>
      <button
        className={athletic ? "btn btn-ghost btn-sm" : "btn btn-sm"}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await post(`/api/admin/purchases/${purchaseId}/atletica`, { athletic: !athletic });
          setBusy(false);
          if (!r.ok) setError(r.data?.error?.message ?? "Erro.");
          router.refresh();
        }}
      >
        {athletic ? "Tirar da Atlética" : "Marcar como Atlética"}
      </button>
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

/** Cola os nomes da diretoria da Atlética: entram direto na seção Atlética da lista. */
export function AthleticForm() {
  const router = useRouter();
  const [names, setNames] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const list = names
    .split("\n")
    .map((n) => n.trim())
    .filter(Boolean);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        const r = await post("/api/admin/atletica", { names: list, adultConfirmed: adult });
        setBusy(false);
        if (!r.ok) return setMsg({ ok: false, text: r.data?.error?.message ?? "Erro." });
        setMsg({ ok: true, text: `${r.data.count} nome(s) adicionado(s) à seção Atlética.` });
        setNames("");
        setAdult(false);
        router.refresh();
      }}
    >
      <div className="field">
        <label htmlFor="a-names">Nome completo de cada pessoa (um por linha)</label>
        <textarea
          id="a-names"
          className="input"
          style={{ minHeight: 150 }}
          value={names}
          onChange={(e) => setNames(e.target.value)}
          placeholder={"Fulano de Tal\nBeltrana Souza Lima"}
        />
        <span className="hint">{list.length} nome(s). Cada um precisa de nome e sobrenome.</span>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
        <span>Confirmo que todas as pessoas acima têm 18 anos ou mais.</span>
      </label>
      <button className="btn" disabled={busy || list.length === 0 || !adult}>
        {busy ? "Adicionando…" : `Adicionar ${list.length || ""} à Atlética`.replace("  ", " ")}
      </button>
      {msg && (
        <p className={msg.ok ? "hint" : "field-error"} role={msg.ok ? "status" : "alert"} style={{ marginTop: 10 }}>
          {msg.text}
        </p>
      )}
    </form>
  );
}

const DOOR_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Código aleatório fácil de ditar para a equipe da portaria (ex.: K7M2-Q9XA). */
function randomDoorCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (b) => DOOR_CODE_ALPHABET[b % DOOR_CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** Interruptor entre a lista impressa e o QR Code na portaria, com o código de acesso do leitor. */
export function EntryModeForm({ mode, doorCodeSet }: { mode: "list" | "qrcode"; doorCodeSet: boolean }) {
  const router = useRouter();
  const [choice, setChoice] = useState(mode);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const needsCode = choice === "qrcode" && !doorCodeSet;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          choice === "list" &&
          mode === "qrcode" &&
          !confirm("Voltar para a lista impressa? O leitor da portaria é desligado e quem estiver usando sai.")
        )
          return;
        setBusy(true);
        setMsg(null);
        const r = await post("/api/admin/entry", { mode: choice, doorCode: code.trim() ? code : null });
        setBusy(false);
        if (!r.ok) return setMsg({ ok: false, text: r.data?.error?.message ?? "Erro ao salvar." });
        setMsg({
          ok: true,
          text: code.trim()
            ? `Salvo. Anote o código da portaria agora (ele não aparece de novo): ${code.trim()}`
            : "Salvo.",
        });
        setCode("");
        router.refresh();
      }}
    >
      <fieldset className="field">
        <legend className="sr-only">Modelo de entrada</legend>
        <div style={{ display: "grid", gap: 10 }}>
          <label className="checkbox">
            <input type="radio" name="entry-mode" checked={choice === "list"} onChange={() => setChoice("list")} />
            <span>
              <strong>Lista impressa</strong> (modelo da festa anterior): o nome entra na lista oficial e a portaria
              confere o nome no papel. Não gera QR Code.
            </span>
          </label>
          <label className="checkbox">
            <input type="radio" name="entry-mode" checked={choice === "qrcode"} onChange={() => setChoice("qrcode")} />
            <span>
              <strong>QR Code na portaria</strong>: cada ingresso aprovado ganha um QR Code na tela de confirmação. A
              equipe da entrada lê o QR pelo celular, confere o nome no documento e confirma. Cada QR vale uma entrada.
            </span>
          </label>
        </div>
      </fieldset>

      {choice === "qrcode" && (
        <div className="field">
          <label htmlFor="door-code-new">
            {doorCodeSet ? "Trocar o código da portaria (opcional)" : "Código de acesso da portaria"}
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              id="door-code-new"
              className="input"
              style={{ flex: "1 1 200px" }}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="off"
              maxLength={64}
              placeholder={doorCodeSet ? "Deixe em branco para manter o atual" : "Mínimo 6 caracteres"}
            />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCode(randomDoorCode())}>
              Gerar código
            </button>
          </div>
          <span className="hint">
            É o que a equipe da entrada digita para abrir o leitor (não dá acesso ao painel). Trocar o código desconecta
            quem estiver usando o leitor. {doorCodeSet && "Já existe um código definido."}
          </span>
        </div>
      )}

      <button
        className="btn"
        disabled={busy || (needsCode && code.trim().length < 6) || (choice === mode && !code.trim())}
      >
        {busy ? "Salvando…" : "Salvar"}
      </button>
      {msg && (
        <p className={msg.ok ? "hint" : "field-error"} role={msg.ok ? "status" : "alert"} style={{ marginTop: 10 }}>
          {msg.text}
        </p>
      )}
    </form>
  );
}

/** Desfaz uma entrada confirmada por engano no leitor. */
export function UndoCheckInButton({ purchaseId, name }: { purchaseId: string; name: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button
        className="btn btn-ghost btn-sm"
        onClick={async () => {
          if (!confirm(`Desfazer a entrada de "${name}"? O QR Code volta a valer para entrar.`)) return;
          const r = await post(`/api/admin/purchases/${purchaseId}/checkin`);
          if (!r.ok) setError(r.data?.error?.message ?? "Erro.");
          router.refresh();
        }}
      >
        Desfazer entrada
      </button>
      {error && <span className="field-error"> {error}</span>}
    </span>
  );
}

/** Link do ingresso com QR Code, para enviar a quem vai usar (ex.: ingresso manual ou da Atlética). */
export function TicketLinkBox({ url, phone, name }: { url: string; phone: string | null; name: string }) {
  const [copied, setCopied] = useState(false);
  const text = `Oi! Seu ingresso (${name}) está aqui. Na portaria, mostre o QR Code e um documento com foto: ${url}`;
  return (
    <div>
      <p style={{ wordBreak: "break-all" }}>
        <a href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copiado!" : "Copiar link"}
        </button>
        {phone && (
          <a
            className="btn btn-sm"
            href={`https://wa.me/55${phone}?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Enviar pelo WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}
