import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * Minimal HS256 JWT (node:crypto only).
 * L-7: each token type (`typ`) is signed with its own key derived from the master secret via
 * HKDF, so a token of one type can never verify as another even if claims were confused;
 * `iss`/`aud` are set and checked when the caller supplies them.
 * TODO(MVP): add `kid` + a key ring for rotation.
 */
export interface JwtClaims {
  sub: string;
  typ: string;
  iat: number;
  exp: number;
  iss?: string;
  aud?: string;
  [k: string]: unknown;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const HEADER = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));

const keyCache = new Map<string, Buffer>();
function keyFor(secret: string, typ: string): Buffer {
  const ck = `${typ}\u0000${secret}`;
  let k = keyCache.get(ck);
  if (!k) {
    k = Buffer.from(hkdfSync("sha256", secret, "persona-hub/jwt/v1", `typ:${typ}`, 32));
    if (keyCache.size > 64) keyCache.clear();
    keyCache.set(ck, k);
  }
  return k;
}

export function signJwt(claims: JwtClaims, secret: string): string {
  const body = `${HEADER}.${b64(JSON.stringify(claims))}`;
  return `${body}.${createHmac("sha256", keyFor(secret, claims.typ)).update(body).digest("base64url")}`;
}

export type JwtResult = { ok: true; claims: JwtClaims } | { ok: false; reason: "invalid" | "expired" };

export function verifyJwt(token: string, secret: string, typ: string, opts: { iss?: string; aud?: string; now?: number } = {}): JwtResult {
  const now = opts.now ?? Date.now();
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== HEADER) return { ok: false, reason: "invalid" };
  const expected = createHmac("sha256", keyFor(secret, typ)).update(`${parts[0]}.${parts[1]}`).digest();
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
  if (!claims || claims.typ !== typ || typeof claims.sub !== "string" || typeof claims.exp !== "number") return { ok: false, reason: "invalid" };
  if (opts.iss !== undefined && claims.iss !== opts.iss) return { ok: false, reason: "invalid" };
  if (opts.aud !== undefined && claims.aud !== opts.aud) return { ok: false, reason: "invalid" };
  if (claims.exp * 1000 <= now) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}
