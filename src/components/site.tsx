import Link from "next/link";
import type { EventInfo } from "@/config/event";
import { contactLinks } from "@/lib/contact";

export function Satin() {
  return (
    <>
      <div className="satin" aria-hidden>
        <div className="satin-vignette" />
      </div>
      <div className="grain" aria-hidden />
    </>
  );
}

export function SiteHeader({ cta = true }: { cta?: boolean }) {
  return (
    <header className="site-header">
      <div className="container">
        <Link href="/" className="brand" aria-label="Atlética Invictus — página inicial">
          <img src="/images/invictus-badge.webp" alt="" width={40} height={40} />
          <span className="brand-name">
            INVICTUS
            <small>A.A.A.MED.TB</small>
          </span>
        </Link>
        <nav className="site-nav" aria-label="Principal">
          <Link className="nav-link" href="/#ingressos">
            Ingressos
          </Link>
          <Link className="nav-link" href="/regras">
            Regras
          </Link>
          {cta && (
            <Link className="btn btn-sm" href="/comprar">
              Comprar
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter({ event }: { event: EventInfo }) {
  return (
    <footer className="site-footer">
      <div className="container">
        <div>
          <h2>Organização</h2>
          <p style={{ margin: 0 }}>{event.organizer}</p>
          {event.partner && <p style={{ margin: "6px 0 0" }}>Em parceria com {event.partner}.</p>}
        </div>
        <div>
          <h2>Contato</h2>
          <ul>
            {contactLinks(event).map((c) => (
              <li key={c.href}>
                <a href={c.href} target={c.href.startsWith("https:") ? "_blank" : undefined} rel="noopener noreferrer">
                  {c.label}
                </a>
              </li>
            ))}
            {contactLinks(event).length === 0 && <li className="pending-value">Contato a confirmar</li>}
            {event.contactInstagram && (
              <li>
                <a
                  href={`https://instagram.com/${event.contactInstagram.replace(/^@/, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {event.contactInstagram.startsWith("@") ? event.contactInstagram : `@${event.contactInstagram}`}
                </a>
              </li>
            )}
          </ul>
        </div>
        <div>
          <h2>Informações</h2>
          <ul>
            <li>
              <Link href="/regras">Regras, reembolso e transferência</Link>
            </li>
            <li>
              <Link href="/privacidade">Política de privacidade</Link>
            </li>
            <li>Pagamentos processados pelo Mercado Pago</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}

export function PendingText({ value, fallback = "A confirmar" }: { value: string | null | undefined; fallback?: string }) {
  if (value && value.trim()) return <>{value}</>;
  return <span className="pending-value">{fallback}</span>;
}
