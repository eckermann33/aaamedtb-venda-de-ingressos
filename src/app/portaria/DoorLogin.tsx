"use client";

import { useState } from "react";

export default function DoorLogin() {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await fetch("/api/portaria/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, code }),
        }).catch(() => null);
        if (res?.ok) return window.location.reload();
        const data = await res?.json().catch(() => null);
        setError(data?.error?.message ?? "Sem conexão. Tente de novo.");
        setBusy(false);
      }}
    >
      <div className="field">
        <label htmlFor="d-name">Seu nome</label>
        <input
          id="d-name"
          className="input"
          value={name}
          maxLength={40}
          placeholder="Ex.: Segurança 1"
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
        <span className="hint">Fica registrado em cada entrada que você confirmar.</span>
      </div>
      <div className="field">
        <label htmlFor="d-code">Código da portaria</label>
        <input
          id="d-code"
          className="input"
          type="password"
          value={code}
          maxLength={64}
          autoComplete="off"
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-block" disabled={busy || name.trim().length < 2 || code.length < 6}>
        {busy ? "Entrando…" : "Abrir leitor"}
      </button>
    </form>
  );
}
