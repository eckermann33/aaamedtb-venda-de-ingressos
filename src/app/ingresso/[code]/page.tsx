import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconInfo } from "@/components/icons";
import { Satin, SiteFooter, SiteHeader } from "@/components/site";
import { TicketQr } from "@/components/TicketQr";
import { eventDateParts, formatDateTime } from "@/lib/dates";
import { normalizeEntryCode } from "@/lib/entry-code";
import { getSql } from "@/server/db";
import { loadSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Seu ingresso", robots: { index: false, follow: false } };

type Row = {
  full_name: string;
  category_label: string;
  status: string;
  checked_in_at: Date | null;
};

/**
 * Ingresso individual (modo QR Code). O link funciona como o próprio ingresso: quem tem o link
 * tem o QR. Serve para o comprador enviar cada ingresso do pedido para quem vai usar.
 */
export default async function TicketPage(props: PageProps<"/ingresso/[code]">) {
  const { code: raw } = await props.params;
  const code = normalizeEntryCode(raw);
  if (!code) notFound();
  const sql = getSql();
  const [row] = await sql<Row[]>`
    SELECT full_name, category_label, status, checked_in_at FROM purchases WHERE entry_code = ${code}
  `;
  if (!row || row.status === "pending") notFound();
  const settings = await loadSettings(sql);
  const e = settings.event;
  const date = eventDateParts(e.date);
  const valid = row.status === "confirmed";

  return (
    <>
      <Satin />
      <SiteHeader cta={false} />
      <main id="conteudo" className="container">
        <div className="checkout">
          <div className="card status-card">
            <span className="label">{e.name}</span>
            <h1 className="status-title" style={{ marginTop: 6 }}>
              {row.full_name}
            </h1>
            <p className="status-text">
              {row.category_label}
              {date && (
                <>
                  {" "}
                  · {date.short}
                  {e.startTime && ` · ${e.startTime}`}
                </>
              )}
              {e.venueName && ` · ${e.venueName}`}
            </p>

            {!valid ? (
              <div className="notice notice-danger" style={{ textAlign: "left" }}>
                <IconInfo size={20} />
                <span>Este ingresso foi cancelado e não dá direito à entrada.</span>
              </div>
            ) : settings.entryMode === "qrcode" ? (
              <>
                <TicketQr code={code} size={260} />
                {row.checked_in_at ? (
                  <p className="field-error" style={{ marginTop: 14 }}>
                    Entrada já registrada em {formatDateTime(row.checked_in_at)}.
                  </p>
                ) : (
                  <p className="status-text" style={{ marginTop: 14 }}>
                    Mostre este QR Code na portaria junto com um <strong>documento oficial com foto</strong> no mesmo
                    nome. Ele vale para <strong>uma entrada</strong>. Tire um print para usar mesmo sem internet.
                  </p>
                )}
              </>
            ) : (
              <p className="status-text">
                Ingresso confirmado. Nesta festa a entrada é feita pela <strong>lista oficial</strong>: na portaria,
                diga seu nome e apresente um documento oficial com foto.
              </p>
            )}
            <Link className="btn btn-ghost" href="/">
              Ver a festa
            </Link>
          </div>
        </div>
      </main>
      <SiteFooter event={e} />
    </>
  );
}
