import { createHmac, timingSafeEqual } from "node:crypto";

/** Minimal HS256 JWT (node:crypto only). */
export interface JwtClaims {
  sub: string;
  typ: string;
  iat: number;
  exp: number;
  [k: string]: unknown;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const HEADER = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));

export function signJwt(claims: JwtClaims, secret: string): string {
  const body = `${HEADER}.${b64(JSON.stringify(claims))}`;
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

export type JwtResult = { ok: true; claims: JwtClaims } | { ok: false; reason: "invalid" | "expired" };

export function verifyJwt(token: string, secret: string, typ: string, now = Date.now()): JwtResult {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) return { ok: false, reason: "invalid" };
  const expected = createHmac("sha256", secret).update(`${parts[0]}.${parts[1]}`).digest();
  let sig: Buffer;
  try {
    sig = Buffer.from(parts[2], "base64url");
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return { ok: false, reason: "invalid" };
  let claims: JwtClaims;
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (claims.typ !== typ || typeof claims.sub !== "string" || typeof claims.exp !== "number") return { ok: false, reason: "invalid" };
  if (claims.exp * 1000 <= now) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}
