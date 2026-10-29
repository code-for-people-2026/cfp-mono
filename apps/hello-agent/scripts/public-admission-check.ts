import assert from "node:assert/strict";
import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";
import Database from "libsql";
import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-sqlite";

const worker = process.argv[2] === "--worker";
const dir = worker ? process.argv[3] : await mkdtemp(path.join(tmpdir(), "hello-public-admission-"));
assert.ok(dir && path.basename(dir).startsWith("hello-public-admission-"));
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${dir}/test.db`, PAYLOAD_SECRET: "public-admission-isolated-test-only",
  HELLO_DEPLOYED: "true", HELLO_TRUST_PROXY: "true", HELLO_ORIGIN: "https://admission.example.invalid", NODE_ENV: "test",
});
const { cms } = await import("../src/cms/client");
const { migrations } = await import("../src/cms/migrations");
const { reservePublicAdmission } = await import("../src/server/public-admission");
const { POST } = await import("../src/app/api/hello/[...path]/route");
const { rateLimit } = await import("../src/server/http");
const { transaction } = await import("../src/operations/service");
const payload = await cms();
const request = (ip: string, endpoint = "identity", cookie?: string, body?: unknown) => new Request(`${process.env.HELLO_ORIGIN}/api/hello/${endpoint}`, {
  method: "POST", headers: { "x-real-ip": ip, ...(endpoint === "miniapp-identity" ? {} : { Origin: process.env.HELLO_ORIGIN! }), ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const post = (ip: string, endpoint = "identity", cookie?: string, body?: unknown) => POST(request(ip, endpoint, cookie, body), { params: Promise.resolve({ path: [endpoint] }) });
const clearAdmission = () => payload.db.drizzle.run(sql`DELETE FROM platform_model_quotas WHERE day LIKE 'admission:%'`);
const waitForFile = async (file: string) => {
  const deadline = Date.now() + 30_000;
  while (true) {
    try { await access(file); return; }
    catch { assert.ok(Date.now() < deadline, "worker synchronization timed out"); await setTimeout(20); }
  }
};
const workerRun = async (ip: string, attempts = 3, lock?: "write" | "read") => {
  const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/public-admission-check.ts", "--worker", dir, ip, String(attempts), ...(lock ? ["--wait-for-lock", lock] : [])], { env: process.env, timeout: 120_000 });
  const match = stdout.match(/ADMITTED=(\d+)/);
  assert.ok(match, "worker must finish its assertions");
  return Number(match[1]);
};
try {
  if (worker) {
    if (process.argv[6] === "--wait-for-lock") {
      await writeFile(path.join(dir, `${process.argv[7]}-worker-ready`), "ready");
      await waitForFile(path.join(dir, `${process.argv[7]}-locked`));
    }
    let accepted = 0;
    for (let i = 0; i < Number(process.argv[5]); i++) {
      try { await reservePublicAdmission(payload, request(process.argv[4]), "safety"); accepted++; }
      catch (error) { assert.ok(error instanceof Error && "status" in error); assert.equal(error.status, 429); }
    }
    console.log(`ADMITTED=${accepted}`);
  } else {
    await payload.db.migrate({ migrations: migrations.map((migration) => ({ name: migration.name, up: (args: unknown) => migration.up(args as MigrateUpArgs), down: (args: unknown) => migration.down(args as MigrateDownArgs) })) });
    Object.assign(process.env, { HELLO_IDENTITY_CALLER_DAILY_LIMIT: "3", HELLO_IDENTITY_GLOBAL_DAILY_LIMIT: "5", HELLO_SAFETY_CALLER_DAILY_LIMIT: "2", HELLO_SAFETY_GLOBAL_DAILY_LIMIT: "3" });
    const identities: { owner: string; cookie: string }[] = [];
    const createIdentity = async (ip: string) => {
      const response = await post(ip);
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie")?.split(";")[0]; assert.ok(cookie);
      identities.push({ ...(await response.json()), cookie });
    };
    for (let index = 0; index < 3; index++) await createIdentity("192.0.2.1");
    assert.equal((await post("192.0.2.1")).status, 429);
    assert.equal((await post("192.0.2.1", "miniapp-identity")).status, 429, "both anonymous credential types share the caller budget");
    assert.equal((await post("192.0.2.1", "identity", identities[0].cookie)).status, 200, "existing credentials do not need new admission");
    await createIdentity("192.0.2.2"); await createIdentity("192.0.2.3");
    assert.equal((await post("192.0.2.4")).status, 429);
    assert.equal((await payload.count({ collection: "credentials", overrideAccess: true })).totalDocs, 5, "rejected admission creates no credentials");
    console.log("✓ rotating anonymous owners cannot bypass caller/global credential admission; cookie and miniapp share a durable budget");

    const body = { category: "other", description: "独立合成投诉用于验证受理边界" };
    const first = await post("198.51.100.1", "safety", identities[0].cookie, body);
    assert.equal(first.status, 200);
    const receipt = (await first.json()).receipt;
    const original = (await payload.find({ collection: "safety-cases", overrideAccess: true, where: { receipt: { equals: receipt } } })).docs[0];
    await transaction(payload, async (req) => { await payload.create({ collection: "safety-enforcements", overrideAccess: true, req, data: { key: `owner:${identities[0].owner}:${original.id}`, owner: identities[0].owner, targetType: "owner", caseId: original.id, active: true, reason: "合成身份生成限制仍允许本人投诉" } }); });
    for (let i = 0; i < 20; i++) rateLimit(identities[0].owner);
    assert.equal((await post("198.51.100.1", "safety", identities[1].cookie, body)).status, 200);
    assert.equal((await post("198.51.100.1", "safety", identities[2].cookie, body)).status, 429, "fresh owner cannot reset caller admission");
    assert.equal((await post("198.51.100.2", "safety", identities[0].cookie, body)).status, 200, "unconsented, generation-limited, business-throttled owners retain complaint access");
    assert.equal((await post("198.51.100.3", "safety", identities[3].cookie, body)).status, 429, "global ceiling covers different callers");
    for (const collection of ["safety-cases", "safety-evidence"] as const)
      assert.equal((await payload.count({ collection, overrideAccess: true })).totalDocs, 3, "rejected admission creates no case or evidence");
    assert.equal((await payload.count({ collection: "safety-audit", overrideAccess: true, where: { event: { equals: "case.created" } } })).totalDocs, 3);
    console.log("✓ rotating owners cannot flood cases; other callers retain their budget; complaint access survives missing consent and generation limits");

    const untrusted = request("203.0.113.1"); untrusted.headers.delete("x-real-ip"); untrusted.headers.set("x-forwarded-for", "203.0.113.2");
    await assert.rejects(reservePublicAdmission(payload, untrusted, "identity"), { status: 503 });
    await clearAdmission();
    await payload.db.drizzle.run(sql`INSERT INTO platform_model_quotas (day, reserved_calls) VALUES ('admission:2000-01-01:safety:caller:expired', 1), ('2000-01-01', 77)`);
    await reservePublicAdmission(payload, request("203.0.113.3"), "safety");
    assert.equal((await payload.db.drizzle.all(sql`SELECT day FROM platform_model_quotas WHERE day LIKE 'admission:2000%'`)).length, 0);
    assert.equal((await payload.db.drizzle.get<{ reserved_calls: number }>(sql`SELECT reserved_calls FROM platform_model_quotas WHERE day = '2000-01-01'`))?.reserved_calls, 77);
    console.log("✓ untrusted forwarding rejected; expired caller hashes purged without changing model quota");

    await clearAdmission();
    const contended = workerRun("203.0.113.9", 1, "write");
    void contended.catch(() => {}); // Assert below after the independent writer releases its lock.
    await waitForFile(path.join(dir, "write-worker-ready"));
    await payload.db.drizzle.transaction(async (tx) => {
      await tx.run(sql`UPDATE platform_model_quotas SET reserved_calls = reserved_calls WHERE day = '2000-01-01'`);
      await writeFile(path.join(dir, "write-locked"), "locked");
      await setTimeout(1_000);
    });
    assert.equal(await contended, 1, "a brief competing business transaction must not cause a false admission failure");
    console.log("✓ admission waits through a real one-second competing SQLite writer and charges exactly once");

    await clearAdmission();
    const commitContended = workerRun("203.0.113.8", 1, "read");
    void commitContended.catch(() => {});
    await waitForFile(path.join(dir, "read-worker-ready"));
    const reader = new Database(path.join(dir, "test.db"));
    try {
      assert.equal(reader.prepare("PRAGMA journal_mode").get().journal_mode, "delete", "this regression exercises reader-blocked COMMIT, not WAL");
      reader.exec("BEGIN DEFERRED");
      reader.prepare("SELECT day FROM platform_model_quotas").all();
      const writer = new Database(path.join(dir, "test.db"));
      try {
        writer.exec("BEGIN IMMEDIATE");
        writer.prepare("UPDATE platform_model_quotas SET reserved_calls = reserved_calls + 1 WHERE day = '2000-01-01'").run();
        assert.throws(() => writer.exec("COMMIT"), { code: "SQLITE_BUSY" }, "the real reader must block COMMIT after a successful write");
        writer.exec("ROLLBACK");
      } finally { writer.close(); }
      await writeFile(path.join(dir, "read-locked"), "locked");
      await setTimeout(1_000);
    } finally { if (reader.inTransaction) reader.exec("ROLLBACK"); reader.close(); }
    assert.equal(await commitContended, 1);
    assert.deepEqual((await payload.db.drizzle.all<{ reserved_calls: number }>(sql`SELECT reserved_calls FROM platform_model_quotas WHERE day LIKE 'admission:%'`)).map((row) => row.reserved_calls), [1, 1], "busy commit must roll back both increments before retry, with no double charge");
    console.log("✓ a real competing reader blocks COMMIT after writes; rollback and retry charge each budget only once");

    await clearAdmission();
    process.env.HELLO_SAFETY_GLOBAL_DAILY_LIMIT = "100";
    assert.equal((await Promise.all([workerRun("203.0.113.10"), workerRun("203.0.113.10"), workerRun("203.0.113.10")])).reduce((a, b) => a + b, 0), 2);
    assert.equal(await workerRun("203.0.113.10", 1), 0, "a new process cannot reset caller admission");
    await clearAdmission();
    process.env.HELLO_SAFETY_GLOBAL_DAILY_LIMIT = "5";
    assert.equal((await Promise.all([11, 12, 13, 14].map((index) => workerRun(`203.0.113.${index}`)))).reduce((a, b) => a + b, 0), 5);
    const totals = await payload.db.drizzle.all<{ day: string; reserved_calls: number }>(sql`SELECT day, reserved_calls FROM platform_model_quotas WHERE day LIKE 'admission:%'`);
    assert.equal(totals.find((row) => row.day.endsWith(":global"))?.reserved_calls, 5);
    assert.equal(totals.filter((row) => row.day.includes(":caller:")).reduce((sum, row) => sum + row.reserved_calls, 0), 5, "caller and global ledgers match the exact admitted count");
    const ledgerBefore = await payload.db.drizzle.all(sql`SELECT * FROM platform_model_quotas ORDER BY day`);
    assert.equal(await workerRun("203.0.113.15", 1), 0, "a new caller after restart cannot reset global admission");
    assert.deepEqual(await payload.db.drizzle.all(sql`SELECT * FROM platform_model_quotas ORDER BY day`), ledgerBefore, "rejected callers neither charge global quota nor allocate caller rows");
    console.log("✓ atomic admission across concurrent processes; caller/global limits survive restart and rejection does not consume durable quota");

    await payload.db.drizzle.run(sql`ALTER TABLE platform_model_quotas RENAME TO unavailable_admission`);
    assert.equal((await post("203.0.113.20")).status, 503);
    assert.equal((await payload.count({ collection: "credentials", overrideAccess: true })).totalDocs, 5);
    await payload.db.drizzle.run(sql`ALTER TABLE unavailable_admission RENAME TO platform_model_quotas`);
    console.log("✓ unavailable admission ledger fails closed before minting credentials");
  }
} finally { await payload.destroy(); }
