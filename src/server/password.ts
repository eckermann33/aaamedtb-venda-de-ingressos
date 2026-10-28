import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Hash de senha com scrypt (memória-intensivo), embutido no Node.js.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

function scrypt(password: string, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  const key = await scrypt(password.normalize("NFKC"), salt, expected.length, { N: n, r, p, maxmem: 128 * n * r * 2 });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Regras mínimas para a senha de administrador. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "A senha precisa ter pelo menos 12 caracteres.";
  if (password.length > 200) return "Senha longa demais.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return "Use letras e números na senha.";
  return null;
}
