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

type Verdict = "block" | "uncertain" | "allow";
const worker = process.argv[2] === "--worker";
const dir = worker ? process.argv[3] : await mkdtemp(path.join(tmpdir(), "hello-moderation-content-"));
assert.ok(dir && path.basename(dir).startsWith("hello-moderation-content-"));
Object.assign(process.env, { HELLO_DATABASE_URI: `file:${dir}/test.db`, PAYLOAD_SECRET: "moderation-content-synthetic-only", HELLO_DEPLOYED: "true", NODE_ENV: "test" });
const { cms } = await import("../src/cms/client");
const { migrations } = await import("../src/cms/migrations");
const { Repository } = await import("../src/cms/repository");
const { operationalModerator } = await import("../src/operations/moderation");
const payload = await cms();
let response: Verdict | number = "block", providerCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://telemetry.payloadcms.com/events") return new Response(null, { status: 204 });
  assert.equal(String(url), "https://api.deepseek.com/chat/completions", "all provider requests must be synthetic");
  assert.equal(new Headers(options?.headers).get("authorization"), "Bearer synthetic-review-key");
  providerCalls++;
  return typeof response === "number" ? new Response("synthetic provider fault", { status: response }) : Response.json({ model: "synthetic-review", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ decision: response, category: "fraud" }) } }] });
};
const counts = () => Promise.all((["safety-cases", "safety-evidence", "safety-audit"] as const).map(async (collection) => (await payload.count({ collection, overrideAccess: true })).totalDocs));
const clear = async () => {
  await payload.db.drizzle.run(sql`DELETE FROM safety_evidence`);
  await payload.db.drizzle.run(sql`DELETE FROM safety_audit`);
  await payload.db.drizzle.run(sql`DELETE FROM safety_cases`);
};
const invoke = (owner: string, id: string = randomUUID(), stage: "input" | "output" = "input") => operationalModerator(new Repository(payload, { id: owner, auth: "cookie" }))({ stage, mode: "byok", apiKey: "synthetic-review-key", requestId: id, texts: [response === "allow" ? "我有自杀念头，想寻求帮助" : "合成诈骗审核用例"] });
async function rejected(owner: string, id: string = randomUUID(), stage: "input" | "output" = "input") {
  const reviewedBefore = providerCalls;
  try { await invoke(owner, id, stage); assert.fail("the current content decision must still reject"); }
  catch (error) {
    assert.ok(error instanceof ContentReviewError);
    // If rule loading itself fails during SQLite contention, no provider
    // verdict exists yet. That request must fail closed with 503, not claim 422.
    const queuedReview = response === "uncertain" && /需要人工复核/.test(error.message);
    assert.equal(error.status, queuedReview ? 409 : response === "block" && providerCalls > reviewedBefore ? 422 : 503);
    return error.message;
  }
}
async function waitForFile(file: string) {
  const deadline = Date.now() + 60_000;
  while (true) { try { await access(file); return; } catch { assert.ok(Date.now() < deadline); await setTimeout(20); } }
}
const runWorker = (name: string, owner: string, id: string, verdict: "block" | "uncertain", attempts = 1, barrier = "") => promisify(execFile)(process.execPath,
  ["--import", "tsx", "scripts/moderation-content-check.ts", "--worker", dir, name, owner, id, verdict, String(attempts), barrier], { env: process.env, timeout: 120_000 });
