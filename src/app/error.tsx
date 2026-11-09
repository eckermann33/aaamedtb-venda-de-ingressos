"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="conteudo" className="login-wrap">
      <div className="card status-card login-card">
        <h1 className="status-title">Algo deu errado</h1>
        <p className="status-text">Tivemos um problema para carregar esta página. Nenhuma cobrança foi feita por causa disso.</p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn" onClick={reset}>
            Tentar de novo
          </button>
          <Link className="btn btn-ghost" href="/">
            Início
          </Link>
        </div>
      </div>
    </main>
  );
}
