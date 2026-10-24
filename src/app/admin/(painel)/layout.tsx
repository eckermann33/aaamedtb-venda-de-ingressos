import type { Metadata } from "next";
import Link from "next/link";
import { requireAdminPage } from "@/server/auth";
import { AdminNav, LogoutButton } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdminPage();
  return (
    <div className="admin-shell">
      <header className="admin-top">
        <div className="container">
          <Link href="/admin" className="brand" aria-label="Painel">
            <img src="/images/invictus-badge.webp" alt="" width={34} height={34} />
          </Link>
          <AdminNav />
          <span className="hint" style={{ fontSize: "0.8rem" }} title={admin.email}>
            {admin.email.split("@")[0]}
          </span>
          <LogoutButton />
        </div>
      </header>
      <main id="conteudo" className="admin-main">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
