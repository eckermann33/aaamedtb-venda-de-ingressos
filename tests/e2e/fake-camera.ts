import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";

/**
 * Câmera falsa do Chromium para os testes da portaria: um vídeo (formato Y4M) mostrando o
 * QR Code de um ingresso com este código fixo. O teste atribui o código a um ingresso pago.
 */
export const FAKE_CAMERA_CODE = "K7M2Q9XA4C0B";
export const FAKE_CAMERA_FILE = join(tmpdir(), "invictus-portaria-qr.y4m");

export function writeFakeCamera(path = FAKE_CAMERA_FILE) {
  const W = 640;
  const H = 480;
  const qr = QRCode.create(`INV1:${FAKE_CAMERA_CODE}`, { errorCorrectionLevel: "M" });
  const n = qr.modules.size;
  const quiet = 4;
  const scale = Math.floor(320 / (n + quiet * 2));
  const side = (n + quiet * 2) * scale;
  const x0 = Math.floor((W - side) / 2);
  const y0 = Math.floor((H - side) / 2);

  const y = Buffer.alloc(W * H, 60); // fundo cinza escuro
  for (let py = 0; py < side; py++) {
    for (let px = 0; px < side; px++) {
      const mx = Math.floor(px / scale) - quiet;
      const my = Math.floor(py / scale) - quiet;
      const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr.modules.get(mx, my);
      y[(y0 + py) * W + x0 + px] = dark ? 16 : 235;
    }
  }
  const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), y, chroma]);
  const header = Buffer.from(`YUV4MPEG2 W${W} H${H} F10:1 Ip A1:1 C420jpeg\n`);
  writeFileSync(path, Buffer.concat([header, frame, frame]));
  return path;
}
