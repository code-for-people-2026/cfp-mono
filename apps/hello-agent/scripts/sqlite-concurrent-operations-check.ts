import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

globalThis.fetch = async () => { throw new Error("network prohibited in concurrency regression"); };
if (process.argv.includes("--alert-worker")) {
  assert.ok(process.env.HELLO_DATABASE_URI?.includes("hello-concurrent-operations-"));
  assert.ok(process.env.HELLO_ALERT_TEST_LOG?.includes("hello-concurrent-operations-"));
  const { cms } = await import("../src/cms/client");
  const { FeishuAlerts } = await import("../src/operations/alerts");
  const { feishuConfig } = await import("../src/operations/feishu");
  const payload = await cms();
  try {
    let now = Date.now();
    const alerts = new FeishuAlerts(payload, feishuConfig()!, async (_, target) => {
      assert.ok("caseId" in target);
      await appendFile(process.env.HELLO_ALERT_TEST_LOG!, `${target.caseId}\n`);
      return { ok: true };
    }, () => now);
    process.send?.("ready");
    await new Promise<void>((resolve) => process.once("message", () => resolve()));
    for (let i = 0; i < 50; i++) { now += 2100; await alerts.tick(); await sleep(5); }
  } finally { await payload.destroy(); process.disconnect?.(); }
} else {
  const directory = await mkdtemp(join(tmpdir(), "hello-concurrent-operations-"));
  Object.assign(process.env, {
    HELLO_DATABASE_URI: `file:${directory}/test.db`, PAYLOAD_SECRET: randomUUID(), HELLO_DEPLOYED: "false",
    HELLO_ORIGIN: "https://example.invalid", HELLO_FEISHU_ALERTS_ENABLED: "true",
    HELLO_FEISHU_WEBHOOK: "https://open.feishu.cn/open-apis/bot/v2/hook/synthetic-only",
    HELLO_FEISHU_SIGNING_SECRET: "synthetic-only-signing-secret", HELLO_ALERT_TEST_LOG: join(directory, "sends.log"),
  });
  const { cms } = await import("../src/cms/client");
  const { mintCredential } = await import("../src/server/auth");
  const { OperationsService, transaction } = await import("../src/operations/service");
  const { FeishuAlerts } = await import("../src/operations/alerts");
  const { feishuConfig } = await import("../src/operations/feishu");
  const { GET } = await import("../src/app/api/hello/[...path]/route");
  const payload = await cms();
  try {
    const credential = await mintCredential(payload, "miniapp");
    const admin = { ...await payload.create({ collection: "admins", overrideAccess: true, context: { helloAdminBootstrap: true }, data: { role: "administrator", email: "admin@synthetic.example", password: randomUUID() } }), collection: "admins" as const };
    const ops = new OperationsService(payload);
    const complaint = await transaction(payload, (req) => ops.createCase({ owner: credential.owner, source: "complaint", category: "other", stage: "user_report" }, "合成投诉，无真实用户", req));
    const alerts = new FeishuAlerts(payload, feishuConfig()!, async () => ({ ok: true }));
    const test = await alerts.test(); await alerts.confirmTest(test.testId);
    const urgent = await transaction(payload, (req) => ops.createCase({ owner: credential.owner, source: "moderation", severity: "urgent", category: "self_harm", stage: "interaction_crisis" }, "合成案件，无真实危机", req));
    const child = fork(fileURLToPath(import.meta.url), ["--alert-worker"], {
      execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"], env: { ...process.env, HELLO_DEPLOYED: "true", NODE_ENV: "test" },
    });
    let output = "";
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    const finished = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`isolated alert worker failed: ${output}`)));
    });
    // Always observe early rejection while waiting for the ready handshake.
    void finished.catch(() => {});
    const timeout = setTimeout(() => child.kill("SIGKILL"), 30_000);
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("message", (message) => message === "ready" ? resolve() : reject(new Error("invalid handshake")));
        child.once("exit", () => reject(new Error(`worker exited before ready: ${output}`)));
        child.once("error", reject);
      });
      child.send("start");
      for (let i = 0; i < 50; i++) {
        if (i === 5) await ops.action(admin, complaint.id, { action: "claim", revision: 0, reason: "并发回归受理合成案件" });
        if (i === 20) await ops.action(admin, complaint.id, { action: "dismiss", revision: 1, reason: "并发回归处置合成案件", reply: "合成测试已完成，无真实投诉" });
        const response = await GET(new Request("https://example.invalid/api/hello/safety", { headers: { authorization: `Bearer ${credential.token}` } }), { params: Promise.resolve({ path: ["safety"] }) });
        assert.equal(response.status, 200, "phone receipt refresh must not fail during admin actions and alert ticks");
        const body = await response.json();
        const row = body.cases.find((r: { receipt: string }) => r.receipt === complaint.receipt);
        assert.equal(row.status, i < 5 ? "pending" : i < 20 ? "in_progress" : "resolved");
        if (i >= 20) assert.equal(row.reply, "合成测试已完成，无真实投诉");
        await sleep(5);
      }
      await finished;
      assert.equal(await readFile(process.env.HELLO_ALERT_TEST_LOG!, "utf8"), `${urgent.id}\n`, "send once across process contention");
      const row = await payload.findByID({ collection: "safety-cases", id: urgent.id, overrideAccess: true });
      assert.equal(row.alertStatus, "delivered");
      assert.equal((row.alertDetails as { attempts: number }).attempts, 1);
      console.log("PASS: 50 authenticated phone refreshes and admin claim/feedback while 50 alert ticks run in another process; one delivery");
    } finally {
      clearTimeout(timeout);
      if (child.exitCode === null) child.kill();
      await finished.catch(() => {});
    }
  } finally { await payload.destroy(); await rm(directory, { recursive: true, force: true }); }
}