function confirmed(stdout: string) {
  assert.match(stdout, /WORKER_OK/);
  const reader = new Database(path.join(dir, "test.db"));
  try {
    for (const match of stdout.matchAll(/^RESULT=(.+)$/gm)) {
      const item = JSON.parse(match[1]);
      if (item.queued) assert.equal(reader.prepare("SELECT receipt FROM safety_cases WHERE source = 'moderation' AND decision IN ('block','uncertain') AND owner = ? AND stage = 'input' AND request_id = ?").all(item.owner, item.id).length, 1, "a queued reply must be independently visible after commit");
    }
  } finally { reader.close(); }
}
let succeeded = false;
try {
  if (worker) {
    const [, , , , name, owner, id, verdict, attempts, barrier] = process.argv;
    response = verdict === "uncertain" ? "uncertain" : "block";
    if (barrier) { await writeFile(path.join(dir, `${barrier}-${name}`), "ready"); await waitForFile(path.join(dir, `${barrier}-go`)); }
    for (let index = 0; index < Number(attempts); index++) {
      const requestId = id === "different" ? `${barrier || name}-${name}-${index}` : id;
      const message = await rejected(owner, requestId);
      console.log(`RESULT=${JSON.stringify({ owner, id: requestId, queued: message.includes("已记录待复核事项") })}`);
    }
    console.log("WORKER_OK");
  } else {
    await payload.db.migrate({ migrations: migrations.map((migration) => ({ name: migration.name, up: (args: unknown) => migration.up(args as MigrateUpArgs), down: (args: unknown) => migration.down(args as MigrateDownArgs) })) });
    Object.assign(process.env, { HELLO_REVIEW_CONTENT_OWNER_DAILY_LIMIT: "10", HELLO_REVIEW_CONTENT_GLOBAL_DAILY_LIMIT: "100", HELLO_REVIEW_FAILURE_OWNER_DAILY_LIMIT: "10", HELLO_REVIEW_FAILURE_GLOBAL_DAILY_LIMIT: "100" });
    const owner = randomUUID(), id = randomUUID();
    await rejected(owner, id);
    const once = await counts(); assert.deepEqual(once, [1, 1, 2]);
    await rejected(owner, id);
    assert.deepEqual(await counts(), once, "replayed block must not append another case, evidence or audit");
    response = "uncertain"; assert.doesNotMatch(await rejected(owner, id), /已记录待复核事项/);
    assert.deepEqual(await counts(), once, "block and uncertain share request deduplication");
    assert.equal(providerCalls, 3, "each attempt is freshly reviewed; prior content decisions do not replace moderation");
    await rejected(owner, id, "output"); await rejected(randomUUID(), id);
    assert.deepEqual(await counts(), [3, 3, 6], "owner and stage isolate the request key");
    response = "allow"; await invoke(owner, id);
    assert.deepEqual(await counts(), [3, 3, 7], "a fresh normal-help allow verdict remains usable and audited");
    console.log("✓ repeated block/uncertain requests are freshly reviewed but persist once per owner/stage/request; normal help remains allowed");

    await clear();
    Object.assign(process.env, { HELLO_REVIEW_CONTENT_OWNER_DAILY_LIMIT: "2", HELLO_REVIEW_CONTENT_GLOBAL_DAILY_LIMIT: "3" });
    response = "block"; await rejected(owner);
    response = "uncertain"; await rejected(owner);
    const ownerFull = await counts();
    response = "block"; await rejected(owner);
    response = "uncertain"; assert.doesNotMatch(await rejected(owner), /已记录|已有审核/);
    assert.deepEqual(await counts(), ownerFull);
    await rejected(randomUUID());
    const full = await counts(); assert.deepEqual(full, [3, 3, 6]);
    response = "block"; await rejected(randomUUID());
    response = "uncertain"; assert.doesNotMatch(await rejected(randomUUID()), /已记录|已有审核/);
    assert.deepEqual(await counts(), full);
    await clear();
    for (const limits of [["0", "3"], ["2", "0"]]) {
      [process.env.HELLO_REVIEW_CONTENT_OWNER_DAILY_LIMIT, process.env.HELLO_REVIEW_CONTENT_GLOBAL_DAILY_LIMIT] = limits;
      for (const verdict of ["block", "uncertain"] as const) { response = verdict; assert.doesNotMatch(await rejected(owner), /已记录/); }
      assert.deepEqual(await counts(), [0, 0, 0]);
    }
    response = "allow"; await invoke(owner);
    assert.deepEqual(await counts(), [0, 0, 1]);
    console.log("✓ owner/global/zero content budgets suppress only persistence; block stays 422, uncertain stays 503 and help still passes");

    await clear();
    Object.assign(process.env, { HELLO_REVIEW_CONTENT_OWNER_DAILY_LIMIT: "1", HELLO_REVIEW_CONTENT_GLOBAL_DAILY_LIMIT: "1", HELLO_REVIEW_FAILURE_OWNER_DAILY_LIMIT: "2", HELLO_REVIEW_FAILURE_GLOBAL_DAILY_LIMIT: "2" });
    response = 500; await rejected(owner, id);
    response = "block"; await rejected(owner, id);
    response = "uncertain"; await rejected(owner, id);
    assert.deepEqual(await counts(), [2, 2, 4], "a provider fault does not suppress the subsequent actual content case");
    response = 500; await rejected(owner); await rejected(owner);
    response = "uncertain"; assert.doesNotMatch(await rejected(randomUUID()), /已记录/);
    assert.deepEqual(await counts(), [3, 3, 6], "failure and content budgets cannot consume or reset each other");
    console.log("✓ provider-failure deduplication and budgets remain separate from actual content decisions");

    await clear(); Object.assign(process.env, { HELLO_REVIEW_CONTENT_OWNER_DAILY_LIMIT: "10", HELLO_REVIEW_CONTENT_GLOBAL_DAILY_LIMIT: "100" });
    await payload.db.drizzle.run(sql`CREATE TRIGGER synthetic_content_audit_failure BEFORE INSERT ON safety_audit BEGIN SELECT RAISE(ABORT, 'synthetic unavailable audit'); END`);
    try { for (const verdict of ["block", "uncertain"] as const) { response = verdict; assert.doesNotMatch(await rejected(owner, id), /已记录/); } }
    finally { await payload.db.drizzle.run(sql`DROP TRIGGER synthetic_content_audit_failure`); }
    assert.deepEqual(await counts(), [0, 0, 0]);
    response = "uncertain";
    await assert.rejects(invoke(owner, id), { status: 409, message: /已记录待复核事项/ });
    assert.equal((await payload.find({ collection: "safety-cases", overrideAccess: true, where: { owner: { equals: owner } } })).docs[0].decision, "uncertain");
    await assert.rejects(invoke(owner, id), { status: 409, message: /同一请求已有审核记录/ });
    await payload.create({ collection: "privacy-profiles", overrideAccess: true, data: { owner, state: "withdrawn", revision: 1 } });
    const beforeWithdrawal = await counts();
    await assert.rejects(invoke(owner, id), { status: 403 });
    assert.deepEqual(await counts(), beforeWithdrawal, "privacy guard must run before duplicate admission");
    console.log("✓ audit errors roll back all content records without fake queue promises; privacy still rejects before duplicate handling");

    await clear();
    Object.assign(process.env, { HELLO_REVIEW_CONTENT_OWNER_DAILY_LIMIT: "2", HELLO_REVIEW_CONTENT_GLOBAL_DAILY_LIMIT: "5" });
    const sharedOwner = randomUUID(), sharedId = randomUUID();
    const launch = async (prefix: string, owners: string[], requestId: string) => {
      const all = Promise.all(owners.map((value, index) => runWorker(String(index), value, requestId, index % 2 ? "block" : "uncertain", 2, prefix))); void all.catch(() => {});
      await Promise.all(owners.map((_, index) => waitForFile(path.join(dir, `${prefix}-${index}`))));
      await writeFile(path.join(dir, `${prefix}-go`), "go");
      for (const [index, result] of (await all).entries()) { await writeFile(path.join(dir, `${prefix}-${index}.log`), result.stdout + result.stderr); confirmed(result.stdout); }
    };
    await launch("duplicate", Array.from({ length: 4 }, () => sharedOwner), sharedId);
    const [concurrentCount] = await counts(); assert.ok(concurrentCount <= 1);
    confirmed((await runWorker("duplicate-restart", sharedOwner, sharedId, "uncertain")).stdout);
    assert.deepEqual(await counts(), [1, 1, 2]);
    await payload.db.drizzle.run(sql`UPDATE safety_cases SET created_at = '2000-01-01T00:00:00.000Z'`);
    confirmed((await runWorker("old-request", sharedOwner, sharedId, "block")).stdout);
    assert.deepEqual(await counts(), [1, 1, 2], "persisted request deduplication survives UTC day changes and restart");
    const newRequest = await runWorker("new-request", sharedOwner, randomUUID(), "uncertain"); confirmed(newRequest.stdout);
    assert.match(newRequest.stdout, /"queued":true/); assert.deepEqual(await counts(), [2, 2, 4]);
    console.log("✓ mixed block/uncertain workers deduplicate concurrent requests across restart and UTC days; fresh requests recover normally");

    await clear();
    const owners = [randomUUID(), randomUUID(), randomUUID()];
    for (let round = 0; round < 2; round++) {
      await launch(`cap-${round}`, [owners[0], owners[1], owners[2], owners[0]], "different");
      const [cases, evidence, audits] = await counts();
      assert.ok(cases <= 5); assert.deepEqual([evidence, audits], [cases, cases * 2]);
      for (const value of owners) assert.ok((await payload.count({ collection: "safety-cases", overrideAccess: true, where: { owner: { equals: value } } })).totalDocs <= 2);
    }
    for (let index = (await counts())[0]; index < 5; index++) {
      confirmed((await runWorker(`recover-${index}`, randomUUID(), "different", "uncertain")).stdout);
      assert.deepEqual(await counts(), [index + 1, index + 1, (index + 1) * 2]);
    }
    for (const verdict of ["block", "uncertain"] as const) confirmed((await runWorker(`at-cap-${verdict}`, randomUUID(), "different", verdict)).stdout);
    assert.deepEqual(await counts(), [5, 5, 10]);
    console.log("✓ competing and restarted workers respect exact owner/global caps with no partial writes; every queued reply is independently committed");
  }
  succeeded = true;
} finally {
  globalThis.fetch = originalFetch;
  await payload.destroy();
  if (!worker && succeeded) await rm(dir, { recursive: true, force: true });
  else if (!worker) console.log(`Synthetic content database/logs retained: ${dir}`);
}
