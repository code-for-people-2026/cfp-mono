import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import { createRequire } from "node:module";
import Database from "libsql";

const directory = await mkdtemp(join(tmpdir(), "hello-contention-"));
const filename = join(directory, "test.db");
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${filename}`, PAYLOAD_SECRET: randomUUID(),
  HELLO_DEPLOYED: "false", HELLO_ORIGIN: "https://example.invalid",
});
globalThis.fetch = async () => { throw new Error("network prohibited in isolated validation"); };
const { cms } = await import("../src/cms/client");
const { mintCredential } = await import("../src/server/auth");
const { OperationsService } = await import("../src/operations/service");
const { GET } = await import("../src/app/api/hello/[...path]/route");
const payload = await cms();
const require = createRequire(import.meta.url);
try {
  const credential = await mintCredential(payload, "miniapp");
  const ops = new OperationsService(payload);
  const receipt = await ops.complain({ id: credential.owner, auth: "miniapp" }, { category: "other", description: "合成并发回归，无真实投诉" });
  const request = () => GET(new Request("https://example.invalid/api/hello/safety", { headers: { authorization: `Bearer ${credential.token}` } }), { params: Promise.resolve({ path: ["safety"] }) });
  const baseline = await request();
  assert.equal(baseline.status, 200);
  assert.equal((await baseline.json()).cases[0].receipt, receipt.receipt);
  // An independent native connection holds the commit/read exclusion window.
  // Its timer runs on a different thread so a client busy wait cannot postpone release.
  const worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const Database = require(workerData.driver);
    const db = new Database(workerData.filename);
    try {
      db.exec('BEGIN EXCLUSIVE');
      parentPort.postMessage('locked');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
      db.exec('COMMIT');
    } finally { db.close(); }
  `, { eval: true, workerData: { filename, driver: require.resolve("libsql") } });
  const finished = new Promise<void>((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`writer exited ${code}`)));
  });
  try {
    await new Promise<void>((resolve, reject) => { worker.once("message", () => resolve()); worker.once("error", reject); });
    const started = Date.now();
    const response = await request();
    const body = await response.json();
    console.log(JSON.stringify({ scenario: "help receipts during another connection's write", status: response.status, elapsedMs: Date.now() - started, error: body.error }));
    assert.equal(response.status, 200, "short database contention must not show 服务暂时不可用 on the help page");
    assert.equal(body.cases[0].receipt, receipt.receipt);
  } finally { await finished; }
  // The app and alert task also contend for the single writer. Keep the holder
  // on this event loop: a synchronous busy timeout would prevent its release.
  const writer = new Database(filename);
  writer.exec("BEGIN IMMEDIATE");
  const release = setTimeout(() => writer.exec("ROLLBACK"), 100);
  try {
    const created = await ops.complain({ id: credential.owner, auth: "miniapp" }, { category: "other", description: "短时写入竞争不应丢失或重复投诉" });
    assert.ok(created.receipt);
    assert.equal((await ops.mine({ id: credential.owner, auth: "miniapp" })).length, 2);
  } finally {
    clearTimeout(release);
    if (writer.inTransaction) writer.exec("ROLLBACK");
    writer.close();
  }
  const blocked = new Database(filename);
  blocked.exec("BEGIN IMMEDIATE");
  const started = Date.now();
  try {
    await assert.rejects(ops.complain({ id: credential.owner, auth: "miniapp" }, { category: "other", description: "持续写锁超时后不应留下半条投诉" }), /SQLITE_BUSY/);
    assert.ok(Date.now() - started < 3_000, "lock wait must be bounded");
  } finally { blocked.exec("ROLLBACK"); blocked.close(); }
  assert.equal((await ops.mine({ id: credential.owner, auth: "miniapp" })).length, 2, "timeout must not partially create a case");
  await ops.complain({ id: credential.owner, auth: "miniapp" }, { category: "other", description: "竞争结束后连接仍应正常提交一次" });
  assert.equal((await ops.mine({ id: credential.owner, auth: "miniapp" })).length, 3);
  const independent = new Database(filename);
  try {
    independent.exec("BEGIN IMMEDIATE");
    independent.prepare("UPDATE safety_cases SET revision = revision WHERE owner = ?").run(credential.owner);
    independent.exec("COMMIT");
    const health = independent.prepare("PRAGMA integrity_check").get();
    assert.ok(health && typeof health === "object" && "integrity_check" in health);
    assert.equal(health.integrity_check, "ok");
  } finally { independent.close(); }
  console.log("PASS: the real authenticated help route preserves receipts through short database contention");
} finally {
  await payload.destroy();
  await rm(directory, { recursive: true, force: true });
}
