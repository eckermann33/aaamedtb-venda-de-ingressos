import type { Metadata } from "next";
import { Satin, SiteFooter, SiteHeader } from "@/components/site";
import { formatDateTime } from "@/lib/dates";
import { AGE_TEXT } from "@/lib/validation";
import { getSql } from "@/server/db";
import { loadSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Regras e políticas" };

function Policy({ text }: { text: string | null }) {
  return text ? <p className="policy" style={{ color: "var(--text)" }}>{text}</p> : <p className="pending-value">Ainda não definida pela organização.</p>;
}

export default async function RulesPage() {
  const sql = getSql();
  const s = await loadSettings(sql);
  const [version] = await sql<{ created_at: Date }[]>`SELECT created_at FROM terms_versions WHERE id = ${s.termsVersionId}`;
  return (
    <>
      <Satin />
      <SiteHeader />
      <main id="conteudo" className="container">
        <article className="prose">
          <span className="label">{s.event.name}</span>
          <h1>Regras e políticas</h1>
          <p className="muted">
            Versão {s.termsVersionId} · atualizada em {formatDateTime(version?.created_at)}. Ao comprar, você aceita a
            versão vigente no momento da compra (registramos a versão e a data/hora do aceite).
          </p>

          <h2>Regras de entrada</h2>
          <ul>
            {s.terms.rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>

          <h2>Maioridade</h2>
          <p>Na compra, o participante declara: “{AGE_TEXT}”</p>

          <h2>Ingresso nominal e lista de entrada</h2>
          <p>
            Cada compra corresponde a um ingresso individual, em nome da pessoa informada. Não enviamos ingresso por
            e-mail, SMS ou WhatsApp: a entrada é feita pela lista oficial, que inclui somente compras com pagamento
            aprovado.
          </p>

          <h2>Valores e taxa de serviço</h2>
          <p>
            O preço de cada categoria e a taxa de serviço são exibidos separadamente antes do pagamento. O comprador
            paga exatamente o total exibido, em parcela única no cartão de crédito ou via Pix.
          </p>

          <h2>Camarote</h2>
          <p>{s.event.camarote}</p>

          <h2>Política de reembolso</h2>
          <Policy text={s.terms.refundPolicy} />

          <h2>Cancelamento do evento</h2>
          <Policy text={s.terms.cancellationPolicy} />

          <h2>Transferência de ingresso</h2>
          <Policy text={s.terms.transferPolicy} />

          <h2>Contato</h2>
          <p>
            {s.event.organizer}
            {s.event.contactEmail && (
              <>
                {" "}
                — <a href={`mailto:${s.event.contactEmail}`}>{s.event.contactEmail}</a>
              </>
            )}
          </p>
        </article>
      </main>
      <SiteFooter event={s.event} />
    </>
  );
}
