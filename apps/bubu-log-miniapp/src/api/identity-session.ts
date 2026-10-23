import type { SessionStorage } from "./session";

type IdentityToken = { token: string; expiresAt: string };

/** Native-only identity credential. Browser sessions belong to HttpOnly cookies. */
export class IdentitySession {
  private readonly key: string;
  private session: IdentityToken | undefined;

  constructor(origin: string, private readonly storage: SessionStorage, private readonly now = Date.now) {
    this.key = `bubu-identity:${origin}`;
    const stored = storage.get(this.key);
    if (this.valid(stored)) this.session = stored;
    else storage.remove(this.key);
  }

  private valid(value: unknown): value is IdentityToken {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const row = value as Record<string, unknown>;
    return typeof row.token === "string" && /^[A-Za-z0-9._~-]+$/.test(row.token)
      && typeof row.expiresAt === "string" && Date.parse(row.expiresAt) > this.now();
  }

  save(session: IdentityToken): void {
    if (!this.valid(session)) throw new Error("登录凭证无效，请重试。");
    this.session = { token: session.token, expiresAt: session.expiresAt };
    this.storage.set(this.key, this.session);
  }

  header(): string | undefined {
    if (!this.valid(this.session)) { this.clear(); return undefined; }
    return `Bearer ${this.session.token}`;
  }

  clear(): void { this.session = undefined; this.storage.remove(this.key); }
}
