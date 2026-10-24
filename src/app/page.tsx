import Link from "next/link";
import { Crown, IconBan, IconCalendar, IconCheck, IconClock, IconId, IconInfo, IconPin } from "@/components/icons";
import { PendingText, Satin, SiteFooter, SiteHeader } from "@/components/site";
import { eventDateParts } from "@/lib/dates";
import { formatBRL } from "@/lib/money";
import { getSql } from "@/server/db";
import { getPublicSettings } from "@/server/public";

function SalesStatus({ salesOpen, soldOut }: { salesOpen: boolean; soldOut: boolean }) {
  if (soldOut) return <>Ingressos esgotados</>;
  if (!salesOpen) return <>Vendas em breve</>;
  return <>Vendas indisponíveis no momento</>;
}

export default async function EventPage() {
  const s = await getPublicSettings(getSql());
  const e = s.event;
  const date = eventDateParts(e.date);
  const fee = s.serviceFeeCents;
  // Camarote vendido pelo site quando existe uma categoria ativa "camarote" (criada no painel).
  const camaroteCategory = s.categories.find((c) => c.id === "camarote") ?? null;
  const camaroteOnline = camaroteCategory !== null;
  const time = e.startTime ? (e.endTime ? `${e.startTime} às ${e.endTime}` : `A partir das ${e.startTime}`) : null;

  return (
    <>
      <Satin />
      <SiteHeader cta={s.canBuy} />
      <main id="conteudo" className={s.canBuy ? "has-mobile-buy" : undefined}>
        {/* HERO ----------------------------------------------------------- */}
        <section className="hero">
          <div className="container hero-grid">
            <div className="hero-copy">
              <img
                className="hero-badge"
                src="/images/invictus-badge.webp"
                alt="Mascote da Atlética Invictus: o Puma com estetoscópio e o bastão de Asclépio"
                width={250}
                height={251}
              />
              <div className="hero-top">
                {date && (
                  <span className="date-stamp" aria-hidden>
                    <span className="day">{date.day}</span>
                    <span className="month">{date.monthShort}</span>
                  </span>
                )}
              </div>
              <h1>
                <span className="title-wrap">
                  <span className="title-party distressed">Party do</span>
                  <Crown className="crown" />
                </span>
                <span className="title-brush">Saco Cheio</span>
              </h1>
              <span className="brush-underline" aria-hidden />
              <p className="hand">{e.tagline}</p>

              <div className="hero-cta">
                {s.canBuy ? (
                  <>
                    <Link href="/comprar" className="btn btn-lg">
                      Garantir meu ingresso
                    </Link>
                    {s.minPriceCents !== null && (
                      <span className="price-hint">
                        A partir de <strong>{formatBRL(s.minPriceCents)}</strong>
                        {fee > 0 && <> + {formatBRL(fee)} de taxa</>} · Pix ou cartão
                      </span>
                    )}
                  </>
                ) : (
                  <span className="btn btn-lg" aria-disabled="true">
                    <SalesStatus salesOpen={s.salesOpen} soldOut={s.soldOut} />
                  </span>
                )}
              </div>

              <div className="partners">
                <span className="label label-line">Em parceria com</span>
                <div className="partners-row">
                  {e.partner && (
                    <>
                      <span className="script">{e.partner}</span>
                      <span className="x" aria-label="e">
                        ×
                      </span>
                    </>
                  )}
                  <span>Invictus</span>
                </div>
              </div>
            </div>

            <div className="hero-poster">
              <div className="poster-frame">
                <img
                  src="/images/cartaz-party-do-saco-cheio.webp"
                  alt={`Cartaz oficial da ${e.name}`}
                  width={901}
                  height={1600}
                />
              </div>
            </div>
          </div>

          <div className="container">
            <dl className="facts">
              <div className="fact">
                <dt className="label">
                  <IconCalendar size={14} /> Data
                </dt>
                <dd style={{ margin: 0 }}>
                  <div className="value">{date ? date.short : <PendingText value={null} />}</div>
                  {date && <div className="sub">{date.weekday}</div>}
                </dd>
              </div>
              <div className="fact">
                <dt className="label">
                  <IconClock size={14} /> Horário
                </dt>
                <dd style={{ margin: 0 }}>
                  <div className="value">
                    <PendingText value={time} />
                  </div>
                </dd>
              </div>
              <div className="fact">
                <dt className="label">
                  <IconPin size={14} /> Local
                </dt>
                <dd style={{ margin: 0 }}>
                  <div className="value">
                    <PendingText value={e.venueName} />
                  </div>
                  {e.venueAddress && <div className="sub">{e.venueAddress}</div>}
                </dd>
              </div>
              <div className="fact">
                <dt className="label">
                  <IconId size={14} /> Classificação
                </dt>
                <dd style={{ margin: 0 }}>
                  <div className="value">18+</div>
                  <div className="sub">Documento com foto</div>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {/* INGRESSOS ------------------------------------------------------ */}
        <section className="section" id="ingressos" aria-labelledby="t-ingressos">
          <div className="container">
            <span className="label">Lote atual</span>
            <h2 className="section-title" id="t-ingressos">
              Ingressos <em>online</em>
            </h2>
            <div className="tickets">
              {s.categories
                .filter((c) => c.id !== "camarote")
                .map((c) => (
                <article className="ticket" key={c.id}>
                  <div className="ticket-main">
                    <span className="label">
                      Pista · {e.name}
                    </span>
                    <h3 className="ticket-name">{c.label}</h3>
                    <div className="ticket-price">
                      <small>R$</small>
                      {(c.priceCents / 100).toFixed(2).replace(".", ",")}
                    </div>
                    {fee > 0 && (
                      <p className="ticket-fee">
                        + <strong>{formatBRL(fee)}</strong> de taxa de serviço · total{" "}
                        <strong>{formatBRL(c.priceCents + fee)}</strong>
                      </p>
                    )}
                  </div>
                  <div className="ticket-stub">
                    {s.canBuy ? (
                      <Link className="btn" href={`/comprar?categoria=${c.id}`} aria-label={`Comprar ingresso ${c.label}`}>
                        Comprar
                      </Link>
                    ) : (
                      <span className="btn" aria-disabled="true">
                        {s.soldOut ? "Esgotado" : "Em breve"}
                      </span>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <div className="notice" style={{ marginTop: 18 }}>
              <IconInfo size={20} />
              <span>
                O ingresso é <strong>individual e nominal</strong>: não enviamos ingresso por e-mail nem por WhatsApp.
                Depois que o pagamento é aprovado, <strong>seu nome completo entra na lista oficial da portaria</strong>.
                Leve um documento oficial com foto.
              </span>
            </div>
          </div>
        </section>

        {/* COMO FUNCIONA -------------------------------------------------- */}
        <section className="section" aria-labelledby="t-como">
          <div className="container">
            <span className="label">Sem complicação</span>
            <h2 className="section-title" id="t-como">
              Como <em>funciona</em>
            </h2>
            <ol className="steps">
              <li>
                <strong>Preencha seu nome</strong>
                <span>Igual ao do seu documento — é por ele que você entra.</span>
              </li>
              <li>
                <strong>Escolha a categoria</strong>
                <span>Feminino ou masculino. O valor aparece antes de pagar.</span>
              </li>
              <li>
                <strong>Pague com Pix ou cartão</strong>
                <span>Pagamento seguro pelo Mercado Pago.</span>
              </li>
              <li>
                <strong>Seu nome na lista</strong>
                <span>Pagamento aprovado = nome na lista oficial da portaria.</span>
              </li>
            </ol>
          </div>
        </section>

        {/* REGRAS + CAMAROTE ---------------------------------------------- */}
        <section className="section" id="regras" aria-labelledby="t-regras">
          <div className="container">
            <span className="label">Leia antes de comprar</span>
            <h2 className="section-title" id="t-regras">
              Regras de <em>entrada</em>
            </h2>
            <div className="grid-2">
              <div className="card">
                <ul className="rules">
                  {s.terms.rules.map((r) => (
                    <li key={r}>
                      {/proib|não será permitid|descumpr/i.test(r) ? <IconBan size={18} /> : <IconCheck size={18} />}
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
                <p style={{ margin: "16px 0 0" }}>
                  <Link href="/regras">Ver regras completas, reembolso, cancelamento e transferência →</Link>
                </p>
              </div>
              <div className="card camarote">
                <Crown className="crown-bg" />
                <span className="label">Área VIP</span>
                <h3 className="section-title" style={{ fontSize: "1.8rem" }}>
                  Camarote
                </h3>
                <p>{e.camarote}</p>
                <div className="notice notice-warn">
                  <IconInfo size={20} />
                  <span>
                    {camaroteOnline
                      ? `O camarote é um adicional de ${formatBRL(camaroteCategory.priceCents)}: marque a opção na compra do seu ingresso. Quem já comprou pode comprar só o camarote, na mesma página.`
                      : "O camarote não é vendido pelo site nesta edição."}
                  </span>
                </div>
                <hr style={{ border: 0, borderTop: "1px solid var(--line)", margin: "22px 0" }} />
                <span className="label">Classificação etária</span>
                <p style={{ marginBottom: 0 }}>
                  <strong style={{ color: "var(--cream)" }}>{e.ageRating}</strong> Poderá ser exigido documento oficial
                  com foto na entrada.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SOBRE + CARTAZ ------------------------------------------------- */}
        <section className="section" aria-labelledby="t-sobre">
          <div className="container mascot-strip">
            <img
              src="/images/invictus-puma.webp"
              alt="Puma, mascote da Invictus, segurando o bastão de Asclépio"
              width={360}
              height={347}
              loading="lazy"
            />
            <div>
              <span className="label">A.A.A.MED.TB</span>
              <h2 className="section-title" id="t-sobre">
                A festa da <em>Invictus</em>
              </h2>
              <p style={{ fontSize: "1.08rem" }}>{e.about}</p>
              {s.canBuy && (
                <Link href="/comprar" className="btn" style={{ marginTop: 8 }}>
                  Quero meu ingresso
                </Link>
              )}
            </div>
          </div>
          <div className="container" style={{ marginTop: 40 }}>
            <details className="card poster-mobile">
              <summary style={{ cursor: "pointer", fontWeight: 700, color: "var(--neon)" }}>Ver cartaz oficial</summary>
              <img
                src="/images/cartaz-party-do-saco-cheio.webp"
                alt={`Cartaz oficial da ${e.name}`}
                width={901}
                height={1600}
                loading="lazy"
                style={{ marginTop: 14, borderRadius: 12 }}
              />
            </details>
          </div>
        </section>
      </main>

      <SiteFooter event={e} />

      {s.canBuy && s.minPriceCents !== null && (
        <div className="mobile-buy">
          <span className="mb-price">
            a partir de
            <strong>{formatBRL(s.minPriceCents)}</strong>
            {fee > 0 && <>+ {formatBRL(fee)} taxa</>}
          </span>
          <Link href="/comprar" className="btn">
            Comprar ingresso
          </Link>
        </div>
      )}
    </>
  );
}
