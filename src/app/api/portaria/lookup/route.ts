import { z } from "zod";
import { requireDoorApi } from "@/server/auth";
import { entryStats, lookupTicket } from "@/server/checkin";
import { getSql } from "@/server/db";
import { clientIp, errorResponse, json, readJson } from "@/server/http";
import { checkRateLimit, rateKey } from "@/server/rate-limit";

const schema = z.object({ code: z.string().max(200) });

/** Mostra o ingresso lido no QR Code para a portaria conferir o documento (não registra a entrada). */
export async function POST(request: Request) {
  const access = await requireDoorApi(request);
  if (access instanceof Response) return access;
  const parsed = schema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) return errorResponse("Código inválido.", 400, "validation");
  const sql = getSql();
  if (!(await checkRateLimit(sql, rateKey("door", clientIp(request)), 300, 60))) {
    return errorResponse("Muitas leituras seguidas. Aguarde um instante.", 429, "rate_limited");
  }
  return json({ ...(await lookupTicket(sql, parsed.data.code)), stats: await entryStats(sql) });
}
