const STATUS: Record<string, { label: string; cls: string }> = {
  confirmed: { label: "Confirmado", cls: "badge-ok" },
  pending: { label: "Pendente", cls: "badge-wait" },
  rejected: { label: "Recusado", cls: "badge-bad" },
  cancelled: { label: "Cancelado", cls: "badge-muted" },
  expired: { label: "Expirado", cls: "badge-muted" },
  refunded: { label: "Estornado", cls: "badge-warn" },
  failed: { label: "Falhou", cls: "badge-bad" },
};

export const ATTENTION_LABEL: Record<string, string> = {
  over_capacity: "Pago acima da lotação — estornar",
  amount_mismatch: "Valor divergente — verificar",
  duplicate_payment: "Pagamento duplicado — estornar o excedente",
  in_mediation: "Em disputa no Mercado Pago",
  late_payment: "Pagamento após o prazo",
};

export const MP_STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  in_process: "Em análise",
  authorized: "Autorizado",
  approved: "Aprovado",
  rejected: "Recusado",
  cancelled: "Cancelado",
  refunded: "Estornado",
  charged_back: "Chargeback",
  in_mediation: "Em disputa",
};

export function StatusBadge({ status, pendingExpired }: { status: string; pendingExpired?: boolean }) {
  const s = pendingExpired && status === "pending" ? { label: "Expirando", cls: "badge-muted" } : (STATUS[status] ?? { label: status, cls: "badge-muted" });
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export function AttentionBadge({ attention }: { attention: string | null }) {
  if (!attention) return null;
  return <span className="badge badge-warn">⚠ {ATTENTION_LABEL[attention] ?? attention}</span>;
}
