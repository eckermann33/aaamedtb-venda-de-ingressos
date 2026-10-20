import type { Metadata } from "next";
import { Satin, SiteFooter, SiteHeader } from "@/components/site";
import { contactLinks } from "@/lib/contact";
import { getSql } from "@/server/db";
import { loadSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Política de privacidade" };

export default async function PrivacyPage() {
  const s = await loadSettings(getSql());
  const e = s.event;
  const contacts = contactLinks(e);
  return (
    <>
      <Satin />
      <SiteHeader />
      <main id="conteudo" className="container">
        <article className="prose">
          <span className="label">LGPD — Lei nº 13.709/2018</span>
          <h1>Política de privacidade</h1>

          <h2>Quem é responsável pelos seus dados</h2>
          <p>
            O controlador dos dados é a {e.organizer}.{" "}
            {contacts.length > 0 ? (
              <>
                Contato para assuntos de privacidade:{" "}
                {contacts.map((c, i) => (
                  <span key={c.href}>
                    {i > 0 && " ou "}
                    <a href={c.href}>{c.label}</a>
                  </span>
                ))}
                .
              </>
            ) : (
              <span className="pending-value">Contato ainda não definido.</span>
            )}
          </p>

          <h2>Quais dados coletamos</h2>
          <ul>
            <li>Nome completo — para montar a lista oficial de entrada.</li>
            <li>Celular/WhatsApp — somente para avisos sobre o evento (por exemplo, cancelamento) e transferências.</li>
            <li>Categoria do ingresso, valores pagos e datas da compra.</li>
            <li>Confirmação de maioridade e registro do aceite das regras (versão, data e hora).</li>
            <li>
              Identificador e situação do pagamento informados pelo Mercado Pago. Não recebemos nem armazenamos dados de
              cartão.
            </li>
          </ul>
          <p>
            Não pedimos CPF, endereço nem data de nascimento. Os dados digitados no ambiente do Mercado Pago (como
            e-mail, CPF ou cartão) são tratados por ele e <strong>não chegam à Atlética</strong>. Para limitar
            abusos, usamos temporariamente uma versão cifrada (hash) do endereço IP, descartada em até 24 horas.
          </p>

          <h2>Para que usamos</h2>
          <ul>
            <li>Vender o ingresso e controlar a entrada no evento (execução de contrato — art. 7º, V, da LGPD).</li>
            <li>Prestação de contas e obrigações legais e contábeis (art. 7º, II).</li>
            <li>Prevenção a fraudes e segurança da plataforma (art. 7º, IX — legítimo interesse).</li>
          </ul>

          <h2>Com quem compartilhamos</h2>
          <p>
            Com o Mercado Pago, que processa os pagamentos, e com o provedor de hospedagem da plataforma. A lista de
            participantes é acessada apenas pela organização do evento e nunca é publicada.
          </p>

          <h2>Por quanto tempo guardamos</h2>
          <p>
            Os nomes dos participantes são anonimizados em até {e.retentionDays} dias após o evento. Registros financeiros
            sem identificação pessoal (valores, datas e identificadores de pagamento) podem ser mantidos pelo prazo exigido
            pela legislação contábil e fiscal.
          </p>

          <h2>Cookies</h2>
          <p>
            A área pública não usa cookies de rastreamento nem publicidade. O painel da organização usa apenas um cookie
            de sessão, necessário para o login.
          </p>

          <h2>Seus direitos</h2>
          <p>
            Você pode pedir confirmação, acesso, correção ou eliminação dos seus dados, entre outros direitos do art. 18 da
            LGPD, pelo contato acima. Pedidos de eliminação podem impedir a sua entrada se feitos antes do evento.
          </p>
        </article>
      </main>
      <SiteFooter event={e} />
    </>
  );
}
