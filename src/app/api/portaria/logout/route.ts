import { cookies } from "next/headers";
import { destroyDoorSession, doorCookieName } from "@/server/auth";
import { getSql } from "@/server/db";
import { errorResponse, isSameOrigin, json } from "@/server/http";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return errorResponse("Origem não permitida.", 403, "forbidden");
  const store = await cookies();
  const token = store.get(doorCookieName())?.value;
  if (token) await destroyDoorSession(getSql(), token);
  store.delete(doorCookieName());
  return json({ ok: true });
}
