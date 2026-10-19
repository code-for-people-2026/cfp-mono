import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import Database from "libsql";
import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-sqlite";
import { ContentReviewError } from "../src/domain/contracts";

const worker = process.argv[2] === "--worker";
const dir = worker ? process.argv[3] : await mkdtemp(path.join(tmpdir(), "hello-moderation-failure-"));
assert.ok(dir && path.basename(dir).startsWith("hello-moderation-failure-"));
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${dir}/test.db`, PAYLOAD_SECRET: "moderation-failure-isolated-test-only",
  HELLO_DEPLOYED: "true", HELLO_MEDIA_STORAGE: "database", NODE_ENV: "test",
});
const { cms } = await import("../src/cms/client");
const { migrations } = await import("../src/cms/migrations");
const { Repository } = await import("../src/cms/repository");
const { operationalModerator } = await import("../src/operations/moderation");
const payload = await cms();
let response: number | "cancel-failed" | "network" | "timeout" | "bad-json" | "allow" | "block" | "uncertain" = 500;
let calls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  assert.equal(String(url), "https://api.deepseek.com/chat/completions", "only an intercepted official request is permitted");
  assert.equal(new Headers(options?.headers).get("authorization"), "Bearer synthetic-review-key");
  calls++;
  if (response === "cancel-failed") return new Response(new ReadableStream({ cancel() { throw new Error("synthetic cancellation failure"); } }), { status: 401 });
  if (response === "network") throw new Error("synthetic-review-key provider private body");
  if (response === "timeout") throw new DOMException("synthetic private timeout", "TimeoutError");
  if (response === "bad-json") return new Response("not JSON");
  if (typeof response === "number") return new Response("synthetic provider private body", { status: response });
  return Response.json({ model: "synthetic-review", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ decision: response, category: "fraud" }) } }] });
};
const counts = () => Promise.all((["safety-cases", "safety-evidence", "safety-audit"] as const).map(async (collection) => (await payload.count({ collection, overrideAccess: true })).totalDocs));
const clear = async () => {
  await payload.db.drizzle.run(sql`DELETE FROM safety_evidence`);
  await payload.db.drizzle.run(sql`DELETE FROM safety_audit`);
  await payload.db.drizzle.run(sql`DELETE FROM safety_cases`);
};
const invoke = (owner: string, requestId: string = randomUUID(), apiKey: string | undefined = "synthetic-review-key", mode: "byok" | "platform" = "byok", stage: "input" | "output" = "input") =>
  operationalModerator(new Repository(payload, { id: owner, auth: "cookie" }))({ stage, mode, texts: ["我遭遇诈骗，想寻求帮助"], requestId, apiKey });
const refused = async (...args: Parameters<typeof invoke>) => {
  try { await invoke(...args); assert.fail("review must fail closed"); }
  catch (error) {
    assert.ok(error instanceof ContentReviewError, "review must expose only its safe domain error");
    assert.equal(error.status, 503);
    assert.doesNotMatch(error.message, /synthetic-review-key|private body/);
    return error.message;
  }
};
async function waitForFile(file: string) {
  const deadline = Date.now() + 60_000;
  while (true) {
    try { await access(file); return; }
    catch { assert.ok(Date.now() < deadline, "worker synchronization timed out"); await setTimeout(20); }
  }
}
const runWorker = (name: string, owner: string, requestId: string, attempts: number, barrier = "") => promisify(execFile)(process.execPath,
  ["--import", "tsx", "scripts/moderation-failure-check.ts", "--worker", dir, name, owner, requestId, String(attempts), barrier],
  { env: process.env, timeout: 120_000 });
function confirmWorker(stdout: string) {
  assert.match(stdout, /WORKER_OK/);
  // A fresh native read connection cannot see an uncommitted Payload request.
  // Verify every promise of a queued case against committed owner/stage/request.
  const reader = new Database(path.join(dir, "test.db"));
  try {
    for (const match of stdout.matchAll(/^RESULT=(.+)$/gm)) {
      const result = JSON.parse(match[1]);
      if (result.queued) {
        const rows = reader.prepare("SELECT receipt FROM safety_cases WHERE owner = ? AND stage = 'input' AND request_id = ? AND source = 'moderation' AND decision = 'unavailable'").all(result.owner, result.requestId);
        assert.equal(rows.length, 1, "a queued reply must correspond to exactly one committed failure case");
      }
    }
  } finally { reader.close(); }
}
let succeeded = false;
try {
  if (worker) {
    const [, , , , name, owner, requestId, attempts, barrier] = process.argv;
    if (barrier) { await writeFile(path.join(dir, `${barrier}-${name}`), "ready"); await waitForFile(path.join(dir, `${barrier}-go`)); }
    for (let index = 0; index < Number(attempts); index++) {
      const id = requestId === "different" ? `${barrier || name}-${name}-${index}` : requestId;
      const message = await refused(owner, id);
      console.log(`RESULT=${JSON.stringify({ owner, requestId: id, queued: message.includes("已记录待复核事项") })}`);
      await setTimeout(20);
    }
    console.log("WORKER_OK");
  } else {
    await payload.db.migrate({ migrations: migrations.map((migration) => ({ name: migration.name, up: (args: unknown) => migration.up(args as MigrateUpArgs), down: (args: unknown) => migration.down(args as MigrateDownArgs) })) });
    Object.assign(process.env, { HELLO_REVIEW_FAILURE_OWNER_DAILY_LIMIT: "20", HELLO_REVIEW_FAILURE_GLOBAL_DAILY_LIMIT: "100" });
    const owner = randomUUID();
    for (const status of [400, 401, 402, 403, 404, 422, 429, "cancel-failed"] as const) {
      response = status;
      assert.doesNotMatch(await refused(owner), /已记录|待复核事项/);
      assert.deepEqual(await counts(), [0, 0, 0], "known caller/configuration HTTP errors must not create content records");
    }
    const beforeMissing = calls;
    for (const key of ["", " \t\r\n ", "synthetic key", "synthetic\nkey", "synthetic\u0007key", "synthetic\u007fkey"]) {
      assert.doesNotMatch(await refused(owner, randomUUID(), key), /已记录|待复核事项/);
      assert.deepEqual(await counts(), [0, 0, 0]);
    }
    // Passing an omitted key without the helper's default explicitly exercises the production boundary.
    await assert.rejects(operationalModerator(new Repository(payload, { id: owner, auth: "cookie" }))({ stage: "input", texts: ["诈骗"], requestId: randomUUID(), mode: "byok" }), { status: 503 });
    assert.equal(calls, beforeMissing);
    response = 500;
    process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = "0";
    assert.doesNotMatch(await refused(owner, randomUUID(), "synthetic-review-key", "platform"), /已记录|待复核事项/);
    process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = "100";
    await payload.db.drizzle.run(sql`ALTER TABLE platform_model_quotas RENAME TO unavailable_model_quotas`);
    try { assert.doesNotMatch(await refused(owner, randomUUID(), "synthetic-review-key", "platform"), /已记录|待复核事项/); }
    finally { await payload.db.drizzle.run(sql`ALTER TABLE unavailable_model_quotas RENAME TO platform_model_quotas`); }
    assert.equal(calls, beforeMissing);
    assert.deepEqual(await counts(), [0, 0, 0]);
    console.log("✓ missing/invalid credentials, HTTP 4xx and admission failures fail closed without cases, evidence, audit or false queue claims");

    for (const failure of [500, 503, "network", "timeout", "bad-json"] as const) {
      response = failure;
      const id = randomUUID();
      assert.match(await refused(owner, id), /已记录/);
      const once = await counts();
      assert.doesNotMatch(await refused(owner, id), /已记录待复核事项/);
      assert.deepEqual(await counts(), once, "same failure request cannot add evidence or audit");
    }
    assert.deepEqual(await counts(), [5, 5, 10]);
    const privateRecords = JSON.stringify(await payload.find({ collection: "safety-audit", overrideAccess: true, limit: 100 }));
    assert.doesNotMatch(privateRecords, /synthetic-review-key|private body/);
    console.log("✓ genuine HTTP 5xx/network/timeout/malformed responses are recorded once; replay adds no audit and never stores provider secrets");

    const recoveredId = randomUUID(); response = 500;
    await refused(owner, recoveredId);
    const beforeRecovery = await counts();
    response = "allow"; await invoke(owner, recoveredId);
    response = "block"; await assert.rejects(invoke(owner, recoveredId), { status: 422 });
    assert.deepEqual(await counts(), [beforeRecovery[0] + 1, beforeRecovery[1] + 1, beforeRecovery[2] + 3], "failure deduplication cannot suppress a fresh allow/block verdict for the same request");

    await clear(); response = 500;
    await payload.db.drizzle.run(sql`CREATE TRIGGER synthetic_audit_failure BEFORE INSERT ON safety_audit BEGIN SELECT RAISE(ABORT, 'synthetic audit unavailable'); END`);
    try { assert.doesNotMatch(await refused(owner), /已记录|待复核事项/); }
    finally { await payload.db.drizzle.run(sql`DROP TRIGGER synthetic_audit_failure`); }
    assert.deepEqual(await counts(), [0, 0, 0], "an audit write failure must roll back its case and evidence");
    console.log("✓ the same request can recover to allow/block; audit failure rolls back case and evidence without a false queue promise");

    await clear(); response = 500;
    Object.assign(process.env, { HELLO_REVIEW_FAILURE_OWNER_DAILY_LIMIT: "2", HELLO_REVIEW_FAILURE_GLOBAL_DAILY_LIMIT: "3" });
    await refused(owner); await refused(owner);
    assert.doesNotMatch(await refused(owner), /已记录|待复核事项/);
    await refused(randomUUID());
    const atCap = await counts(); assert.deepEqual(atCap, [3, 3, 6]);
    assert.doesNotMatch(await refused(randomUUID()), /已记录|待复核事项/);
    assert.deepEqual(await counts(), atCap);
    await clear(); process.env.HELLO_REVIEW_FAILURE_OWNER_DAILY_LIMIT = "0";
    await refused(owner); assert.deepEqual(await counts(), [0, 0, 0]);
    process.env.HELLO_REVIEW_FAILURE_OWNER_DAILY_LIMIT = "2"; process.env.HELLO_REVIEW_FAILURE_GLOBAL_DAILY_LIMIT = "0";
    await refused(owner); assert.deepEqual(await counts(), [0, 0, 0]);
    response = "allow"; await invoke(owner);
    response = "block"; await assert.rejects(invoke(owner), { status: 422 });
    response = "uncertain"; await refused(owner);
    assert.deepEqual(await counts(), [2, 2, 5], "failure budget must not suppress actual content decisions or their audits");
    console.log("✓ owner/global/zero budgets bound failure records atomically while allow/block/uncertain retain their existing behavior");

    await clear(); response = 500;
    Object.assign(process.env, { HELLO_REVIEW_FAILURE_OWNER_DAILY_LIMIT: "3", HELLO_REVIEW_FAILURE_GLOBAL_DAILY_LIMIT: "5" });
    const sameOwner = randomUUID(), sameId = randomUUID();
    const launch = async (prefix: string, entries: { owner: string; request: string; attempts: number }[], holdWriter = false) => {
      const workers = entries.map((entry, index) => runWorker(String(index), entry.owner, entry.request, entry.attempts, prefix));
      const all = Promise.all(workers); void all.catch(() => {});
      await Promise.all(entries.map((_, index) => waitForFile(path.join(dir, `${prefix}-${index}`))));
      const writer = holdWriter ? new Database(path.join(dir, "test.db")) : undefined;
      try {
        writer?.prepare("BEGIN IMMEDIATE").run();
        await writeFile(path.join(dir, `${prefix}-go`), "go");
        for (const [index, result] of (await all).entries()) {
          await writeFile(path.join(dir, `${prefix}-result-${index}.log`), result.stdout + result.stderr);
          confirmWorker(result.stdout);
          if (holdWriter) assert.doesNotMatch(result.stdout, /"queued":true/, "a held writer must never produce a false acceptance promise");
        }
      } finally {
        if (writer?.inTransaction) writer.prepare("ROLLBACK").run();
        writer?.close();
      }
    };
    const blockedOwner = randomUUID(), blockedId = randomUUID();
    await launch("held-writer", Array.from({ length: 3 }, () => ({ owner: blockedOwner, request: blockedId, attempts: 1 })), true);
    assert.deepEqual(await counts(), [0, 0, 0], "all attempts may fail closed while another transaction owns the writer");
    const afterRelease = await runWorker("released-writer", blockedOwner, blockedId, 1);
    confirmWorker(afterRelease.stdout);
    assert.match(afterRelease.stdout, /"queued":true/, "the same request must recover when the writer is released");
    assert.deepEqual(await counts(), [1, 1, 2]);
    confirmWorker((await runWorker("released-replay", blockedOwner, blockedId, 1)).stdout);
    assert.deepEqual(await counts(), [1, 1, 2], "recovered requests must remain idempotent");
    await clear();
    await launch("duplicate", Array.from({ length: 4 }, () => ({ owner: sameOwner, request: sameId, attempts: 3 })));
    const [concurrentCases, concurrentEvidence, concurrentAudit] = await counts();
    assert.ok(concurrentCases <= 1, "independent simultaneous workers must never duplicate a request");
    assert.deepEqual([concurrentEvidence, concurrentAudit], [concurrentCases, concurrentCases * 2], "contention must not leave partial writes");
    confirmWorker((await runWorker("duplicate-recovery", sameOwner, sameId, 1)).stdout);
    assert.deepEqual(await counts(), [1, 1, 2], "after contention the same request must persist exactly once");
    await payload.db.drizzle.run(sql`UPDATE safety_cases SET created_at = '2000-01-01T00:00:00.000Z'`);
    confirmWorker((await runWorker("restart", sameOwner, sameId, 1)).stdout);
    assert.deepEqual(await counts(), [1, 1, 2], "deduplication must survive process restart and UTC days");
    const recovery = await runWorker("restart-new", sameOwner, randomUUID(), 1);
    confirmWorker(recovery.stdout);
    assert.match(recovery.stdout, /"queued":true/, "a fresh worker must successfully record a new failure after contention");
    assert.deepEqual(await counts(), [2, 2, 4]);
    await refused(sameOwner, sameId, "synthetic-review-key", "byok", "output");
    assert.deepEqual(await counts(), [3, 3, 6], "input and output failures are distinct review stages");
    console.log("✓ concurrent workers deduplicate owner/stage/request across restarts and days without suppressing the other stage");

    await clear();
    const owners = [randomUUID(), randomUUID(), randomUUID()];
    for (let round = 0; round < 3; round++) {
      await launch(`budget-${round}`, Array.from({ length: 6 }, (_, index) => ({ owner: owners[index % owners.length], request: "different", attempts: 2 })));
      const [cases, evidence, audit] = await counts();
      assert.ok(cases <= 5, "every concurrent round must respect the global cap");
      assert.deepEqual([evidence, audit], [cases, cases * 2], "no concurrent failure leaves partial evidence/audit");
      for (const value of owners) assert.ok((await payload.count({ collection: "safety-cases", overrideAccess: true, where: { owner: { equals: value } } })).totalDocs <= 3);
    }
    // This pinned SQLite driver can reject COMMIT after lock contention. Such
    // attempts fail closed; a fresh worker must recover and fill the exact cap.
    const [beforeWorkerRecovery] = await counts();
    for (let index = beforeWorkerRecovery; index < 5; index++) {
      const result = await runWorker(`recovery-${index}`, randomUUID(), "different", 1);
      confirmWorker(result.stdout);
      assert.deepEqual(await counts(), [index + 1, index + 1, (index + 1) * 2], "a fresh worker must successfully persist after contention ends");
    }
    assert.deepEqual(await counts(), [5, 5, 10]);
    confirmWorker((await runWorker("restart-cap", randomUUID(), "different", 2)).stdout);
    assert.deepEqual(await counts(), [5, 5, 10]);
    console.log("✓ concurrent process rounds never exceed caps or partially write; fresh workers recover to exactly 5 cases and every queued reply is committed");
  }
  succeeded = true;
} finally {
  globalThis.fetch = originalFetch;
  await payload.destroy();
  if (!worker && succeeded) await rm(dir, { recursive: true, force: true });
  else if (!worker) console.log(`Synthetic failure database/logs retained: ${dir}`);
}
