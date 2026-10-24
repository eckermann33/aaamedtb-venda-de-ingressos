"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { TermsContent } from "@/config/event";
import { IconAlert, IconCard, IconCheck, IconExternal, IconLock, IconPix } from "@/components/icons";
import { formatPhone, phoneDigits } from "@/lib/contact";
import { formatBRL } from "@/lib/money";
import { AGE_TEXT, cleanName, validateFullName } from "@/lib/validation";

type Category = { id: string; label: string; priceCents: number };

type Props = {
  categories: Category[];
  feeCents: number;
  preselected: string | null;
  termsVersionId: number;
  terms: TermsContent;
  eventName: string;
  maxTickets: number;
};

type Extra = { key: string; name: string; categoryId: string };

/** Chave para detectar nomes repetidos no mesmo pedido (sem acento e sem maiúsculas). */
function searchKey(raw: string): string {
  return cleanName(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function remember(id: string) {
  // Conveniência: lembra os pedidos feitos neste aparelho (não é registro oficial).
  try {
    const list: string[] = JSON.parse(localStorage.getItem("invictus:pedidos") ?? "[]");
    localStorage.setItem("invictus:pedidos", JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 10)));
  } catch {
    /* armazenamento indisponível */
  }
}

export default function CheckoutForm({ categories, feeCents, preselected, termsVersionId, terms, maxTickets }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [categoryId, setCategoryId] = useState(
    categories.some((c) => c.id === preselected) ? preselected! : categories.length === 1 ? categories[0].id : "",
  );
  // Ingressos adicionais do mesmo pedido (cada um com o nome de quem vai entrar).
  const [extras, setExtras] = useState<Extra[]>([]);
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [method, setMethod] = useState<"pix" | "card">("pix");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Uma chave por tentativa: cliques repetidos não criam compras duplicadas.
  const requestId = useRef<string | null>(null);

  const category = categories.find((c) => c.id === categoryId) ?? null;
  const lines = useMemo(() => {
    const out: { name: string; category: Category | null }[] = [{ name, category }];
    for (const x of extras) out.push({ name: x.name, category: categories.find((c) => c.id === x.categoryId) ?? null });
    return out;
  }, [name, category, extras, categories]);
  const count = lines.length;
  const ticketsTotal = lines.reduce((n, l) => n + (l.category?.priceCents ?? 0), 0);
  const total = category ? ticketsTotal + feeCents * count : 0;

  const addExtra = () =>
    setExtras((list) =>
      list.length + 1 >= maxTickets
        ? list
        : [...list, { key: crypto.randomUUID(), name: "", categoryId: categoryId || (categories[0]?.id ?? "") }],
    );
  const updateExtra = (key: string, patch: Partial<Extra>) =>
    setExtras((list) => list.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const removeExtra = (key: string) => setExtras((list) => list.filter((x) => x.key !== key));

  function goToReview(ev: React.FormEvent) {
    ev.preventDefault();
    const next: Record<string, string> = {};
    const nameError = validateFullName(name);
    if (nameError) next.name = nameError;
    if (!phoneDigits(phone)) next.phone = "Informe um celular/WhatsApp com DDD, só com números.";
    if (!category) next.category = "Escolha a categoria do ingresso.";
    const seen = new Set<string>([searchKey(name)]);
    extras.forEach((x, i) => {
      const error = validateFullName(x.name);
      if (error) next[`extra${i}`] = `Ingresso ${i + 2}: ${error}`;
      else if (seen.has(searchKey(x.name))) next[`extra${i}`] = `Ingresso ${i + 2}: este nome já está no pedido.`;
      seen.add(searchKey(x.name));
    });
    if (!adult) next.adult = "É obrigatório confirmar que você tem 18 anos ou mais.";
    if (!accepted) next.accepted = "É preciso aceitar as regras e os termos para continuar.";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      const first = Object.keys(next)[0];
      document.getElementById(`f-${first}`)?.focus();
      return;
    }
    setName(cleanName(name));
    setExtras((list) => list.map((x) => ({ ...x, name: cleanName(x.name) })));
    requestId.current = crypto.randomUUID();
    setServerError(null);
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function pay(ev: React.FormEvent) {
    ev.preventDefault();
    if (submitting) return;
    setErrors({});
    setServerError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientRequestId: requestId.current,
          fullName: name,
          categoryId,
          extraTickets: extras.map((x) => ({ fullName: x.name, categoryId: x.categoryId })),
          adultConfirmed: adult,
          termsAccepted: accepted,
          termsVersionId,
          paymentMethod: method,
          buyerPhone: phone,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.purchase) {
        const code = data?.error?.code;
        setServerError(data?.error?.message ?? "Não foi possível continuar. Tente novamente.");
        // Erros definitivos desta tentativa: gera nova chave para permitir tentar de novo.
        if (code === "payment_unavailable" || code === "conflict") requestId.current = crypto.randomUUID();
        if (code === "terms_changed") setTimeout(() => window.location.reload(), 2500);
        setSubmitting(false);
        return;
      }
      const purchase = data.purchase as { id: string; checkoutUrl: string | null; state: string };
      remember(purchase.id);
      // Pix e cartão são pagos no ambiente do Mercado Pago (Checkout Pro).
      if (purchase.checkoutUrl) {
        window.location.assign(purchase.checkoutUrl);
        return;
      }
      router.push(`/pedido/${purchase.id}`);
    } catch {
      setServerError("Sem conexão com o servidor. Verifique sua internet e tente novamente.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <ol className="stepper" aria-label="Etapas da compra">
        <li aria-current={step === 1 ? "step" : undefined} className={step > 1 ? "done" : undefined}>
          1 · Seus dados
        </li>
        <li aria-current={step === 2 ? "step" : undefined}>2 · Pagamento</li>
        <li>3 · Confirmação</li>
      </ol>

      {step === 1 && (
        <form className="card" onSubmit={goToReview} noValidate>
          <div className="field">
            <label htmlFor="f-name">{extras.length > 0 ? "Seu nome completo (ingresso 1)" : "Nome completo"}</label>
            <input
              id="f-name"
              className="input"
              name="name"
              autoComplete="name"
              autoCapitalize="words"
              placeholder="Como está no seu documento"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby="h-name e-name"
            />
            <span className="hint" id="h-name">
              É por esse nome que você entra: ele vai para a lista oficial da portaria.
            </span>
            {errors.name && (
              <span className="field-error" id="e-name" role="alert">
                {errors.name}
              </span>
            )}
          </div>

          <div className="field">
            <label htmlFor="f-phone">Celular / WhatsApp</label>
            <input
              id="f-phone"
              className="input"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              placeholder="(42) 99999-9999"
              value={phone}
              maxLength={20}
              onChange={(e) => setPhone(e.target.value)}
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby="h-phone e-phone"
            />
            <span className="hint" id="h-phone">
              Usado só para avisos sobre a festa (por exemplo, se ela for cancelada).
            </span>
            {errors.phone && (
              <span className="field-error" id="e-phone" role="alert">
                {errors.phone}
              </span>
            )}
          </div>

          <fieldset className="field" aria-describedby={errors.category ? "e-category" : undefined}>
            <legend>Categoria do ingresso</legend>
            <div className="choice-grid">
              {categories.map((c, i) => (
                <label className="choice" key={c.id}>
                  <input
                    id={i === 0 ? "f-category" : undefined}
                    type="radio"
                    name="category"
                    value={c.id}
                    checked={categoryId === c.id}
                    onChange={() => setCategoryId(c.id)}
                  />
                  <span className="choice-body">
                    <span className="choice-title">{c.label}</span>
                    <span className="choice-price">{formatBRL(c.priceCents)}</span>
                    {feeCents > 0 && <span className="choice-sub">+ {formatBRL(feeCents)} de taxa</span>}
                  </span>
                  <span className="choice-check" aria-hidden>
                    <IconCheck size={14} />
                  </span>
                </label>
              ))}
            </div>
            {errors.category && (
              <span className="field-error" id="e-category" role="alert">
                {errors.category}
              </span>
            )}
          </fieldset>

          {extras.map((x, i) => (
            <div className="field extra-ticket" key={x.key}>
              <label htmlFor={`f-extra${i}`}>Nome completo do ingresso {i + 2}</label>
              <input
                id={`f-extra${i}`}
                className="input"
                autoCapitalize="words"
                placeholder="Nome de quem vai usar este ingresso"
                value={x.name}
                maxLength={120}
                onChange={(e) => updateExtra(x.key, { name: e.target.value })}
                aria-invalid={errors[`extra${i}`] ? true : undefined}
                aria-describedby={errors[`extra${i}`] ? `e-extra${i}` : undefined}
              />
              <div className="extra-row">
                <select
                  className="input"
                  aria-label={`Categoria do ingresso ${i + 2}`}
                  value={x.categoryId}
                  onChange={(e) => updateExtra(x.key, { categoryId: e.target.value })}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} · {formatBRL(c.priceCents)}
                      {feeCents > 0 ? ` + ${formatBRL(feeCents)} de taxa` : ""}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeExtra(x.key)}>
                  Remover
                </button>
              </div>
              {errors[`extra${i}`] && (
                <span className="field-error" id={`e-extra${i}`} role="alert">
                  {errors[`extra${i}`]}
                </span>
              )}
            </div>
          ))}

          {count < maxTickets ? (
            <button type="button" className="btn btn-ghost btn-block add-ticket" onClick={addExtra}>
              + Adicionar outro ingresso ao pedido
            </button>
          ) : (
            <p className="hint">Limite de {maxTickets} ingressos por pedido.</p>
          )}

          <div className="rules-box" aria-labelledby="t-rules">
            <h3 id="t-rules">Regras de entrada</h3>
            <ul>
              {terms.rules.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <details>
              <summary>Reembolso, cancelamento e transferência</summary>
              <strong>Reembolso</strong>
              <p className="policy">{terms.refundPolicy}</p>
              <strong>Cancelamento do evento</strong>
              <p className="policy">{terms.cancellationPolicy}</p>
              <strong>Transferência</strong>
              <p className="policy">{terms.transferPolicy}</p>
            </details>
          </div>

          <label className="checkbox" data-invalid={errors.adult ? true : undefined}>
            <input
              id="f-adult"
              type="checkbox"
              checked={adult}
              onChange={(e) => setAdult(e.target.checked)}
              aria-describedby={errors.adult ? "e-adult" : undefined}
            />
            <span>{AGE_TEXT}</span>
          </label>
          {errors.adult && (
            <p className="field-error" id="e-adult" role="alert" style={{ marginTop: -6 }}>
              {errors.adult}
            </p>
          )}

          <label className="checkbox" data-invalid={errors.accepted ? true : undefined}>
            <input
              id="f-accepted"
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              aria-describedby={errors.accepted ? "e-accepted" : undefined}
            />
            <span>
              Li e aceito as regras de entrada, as políticas de reembolso, cancelamento e transferência e a{" "}
              <Link href="/privacidade" target="_blank">
                Política de Privacidade
              </Link>
              .
            </span>
          </label>
          {errors.accepted && (
            <p className="field-error" id="e-accepted" role="alert" style={{ marginTop: -6 }}>
              {errors.accepted}
            </p>
          )}

          <button type="submit" className="btn btn-lg btn-block" style={{ marginTop: 8 }}>
            Continuar {category && <>· {count > 1 && <>{count} ingressos · </>}{formatBRL(total)}</>}
          </button>
        </form>
      )}

      {step === 2 && category && (
        <form className="card" onSubmit={pay} noValidate>
          <h2 className="field-label" style={{ fontSize: "1.1rem", marginBottom: 4 }}>
            Confira seu pedido
          </h2>
          <dl className="summary">
            {lines.map((l, i) => (
              <div key={i}>
                <dt>{count > 1 ? `Ingresso ${i + 1}` : "Nome na lista"}</dt>
                <dd>
                  {l.name}
                  {count > 1 && l.category && (
                    <>
                      {" "}
                      · {l.category.label} · {formatBRL(l.category.priceCents)}
                    </>
                  )}
                </dd>
              </div>
            ))}
            <div>
              <dt>Celular / WhatsApp</dt>
              <dd>{phoneDigits(phone) ? formatPhone(phoneDigits(phone)!) : phone}</dd>
            </div>
            {count === 1 && (
              <div>
                <dt>Categoria</dt>
                <dd>{category.label}</dd>
              </div>
            )}
            <div>
              <dt>{count > 1 ? `Ingressos (${count})` : "Ingresso"}</dt>
              <dd>{formatBRL(ticketsTotal)}</dd>
            </div>
            {feeCents > 0 && (
              <div>
                <dt>{count > 1 ? `Taxa de serviço (${count} × ${formatBRL(feeCents)})` : "Taxa de serviço"}</dt>
                <dd>{formatBRL(feeCents * count)}</dd>
              </div>
            )}
            <div className="total">
              <dt>Total</dt>
              <dd>{formatBRL(total)}</dd>
            </div>
          </dl>

          <div className="notice" style={{ marginBottom: 18 }}>
            <IconCheck size={20} />
            <span>
              {count > 1 ? "Cada ingresso é individual e nominal." : "Ingresso individual e nominal."} Entrada só para maiores de 18 anos, com documento oficial com foto.{" "}
              {categories.some((c) => c.id === "camarote") ? "Camarote é uma categoria própria de ingresso." : "O camarote é vendido à parte, na entrada."} Sem cobranças além do total acima.
            </span>
          </div>

          <fieldset className="field" style={{ marginBottom: 0 }}>
            <legend>Forma de pagamento</legend>
            <div className="pay-methods">
              <label className="choice">
                <input type="radio" name="method" value="pix" checked={method === "pix"} onChange={() => setMethod("pix")} />
                <span className="choice-body">
                  <span className="choice-title">
                    <IconPix size={20} /> Pix
                  </span>
                  <span className="choice-sub">Aprovação na hora, QR Code no Mercado Pago</span>
                </span>
                <span className="choice-check" aria-hidden>
                  <IconCheck size={14} />
                </span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="method"
                  value="card"
                  checked={method === "card"}
                  onChange={() => setMethod("card")}
                />
                <span className="choice-body">
                  <span className="choice-title">
                    <IconCard size={20} /> Cartão
                  </span>
                  <span className="choice-sub">Crédito, à vista, no Mercado Pago</span>
                </span>
                <span className="choice-check" aria-hidden>
                  <IconCheck size={14} />
                </span>
              </label>
            </div>
          </fieldset>

          <div className="notice" style={{ marginBottom: 18 }}>
            <IconExternal size={20} />
            <span>
              {method === "pix"
                ? "Você será levado ao ambiente seguro do Mercado Pago, onde aparece o QR Code do Pix e o código copia e cola."
                : "Você será levado ao ambiente seguro do Mercado Pago para digitar os dados do cartão. Nós não vemos nem guardamos os dados do seu cartão."}{" "}
              Depois do pagamento, você volta para cá e seu nome entra na lista.
            </span>
          </div>

          {serverError && (
            <div className="notice notice-danger" role="alert" style={{ marginBottom: 16 }}>
              <IconAlert size={20} />
              <span>{serverError}</span>
            </div>
          )}

          <button type="submit" className="btn btn-lg btn-block" disabled={submitting} aria-busy={submitting}>
            {submitting ? (
              <>
                <span className="spinner" aria-hidden /> Processando…
              </>
            ) : method === "pix" ? (
              <>Pagar {formatBRL(total)} com Pix</>
            ) : (
              <>Pagar {formatBRL(total)} com cartão</>
            )}
          </button>
          <p className="secure-note">
            <IconLock size={15} /> Pagamento processado pelo Mercado Pago
          </p>
          <div style={{ textAlign: "center" }}>
            <button type="button" className="back-link" onClick={() => setStep(1)} disabled={submitting}>
              ← Alterar meus dados
            </button>
          </div>
        </form>
      )}
    </>
  );
}
