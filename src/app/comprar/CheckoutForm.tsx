"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import type { TermsContent } from "@/config/event";
import { IconAlert, IconCard, IconCheck, IconExternal, IconLock, IconPix } from "@/components/icons";
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
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function remember(id: string) {
  // Conveniência: lembra os pedidos feitos neste aparelho (não é registro oficial).
  try {
    const list: string[] = JSON.parse(localStorage.getItem("invictus:pedidos") ?? "[]");
    localStorage.setItem("invictus:pedidos", JSON.stringify([id, ...list.filter((x) => x !== id)].slice(0, 10)));
  } catch {
    /* armazenamento indisponível */
  }
}

export default function CheckoutForm({ categories, feeCents, preselected, termsVersionId, terms }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState(
    categories.some((c) => c.id === preselected) ? preselected! : categories.length === 1 ? categories[0].id : "",
  );
  const [adult, setAdult] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [method, setMethod] = useState<"pix" | "card">("pix");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  // Uma chave por tentativa: cliques repetidos não criam compras duplicadas.
  const requestId = useRef<string | null>(null);

  const category = categories.find((c) => c.id === categoryId) ?? null;
  const total = useMemo(() => (category ? category.priceCents + feeCents : 0), [category, feeCents]);

  function goToReview(ev: React.FormEvent) {
    ev.preventDefault();
    const next: Record<string, string> = {};
    const nameError = validateFullName(name);
    if (nameError) next.name = nameError;
    if (!category) next.category = "Escolha a categoria do ingresso.";
    if (!adult) next.adult = "É obrigatório confirmar que você tem 18 anos ou mais.";
    if (!accepted) next.accepted = "É preciso aceitar as regras e os termos para continuar.";
    setErrors(next);
    if (Object.keys(next).length > 0) {
      const first = Object.keys(next)[0];
      document.getElementById(`f-${first}`)?.focus();
      return;
    }
    setName(cleanName(name));
    requestId.current = crypto.randomUUID();
    setServerError(null);
    setStep(2);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function pay(ev: React.FormEvent) {
    ev.preventDefault();
    if (submitting) return;
    if (method === "pix" && !EMAIL.test(email.trim())) {
      setErrors({ email: "Informe um e-mail válido." });
      document.getElementById("f-email")?.focus();
      return;
    }
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
          adultConfirmed: adult,
          termsAccepted: accepted,
          termsVersionId,
          paymentMethod: method,
          payerEmail: method === "pix" ? email.trim() : undefined,
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
      if (method === "card" && purchase.checkoutUrl) {
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
            <label htmlFor="f-name">Nome completo</label>
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
            Continuar {category && <>· {formatBRL(total)}</>}
          </button>
        </form>
      )}

      {step === 2 && category && (
        <form className="card" onSubmit={pay} noValidate>
          <h2 className="field-label" style={{ fontSize: "1.1rem", marginBottom: 4 }}>
            Confira seu pedido
          </h2>
          <dl className="summary">
            <div>
              <dt>Nome na lista</dt>
              <dd>{name}</dd>
            </div>
            <div>
              <dt>Categoria</dt>
              <dd>{category.label}</dd>
            </div>
            <div>
              <dt>Ingresso</dt>
              <dd>{formatBRL(category.priceCents)}</dd>
            </div>
            {feeCents > 0 && (
              <div>
                <dt>Taxa de serviço</dt>
                <dd>{formatBRL(feeCents)}</dd>
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
              Ingresso individual e nominal. Entrada só para maiores de 18 anos, com documento oficial com foto. O
              camarote é vendido à parte, na entrada. Sem cobranças além do total acima.
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
                  <span className="choice-sub">Aprovação na hora, QR Code aqui no site</span>
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

          {method === "pix" ? (
            <div className="field">
              <label htmlFor="f-email">E-mail para o Pix</label>
              <input
                id="f-email"
                className="input"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="voce@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={errors.email ? true : undefined}
                aria-describedby="h-email"
              />
              <span className="hint" id="h-email">
                Exigido pelo Mercado Pago para gerar o Pix. É enviado só para eles — a Atlética não guarda seu e-mail.
              </span>
              {errors.email && (
                <span className="field-error" role="alert">
                  {errors.email}
                </span>
              )}
            </div>
          ) : (
            <div className="notice" style={{ marginBottom: 18 }}>
              <IconExternal size={20} />
              <span>
                Você será levado ao <strong>ambiente seguro do Mercado Pago</strong> para digitar os dados do cartão. Nós
                não vemos nem guardamos os dados do seu cartão. Depois do pagamento, você volta para cá automaticamente.
              </span>
            </div>
          )}

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
              <>Gerar Pix de {formatBRL(total)}</>
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
