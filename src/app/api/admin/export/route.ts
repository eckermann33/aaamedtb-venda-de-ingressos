import { formatPhone } from "@/lib/contact";
import { toCsv } from "@/lib/csv";
import { formatDateTime } from "@/lib/dates";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { allPurchases, officialList } from "@/server/reports";

const STATUS_LABEL: Record<string, string> = {
  confirmed: "Confirmado",
  pending: "Pendente",
  rejected: "Recusado",
  cancelled: "Cancelado",
  expired: "Expirado",
  refunded: "Reembolsado",
  failed: "Falhou",
};

const METHOD_LABEL: Record<string, string> = { pix: "Pix", card: "Cartão", manual: "Manual" };

function money(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

export async function GET(request: Request) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const scope = new URL(request.url).searchParams.get("scope") === "all" ? "all" : "official";
  const sql = getSql();
  const stamp = new Date().toISOString().slice(0, 10);

  let csv: string;
  if (scope === "official") {
    const rows = await officialList(sql);
    csv = toCsv(
      ["Nº", "Seção", "Nome completo", "Categoria", "Código interno", "Entrada (marcar)"],
      rows.map((r, i) => [i + 1, r.athletic ? "Atlética" : "Geral", r.full_name, r.category_label, r.ticket_code, ""]),
    );
  } else {
    const all = await allPurchases(sql);
    csv = toCsv(
      ["Nome completo", "Celular/WhatsApp", "Categoria", "Valor total (R$)", "Taxa (R$)", "Forma", "Origem", "Seção", "Camarote adicionado pelo painel (R$)", "Observação", "Status da compra", "Status MP",
       "ID pagamento MP", "Código interno", "Criada em", "Confirmada em", "Alerta"],
      all.map((r) => [
        r.full_name, r.buyer_phone ? formatPhone(r.buyer_phone) : "", r.category_label, money(r.amount_cents), money(r.fee_cents),
        METHOD_LABEL[r.payment_method] ?? r.payment_method, r.source === "manual" ? "Manual" : "Site", r.athletic ? "Atlética" : "Geral", r.camarote_extra_cents === null ? "" : money(r.camarote_extra_cents), r.note, STATUS_LABEL[r.status] ?? r.status, r.payment_status,
        r.mp_payment_id, r.ticket_code, formatDateTime(r.created_at), formatDateTime(r.confirmed_at), r.attention,
      ]),
    );
  }
  await audit(sql, admin.id, "export_csv", { scope });
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="invictus-${scope === "official" ? "lista-oficial" : "compras"}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
