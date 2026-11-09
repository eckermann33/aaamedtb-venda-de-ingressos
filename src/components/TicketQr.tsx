"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { formatEntryCode, qrPayload } from "@/lib/entry-code";

/** QR Code do ingresso (gerado no navegador) com o código escrito embaixo, para digitar se precisar. */
export function TicketQr({ code, size = 220 }: { code: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toString(qrPayload(code), { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [code]);
  return (
    <figure className="ticket-qr" style={{ width: size }}>
      <div
        className="ticket-qr-img"
        role="img"
        aria-label={`QR Code do ingresso ${formatEntryCode(code)}`}
        // SVG gerado pela biblioteca a partir do código do ingresso (sem conteúdo de terceiros).
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <figcaption className="ticket-qr-code">{formatEntryCode(code)}</figcaption>
    </figure>
  );
}
