import type { Pool } from "pg";
import { IdSchema } from "@cfp/kith-inn-contracts";
import { inTransaction } from "./database";

// Maintenance only: not exposed by the HTTP server or available to the runtime role.
export async function grantMember(pool: Pool, identity: { appId: string; openid: string }, merchantId?: string) {
  if (!identity.appId.trim() || !identity.openid.trim() || (merchantId !== undefined && !IdSchema.safeParse(merchantId).success)) {
    throw new Error("Invalid member identity or store");
  }
  return inTransaction(pool, async (client) => {
    // Serialize provisioning only; ordinary requests retain per-store locks.
    await client.query("SELECT pg_advisory_xact_lock($1, $2)", [20261009, 3305]);
    const { rows: [existing] } = await client.query(
      "SELECT id, merchant_id FROM merchant_members WHERE app_id = $1 AND openid = $2", [identity.appId, identity.openid]);
    if (existing && merchantId && existing.merchant_id !== merchantId.toLowerCase()) throw new Error("Member already belongs to another store");
    let store = existing?.merchant_id ?? merchantId?.toLowerCase();
    if (!store) store = (await client.query("INSERT INTO merchants DEFAULT VALUES RETURNING id")).rows[0].id;
    const { rows: [merchant] } = await client.query("SELECT active FROM merchants WHERE id = $1 FOR UPDATE", [store]);
    if (!merchant?.active) throw new Error("Store unavailable");
    const { rows: [member] } = await client.query(`INSERT INTO merchant_members (merchant_id, app_id, openid)
      VALUES ($1, $2, $3) ON CONFLICT (app_id, openid)
      DO UPDATE SET active = true, updated_at = now()
      RETURNING id AS "memberId", merchant_id AS "merchantId"`, [store, identity.appId, identity.openid]);
    return member as { memberId: string; merchantId: string };
  });
}

export async function revokeMember(pool: Pool, memberId: string) {
  if (!IdSchema.safeParse(memberId).success) throw new Error("Invalid member");
  await inTransaction(pool, async (client) => {
    const { rows: [member] } = await client.query("SELECT merchant_id FROM merchant_members WHERE id = $1", [memberId]);
    if (!member) throw new Error("Member not found");
    await client.query("SELECT id FROM merchants WHERE id = $1 FOR UPDATE", [member.merchant_id]);
    await client.query("UPDATE merchant_members SET active = false, updated_at = now() WHERE id = $1", [memberId]);
    await client.query("UPDATE sessions SET revoked_at = now() WHERE member_id = $1 AND revoked_at IS NULL", [memberId]);
  });
}
