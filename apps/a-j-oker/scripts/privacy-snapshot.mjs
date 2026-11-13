import { createReadStream } from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import { open, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const [action, source, target] = process.argv.slice(2);
const assertHealthy = (db) => {
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length)
    throw new Error('Database integrity check failed');
};
if (action === 'backup' || action === 'restore') {
  const from = new DatabaseSync(source, { readOnly: true });
  try {
    assertHealthy(from);
    if (action === 'backup') {
      // Never overwrite an existing rollback copy.
      const reservation = await open(target, 'wx', 0o600); await reservation.close();
    } else {
      // All writers MUST already be stopped. Checkpoint/close before replacing pages.
      const current = new DatabaseSync(target); current.exec('PRAGMA wal_checkpoint(TRUNCATE)'); current.close();
    }
    await backup(from, target);
    const persisted = await open(target, 'r');
    try { await persisted.sync(); } finally { await persisted.close(); }
    const directory = await open(path.dirname(target), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
    const checked = new DatabaseSync(target, { readOnly: true });
    try { assertHealthy(checked); } finally { checked.close(); }
  } finally { from.close(); }
} else if (action === 'retire') {
  // Called offline only after every declared backup directory was pruned to 7 days.
  // Keep a full extra day for scheduling skew and delayed completions.
  const cutoff = Date.now() - 8 * 86400_000;
  const unique = new Map();
  const remember = (bytes) => {
    if (bytes.length > 4096) throw new Error('Invalid deletion ledger');
    const line = bytes.toString('utf8').trim();
    if (!line) return;
    const row = JSON.parse(line);
    if (!/^[a-f0-9]{64}$/.test(row.ownerDigest)) throw new Error('Invalid deletion ledger');
    const previous = unique.get(row.ownerDigest);
    // An undated legacy entry must never be aged out by a later dated duplicate.
    if (!previous || (Number.isFinite(Date.parse(previous.requestedAt)) && (!Number.isFinite(Date.parse(row.requestedAt)) || Date.parse(row.requestedAt) > Date.parse(previous.requestedAt))))
      unique.set(row.ownerDigest, { ownerDigest: row.ownerDigest, requestedAt: row.requestedAt });
  };
  let pending = Buffer.alloc(0);
  for await (const chunk of createReadStream(target, { highWaterMark: 64 * 1024 })) {
    const buffer = Buffer.concat([pending, chunk]);
    let start = 0;
    for (let end = buffer.indexOf(10); end !== -1; end = buffer.indexOf(10, start)) {
      remember(buffer.subarray(start, end)); start = end + 1;
    }
    pending = buffer.subarray(start);
    if (pending.length > 4096) throw new Error('Invalid deletion ledger');
  }
  remember(pending);
  const records = [...unique.values()];
  const recent = new Set(records.filter((r) => !Number.isFinite(Date.parse(r.requestedAt)) || Date.parse(r.requestedAt) >= cutoff).map((r) => r.ownerDigest));
  const db = new DatabaseSync(source);
  const preserved = new Set(recent);
  try {
    assertHealthy(db);
    db.exec('BEGIN IMMEDIATE');
    const tables = ['sessions', 'greetings', 'media', 'credentials', 'adk_sessions', 'session_locks', 'wechat_identities', 'age_profiles'];
    const owners = db.prepare('SELECT id, owner, state, deleted_at FROM privacy_profiles').all();
    const remove = db.prepare("DELETE FROM privacy_profiles WHERE id = ? AND state = 'deleted'");
    for (const row of owners) {
      const digest = createHash('sha256').update(row.owner).digest('hex');
      if (row.state !== 'deleted' || !Number.isFinite(Date.parse(row.deleted_at)) || Date.parse(row.deleted_at) >= cutoff || recent.has(digest) || tables.some((table) => db.prepare(`SELECT 1 FROM ${table} WHERE owner = ? LIMIT 1`).get(row.owner))) {
        preserved.add(digest); continue;
      }
      remove.run(row.id);
    }
    db.exec('COMMIT');
    const temporary = target + '.compacting';
    const handle = await open(temporary, 'w', 0o600);
    try {
      const kept = records.filter((r) => preserved.has(r.ownerDigest));
      await handle.writeFile(kept.map((r) => JSON.stringify(r) + '\n').join(''));
      await handle.sync();
    } finally { await handle.close(); }
    await rename(temporary, target);
    const directory = await open(path.dirname(target), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { db.close(); }
} else throw new Error('Unknown privacy snapshot operation');
console.log(JSON.stringify({ operation: action, ok: true }));
