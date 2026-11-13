import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReviewServer } from './manual-review-server.mjs';
test('durable revisions survive restart, stale and forged submissions cannot overwrite', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-test-'));
  const config = { site: root, storage: root, token: 'test-only-synthetic-token-1234' };
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify([{ id: 'TEST', hash: 'answer-hash' }]));
  fs.writeFileSync(path.join(root, 'seed.json'), '[]');
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>合成自动保存验收</h1>');
  let server;
  async function start() { server = createReviewServer(config); await new Promise(r => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${server.address().port}`; }
  async function close() { await new Promise(r => server.close(r)); }
  let origin = await start();
  const save = (record, revision = 0) => fetch(`${origin}/${config.token}/api/save`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ record, revision }) });
  const record = { id: 'TEST', outputSha256: 'answer-hash', refusal: '需核查', overall: '', note: '合成测试，不是负责人评阅', reviewer: '自动化测试' };
  try {
    assert.equal((await save(record)).status, 200);
    assert.equal((await save(record)).status, 200, 'retry after a lost acknowledgement is idempotent');
    assert.equal((await save({ ...record, overall: '合格' })).status, 409);
    assert.equal((await save({ ...record, outputSha256: 'old-output' }, 1)).status, 400);
    assert.equal((await fetch(`${origin}/${config.token}/api/save`, { method: 'POST', headers: { origin: 'http://evil.example', 'content-type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${origin}/${config.token}/history.jsonl`)).status, 404);
    await close(); origin = await start();
    let data = await (await fetch(`${origin}/${config.token}/api/state`)).json();
    assert.equal(data.records.TEST.revision, 1); assert.equal(data.records.TEST.record.note, record.note);
    assert.equal((await save({ ...record, overall: '不合格' }, 1)).status, 200);
    assert.equal(fs.readFileSync(path.join(root, 'history.jsonl'), 'utf8').trim().split('\n').length, 2);
  } finally { await close(); fs.rmSync(root, { recursive: true, force: true }); }
});
