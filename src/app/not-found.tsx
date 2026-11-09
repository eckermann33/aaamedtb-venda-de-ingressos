import Link from "next/link";
import { Satin } from "@/components/site";

export default function NotFound() {
  return (
    <>
      <Satin />
      <main id="conteudo" className="login-wrap">
        <div className="card status-card login-card">
          <h1 className="status-title">Página não encontrada</h1>
          <p className="status-text">O endereço pode estar errado ou o pedido não existe.</p>
          <Link className="btn" href="/">
            Ir para o evento
          </Link>
        </div>
      </main>
    </>
  );
}
