import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { json } from "@/server/http";
import { getMercadoPago } from "@/server/mercadopago";
import { reconcilePending } from "@/server/purchases";

/** Confere no Mercado Pago todas as compras pendentes ou com alerta. */
export async function POST(request: Request) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const sql = getSql();
  const checked = await reconcilePending(sql, getMercadoPago(), 200);
  await audit(sql, admin.id, "reconcile", { checked });
  return json({ ok: true, checked });
}
