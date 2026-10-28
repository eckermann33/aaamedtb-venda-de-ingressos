import type { Metadata } from "next";
import Link from "next/link";
import { Satin, SiteFooter, SiteHeader } from "@/components/site";
import { getSql } from "@/server/db";
import { getPublicSettings } from "@/server/public";
import { MAX_TICKETS_PER_ORDER } from "@/config/event";
import CheckoutForm from "./CheckoutForm";

export const metadata: Metadata = { title: "Comprar ingresso" };

export default async function BuyPage(props: PageProps<"/comprar">) {
  const s = await getPublicSettings(getSql());
  const query = await props.searchParams;
  const preselected = typeof query.categoria === "string" ? query.categoria : null;

  return (
    <>
      <Satin />
      <SiteHeader cta={false} />
      <main id="conteudo" className="container">
        <div className="checkout">
          <div className="checkout-head">
            <span className="label">Ingresso oficial</span>
            <h1 style={{ margin: "6px 0 0" }}>
              <span className="title-party distressed">Party do </span>
              <span className="title-brush">Saco Cheio</span>
            </h1>
          </div>
          {s.canBuy ? (
            <CheckoutForm
              categories={s.categories.map((c) => ({ id: c.id, label: c.label, priceCents: c.priceCents }))}
              feeCents={s.serviceFeeCents}
              preselected={preselected}
              termsVersionId={s.termsVersionId}
              terms={s.terms}
              eventName={s.event.name}
              maxTickets={MAX_TICKETS_PER_ORDER}
              entryMode={s.entryMode}
            />
          ) : (
            <div className="card status-card">
              <h2 className="status-title">{s.soldOut ? "Ingressos esgotados" : "Vendas fechadas"}</h2>
              <p className="status-text">
                {s.soldOut
                  ? "Todos os ingressos foram vendidos ou estão reservados no momento. Reservas não pagas expiram em até 35 minutos — tente de novo mais tarde."
                  : "As vendas online ainda não estão abertas. Fique de olho no Instagram da Atlética!"}
              </p>
              <Link className="btn btn-ghost" href="/">
                Voltar para o evento
              </Link>
            </div>
          )}
        </div>
      </main>
      <SiteFooter event={s.event} />
    </>
  );
}
