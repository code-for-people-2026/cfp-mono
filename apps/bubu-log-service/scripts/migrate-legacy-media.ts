import { createHash } from 'node:crypto';
import path from 'node:path';
import { legacyBackendFromEnv } from '../src/legacy';
import { readLegacyPhoto } from '../src/media';
import { sanitizeAttachment } from '../src/records/attachments';
import { createRuntime } from '../src/runtime';
import { identityDirectory, operationsOrigin } from '../src/runtime-config';
import { MediaMigrationManifest, SidecarMediaReferences, sourceReference, type MigrationEntry } from './lib/legacy-media';
const apply = process.argv.includes('--apply');
const legacy = legacyBackendFromEnv();
if (apply && process.env.BUBU_LEGACY_MEDIA_WRITE_FENCE !== 'confirmed') throw new Error('Stop ALL legacy and sidecar writers before applying the migration');
const manifestPath = process.env.BUBU_LEGACY_MEDIA_MANIFEST || '';
if (apply && (!manifestPath || !path.isAbsolute(manifestPath) || manifestPath.startsWith(path.resolve(process.cwd()) + path.sep))) throw new Error('Keep the private absolute manifest outside the application directory');
const origins = (process.env.BUBU_LEGACY_MEDIA_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
let manifest: MediaMigrationManifest | undefined;
try {
  // Even a dry-run needs the writer lock to inspect sidecar snapshots consistently.
  runtime = await createRuntime({ directory: identityDirectory(), secret: process.env.BUBU_PAYLOAD_SECRET, publicOrigin: process.env.BUBU_PUBLIC_ORIGIN || 'http://127.0.0.1:3320', opsOrigin: operationsOrigin(), mcpUrl: 'http://127.0.0.1:3320/api/mcp', legacy, maintenanceWorker: false });
  if (apply) manifest = new MediaMigrationManifest(manifestPath);
  const sidecar = new SidecarMediaReferences(runtime.identity, babyId => runtime!.privacy.requireLegacyStorage(babyId));
  let deletedReceipts = 0;
  const finish = async (entry: MigrationEntry) => {
    // A completed deletion takes precedence over old import receipts. Keep the journal for source revocation.
    if (await runtime!.deletion.hasCompletedFamilyDeletion(entry.babyId)) { deletedReceipts++; return; }
    const uri = `bubu-attachment:${entry.attachmentId}`;
    const image = await runtime!.attachments.verifyLegacy(entry.babyId, sourceReference(entry.url), entry.attachmentId);
    if (image.sha256 !== entry.normalizedSha256) throw new Error('Migrated image checksum changed');
    if (entry.kind !== 'sidecar-photo') await legacy.replaceLegacyMedia({ ...entry, kind: entry.kind }, uri);
    // Replay on every invocation, including when a prior run changed core but crashed before SQLite committed.
    await sidecar.replace(entry.babyId, entry.url, uri);
  };
  if (manifest) {
    await runtime.deletion.replayAfterRestore();
    for (const entry of manifest.entries) await finish(entry);
  }
  const inventory = await legacy.listLegacyMedia();
  if (inventory.unresolvedProfiles) throw new Error('Historical profile ownership must be resolved before media migration');
  const references = [...inventory.references, ...await sidecar.inventory()];
  let copied = 0, alreadyPrivate = 0;
  const seen = new Set<string>();
  for (const item of references) {
    const key = JSON.stringify([item.babyId,item.url]); if (seen.has(key)) continue; seen.add(key);
    const existing = /^bubu-attachment:(att_[a-f0-9]{64})$/.exec(item.url)?.[1];
    if (existing) {
      if (manifest) {
        const entry = manifest.entries.find(row => row.babyId === item.babyId && row.attachmentId === existing);
        if (!entry) throw new Error('Private legacy reference has no verified source receipt');
        await finish(entry);
      }
      alreadyPrivate++; continue;
    }
    await runtime.privacy.requireLegacyStorage(item.babyId);
    const response = await readLegacyPhoto({ babyId: item.babyId, poopPhotoUrl: item.url }, item.babyId, { allowedOrigins: origins });
    const bytes = new Uint8Array(await response.arrayBuffer()), mime = response.headers.get('content-type') || '';
    await sanitizeAttachment(bytes, mime);
    if (manifest) {
      const attachment = await runtime.attachments.importLegacy(item.babyId, sourceReference(item.url), bytes, mime);
      const entry = { at: new Date().toISOString(), ...item, sourceSha256: createHash('sha256').update(bytes).digest('hex'), attachmentId: attachment.id, normalizedSha256: attachment.sha256 };
      manifest.append(entry); await finish(entry);
    }
    copied++;
  }
  if (manifest) {
    const remaining = [...(await legacy.listLegacyMedia()).references, ...await sidecar.inventory()];
    if (remaining.some(item => !/^bubu-attachment:att_[a-f0-9]{64}$/.test(item.url))) throw new Error('Unmigrated references remain; keep all writers stopped');
  }
  console.log(JSON.stringify({ apply, references: references.length, copied, alreadyPrivate, deletedReceipts, publicObjectsRevoked: false, notice: 'Revoke public objects only after independent end-to-end verification.' }));
} finally { manifest?.close(); await runtime?.close(); }
