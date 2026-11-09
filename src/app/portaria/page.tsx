import type { Metadata } from "next";
import { Satin } from "@/components/site";
import { currentDoorAccess } from "@/server/auth";
import { entryStats } from "@/server/checkin";
import { getSql } from "@/server/db";
import { getEntryMode } from "@/server/settings";
import DoorLogin from "./DoorLogin";
import DoorScanner from "./DoorScanner";

export const metadata: Metadata = { title: "Portaria", robots: { index: false, follow: false } };

/** Leitor de QR Code da portaria: só ler o ingresso e confirmar a entrada. */
export default async function DoorPage() {
  const sql = getSql();
  if ((await getEntryMode(sql)) !== "qrcode") {
    return (
      <>
        <Satin />
        <main id="conteudo" className="login-wrap">
          <div className="card login-card" style={{ textAlign: "center" }}>
            <h1 className="admin-title">Portaria</h1>
            <p className="admin-sub">
              A entrada por QR Code está desativada. Nesta festa, a portaria usa a lista impressa.
            </p>
          </div>
        </main>
      </>
    );
  }
  const access = await currentDoorAccess();
  if (!access) {
    return (
      <>
        <Satin />
        <main id="conteudo" className="login-wrap">
          <div className="card login-card">
            <img src="/images/invictus-logo.webp" alt="Invictus A.A.A.MED.TB" width={110} height={109} />
            <h1 className="admin-title" style={{ textAlign: "center" }}>
              Portaria
            </h1>
            <p className="admin-sub" style={{ textAlign: "center" }}>
              Leitor de ingressos. Use o código que a organização passou para a equipe da entrada.
            </p>
            <DoorLogin />
          </div>
        </main>
      </>
    );
  }
  return <DoorScanner label={access.label} fromPanel={access.adminId !== null} initialStats={await entryStats(sql)} />;
}
