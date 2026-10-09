import { createHash, randomBytes } from "node:crypto";
import { LoginInputSchema, SessionSchema } from "@cfp/kith-inn-contracts";
import type { Pool, PoolClient } from "pg";
import { ApiError } from "./auth";
import { inTransaction } from "./database";

export type ActiveSession = { merchantId: string; memberId: string; tokenHash: Buffer };
const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "请重新登录");
const forbidden = () => new ApiError(403, "FORBIDDEN", "当前账号没有经营权限");
const digest = (token: string) => createHash("sha256").update(token).digest();

export class Sessions {
  constructor(
    private readonly pool: Pool,
    private readonly identity: { appId: string },
    private readonly exchange: (code: string) => Promise<string>,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async login(code: string) {
    const parsed = LoginInputSchema.safeParse({ code });
    if (!parsed.success || !code.trim()) throw new ApiError(400, "INVALID_REQUEST", "登录凭证无效");
    const openid = await this.exchange(code);
    const token = randomBytes(32).toString("base64url");
    const createdAt = this.clock();
    const expiresAt = new Date(createdAt.getTime() + 30 * 86_400_000);
    const member = await inTransaction(this.pool, async (client) => {
      const { rows: [member] } = await client.query(`SELECT member.id, member.merchant_id, member.active
        FROM merchant_members member JOIN merchants m ON m.id = member.merchant_id
        WHERE member.app_id = $1 AND member.openid = $2 AND m.active FOR UPDATE OF m`, [this.identity.appId, openid]);
      if (!member?.active) throw forbidden();
      // Re-read after the store lock: revocation may have committed while we waited.
      const active = await client.query("SELECT 1 FROM merchant_members WHERE id = $1 AND active", [member.id]);
      if (!active.rowCount) throw forbidden();
      await client.query(`INSERT INTO sessions (token_hash, merchant_id, member_id, created_at, expires_at)
        VALUES ($1, $2, $3, $4, $5)`, [digest(token), member.merchant_id, member.id, createdAt, expiresAt]);
      return member;
    });
    return SessionSchema.parse({ token, expiresAt: expiresAt.toISOString(), memberId: member.id, merchantId: member.merchant_id });
  }

  async authenticate(token: string): Promise<ActiveSession> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unauthorized();
    const tokenHash = digest(token);
    const { rows: [session] } = await this.pool.query(`
      SELECT m.id, m.active, member.id AS member_id, member.active AS member_active, member.app_id FROM sessions s
      JOIN merchants m ON m.id = s.merchant_id
      JOIN merchant_members member ON member.id = s.member_id AND member.merchant_id = m.id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2`, [tokenHash, this.clock()]);
    if (!session) throw unauthorized();
    if (!session.active || !session.member_active || session.app_id !== this.identity.appId) throw forbidden();
    return { merchantId: session.id, memberId: session.member_id, tokenHash };
  }

  async withSession<T>(session: ActiveSession, work: (client: PoolClient) => Promise<T>): Promise<T> {
    return inTransaction(this.pool, async (client) => {
      const { rows: [merchant] } = await client.query("SELECT active FROM merchants WHERE id = $1 FOR UPDATE", [session.merchantId]);
      if (!merchant?.active) throw forbidden();
      const result = await client.query(`SELECT 1 FROM sessions s
        JOIN merchant_members member ON member.id = s.member_id AND member.merchant_id = s.merchant_id
        WHERE s.token_hash = $1 AND s.merchant_id = $2 AND s.member_id = $3 AND member.app_id = $4
        AND member.active AND s.revoked_at IS NULL AND s.expires_at > $5`,
      [session.tokenHash, session.merchantId, session.memberId, this.identity.appId, this.clock()]);
      if (!result.rowCount) throw unauthorized();
      return work(client);
    });
  }

  async revoke(session: ActiveSession): Promise<void> {
    await this.withSession(session, async (client) => {
      await client.query("UPDATE sessions SET revoked_at = $2 WHERE token_hash = $1", [session.tokenHash, this.clock()]);
    });
  }
}
