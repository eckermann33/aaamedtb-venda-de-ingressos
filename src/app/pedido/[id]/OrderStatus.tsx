"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconAlert,
  IconBan,
  IconCheck,
  IconCopy,
  IconExternal,
  IconHourglass,
  IconInfo,
  IconPix,
  IconRefresh,
  IconX,
} from "@/components/icons";
import { formatBRL } from "@/lib/money";
import type { PublicPurchase } from "@/server/purchases";

type Props = { initial: PublicPurchase; contactEmail: string | null; eventName: string };

const WAITING = new Set(["preparing", "awaiting_payment", "payment_rejected"]);

function useCountdown(target: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!target) return null;
  const ms = Math.max(0, new Date(target).getTime() - now);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return { ms, label: `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` };
}

export default function OrderStatus({ initial, contactEmail, eventName }: Props) {
  const [p, setP] = useState(initial);
  const [toast, setToast] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const failures = useRef(0);
  const waiting = WAITING.has(p.state);
  const countdown = useCountdown(p.pix?.expiresAt ?? (waiting ? p.expiresAt : null));

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/purchases/${p.id}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      failures.current = 0;
      setP(data.purchase);
    } catch {
      failures.current += 1;
    }
  }, [p.id]);

  // Consulta o servidor enquanto o pagamento está pendente (o estado oficial vem do banco).
  useEffect(() => {
    if (!waiting) return;
    const delay = Math.min(4000 * 2 ** Math.min(failures.current, 3), 30000);
    const t = setTimeout(refresh, delay);
    return () => clearTimeout(t);
  }, [p, waiting, refresh]);

  useEffect(() => {
    const onFocus = () => waiting && refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [waiting, refresh]);

  async function copyPix() {
    if (!p.pix) return;
    try {
      await navigator.clipboard.writeText(p.pix.qrCode);
      setToast("Código Pix copiado!");
    } catch {
      setToast("Não deu para copiar — selecione o código e copie manualmente.");
    }
    setTimeout(() => setToast(null), 2500);
  }

  async function checkNow() {
    setChecking(true);
    await refresh();
    setChecking(false);
  }

  const summary = (
    <dl className="summary" style={{ textAlign: "left", marginTop: 8 }}>
      <div>
        <dt>Nome na lista</dt>
        <dd>{p.fullName}</dd>
      </div>
      <div>
        <dt>Ingresso</dt>
        <dd>
          {p.categoryLabel} · {formatBRL(p.ticketPriceCents)}
        </dd>
      </div>
      {p.feeCents > 0 && (
        <div>
          <dt>Taxa de serviço</dt>
          <dd>{formatBRL(p.feeCents)}</dd>
        </div>
      )}
      <div className="total">
        <dt>Total</dt>
        <dd>{formatBRL(p.amountCents)}</dd>
      </div>
    </dl>
  );

  const contact = contactEmail ? (
    <>
      Fale com a organização: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
    </>
  ) : (
    <>Fale com a organização da Atlética.</>
  );

  let body: React.ReactNode;
  switch (p.state) {
    case "approved":
      body = (
        <>
          <div className="status-icon">
            <IconCheck size={44} />
          </div>
          <h1 className="status-title">Pagamento aprovado!</h1>
          <p className="status-text">
            Seu nome já está na <strong>lista oficial de entrada</strong> da {eventName}. Não precisa mostrar
            comprovante: na portaria, é só dizer seu nome e apresentar um documento oficial com foto.
          </p>
          {summary}
          <Link className="btn btn-ghost" href="/">
            Voltar para o evento
          </Link>
        </>
      );
      break;
    case "preparing":
      body = (
        <>
          <div className="status-icon wait">
            <IconHourglass size={40} />
          </div>
          <h1 className="status-title">Preparando pagamento…</h1>
          <p className="status-text">Só um instante.</p>
        </>
      );
      break;
    case "awaiting_payment":
    case "payment_rejected":
      body = (
        <>
          {p.state === "payment_rejected" && (
            <div className="notice notice-danger" role="alert" style={{ marginBottom: 18, textAlign: "left" }}>
              <IconAlert size={20} />
              <span>
                <strong>Pagamento recusado.</strong> Nenhum valor foi cobrado. Você pode tentar outro cartão abaixo
                enquanto a reserva estiver válida.
              </span>
            </div>
          )}
          <h1 className="status-title">
            <span className="live-dot" aria-hidden />
            Aguardando pagamento
          </h1>
          {p.paymentMethod === "pix" && p.pix ? (
            <div className="pix-box">
              <p className="status-text" style={{ marginBottom: 0 }}>
                Abra o app do seu banco, escolha <strong>Pix → Ler QR Code</strong> ou <strong>Pix Copia e Cola</strong>.
              </p>
              {p.pix.qrCodeBase64 && (
                <div className="qr">
                  <img src={`data:image/png;base64,${p.pix.qrCodeBase64}`} alt="QR Code do Pix" width={280} height={280} />
                </div>
              )}
              <div className="countdown" aria-live="off">
                {countdown && countdown.ms > 0 ? (
                  <>
                    Expira em <strong>{countdown.label}</strong>
                  </>
                ) : (
                  <>Prazo do Pix encerrado</>
                )}
              </div>
              <div className="pix-code" aria-label="Código Pix copia e cola">
                {p.pix.qrCode}
              </div>
              <button type="button" className="btn btn-lg btn-block" onClick={copyPix}>
                <IconCopy size={20} /> Copiar código Pix
              </button>
              <p className="hint" style={{ margin: 0 }}>
                Valor: <strong>{formatBRL(p.amountCents)}</strong>. A confirmação aparece aqui sozinha em segundos — pode
                até fechar esta página: se o pagamento for aprovado, seu nome entra na lista mesmo assim.
              </p>
            </div>
          ) : (
            <>
              <p className="status-text">
                Conclua o pagamento com cartão no ambiente seguro do Mercado Pago. Assim que for aprovado, seu nome entra
                na lista automaticamente.
              </p>
              {p.checkoutUrl && (
                <a className="btn btn-lg btn-block" href={p.checkoutUrl}>
                  <IconExternal size={20} /> Ir para o Mercado Pago
                </a>
              )}
              {countdown && countdown.ms > 0 && (
                <p className="countdown" style={{ marginTop: 14 }}>
                  Reserva válida por <strong>{countdown.label}</strong>
                </p>
              )}
            </>
          )}
          {summary}
          <button type="button" className="btn btn-ghost btn-sm" onClick={checkNow} disabled={checking}>
            <IconRefresh size={16} /> {checking ? "Verificando…" : "Já paguei — verificar agora"}
          </button>
        </>
      );
      break;
    case "rejected":
      body = (
        <>
          <div className="status-icon danger">
            <IconX size={44} />
          </div>
          <h1 className="status-title">Pagamento recusado</h1>
          <p className="status-text">
            O pagamento não foi aprovado e <strong>nenhum valor foi cobrado</strong>. Seu nome não entrou na lista.
          </p>
          <Link className="btn btn-lg" href="/comprar">
            Tentar novamente
          </Link>
        </>
      );
      break;
    case "expired":
      body = (
        <>
          <div className="status-icon warn">
            <IconHourglass size={42} />
          </div>
          <h1 className="status-title">Pagamento expirado</h1>
          <p className="status-text">
            O prazo para pagar terminou e a reserva foi liberada. Nenhum valor foi cobrado. Se quiser, faça uma nova
            compra.
          </p>
          <Link className="btn btn-lg" href="/comprar">
            Comprar novamente
          </Link>
        </>
      );
      break;
    case "cancelled":
      body = (
        <>
          <div className="status-icon warn">
            <IconBan size={42} />
          </div>
          <h1 className="status-title">Pagamento cancelado</h1>
          <p className="status-text">Este pagamento foi cancelado e seu nome não está na lista.</p>
          <Link className="btn btn-lg" href="/comprar">
            Comprar novamente
          </Link>
        </>
      );
      break;
    case "refunded":
      body = (
        <>
          <div className="status-icon warn">
            <IconRefresh size={40} />
          </div>
          <h1 className="status-title">Pagamento estornado</h1>
          <p className="status-text">
            O valor desta compra foi devolvido e o ingresso foi cancelado. Seu nome não está mais na lista. {contact}
          </p>
        </>
      );
      break;
    case "attention":
      body = (
        <>
          <div className="status-icon warn">
            <IconInfo size={42} />
          </div>
          <h1 className="status-title">Pagamento em análise</h1>
          <p className="status-text">
            Recebemos o seu pagamento, mas ele precisa de uma verificação da organização (por exemplo, os ingressos
            esgotaram enquanto você pagava). Se não for possível confirmar, o valor será estornado. {contact}
          </p>
          {summary}
        </>
      );
      break;
    case "failed":
    default:
      body = (
        <>
          <div className="status-icon danger">
            <IconAlert size={42} />
          </div>
          <h1 className="status-title">Não foi possível iniciar o pagamento</h1>
          <p className="status-text">Nenhum valor foi cobrado. Tente novamente em instantes.</p>
          <Link className="btn btn-lg" href="/comprar">
            Tentar novamente
          </Link>
        </>
      );
  }

  return (
    <section className="card status-card" aria-live="polite">
      {p.paymentMethod === "pix" && waiting && (
        <span className="label" style={{ display: "inline-flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
          <IconPix size={14} /> Pagamento via Pix
        </span>
      )}
      {body}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </section>
  );
}
