export interface SessionStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}

type StoredCookie = { value: string; path: string; secure: boolean; expiresAt?: number };
const authCookie = /^(?:__Secure-|__Host-)?(?:authjs|next-auth)\.(?:session-token(?:\.\d+)?|csrf-token|callback-url)$/;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** A cookie jar for the existing Auth.js endpoints, isolated by backend origin. */
export class SessionCookies {
  private readonly key: string;
  private cookies: Record<string, StoredCookie> = {};
  constructor(
    private readonly origin: string,
    private readonly storage: SessionStorage,
    private readonly now: () => number = Date.now,
  ) {
    this.key = `bubu-session:${origin}`;
    const saved = storage.get(this.key);
    if (!record(saved)) return;
    for (const [name, item] of Object.entries(saved)) {
      if (!authCookie.test(name) || !record(item) || typeof item.value !== "string" || /[\r\n;]/.test(item.value)) continue;
      if (typeof item.path !== "string" || typeof item.secure !== "boolean") continue;
      if (item.expiresAt !== undefined && (typeof item.expiresAt !== "number" || !Number.isFinite(item.expiresAt))) continue;
      this.cookies[name] = { value: item.value, path: item.path, secure: item.secure,
        ...(typeof item.expiresAt === "number" ? { expiresAt: item.expiresAt } : {}) };
    }
  }
  clear() {
    this.cookies = {};
    this.storage.remove(this.key);
  }
  receive(values: string[]) {
    const hostname = this.origin.replace(/^https?:\/\//, "").replace(/:\d+$/, "").toLowerCase();
    for (const combined of values) {
      // Some transports combine Set-Cookie headers; don't split the comma in Expires.
      for (const raw of combined.split(/,(?=\s*[^;,\s]+=)/)) {
        const [pair, ...attributes] = raw.split(";");
        const separator = pair.indexOf("=");
        if (separator < 1) continue;
        const name = pair.slice(0, separator).trim();
        const value = pair.slice(separator + 1).trim();
        if (!authCookie.test(name) || /[\r\n;]/.test(value)) continue;
        const attrs = new Map(attributes.map((part) => {
          const index = part.indexOf("=");
          return index < 0 ? [part.trim().toLowerCase(), ""] : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
        }));
        const domain = attrs.get("domain")?.replace(/^\./, "").toLowerCase();
        if (domain && hostname !== domain && !hostname.endsWith(`.${domain}`)) continue;
        const secure = attrs.has("secure") || name.startsWith("__Secure-") || name.startsWith("__Host-");
        if (secure && !this.origin.startsWith("https://")) continue;
        const maxAge = attrs.has("max-age") ? Number(attrs.get("max-age")) : NaN;
        const expires = Date.parse(attrs.get("expires") || "");
        const expiresAt = Number.isFinite(maxAge) ? this.now() + maxAge * 1000 : Number.isFinite(expires) ? expires : undefined;
        if (!value || (expiresAt !== undefined && expiresAt <= this.now())) delete this.cookies[name];
        else this.cookies[name] = { value, path: attrs.get("path") || "/", secure, ...(expiresAt !== undefined ? { expiresAt } : {}) };
      }
    }
    this.storage.set(this.key, this.cookies);
  }
  header(path: string): string {
    return Object.entries(this.cookies)
      .filter(([, item]) => (item.expiresAt === undefined || item.expiresAt > this.now()) &&
        (path === item.path || path.startsWith(item.path.endsWith("/") ? item.path : `${item.path}/`)) &&
        (!item.secure || this.origin.startsWith("https://")))
      .map(([name, item]) => `${name}=${item.value}`).join("; ");
  }
}
