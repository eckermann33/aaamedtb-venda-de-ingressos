import type { Sql, TxSql } from "./db";

export async function audit(sql: Sql | TxSql, adminId: number | null, action: string, details?: Record<string, unknown>) {
  await sql`
    INSERT INTO audit_log (admin_id, action, details)
    VALUES (${adminId}, ${action}, ${details ? sql.json(details as never) : null})
  `;
}
