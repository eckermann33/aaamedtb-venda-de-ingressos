import { getSql } from "@/server/db";
import { json } from "@/server/http";

export async function GET() {
  try {
    await getSql()`SELECT 1`;
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 503);
  }
}
