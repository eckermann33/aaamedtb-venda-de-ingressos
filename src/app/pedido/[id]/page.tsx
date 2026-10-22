import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { contactLinks } from "@/lib/contact";
import { Satin, SiteFooter, SiteHeader } from "@/components/site";
import { getSql } from "@/server/db";
import { getMercadoPago } from "@/server/mercadopago";
import { getOrder, isUuid, reconcilePurchase, toPublic } from "@/server/purchases";
import { loadSettings } from "@/server/settings";
import OrderStatus from "./OrderStatus";

export const metadata: Metadata = { title: "Seu pedido", robots: { index: false, follow: false } };

export default async function OrderPage(props: PageProps<"/pedido/[id]">) {
  const { id } = await props.params;
  if (!isUuid(id)) notFound();
  const sql = getSql();
  let order = await getOrder(sql, id);
  if (!order) notFound();

  // Ao voltar do Mercado Pago, confere o pagamento direto na API (nunca confia nos parâmetros da URL).
  if (order.lead.status === "pending") {
    const query = await props.searchParams;
    const hint = typeof query.payment_id === "string" ? query.payment_id : undefined;
    await reconcilePurchase(sql, getMercadoPago(), id, { hintPaymentId: hint, minIntervalSeconds: 3 });
    order = (await getOrder(sql, id))!;
  }
  const settings = await loadSettings(sql);

  return (
    <>
      <Satin />
      <SiteHeader cta={false} />
      <main id="conteudo" className="container">
        <div className="checkout">
          <ol className="stepper" aria-label="Etapas da compra">
            <li className="done">1 · Seus dados</li>
            <li className="done">2 · Pagamento</li>
            <li aria-current="step">3 · Confirmação</li>
          </ol>
          <OrderStatus initial={toPublic(order.lead, order.tickets)} contacts={contactLinks(settings.event)} eventName={settings.event.name} />
        </div>
      </main>
      <SiteFooter event={settings.event} />
    </>
  );
}
