import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Bowlby_One, Kalam, Knewave } from "next/font/google";
import { headers } from "next/headers";
import { env } from "@/server/env";
import "./globals.css";

const body = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-body" });
const label = Barlow_Condensed({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-label" });
const display = Bowlby_One({ subsets: ["latin"], weight: "400", variable: "--font-display" });
const brush = Knewave({ subsets: ["latin"], weight: "400", variable: "--font-brush" });
const hand = Kalam({ subsets: ["latin"], weight: "700", variable: "--font-hand" });

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: {
    default: "Party do Saco Cheio — Ingressos | Atlética Invictus",
    template: "%s | Atlética Invictus",
  },
  description: "Ingressos oficiais da Party do Saco Cheio — Atlética de Medicina Invictus (A.A.A.MED.TB). Pague com Pix ou cartão.",
  openGraph: { locale: "pt_BR", type: "website", siteName: "Atlética Invictus" },
};

export const viewport: Viewport = {
  themeColor: "#050805",
  colorScheme: "dark",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Lê os cabeçalhos para que todas as páginas sejam renderizadas por requisição (nonce da CSP).
  await headers();
  return (
    <html lang="pt-BR" className={`${body.variable} ${label.variable} ${display.variable} ${brush.variable} ${hand.variable}`}>
      <body>
        <a className="skip-link" href="#conteudo">
          Pular para o conteúdo
        </a>
        {children}
      </body>
    </html>
  );
}
