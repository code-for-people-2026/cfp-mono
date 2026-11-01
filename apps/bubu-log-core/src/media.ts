import type { Pool } from 'pg';
import { LifecycleError, AUDIT_SCOPE, assertAuditOwnership, type ProfileOwners } from './lifecycle';
export interface MediaReference { kind: 'activity' | 'baby-avatar' | 'profile-avatar' | 'audit-photo'; documentId: string; babyId: string; url: string }
export function replaceMedia(value: unknown, before: string, after: string): unknown {
  if (typeof value === 'string') {
    if (value === before) return after;
    // Structured snapshots may have been serialized a second time by older clients.
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        const changed = replaceMedia(parsed, before, after);
        return JSON.stringify(changed) === JSON.stringify(parsed) ? value : JSON.stringify(changed);
      }
    } catch { /* Plain text: replace complete URL tokens only. */ }
    return value.replace(/https:\/\/[^\s<>"'\\，。；！？]+/gu, token => {
      if (token === before) return after;
      const trimmed = token.replace(/[.,;:!?)}\]]+$/u, '');
      return trimmed === before ? after + token.slice(trimmed.length) : token;
    });
  }
  if (Array.isArray(value)) return value.map(item => replaceMedia(item, before, after));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceMedia(item, before, after)]));
  return value;
}
/** Only photo fields are media; unrelated links in user text are not downloads. */
export function photoUrls(value: unknown): string[] {
  const urls = new Set<string>();
  const visit = (item: unknown) => {
    if (typeof item === 'string') { try { visit(JSON.parse(item)); } catch { /* Plain text. */ } return; }
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (['poopPhotoUrl','poop_photo_url','avatarUrl','avatar_url'].includes(key) && typeof child === 'string' && child && !['known','pending','unknown','not_applicable','not_yet'].includes(child)) urls.add(child);
      else visit(child);
    }
  };
  visit(value); return [...urls];
}
/** Offline migration port. It updates references only; copying and encrypted bytes belong to the sidecar. */
export class OriginalMediaReferences {
  constructor(private readonly pool: Pool, private readonly owners: ProfileOwners = {}) {}
  async inventory(): Promise<{ references: MediaReference[]; unresolvedProfiles: number }> {
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await assertAuditOwnership(db);
      const rows = await db.query<{kind: MediaReference['kind']; documentId: string; babyId: string; url: string}>(`SELECT 'activity' AS kind, id AS "documentId", baby_id AS "babyId", poop_photo_url AS url FROM "Activity" WHERE poop_photo_url IS NOT NULL AND poop_photo_url<>'' UNION ALL SELECT 'baby-avatar',id,id,avatar_url FROM "Baby" WHERE avatar_url IS NOT NULL AND avatar_url<>''`);
      const profiles = await db.query<{id: string; url: string}>('SELECT id,"avatarUrl" AS url FROM "BabyProfile" WHERE "avatarUrl" IS NOT NULL AND "avatarUrl"<>\'\'');
      const references = [...rows.rows]; let unresolvedProfiles = 0;
      for (const row of profiles.rows) {
        if (!Object.hasOwn(this.owners, row.id)) { unresolvedProfiles++; continue; }
        references.push({ kind: 'profile-avatar', documentId: row.id, babyId: this.owners[row.id]!, url: row.url });
      }
      const audits = await db.query(`SELECT a.id,COALESCE(a.baby_id,activity.baby_id,resource.baby_id) AS "babyId",a.before_data,a.after_data FROM "AuditLog" a LEFT JOIN "Activity" activity ON activity.id=a.activity_id LEFT JOIN "Activity" resource ON resource.id=a.resource_id AND a.resource_type='ACTIVITY'`);
      for (const audit of audits.rows) for (const url of photoUrls([audit.before_data,audit.after_data])) {
        if (!audit.babyId) throw new LifecycleError('LEGACY_MEDIA_OWNER_UNRESOLVED');
        references.push({ kind: 'audit-photo', documentId: audit.id, babyId: audit.babyId, url });
      }
      await db.query('COMMIT'); return { references, unresolvedProfiles };
    } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; } finally { db.release(); }
  }
  async replace(reference: MediaReference, privateUri: string) {
    if (!/^bubu-attachment:att_[a-f0-9]{64}$/.test(privateUri) || !reference.babyId || reference.babyId.length > 200 || !reference.documentId || reference.documentId.length > 200 || !reference.url || reference.url.length > 4096) throw new LifecycleError('INVALID_MEDIA_REFERENCE', 400);
    let source: URL;
    try { source = new URL(reference.url); } catch { throw new LifecycleError('INVALID_MEDIA_REFERENCE', 400); }
    if (source.protocol !== 'https:' || source.username || source.password) throw new LifecycleError('INVALID_MEDIA_REFERENCE', 400);
    const fields = reference.kind === 'activity' ? ['Activity','poop_photo_url','baby_id'] : reference.kind === 'baby-avatar' ? ['Baby','avatar_url','id'] : reference.kind === 'profile-avatar' ? ['BabyProfile','avatarUrl',null] : undefined;
    if (!fields && reference.kind !== 'audit-photo') throw new LifecycleError('INVALID_MEDIA_REFERENCE', 400);
    if (reference.kind === 'profile-avatar' && (!Object.hasOwn(this.owners,reference.documentId) || this.owners[reference.documentId] !== reference.babyId)) throw new LifecycleError('LEGACY_PROFILE_OWNER_UNRESOLVED');
    const db = await this.pool.connect();
    try {
      await db.query('BEGIN'); await db.query("SET LOCAL lock_timeout='5s'"); await db.query("SET LOCAL statement_timeout='15s'");
      await db.query('LOCK TABLE "Baby", "Activity", "BabyProfile", "AuditLog" IN SHARE ROW EXCLUSIVE MODE');
      await assertAuditOwnership(db);
      const audits = await db.query(`SELECT id,input_text,description,error_message,before_data,after_data FROM "AuditLog" WHERE ${AUDIT_SCOPE}`, [reference.babyId]);
      if (fields) {
        const [table,column,family] = fields;
        const current = await db.query<{url: string}>(`SELECT "${column}" AS url FROM "${table}" WHERE id=$1${family ? ` AND "${family}"=$2` : ''}`, family ? [reference.documentId,reference.babyId] : [reference.documentId]);
        if (current.rows.length !== 1 || ![reference.url, privateUri].includes(current.rows[0]!.url)) throw new LifecycleError('MEDIA_REFERENCE_CHANGED', 409);
      } else {
        const current = audits.rows.find(row => row.id === reference.documentId);
        if (!current || !photoUrls([current.before_data,current.after_data]).some(url => url === reference.url || url === privateUri)) throw new LifecycleError('MEDIA_REFERENCE_CHANGED', 409);
      }
      // One family/source mapping covers current records and all historical snapshots.
      await db.query('UPDATE "Activity" SET poop_photo_url=$1 WHERE baby_id=$2 AND poop_photo_url=$3', [privateUri,reference.babyId,reference.url]);
      await db.query('UPDATE "Baby" SET avatar_url=$1 WHERE id=$2 AND avatar_url=$3', [privateUri,reference.babyId,reference.url]);
      const profiles = Object.entries(this.owners).filter(([,babyId]) => babyId === reference.babyId).map(([id]) => id);
      if (profiles.length) await db.query('UPDATE "BabyProfile" SET "avatarUrl"=$1 WHERE id=ANY($2::text[]) AND "avatarUrl"=$3', [privateUri,profiles,reference.url]);
      for (const row of audits.rows) {
        const changed = replaceMedia(row, reference.url, privateUri) as typeof row;
        if (JSON.stringify(changed) !== JSON.stringify(row)) await db.query('UPDATE "AuditLog" SET input_text=$1,description=$2,error_message=$3,before_data=$4,after_data=$5 WHERE id=$6', [changed.input_text,changed.description,changed.error_message,changed.before_data,changed.after_data,row.id]);
      }
      await db.query('COMMIT'); return { babyId: reference.babyId, documentId: reference.documentId, uri: privateUri };
    } catch (error) { await db.query('ROLLBACK').catch(() => {}); throw error; } finally { db.release(); }
  }
}
