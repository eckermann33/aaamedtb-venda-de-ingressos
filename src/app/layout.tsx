import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Bowlby_One, Kalam, Knewave } from "next/font/google";
import { headers } from "next/headers";
import type { EventInfo } from "@/config/event";
import { posterOf } from "@/lib/event-display";
import { getSql } from "@/server/db";
import { env } from "@/server/env";
import "./globals.css";

const body = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const label = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-label" });
const display = Bowlby_One({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const brush = Knewave({ subsets: ["latin"], weight: "400", variable: "--font-brush" });
const hand = Kalam({ subsets: ["latin"], weight: "700", variable: "--font-hand" });

/** Título e prévia de link (WhatsApp/Instagram) com o nome e o cartaz da festa atual. */
export async function generateMetadata(): Promise<Metadata> {
  let name = "Ingressos";
  let poster: string | null = null;
  try {
    const [row] = await getSql()<{ event: EventInfo }[]>`SELECT event FROM settings WHERE id = 1`;
    if (row) {
      name = row.event.name;
      poster = posterOf(row.event);
    }
  } catch {
    // Sem banco (ex.: antes da migração): usa o título genérico.
  }
  return {
    metadataBase: new URL(env.appUrl),
    title: {
      default: `${name} — Ingressos | Atlética Invictus`,
      template: "%s | Atlética Invictus",
    },
    description: `Ingressos oficiais da ${name} — Atlética de Medicina Invictus (A.A.A.MED.TB). Pague com Pix ou cartão.`,
    openGraph: {
      locale: "pt_BR",
      type: "website",
      siteName: "Atlética Invictus",
      ...(poster ? { images: [{ url: poster, alt: `Cartaz oficial da ${name}` }] } : {}),
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#050805",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Lê os cabeçalhos para que todas as páginas sejam renderizadas por requisição (nonce da CSP).
  await headers();
  return (
    <html
      lang="pt-BR"
      className={`${body.variable} ${label.variable} ${display.variable} ${brush.variable} ${hand.variable}`}
    >
      <body>
        <a className="skip-link" href="#conteudo">
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
