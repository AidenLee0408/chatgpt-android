import { createHash, randomBytes } from "node:crypto";
import { newId, DomainError, type AppService, type Provider, type Store } from "../core/index.js";
import { signJwt, verifyJwt, type JwtClaims } from "./jwt.js";

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
  /** jti → exp (ms) of single-use step-up tokens already spent. */
  private readonly usedStepUps = new Map<string, number>();
  private readonly iss: string;
  private readonly aud: string;

  constructor(
    private readonly store: Store,
    private readonly app: AppService,
    private readonly secret: string,
    readonly verifiers: Partial<Record<Provider, SocialVerifier>>,
    issuer = "persona-hub",
  ) {
    this.iss = issuer;
    this.aud = `${issuer}/v1`;
  }

  private sign(claims: JwtClaims): string {
    return signJwt({ ...claims, iss: this.iss, aud: this.aud }, this.secret);
  }

  private verify(token: string, typ: string) {
    return verifyJwt(token, this.secret, typ, { iss: this.iss, aud: this.aud });
  }

  private sessionLive(sid: unknown, userId: string): boolean {
    const s = typeof sid === "string" ? this.store.authSessions.get(sid) : undefined;
    return !!s && !s.revoked_at && s.user_id === userId && !!this.app.user(userId);
  }

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
    const access_token = this.sign({ sub: userId, sid: familyId, typ: "access", iat: now, exp: now + ACCESS_TTL_S, jti: randomBytes(8).toString("hex") });
    const refresh_token = `rt_${randomBytes(32).toString("base64url")}`;
    this.store.refreshTokens.set(sha256(refresh_token), {
      hash: sha256(refresh_token), family_id: familyId, user_id: userId, expires_at: Date.now() + REFRESH_TTL_S * 1000, used: false,
    });
    return { access_token, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token, refresh_expires_in: REFRESH_TTL_S };
  }

  /** Returns {userId, sessionId} or throws token_expired. Checks session revocation and user deletion on every call. */
  authenticate(accessToken: string): { userId: string; sessionId: string } {
    const r = this.verify(accessToken, "access");
    const expired = new DomainError("token_expired", "로그인이 만료됐어요. 다시 로그인해 주세요.");
    if (!r.ok) throw expired;
    const sid = String(r.claims.sid ?? "");
    const s = this.store.authSessions.get(sid);
    if (!s || s.revoked_at || s.user_id !== r.claims.sub || !this.app.user(r.claims.sub)) throw expired;
    return { userId: r.claims.sub, sessionId: sid };
  }

  /**
   * Step-up (H-1, partial). The token is bound to the login session (`sid`), dies with it,
   * and carries a `jti` so high-risk operations can spend it exactly once.
   *
   * TODO(H-1, MVP): this still trusts the app's claim that biometric auth succeeded. Replace with
   * a server nonce challenge (POST /v1/auth/step-up/challenge) answered by a device-key assertion
   * (Android Keystore key with setUserAuthenticationRequired(true), iOS Secure Enclave with
   * biometryCurrentSet, or a WebAuthn/passkey assertion), public key registered at login.
   */
  stepUp(userId: string, sessionId: string): { step_up_token: string; expires_in: number; expires_at: string } {
    if (!this.sessionLive(sessionId, userId)) throw new DomainError("token_expired", "로그인이 만료됐어요. 다시 로그인해 주세요.");
    const now = Math.floor(Date.now() / 1000);
    const step_up_token = this.sign({ sub: userId, sid: sessionId, typ: "step_up", iat: now, exp: now + STEP_UP_TTL_S, jti: randomBytes(12).toString("hex") });
    return { step_up_token, expires_in: STEP_UP_TTL_S, expires_at: new Date((now + STEP_UP_TTL_S) * 1000).toISOString() };
  }

  /**
   * Valid when signed for this user AND this session, the session is not revoked, and (for
   * `consume`) the token hasn't been spent. `consume: true` marks it spent — use for high-risk
   * operations (DELETE /me, exports). Other uses keep the 5-minute window.
   */
  hasStepUp(token: string | undefined, userId: string, sessionId: string, opts: { consume?: boolean } = {}): boolean {
    if (!token) return false;
    const r = this.verify(token, "step_up");
    if (!r.ok || r.claims.sub !== userId || r.claims.sid !== sessionId || !this.sessionLive(sessionId, userId)) return false;
    const jti = typeof r.claims.jti === "string" ? r.claims.jti : "";
    if (!jti || this.usedStepUps.has(jti)) return false;
    if (opts.consume) {
      const now = Date.now();
      if (this.usedStepUps.size > 10_000) for (const [k, exp] of this.usedStepUps) if (exp <= now) this.usedStepUps.delete(k);
      this.usedStepUps.set(jti, r.claims.exp * 1000);
    }
    return true;
  }

  /** Short-lived signed download token for exports (10 min), bound to the session that asked for it. */
  signDownload(exportId: string, userId: string, sessionId: string, ttlS = 600): { token: string; expires_at: string } {
    const now = Math.floor(Date.now() / 1000);
    return {
      token: this.sign({ sub: userId, sid: sessionId, exp_id: exportId, typ: "export_dl", iat: now, exp: now + ttlS }),
      expires_at: new Date((now + ttlS) * 1000).toISOString(),
    };
  }

  /** M-5: returns the owner only when the token matches the export AND its session is still live. */
  verifyDownload(token: string, exportId: string): string | null {
    const r = this.verify(token, "export_dl");
    return r.ok && r.claims.exp_id === exportId && this.sessionLive(r.claims.sid, r.claims.sub) ? r.claims.sub : null;
  }
}
