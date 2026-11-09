import { cookies } from "next/headers";
import { audit } from "@/server/audit";
import { adminFromToken, destroySession, sessionCookieName } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, isSameOrigin, json } from "@/server/http";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return errorResponse("Origem não permitida.", 403, "forbidden");
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  if (token) {
    const sql = getSql();
    const admin = await adminFromToken(sql, token);
    await destroySession(sql, token);
    if (admin) await audit(sql, admin.id, "logout");
  }
  store.delete(sessionCookieName());
  return json({ ok: true });
}
