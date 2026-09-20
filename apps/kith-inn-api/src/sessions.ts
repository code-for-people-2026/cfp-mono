import { createHash, randomBytes } from "node:crypto";
import { LoginInputSchema, SessionSchema } from "@cfp/kith-inn-contracts";
import type { Pool, PoolClient } from "pg";
import { ApiError } from "./auth";

export type ActiveSession = { merchantId: string; tokenHash: Buffer };
const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "请重新登录");
const forbidden = () => new ApiError(403, "FORBIDDEN", "当前账号没有经营权限");
const digest = (token: string) => createHash("sha256").update(token).digest();

export class Sessions {
  constructor(
    private readonly pool: Pool,
    private readonly owner: { appId: string; ownerOpenId: string },
    private readonly exchange: (code: string) => Promise<string>,
    private readonly clock: () => Date = () => new Date()
  ) {}

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async login(code: string) {
    const parsed = LoginInputSchema.safeParse({ code });
    if (!parsed.success || !code.trim()) throw new ApiError(400, "INVALID_REQUEST", "登录凭证无效");
    if (await this.exchange(code) !== this.owner.ownerOpenId) throw forbidden();
    const token = randomBytes(32).toString("base64url");
    const createdAt = this.clock();
    const expiresAt = new Date(createdAt.getTime() + 30 * 86_400_000);
    await this.transaction(async (client) => {
      await client.query(`INSERT INTO merchants (app_id, openid) VALUES ($1, $2)
        ON CONFLICT (singleton) DO NOTHING`, [this.owner.appId, this.owner.ownerOpenId]);
      const { rows: [merchant] } = await client.query("SELECT * FROM merchants WHERE singleton FOR UPDATE");
      if (!merchant?.active || merchant.app_id !== this.owner.appId ||
          merchant.openid !== this.owner.ownerOpenId) throw forbidden();
      await client.query(`INSERT INTO sessions (token_hash, merchant_id, created_at, expires_at)
        VALUES ($1, $2, $3, $4)`, [digest(token), merchant.id, createdAt, expiresAt]);
    });
    return SessionSchema.parse({ token, expiresAt: expiresAt.toISOString() });
  }

  async authenticate(token: string): Promise<ActiveSession> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized();
    const tokenHash = digest(token);
    const { rows: [session] } = await this.pool.query(`
      SELECT m.id, m.active, m.app_id, m.openid FROM sessions s
      JOIN merchants m ON m.id = s.merchant_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`, [tokenHash, this.clock()]);
    if (!session) throw unauthorized();
    if (!session.active || session.app_id !== this.owner.appId ||
        session.openid !== this.owner.ownerOpenId) throw forbidden();
    return { merchantId: session.id, tokenHash };
  }

  async revoke(session: ActiveSession): Promise<void> {
    await this.transaction(async (client) => {
      const { rows: [merchant] } = await client.query("SELECT * FROM merchants WHERE id = $1 FOR UPDATE", [session.merchantId]);
      if (!merchant?.active || merchant.app_id !== this.owner.appId ||
          merchant.openid !== this.owner.ownerOpenId) throw forbidden();
      const result = await client.query(`UPDATE sessions SET revoked_at = $3
        WHERE token_hash = $1 AND merchant_id = $2 AND revoked_at IS NULL AND expires_at > $3`,
      [session.tokenHash, session.merchantId, this.clock()]);
      if (!result.rowCount) throw unauthorized();
    });
  }
}
