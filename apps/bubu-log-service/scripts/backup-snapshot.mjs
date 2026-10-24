import process from 'node:process';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { constants, createReadStream } from 'node:fs';
import { open, lstat, mkdir, readdir, chmod, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const objectName = /^[a-f0-9]{64}$/;
const validFile = name => name === 'database.pg' || name === 'sidecar/identity.db' || /^sidecar\/private-attachments\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(name);
const healthy = db => {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Invalid SQLite snapshot');
};
async function regular(file) {
  const stat = await lstat(file);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('Unsafe snapshot file');
  return stat;
}
async function directory(file) { if (!(await lstat(file)).isDirectory()) throw new Error('Unsafe snapshot directory'); }
async function copy(source, target) {
  await regular(source);
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW), output = await open(target, 'wx', 0o600);
  try { for await (const bytes of input.createReadStream({ autoClose: false })) await output.writeFile(bytes); await output.sync(); }
  finally { await input.close(); await output.close(); }
}
async function fingerprint(file) {
  const stat = await regular(file), hash = createHash('sha256');
  for await (const bytes of createReadStream(file, { flags: constants.O_RDONLY | constants.O_NOFOLLOW })) hash.update(bytes);
  return { bytes: stat.size, sha256: hash.digest('hex') };
}
async function inventory(root, prefix = '') {
  await directory(root); const result = [];
  for (const name of (await readdir(root)).sort()) {
    const relative = prefix + name, file = join(root, name), stat = await lstat(file);
    if (stat.isDirectory()) {
      if (!['sidecar', 'sidecar/private-attachments'].includes(relative) && !/^sidecar\/private-attachments\/[a-f0-9]{64}$/.test(relative)) throw new Error('Unexpected snapshot directory');
      result.push(...await inventory(file, relative + '/'));
    } else {
      if (relative === 'manifest.json') { await regular(file); continue; }
      if (!validFile(relative)) throw new Error('Unexpected snapshot entry');
      result.push({ name: relative, ...await fingerprint(file) });
    }
  }
  return result;
}

/** Writers must be stopped by the host runner. Only database and encrypted objects are included. */
export async function captureSnapshot(source, postgresDump, target) {
  source = resolve(source); target = resolve(target);
  await directory(source);
  const entries = await readdir(source);
  // Keys, deletion ledgers, unknown files and a surviving writer lease must never be silently copied or skipped.
  if (!entries.includes('identity.db') || entries.some(name => !['identity.db', 'identity.db-wal', 'identity.db-shm', 'private-attachments'].includes(name))) throw new Error('Unexpected live data entry or active writer');
  for (const name of entries.filter(name => name !== 'private-attachments')) await regular(join(source, name));
  await mkdir(target, { mode: 0o700 }); await mkdir(join(target, 'sidecar'), { mode: 0o700 });
  const original = new DatabaseSync(join(source, 'identity.db'), { readOnly: true });
  try { healthy(original); await backup(original, join(target, 'sidecar/identity.db')); } finally { original.close(); }
  // The backup API preserves WAL mode. Normalize the isolated copy so verification never creates side files.
  const consolidated = new DatabaseSync(join(target, 'sidecar/identity.db'));
  try { consolidated.exec('PRAGMA journal_mode=DELETE'); healthy(consolidated); } finally { consolidated.close(); }
  await chmod(join(target, 'sidecar/identity.db'), 0o600);
  const persisted = await open(join(target, 'sidecar/identity.db'), 'r'); try { await persisted.sync(); } finally { await persisted.close(); }
  await copy(postgresDump, join(target, 'database.pg'));
  if (entries.includes('private-attachments')) {
    const objects = join(source, 'private-attachments'); await directory(objects);
    await mkdir(join(target, 'sidecar/private-attachments'), { mode: 0o700 });
    for (const owner of await readdir(objects)) {
      if (!objectName.test(owner)) throw new Error('Unexpected media owner');
      await directory(join(objects, owner)); await mkdir(join(target, 'sidecar/private-attachments', owner), { mode: 0o700 });
      for (const name of await readdir(join(objects, owner))) {
        if (!objectName.test(name)) throw new Error('Unexpected media object');
        const handle = await open(join(objects, owner, name), constants.O_RDONLY | constants.O_NOFOLLOW);
        try { const prefix = Buffer.alloc(11); await handle.read(prefix, 0, 11, 0); if (prefix.toString() !== 'BUBUMEDIA1\0') throw new Error('Unencrypted media'); }
        finally { await handle.close(); }
        await copy(join(objects, owner, name), join(target, 'sidecar/private-attachments', owner, name));
      }
    }
  }
  const manifest = { version: 1, at: new Date().toISOString(), files: await inventory(target) };
  const file = await open(join(target, 'manifest.json'), 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(manifest)); await file.sync(); } finally { await file.close(); }
  await verifySnapshot(target);
  return { files: manifest.files.length };
}

/** Integrity evidence only. This does not replay deletions, decrypt media or approve production recovery. */
export async function verifySnapshot(target) {
  const stat = await regular(join(target, 'manifest.json'));
  if (stat.size > 16 * 1024 ** 2) throw new Error('Manifest exceeds limit');
  const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8')), actual = await inventory(target);
  if (manifest.version !== 1 || !Number.isFinite(Date.parse(manifest.at)) || !Array.isArray(manifest.files) || JSON.stringify(manifest.files) !== JSON.stringify(actual) || !actual.some(file => file.name === 'database.pg') || !actual.some(file => file.name === 'sidecar/identity.db')) throw new Error('Snapshot does not match manifest');
  const db = new DatabaseSync(join(target, 'sidecar/identity.db'), { readOnly: true });
  try { if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') throw new Error('Unconsolidated SQLite snapshot'); healthy(db); } finally { db.close(); }
  return { files: actual.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [action, source, pg, target] = process.argv.slice(2);
    if (action === 'capture' && source && pg && target) console.log(JSON.stringify(await captureSnapshot(source, pg, target)));
    else if (action === 'verify' && source && !pg) console.log(JSON.stringify(await verifySnapshot(source)));
    else throw new Error('Invalid snapshot command');
  } catch { console.error('bubu_snapshot_failed'); process.exitCode = 1; }
}
