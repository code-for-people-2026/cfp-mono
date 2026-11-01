import pg, { type Pool, type PoolClient } from "pg";
export class LifecycleError extends Error { constructor(readonly code: string, readonly status = 503) { super(code); } }
export type ProfileOwners = Readonly<Record<string, string>>;
const MAX_ROWS = 10000;
function scope(id: string) { if (!id || id.length > 200 || Array.from(id).some(char => char.charCodeAt(0) < 32)) throw new LifecycleError("INVALID_BABY", 400); }
export function profileOwnersFromEnv(value = process.env.BUBU_CORE_LEGACY_PROFILE_OWNERS): ProfileOwners {
  if (!value) return {};
  const result: unknown = JSON.parse(value);
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new LifecycleError("LEGACY_PROFILE_MAPPING_INVALID");
  for (const [key, id] of Object.entries(result)) { scope(key); if (typeof id !== "string") throw new LifecycleError("LEGACY_PROFILE_MAPPING_INVALID"); scope(id); }
  return result as Record<string, string>;
}
export const AUDIT_SCOPE = `baby_id=$1 OR activity_id IN (SELECT id FROM "Activity" WHERE baby_id=$1) OR (resource_type='ACTIVITY' AND resource_id IN (SELECT id FROM "Activity" WHERE baby_id=$1))`;
export async function assertAuditOwnership(db: PoolClient) {
  const rows = await db.query(`SELECT 1 FROM "AuditLog" a LEFT JOIN "Activity" x ON x.id=a.activity_id LEFT JOIN "Activity" y ON y.id=a.resource_id AND a.resource_type='ACTIVITY' WHERE (a.baby_id IS NOT NULL AND x.baby_id IS NOT NULL AND a.baby_id<>x.baby_id) OR (a.baby_id IS NOT NULL AND y.baby_id IS NOT NULL AND a.baby_id<>y.baby_id) OR (x.baby_id IS NOT NULL AND y.baby_id IS NOT NULL AND x.baby_id<>y.baby_id) LIMIT 1`);
  if (rows.rowCount) throw new LifecycleError("LEGACY_AUDIT_SCOPE_CONFLICT");
}
/** Original PostgreSQL schema, one repeatable snapshot or atomic family deletion. No user-account deletion. */
export class PostgresFamilyLifecycle {
  constructor(private readonly pool: Pool, private readonly owners: ProfileOwners = {}) {}
  private async transaction<T>(readOnly: boolean, action: (db: PoolClient) => Promise<T>): Promise<T> {
    const db = await this.pool.connect();
    try {
      await db.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN");
      await db.query("SET LOCAL statement_timeout='15s'"); await db.query("SET LOCAL lock_timeout='5s'");
      // Deletion fences all old table writers too, not just this process. No data leaves until commit succeeds.
      if (!readOnly) await db.query('LOCK TABLE "Baby", "BabyUser", "Activity", "DailyStat", "AuditLog", "BabyProfile", payload_locked_documents, payload_locked_documents_rels IN SHARE ROW EXCLUSIVE MODE');
      const result = await action(db); await db.query("COMMIT"); return result;
    } catch (error) { await db.query("ROLLBACK").catch(() => {}); throw error; }
    finally { db.release(); }
  }
  private async profiles(db: PoolClient, babyId: string) {
    await assertAuditOwnership(db);
    const profiles = await db.query<{id: string}>('SELECT id FROM "BabyProfile"');
    // Deprecated singleton rows have no family foreign key. Never silently delete somebody else's row.
    if (profiles.rows.some(row => !Object.hasOwn(this.owners, row.id))) throw new LifecycleError("LEGACY_PROFILE_OWNER_UNRESOLVED");
    return profiles.rows.filter(row => this.owners[row.id] === babyId).map(row => row.id);
  }
  async exportFamilyData(babyId: string) {
    scope(babyId);
    return this.transaction(true, async db => {
      const profileIds = await this.profiles(db, babyId);
      const rows = async (sql: string, params: unknown[] = [babyId]) => {
        const result = await db.query(sql + ` LIMIT ${MAX_ROWS + 1}`, params);
        if (result.rows.length > MAX_ROWS) throw new LifecycleError("EXPORT_TOO_LARGE", 413);
        return result.rows;
      };
      const baby = await rows('SELECT * FROM "Baby" WHERE id=$1');
      if (!baby.length) throw new LifecycleError("BABY_NOT_FOUND", 404);
      const result = { format: "bubu-original-payload-v1", babyId, tables: {
        Baby: baby,
        BabyProfile: await rows('SELECT * FROM "BabyProfile" WHERE id=ANY($1::text[]) ORDER BY id', [profileIds]),
        BabyUser: await rows('SELECT * FROM "BabyUser" WHERE baby_id=$1 ORDER BY id'),
        Activity: await rows('SELECT * FROM "Activity" WHERE baby_id=$1 ORDER BY id'),
        DailyStat: await rows('SELECT * FROM "DailyStat" WHERE baby_id=$1 ORDER BY id'),
        AuditLog: await rows(`SELECT * FROM "AuditLog" WHERE ${AUDIT_SCOPE} ORDER BY id`),
      } };
      if (Buffer.byteLength(JSON.stringify(result)) > 9 * 1024 * 1024) throw new LifecycleError("EXPORT_TOO_LARGE", 413);
      return result;
    });
  }
  async deleteFamilyData(babyId: string): Promise<void> {
    scope(babyId);
    await this.transaction(false, async db => {
      const profileIds = await this.profiles(db, babyId);
      // Payload lock relations have no FK in the historical database. Remove scoped locks before the rows.
      const lockScope = `"Baby_id"=$1 OR "BabyUser_id" IN (SELECT id FROM "BabyUser" WHERE baby_id=$1) OR "Activity_id" IN (SELECT id FROM "Activity" WHERE baby_id=$1) OR "DailyStat_id" IN (SELECT id FROM "DailyStat" WHERE baby_id=$1) OR "AuditLog_id" IN (SELECT id FROM "AuditLog" WHERE ${AUDIT_SCOPE})`;
      const locks = await db.query<{parent_id: number}>(`DELETE FROM payload_locked_documents_rels WHERE ${lockScope} RETURNING parent_id`, [babyId]);
      await db.query('DELETE FROM payload_locked_documents WHERE id=ANY($1::int[]) AND NOT EXISTS (SELECT 1 FROM payload_locked_documents_rels r WHERE r.parent_id=payload_locked_documents.id)', [locks.rows.map(row => row.parent_id)]);
      // Delete audit content first: the old FK uses SET NULL and otherwise retains raw family content.
      await db.query(`DELETE FROM "AuditLog" WHERE ${AUDIT_SCOPE}`, [babyId]);
      for (const table of ["Activity", "DailyStat", "BabyUser"]) await db.query(`DELETE FROM "${table}" WHERE baby_id=$1`, [babyId]);
      await db.query('DELETE FROM "BabyProfile" WHERE id=ANY($1::text[])', [profileIds]);
      await db.query('DELETE FROM "Baby" WHERE id=$1', [babyId]);
      // No User, Account, Session, other families or unrelated template tables are modified.
    });
  }
}
let pool: pg.Pool | undefined;
export const corePool = () => pool ??= new pg.Pool({ connectionString: process.env.BUBU_CORE_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
let singleton: PostgresFamilyLifecycle | undefined;
export function familyLifecycle() {
  return singleton ??= new PostgresFamilyLifecycle(corePool(), profileOwnersFromEnv());
}
