import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const directory = await mkdtemp(join(tmpdir(), 'privacy-snapshot-'));
const invoke = (...args) => execFileSync(process.execPath, ['scripts/privacy-snapshot.mjs', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const source = join(directory, 'source.db'), snapshot = join(directory, 'backup.db'), ledger = join(directory, 'ledger.ndjson');
  let db = new DatabaseSync(source);
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE privacy_profiles (id INTEGER PRIMARY KEY, owner TEXT, state TEXT, deleted_at TEXT)");
  for (const table of ['sessions', 'greetings', 'media', 'credentials', 'adk_sessions', 'session_locks', 'wechat_identities', 'age_profiles']) db.exec(`CREATE TABLE ${table} (owner TEXT)`);
  const old = new Date(Date.now() - 9 * 86400_000).toISOString();
  for (const [id, owner, state] of [[1, 'retire', 'deleted'], [2, 'partial', 'deleting'], [3, 'still-referenced', 'deleted'], [4, 'recent', 'deleted']]) db.prepare('INSERT INTO privacy_profiles VALUES (?, ?, ?, ?)').run(id, owner, state, old);
  db.prepare('INSERT INTO sessions VALUES (?)').run('still-referenced');
  invoke('backup', source, snapshot); // Includes committed WAL pages.
  assert.throws(() => invoke('backup', source, snapshot), 'backup overwrite must be refused');
  db.exec('DELETE FROM sessions'); db.close();
  invoke('restore', snapshot, source);
  db = new DatabaseSync(source);
  assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n, 1); db.close();
  const digest = (owner) => createHash('sha256').update(owner).digest('hex');
  await writeFile(ledger, ['retire', 'partial', 'still-referenced', 'recent', 'legacy-no-date'].map((owner) => JSON.stringify({ ownerDigest: digest(owner), ...(owner === 'legacy-no-date' ? {} : { requestedAt: owner === 'recent' ? new Date().toISOString() : old }) })).join('\n'));
  invoke('retire', source, ledger);
  db = new DatabaseSync(source);
  assert.deepEqual(db.prepare('SELECT owner FROM privacy_profiles ORDER BY id').all().map((r) => r.owner), ['partial', 'still-referenced', 'recent']); db.close();
  const remaining = await readFile(ledger, 'utf8');
  assert.ok(!remaining.includes(digest('retire')));
  for (const owner of ['partial', 'still-referenced', 'recent', 'legacy-no-date']) assert.ok(remaining.includes(digest(owner)));
  await writeFile(ledger, '{broken');
  assert.throws(() => invoke('retire', source, ledger));
  console.log('SQLite WAL snapshot/restore, overwrite refusal, mature deletion-guard retirement and failure preservation passed.');
} finally { await rm(directory, { recursive: true, force: true }); }
