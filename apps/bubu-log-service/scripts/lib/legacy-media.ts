import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, readFileSync, writeSync, fsyncSync, fstatSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { IdentityService } from '../../src/identity';
import { recordTables } from '../../src/records/persistence';
import type { LegacyMediaReference } from '../../src/legacy';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const hex = z.string().regex(/^[a-f0-9]{64}$/);
const entrySchema = z.object({
  at: z.string().datetime(), kind: z.enum(['activity','baby-avatar','profile-avatar','audit-photo','sidecar-photo']),
  documentId: z.string().min(1).max(200), babyId: z.string().min(1).max(200), url: z.string().url().max(4096).refine(value => { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password; }),
  sourceSha256: hex, attachmentId: z.string().regex(/^att_[a-f0-9]{64}$/), normalizedSha256: hex,
}).strict();
export type MigrationEntry = z.infer<typeof entrySchema>;
export type MigrationReference = LegacyMediaReference | { kind: 'sidecar-photo'; documentId: string; babyId: string; url: string };
export const sourceReference = (url: string) => ({ kind: 'legacy-source' as const, documentId: digest(url) });
/** Durable intent journal: complete, hash-chained entries are required before either store is changed. */
export class MediaMigrationManifest {
  private readonly fd: number;
  readonly entries: MigrationEntry[] = [];
  private previous = '0'.repeat(64);
  constructor(readonly file: string) {
    this.fd = openSync(file, constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = fstatSync(this.fd);
      if (!stat.isFile() || stat.mode & 0o077 || stat.size > 50 * 1024 * 1024) throw new Error('Migration manifest must be private and bounded');
      const content = readFileSync(this.fd, 'utf8');
      if (content && !content.endsWith('\n')) throw new Error('Incomplete migration manifest; recover it before any reference changes');
      for (const line of content.split('\n').filter(Boolean)) {
        const row = JSON.parse(line), entry = entrySchema.parse(row.entry);
        const checksum = digest(this.previous + JSON.stringify(entry));
        if (row.previous !== this.previous || row.digest !== checksum) throw new Error('Migration manifest integrity failure');
        this.checkConflict(entry); this.entries.push(entry); this.previous = checksum;
      }
    } catch (error) { closeSync(this.fd); throw error; }
  }
  private checkConflict(entry: MigrationEntry) {
    const old = this.entries.find(row => row.babyId === entry.babyId && row.url === entry.url);
    if (old && (old.attachmentId !== entry.attachmentId || old.sourceSha256 !== entry.sourceSha256 || old.normalizedSha256 !== entry.normalizedSha256)) throw new Error('Migration source or normalization changed');
  }
  append(raw: MigrationEntry) {
    const entry = entrySchema.parse(raw); this.checkConflict(entry);
    const checksum = digest(this.previous + JSON.stringify(entry));
    const bytes = Buffer.from(JSON.stringify({ entry, previous: this.previous, digest: checksum }) + '\n');
    let offset = 0;
    while (offset < bytes.length) { const count = writeSync(this.fd, bytes, offset); if (count < 1) throw new Error('Incomplete migration journal write'); offset += count; }
    fsyncSync(this.fd);
    const parent = openSync(path.dirname(this.file), constants.O_RDONLY); try { fsyncSync(parent); } finally { closeSync(parent); }
    this.entries.push(entry); this.previous = checksum;
  }
  close() { closeSync(this.fd); }
}

const migrationTables = [...recordTables.filter(table => table !== 'care-attachments'), 'chat-turns', 'safety-signals', 'privacy-requests'] as const;
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
export function rewriteMedia(value: unknown, before: string, after: string): unknown {
  if (typeof value === 'string') {
    if (value === before) return after;
    // Structured snapshots may have been serialized a second time by older clients.
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        const changed = rewriteMedia(parsed, before, after);
        return JSON.stringify(changed) === JSON.stringify(parsed) ? value : JSON.stringify(changed);
      }
    } catch { /* Plain text: replace complete URL tokens only. */ }
    return value.replace(/https:\/\/[^\s<>"'\\，。；！？]+/gu, token => {
      if (token === before) return after;
      const trimmed = token.replace(/[.,;:!?)}\]]+$/u, '');
      return trimmed === before ? after + token.slice(trimmed.length) : token;
    });
  }
  if (Array.isArray(value)) return value.map(item => rewriteMedia(item,before,after));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,rewriteMedia(item,before,after)]));
  return value;
}
/** Offline only: callers hold the runtime writer lock. IDs, versions and original request hashes remain intact. */
export class SidecarMediaReferences {
  constructor(private readonly identity: IdentityService, private readonly requireStorage: (babyId: string) => Promise<void>) {}
  async inventory(): Promise<MigrationReference[]> {
    return this.identity.exclusive(() => this.identity.store.transaction(async req => {
      const refs: MigrationReference[] = [];
      for (const collection of migrationTables) {
        if (!this.identity.store.payload.collections[collection]) continue;
        const rows = await this.identity.store.payload.find({ collection, pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
        for (const row of rows.docs) for (const url of photoUrls(row.value)) {
          if (typeof row.babyId !== 'string' || !row.babyId) throw new Error('Sidecar photo ownership is unresolved');
          refs.push({ kind: 'sidecar-photo', documentId: digest(`${collection}:${row.id}`), babyId: row.babyId, url });
        }
      }
      return refs;
    }));
  }
  async replace(babyId: string, before: string, after: string) {
    return this.identity.exclusive(() => this.identity.store.transaction(async req => {
      await this.requireStorage(babyId);
      for (const collection of migrationTables) {
        if (!this.identity.store.payload.collections[collection]) continue;
        const rows = await this.identity.store.payload.find({ collection, where: { babyId: { equals: babyId } }, pagination: false, limit: 0, depth: 0, overrideAccess: true, req });
        for (const row of rows.docs) {
          const value = rewriteMedia(row.value, before, after);
          if (JSON.stringify(value) !== JSON.stringify(row.value)) await this.identity.store.payload.update({ collection, id: row.id, data: { value }, overrideAccess: true, req });
        }
      }
    }));
  }
}
