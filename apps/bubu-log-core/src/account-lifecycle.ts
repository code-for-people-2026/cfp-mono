import type { Pool, PoolClient } from 'pg';
import { LifecycleError, corePool } from './lifecycle';
const limit = 10000;
function userScope(id: string) { if (!id || id.length > 200 || Array.from(id).some(char => char.charCodeAt(0) < 32)) throw new LifecycleError('INVALID_USER',400); }
/** Private, proven account scope only. Never deletes a Baby, Activity or DailyStat. */
export class PostgresAccountLifecycle {
  constructor(private readonly pool: Pool, private readonly externalAvatarOrigins: readonly string[] = []) {}
  private async transaction<T>(readOnly: boolean, action: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query(readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
      await db.query("SET LOCAL statement_timeout='15s'"); await db.query("SET LOCAL lock_timeout='5s'");
      if (!readOnly) await db.query('LOCK TABLE "User", "Account", "Session", "BabyUser", "AuditLog", "VerificationToken", payload_locked_documents, payload_locked_documents_rels IN SHARE ROW EXCLUSIVE MODE');
      const result = await action(db); await db.query('COMMIT'); return result;
    } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; } finally { db.release(); }
  }
  async exportAccountData(userId: string) {
    userScope(userId);
    return this.transaction(true, async db => {
      const rows = async (sql: string) => {
        const result = await db.query(sql+` LIMIT ${limit+1}`,[userId]);
        if (result.rows.length > limit) throw new LifecycleError('EXPORT_TOO_LARGE',413);
        return result.rows;
      };
      // Explicit allowlists: passwords, provider tokens and sessionToken never enter an export.
      const profile = (await rows('SELECT id,username,name,email,email_verified,image,role,created_at,updated_at FROM "User" WHERE id=$1'))[0] || null;
      const result = { format:'bubu-original-account-v1', userId, profile,
        connections:await rows('SELECT id,type,provider,"providerAccountId" FROM "Account" WHERE "userId"=$1 ORDER BY id'),
        sessions:await rows('SELECT expires FROM "Session" WHERE "userId"=$1 ORDER BY expires'),
        memberships:await rows('SELECT id,baby_id,is_default,created_at FROM "BabyUser" WHERE user_id=$1 ORDER BY id') };
      if (Buffer.byteLength(JSON.stringify(result)) > 9*1024*1024) throw new LifecycleError('EXPORT_TOO_LARGE',413);
      return result;
    });
  }
  async deleteAccountData(userId: string) {
    userScope(userId);
    await this.transaction(false, async db => {
      const user = (await db.query<{image: string|null}>('SELECT image FROM "User" WHERE id=$1',[userId])).rows[0];
      if (user?.image) {
        let url: URL;
        try { url = new URL(user.image); } catch { throw new LifecycleError('ACCOUNT_MEDIA_OWNER_UNRESOLVED'); }
        if (url.protocol !== 'https:' || url.username || url.password || !this.externalAvatarOrigins.includes(url.origin)) throw new LifecycleError('ACCOUNT_MEDIA_OWNER_UNRESOLVED');
        // Verified third-party avatars are provider-owned: erase our reference, never revoke their object.
      }
      // The historical token table has no User FK and no active writer. Nonempty data requires ownership investigation.
      if ((await db.query('SELECT 1 FROM "VerificationToken" LIMIT 1')).rowCount) throw new LifecycleError('VERIFICATION_TOKEN_OWNER_UNRESOLVED');
      const locks = await db.query<{parent_id:number}>('DELETE FROM payload_locked_documents_rels WHERE "User_id"=$1 OR "BabyUser_id" IN (SELECT id FROM "BabyUser" WHERE user_id=$1) RETURNING parent_id',[userId]);
      await db.query('DELETE FROM payload_locked_documents WHERE id=ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM payload_locked_documents_rels r WHERE r.parent_id=payload_locked_documents.id)',[locks.rows.map(row => row.parent_id)]);
      await db.query('UPDATE "AuditLog" SET user_id=NULL WHERE user_id=$1',[userId]);
      await db.query('DELETE FROM "Account" WHERE "userId"=$1',[userId]);
      await db.query('DELETE FROM "Session" WHERE "userId"=$1',[userId]);
      await db.query('DELETE FROM "BabyUser" WHERE user_id=$1',[userId]);
      await db.query('DELETE FROM "User" WHERE id=$1',[userId]);
      // In particular, the last caregiver's departure never deletes the shared family history.
    });
  }
}
export const accountLifecycle = () => new PostgresAccountLifecycle(corePool(), (process.env.BUBU_CORE_EXTERNAL_AVATAR_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean));
