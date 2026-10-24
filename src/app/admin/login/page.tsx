import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Satin } from "@/components/site";
import { currentAdmin } from "@/server/auth";
import LoginForm from "./LoginForm";

export const metadata: Metadata = { title: "Painel — Entrar", robots: { index: false, follow: false } };

export default async function LoginPage() {
  if (await currentAdmin()) redirect("/admin");
  return (
    <>
      <Satin />
      <main id="conteudo" className="login-wrap">
        <div className="card login-card">
          <img src="/images/invictus-logo.webp" alt="Invictus A.A.A.MED.TB" width={140} height={139} />
          <h1 className="admin-title" style={{ textAlign: "center" }}>
            Painel da organização
          </h1>
          <p className="admin-sub" style={{ textAlign: "center" }}>
            Acesso restrito à diretoria da Atlética.
          </p>
          <LoginForm />
        </div>
      </main>
    </>
  );
}
