"use client";

import { useState } from "react";
import { IconAlert } from "@/components/icons";

export default function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    if (loading) return;
    const form = new FormData(ev.currentTarget);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      if (res.ok) {
        window.location.assign("/admin");
        return;
      }
      const data = await res.json().catch(() => null);
      setError(data?.error?.message ?? "Não foi possível entrar.");
    } catch {
      setError("Sem conexão com o servidor.");
    }
    setLoading(false);
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" className="input" autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      {error && (
        <div className="notice notice-danger" role="alert" style={{ marginBottom: 16 }}>
          <IconAlert size={20} />
          <span>{error}</span>
        </div>
      )}
      <button className="btn btn-lg btn-block" disabled={loading}>
        {loading ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
