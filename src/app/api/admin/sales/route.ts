import { z } from "zod";
import { audit } from "@/server/audit";
import { requireAdminApi } from "@/server/auth";
import { getSql } from "@/server/db";
import { envState } from "@/server/deps";
import { errorResponse, json, readJson } from "@/server/http";
import { loadSettings, readiness } from "@/server/settings";

const schema = z.object({ open: z.boolean() });

/** Abre ou fecha as vendas. */
export async function POST(request: Request) {
  const admin = await requireAdminApi(request);
  if (admin instanceof Response) return admin;
  const parsed = schema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return errorResponse("Requisição inválida.", 400);

  const sql = getSql();
  const result = await sql.begin(async (tx) => {
    const settings = await loadSettings(tx, { forUpdate: true });
    if (parsed.data.open) {
      const blocking = readiness(settings, envState()).filter((i) => i.blocking);
      if (blocking.length > 0) return { blocking };
    }
    await tx`UPDATE settings SET sales_open = ${parsed.data.open}, updated_at = now() WHERE id = 1`;
    await audit(tx, admin.id, parsed.data.open ? "sales_opened" : "sales_closed");
    return { blocking: [] };
  });
  if (result.blocking.length > 0) {
    return json(
      {
        error: {
          code: "not_ready",
          message: "Preencha as informações pendentes antes de abrir as vendas.",
          pending: result.blocking.map((i) => i.label),
        },
      },
      409,
    );
  }
  return json({ ok: true, salesOpen: parsed.data.open });
}
