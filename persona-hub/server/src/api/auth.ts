import { createHash, randomBytes } from "node:crypto";
import { newId, DomainError, type AppService, type Provider, type Store } from "../core/index.js";
import { signJwt, verifyJwt } from "./jwt.js";

export const ACCESS_TTL_S = 15 * 60;
export const REFRESH_TTL_S = 30 * 86400;
export const STEP_UP_TTL_S = 5 * 60;

/** Verified social identity. */
export interface SocialIdentity {
  subject: string;
  display_name?: string;
}

/**
 * Verifies a provider ID token (kakao/apple/google). Real implementations must check
 * signature (provider JWKS), iss, aud (our client id), exp and nonce. Returns null if invalid.
 */
export interface SocialVerifier {
  verify(idToken: string): Promise<SocialIdentity | null>;
}

/** ALLOW_DEV_LOGIN=1 only: any non-empty string is a stable subject. "test-user" = seeded demo user. */
export class DevSocialVerifier implements SocialVerifier {
  async verify(idToken: string): Promise<SocialIdentity | null> {
    const s = idToken.trim();
    return s ? { subject: s.slice(0, 200), display_name: `개발용 ${s.slice(0, 20)}` } : null;
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface TokenPair {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
}

/** App-user auth: JWT access tokens + rotating opaque refresh tokens with family-wide reuse detection. */
export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly app: AppService,
    private readonly secret: string,
    readonly verifiers: Partial<Record<Provider, SocialVerifier>>,
  ) {}

  async login(provider: Provider, idToken: string): Promise<TokenPair & { user_id: string; is_new_user: boolean }> {
    const v = this.verifiers[provider];
    if (!v) throw new DomainError("validation_failed", "지원하지 않는 로그인 방식이에요.", "provider");
    const ident = await v.verify(idToken);
    if (!ident) throw new DomainError("token_expired", "로그인 정보를 확인할 수 없어요. 다시 로그인해 주세요.", "id_token");
    const before = this.store.users.size;
    const user = this.app.findOrCreateUserByIdentity(provider, ident.subject, ident.display_name);
    const session = { id: newId("ses"), user_id: user.id, created_at: new Date().toISOString(), revoked_at: null };
    this.store.authSessions.set(session.id, session);
    return { ...this.issue(user.id, session.id), user_id: user.id, is_new_user: this.store.users.size > before };
  }

  refresh(refreshToken: string): TokenPair {
    const rt = this.store.refreshTokens.get(sha256(refreshToken));
    const expired = () => new DomainError("token_expired", "로그인이 만료됐어요. 다시 로그인해 주세요.");
    if (!rt) throw expired();
    const session = this.store.authSessions.get(rt.family_id);
    if (rt.used) {
      // Reuse of a rotated token → assume theft, kill the whole family.
      this.revokeFamily(rt.family_id);
      throw expired();
    }
    if (!session || session.revoked_at || rt.expires_at <= Date.now() || !this.app.user(rt.user_id)) throw expired();
    rt.used = true;
    return this.issue(rt.user_id, rt.family_id);
  }

  logout(refreshToken: string | undefined, sessionId: string): void {
    if (refreshToken) {
      const rt = this.store.refreshTokens.get(sha256(refreshToken));
      if (rt) this.revokeFamily(rt.family_id);
    }
    this.revokeFamily(sessionId);
  }

  private revokeFamily(familyId: string): void {
    const s = this.store.authSessions.get(familyId);
    if (s) s.revoked_at ??= new Date().toISOString();
    for (const [k, t] of this.store.refreshTokens) if (t.family_id === familyId) this.store.refreshTokens.delete(k);
  }

  private issue(userId: string, familyId: string): TokenPair {
    const now = Math.floor(Date.now() / 1000);
    const access_token = signJwt({ sub: userId, sid: familyId, typ: "access", iat: now, exp: now + ACCESS_TTL_S, jti: randomBytes(8).toString("hex") }, this.secret);
    const refresh_token = `rt_${randomBytes(32).toString("base64url")}`;
    this.store.refreshTokens.set(sha256(refresh_token), {
      hash: sha256(refresh_token), family_id: familyId, user_id: userId, expires_at: Date.now() + REFRESH_TTL_S * 1000, used: false,
    });
    return { access_token, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token, refresh_expires_in: REFRESH_TTL_S };
  }

  /** Returns {userId, sessionId} or throws token_expired. Checks session revocation and user deletion on every call. */
  authenticate(accessToken: string): { userId: string; sessionId: string } {
    const r = verifyJwt(accessToken, this.secret, "access");
    const expired = new DomainError("token_expired", "로그인이 만료됐어요. 다시 로그인해 주세요.");
    if (!r.ok) throw expired;
    const sid = String(r.claims.sid ?? "");
    const s = this.store.authSessions.get(sid);
    if (!s || s.revoked_at || s.user_id !== r.claims.sub || !this.app.user(r.claims.sub)) throw expired;
    return { userId: r.claims.sub, sessionId: sid };
  }

  /**
   * PoC step-up: trusts the app's claim that biometric auth succeeded.
   * TODO(MVP): require device attestation (Play Integrity / App Attest) or a
   * WebAuthn/passkey assertion bound to a server nonce before issuing.
   */
  stepUp(userId: string, sessionId: string): { step_up_token: string; expires_in: number; expires_at: string } {
    const now = Math.floor(Date.now() / 1000);
    const step_up_token = signJwt({ sub: userId, sid: sessionId, typ: "step_up", iat: now, exp: now + STEP_UP_TTL_S }, this.secret);
    return { step_up_token, expires_in: STEP_UP_TTL_S, expires_at: new Date((now + STEP_UP_TTL_S) * 1000).toISOString() };
  }

  hasStepUp(token: string | undefined, userId: string): boolean {
    if (!token) return false;
    const r = verifyJwt(token, this.secret, "step_up");
    return r.ok && r.claims.sub === userId;
  }

  /** Short-lived signed download token for exports (10 min). */
  signDownload(exportId: string, userId: string, ttlS = 600): { token: string; expires_at: string } {
    const now = Math.floor(Date.now() / 1000);
    return {
      token: signJwt({ sub: userId, exp_id: exportId, typ: "export_dl", iat: now, exp: now + ttlS }, this.secret),
      expires_at: new Date((now + ttlS) * 1000).toISOString(),
    };
  }

  verifyDownload(token: string, exportId: string): string | null {
    const r = verifyJwt(token, this.secret, "export_dl");
    return r.ok && r.claims.exp_id === exportId && this.app.user(r.claims.sub) ? r.claims.sub : null;
  }
}
