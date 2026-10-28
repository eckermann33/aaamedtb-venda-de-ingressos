"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatEntryCode, normalizeEntryCode } from "@/lib/entry-code";
import type { CheckInResult, DoorStats, DoorTicket } from "@/server/checkin";

type Props = { label: string; fromPanel: boolean; initialStats: DoorStats };

type Phase =
  | { kind: "scan" }
  | { kind: "busy" }
  | { kind: "result"; code: string; data: CheckInResult }
  | { kind: "error"; message: string };

const SAME_CODE_PAUSE_MS = 3000;
const DONE_RETURN_MS = 1800;

function hhmm(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* sem vibração */
  }
}

/**
 * Leitor da portaria: câmera lendo QR Codes. Ao ler, mostra o nome em letras grandes para
 * conferir com o documento; a entrada só é registrada quando a pessoa da portaria confirma.
 */
export default function DoorScanner({ label, fromPanel, initialStats }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastRead = useRef<{ code: string; at: number }>({ code: "", at: 0 });
  const [phase, setPhase] = useState<Phase>({ kind: "scan" });
  const [stats, setStats] = useState(initialStats);
  const [camera, setCamera] = useState<"starting" | "on" | "blocked" | "unavailable">("starting");
  const [typed, setTyped] = useState("");

  const call = useCallback(async (path: "lookup" | "checkin", code: string) => {
    setPhase({ kind: "busy" });
    try {
      const res = await fetch(`/api/portaria/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      // Sessão encerrada (código trocado) ou QR Code desativado: volta para a tela inicial.
      if (res.status === 401 || res.status === 409) return window.location.reload();
      const data = await res.json();
      if (!res.ok) return setPhase({ kind: "error", message: data?.error?.message ?? "Erro. Tente de novo." });
      setStats(data.stats);
      setPhase({ kind: "result", code, data });
      vibrate(data.result === "valid" || data.result === "checked_in" ? 80 : [120, 80, 120]);
    } catch {
      setPhase({ kind: "error", message: "Sem conexão com o servidor. Confira a internet e tente de novo." });
    }
  }, []);

  const onRead = useCallback(
    (raw: string) => {
      const code = normalizeEntryCode(raw);
      const key = code ?? raw;
      const now = Date.now();
      if (lastRead.current.code === key && now - lastRead.current.at < SAME_CODE_PAUSE_MS) return;
      lastRead.current = { code: key, at: now };
      if (!code) {
        setPhase({ kind: "result", code: "", data: { result: "not_found" } });
        vibrate([120, 80, 120]);
        return;
      }
      void call("lookup", code);
    },
    [call],
  );

  const backToScan = useCallback(() => {
    lastRead.current.at = Date.now();
    setPhase({ kind: "scan" });
  }, []);

  // Câmera traseira, ligada uma vez e mantida enquanto a página estiver aberta.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let lock: { release: () => Promise<void> } | null = null;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) return setCamera("unavailable");
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream;
          await v.play().catch(() => {});
        }
        setCamera("on");
      } catch (err) {
        setCamera((err as Error).name === "NotAllowedError" ? "blocked" : "unavailable");
      }
      try {
        // Mantém a tela acesa durante a portaria (quando o navegador permite).
        const wakeLock = (
          navigator as unknown as { wakeLock?: { request(t: "screen"): Promise<{ release(): Promise<void> }> } }
        ).wakeLock;
        if (wakeLock) lock = await wakeLock.request("screen");
      } catch {
        /* sem wake lock */
      }
    })();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      void lock?.release().catch(() => {});
    };
  }, []);

  // Leitura dos quadros da câmera só enquanto está na tela de leitura.
  useEffect(() => {
    if (phase.kind !== "scan" || camera !== "on") return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 150) return;
      last = t;
      const v = videoRef.current;
      const c = canvasRef.current;
      if (!v || !c || v.readyState < 2 || !v.videoWidth) return;
      const w = Math.min(640, v.videoWidth);
      const h = Math.round((v.videoHeight * w) / v.videoWidth);
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, w, h);
      const found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
      if (found?.data) onRead(found.data);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase.kind, camera, onRead]);

  // Depois de liberar a entrada, volta sozinho para o leitor.
  useEffect(() => {
    if (phase.kind !== "result" || phase.data.result !== "checked_in") return;
    const t = setTimeout(backToScan, DONE_RETURN_MS);
    return () => clearTimeout(t);
  }, [phase, backToScan]);

  return (
    <div className="door">
      <header className="door-top">
        <div>
          <strong>Portaria</strong> <span className="hint">· {label}</span>
        </div>
        <div className="door-count" aria-live="polite">
          Entraram <strong>{stats.checkedIn}</strong> de {stats.total}
        </div>
        {fromPanel ? (
          <a className="btn btn-ghost btn-sm" href="/admin/portaria">
            Painel
          </a>
        ) : (
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              await fetch("/api/portaria/logout", { method: "POST" }).catch(() => null);
              window.location.reload();
            }}
          >
            Sair
          </button>
        )}
      </header>

      <div className="door-camera" hidden={phase.kind !== "scan" && phase.kind !== "busy"}>
        <video ref={videoRef} playsInline muted aria-label="Câmera do leitor" />
        <canvas ref={canvasRef} hidden />
        <div className="door-frame" aria-hidden />
        {camera === "starting" && <p className="door-camera-msg">Ligando a câmera…</p>}
        {camera === "blocked" && (
          <p className="door-camera-msg">
            Câmera bloqueada. Permita o acesso à câmera nas configurações do navegador e recarregue.
          </p>
        )}
        {camera === "unavailable" && (
          <p className="door-camera-msg">Câmera indisponível neste aparelho. Digite o código abaixo.</p>
        )}
        {phase.kind === "busy" && <p className="door-camera-msg">Consultando…</p>}
      </div>

      {(phase.kind === "scan" || phase.kind === "busy") && (
        <form
          className="door-type"
          onSubmit={(e) => {
            e.preventDefault();
            const code = normalizeEntryCode(typed);
            if (!code) return setPhase({ kind: "result", code: "", data: { result: "not_found" } });
            setTyped("");
            void call("lookup", code);
          }}
        >
          <label htmlFor="door-code" className="hint">
            QR não lê? Digite o código que aparece embaixo dele:
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="door-code"
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="XXXX-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={20}
            />
            <button className="btn btn-sm" disabled={phase.kind === "busy" || typed.trim().length < 12}>
              Buscar
            </button>
          </div>
        </form>
      )}

      {phase.kind === "error" && (
        <section className="door-result door-bad" role="alert">
          <p className="door-big">Erro</p>
          <p>{phase.message}</p>
          <button className="btn btn-lg btn-block" onClick={backToScan}>
            Voltar ao leitor
          </button>
        </section>
      )}

      {phase.kind === "result" && (
        <ResultCard phase={phase} onConfirm={() => void call("checkin", phase.code)} onBack={backToScan} />
      )}
    </div>
  );
}

function Badges({ t }: { t: DoorTicket }) {
  return (
    <p className="door-badges">
      {/* O camarote ganha etiqueta própria, em destaque. */}
      <span className="badge badge-muted">
        {t.camarote ? t.categoryLabel.replace(/ \+ Camarote$/, "") : t.categoryLabel}
      </span>
      {t.camarote && <span className="badge badge-warn">CAMAROTE</span>}
      {t.athletic && <span className="badge badge-ok">ATLÉTICA</span>}
    </p>
  );
}

function ResultCard({
  phase,
  onConfirm,
  onBack,
}: {
  phase: Extract<Phase, { kind: "result" }>;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const d = phase.data;
  switch (d.result) {
    case "valid":
      return (
        <section className="door-result door-check" aria-live="assertive">
          <p className="door-step">Confira o documento com foto</p>
          <h1 className="door-name">{d.ticket.fullName}</h1>
          <Badges t={d.ticket} />
          <ul className="door-checklist">
            <li>Nome do documento igual ao nome acima</li>
            <li>Foto confere com a pessoa</li>
            <li>18 anos ou mais</li>
          </ul>
          <p className="hint">Código {formatEntryCode(phase.code)}</p>
          <button className="btn btn-lg btn-block door-confirm" onClick={onConfirm} autoFocus>
            Confirmar entrada
          </button>
          <button className="btn btn-ghost btn-block" onClick={onBack} style={{ marginTop: 10 }}>
            Não confere: voltar
          </button>
        </section>
      );
    case "checked_in":
      return (
        <section className="door-result door-ok" aria-live="assertive">
          <p className="door-big">✓ ENTRADA LIBERADA</p>
          <h1 className="door-name">{d.ticket.fullName}</h1>
          <Badges t={d.ticket} />
          <button className="btn btn-lg btn-block" onClick={onBack}>
            Próximo
          </button>
        </section>
      );
    case "already":
      return (
        <section className="door-result door-bad" aria-live="assertive">
          <p className="door-big">✕ JÁ ENTROU</p>
          <h1 className="door-name">{d.ticket.fullName}</h1>
          <Badges t={d.ticket} />
          <p>
            Este ingresso já foi usado às <strong>{hhmm(d.ticket.checkedInAt)}</strong>
            {d.ticket.checkedInBy && <> ({d.ticket.checkedInBy})</>}. Não libere a entrada; chame a organização.
          </p>
          <button className="btn btn-lg btn-block" onClick={onBack}>
            Voltar ao leitor
          </button>
        </section>
      );
    case "invalid":
      return (
        <section className="door-result door-bad" aria-live="assertive">
          <p className="door-big">✕ INGRESSO INVÁLIDO</p>
          <h1 className="door-name">{d.ticket.fullName}</h1>
          <p>{d.reason} Não libere a entrada; chame a organização.</p>
          <button className="btn btn-lg btn-block" onClick={onBack}>
            Voltar ao leitor
          </button>
        </section>
      );
    case "not_found":
      return (
        <section className="door-result door-bad" aria-live="assertive">
          <p className="door-big">✕ NÃO ENCONTRADO</p>
          <p>Este QR Code não é um ingresso desta festa. Confira se a pessoa está mostrando o QR certo.</p>
          <button className="btn btn-lg btn-block" onClick={onBack}>
            Voltar ao leitor
          </button>
        </section>
      );
  }
}
