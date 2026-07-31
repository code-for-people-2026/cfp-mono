import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ActiveSession, WeeklyMenuIdentity } from "./store";

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000;
const WECHAT_TIMEOUT_MS = 3_000;

export type AuthenticatedSession = ActiveSession;

export type SessionStore = Readonly<{
  createSession(input: Readonly<{
    id: string;
    identityId: string;
    tokenHash: string;
    expiresAt: string;
  }>): Promise<void>;
  findActiveSession(tokenHash: string, now?: Date): Promise<ActiveSession | null>;
  revokeSession(identityId: string, sessionId: string, revokedAt?: Date): Promise<boolean>;
  upsertWechatIdentity(identity: WeeklyMenuIdentity): Promise<WeeklyMenuIdentity>;
}>;

export type WechatCodeExchanger = Readonly<{
  exchange(code: string): Promise<{ openId: string }>;
}>;

export class AuthenticationError extends Error {
  constructor(readonly code: "INVALID_TOKEN" | "WECHAT_LOGIN_FAILED") {
    super(code);
    this.name = "AuthenticationError";
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function assertLoginCode(code: string): string {
  const value = code.trim();
  if (!value || value.length > 256) throw new AuthenticationError("WECHAT_LOGIN_FAILED");
  return value;
}

export function createWechatCodeExchanger(input: Readonly<{
  appId: string;
  appSecret: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}>): WechatCodeExchanger {
  const fetcher = input.fetcher ?? fetch;
  const timeoutMs = input.timeoutMs ?? WECHAT_TIMEOUT_MS;

  return {
    async exchange(code) {
      try {
        const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
        url.searchParams.set("appid", input.appId);
        url.searchParams.set("secret", input.appSecret);
        url.searchParams.set("js_code", assertLoginCode(code));
        url.searchParams.set("grant_type", "authorization_code");
        const response = await fetcher(url, {
          method: "GET",
          headers: { accept: "application/json" },
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) throw new AuthenticationError("WECHAT_LOGIN_FAILED");

        const payload: unknown = await response.json();
        if (!payload || typeof payload !== "object") {
          throw new AuthenticationError("WECHAT_LOGIN_FAILED");
        }
        const record = payload as Record<string, unknown>;
        const openId = typeof record.openid === "string" ? record.openid.trim() : "";
        if (!openId || record.errcode !== undefined) {
          throw new AuthenticationError("WECHAT_LOGIN_FAILED");
        }
        return { openId };
      } catch {
        // Never propagate fetch URLs or WeChat response details: both may contain secrets.
        throw new AuthenticationError("WECHAT_LOGIN_FAILED");
      }
    }
  };
}

export class SessionService {
  constructor(
    private readonly store: SessionStore,
    private readonly wechat: WechatCodeExchanger,
    private readonly clock: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID,
    private readonly createToken: () => string = () => randomBytes(32).toString("base64url")
  ) {}

  async login(code: string): Promise<Readonly<{ token: string; expiresAt: string }>> {
    const { openId } = await this.wechat.exchange(assertLoginCode(code));
    const identity = await this.store.upsertWechatIdentity({
      id: this.createId(),
      wechatOpenId: openId
    });
    const token = this.createToken();
    const expiresAt = new Date(this.clock().getTime() + SESSION_LIFETIME_MS).toISOString();
    await this.store.createSession({
      id: this.createId(),
      identityId: identity.id,
      tokenHash: hashToken(token),
      expiresAt
    });
    return { token, expiresAt };
  }

  async authenticate(token: string): Promise<AuthenticatedSession> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw new AuthenticationError("INVALID_TOKEN");
    }
    const session = await this.store.findActiveSession(hashToken(token), this.clock());
    if (!session) throw new AuthenticationError("INVALID_TOKEN");
    return session;
  }

  async revoke(session: AuthenticatedSession): Promise<void> {
    const revoked = await this.store.revokeSession(
      session.identityId,
      session.id,
      this.clock()
    );
    if (!revoked) throw new AuthenticationError("INVALID_TOKEN");
  }
}
