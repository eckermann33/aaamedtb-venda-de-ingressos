import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Sql } from "./db";
import { getSql } from "./db";
import { env } from "./env";
import { errorResponse, isSameOrigin } from "./http";
import { verifyPassword } from "./password";

const SESSION_HOURS = 12;
const DUMMY_HASH = `scrypt$32768$8$1$${Buffer.alloc(16).toString("base64")}$${Buffer.alloc(64).toString("base64")}`;

export type Admin = { id: number; email: string };

export function sessionCookieName() {
  // O prefixo __Host- impede que subdomínios sobrescrevam o cookie (exige HTTPS).
  return env.isSecure ? "__Host-invictus_admin" : "invictus_admin";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function authenticate(sql: Sql, email: string, password: string): Promise<Admin | null> {
  const rows = await sql<{ id: number; email: string; password_hash: string; disabled: boolean }[]>`
    SELECT id, email, password_hash, disabled FROM admins WHERE email = ${email.trim().toLowerCase()}
  `;
  const admin = rows[0];
  // Mesmo sem usuário, executa a verificação para não revelar quais e-mails existem pelo tempo de resposta.
  const ok = await verifyPassword(password, admin?.password_hash ?? DUMMY_HASH);
  if (!admin || admin.disabled || !ok) return null;
  await sql`UPDATE admins SET last_login_at = now() WHERE id = ${admin.id}`;
  return { id: admin.id, email: admin.email };
}

export async function createSession(sql: Sql, adminId: number): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await sql`DELETE FROM admin_sessions WHERE expires_at < now()`;
  await sql`
    INSERT INTO admin_sessions (token_hash, admin_id, expires_at)
    VALUES (${hashToken(token)}, ${adminId}, ${expires})
  `;
  return { token, expires };
}

export async function destroySession(sql: Sql, token: string) {
  await sql`DELETE FROM admin_sessions WHERE token_hash = ${hashToken(token)}`;
}

export async function adminFromToken(sql: Sql, token: string | undefined): Promise<Admin | null> {
  if (!token || token.length > 100) return null;
  const rows = await sql<Admin[]>`
    SELECT a.id, a.email
    FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
    WHERE s.token_hash = ${hashToken(token)} AND s.expires_at > now() AND NOT a.disabled
  `;
  return rows[0] ?? null;
}

/** Administrador da sessão atual (ou null). */
export async function currentAdmin(): Promise<Admin | null> {
  const store = await cookies();
  return adminFromToken(getSql(), store.get(sessionCookieName())?.value);
}

/** Para páginas do painel: redireciona ao login se não houver sessão válida. */
export async function requireAdminPage(): Promise<Admin> {
  const admin = await currentAdmin();
  if (!admin) redirect("/admin/login");
  return admin;
}

/**
 * Para rotas da API do painel: exige sessão válida e, em operações que alteram
 * dados, que a requisição venha do próprio site (proteção contra CSRF).
 */
export async function requireAdminApi(request: Request): Promise<Admin | Response> {
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
    return errorResponse("Origem não permitida.", 403, "forbidden");
  }
  const admin = await currentAdmin();
  if (!admin) return errorResponse("Faça login para continuar.", 401, "unauthorized");
  return admin;
}

// ---------------------------------------------------------------------------
// Portaria (modo de entrada por QR Code): acesso só ao leitor, com um código
// definido pela organização no painel. Administradores também podem usar o leitor.
// ---------------------------------------------------------------------------

const DOOR_SESSION_HOURS = 14;

export type DoorAccess = { label: string; adminId: number | null };

export function doorCookieName() {
  return env.isSecure ? "__Host-invictus_portaria" : "invictus_portaria";
}

/** Confere o código de acesso da portaria (hash salvo nas configurações). */
export async function verifyDoorCode(sql: Sql, code: string): Promise<boolean> {
  const [row] = await sql<{ door_code_hash: string | null }[]>`SELECT door_code_hash FROM settings WHERE id = 1`;
  const ok = await verifyPassword(code, row?.door_code_hash ?? DUMMY_HASH);
  return Boolean(row?.door_code_hash) && ok;
}

export async function createDoorSession(sql: Sql, label: string): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + DOOR_SESSION_HOURS * 3600_000);
  await sql`DELETE FROM door_sessions WHERE expires_at < now()`;
  await sql`INSERT INTO door_sessions (token_hash, label, expires_at) VALUES (${hashToken(token)}, ${label}, ${expires})`;
  return { token, expires };
}

export async function destroyDoorSession(sql: Sql, token: string) {
  await sql`DELETE FROM door_sessions WHERE token_hash = ${hashToken(token)}`;
}

export async function doorFromToken(sql: Sql, token: string | undefined): Promise<DoorAccess | null> {
  if (!token || token.length > 100) return null;
  const rows = await sql<{ label: string }[]>`
    SELECT label FROM door_sessions WHERE token_hash = ${hashToken(token)} AND expires_at > now()
  `;
  return rows[0] ? { label: rows[0].label, adminId: null } : null;
}

/** Quem está usando o leitor: um administrador logado ou uma sessão da portaria. */
export async function currentDoorAccess(): Promise<DoorAccess | null> {
  const admin = await currentAdmin();
  if (admin) return { label: `Painel (${admin.email.split("@")[0]})`.slice(0, 60), adminId: admin.id };
  const store = await cookies();
  return doorFromToken(getSql(), store.get(doorCookieName())?.value);
}

/** Para as rotas da portaria: exige o modo QR Code ativo e acesso válido (com proteção contra CSRF). */
export async function requireDoorApi(request: Request): Promise<DoorAccess | Response> {
  if (request.method !== "GET" && request.method !== "HEAD" && !isSameOrigin(request)) {
    return errorResponse("Origem não permitida.", 403, "forbidden");
  }
  const [row] = await getSql()<{ entry_mode: string }[]>`SELECT entry_mode FROM settings WHERE id = 1`;
  if (row?.entry_mode !== "qrcode") {
    return errorResponse("A entrada por QR Code está desativada.", 409, "qrcode_disabled");
  }
  const access = await currentDoorAccess();
  if (!access) return errorResponse("Entre com o código da portaria.", 401, "unauthorized");
  return access;
}
