import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { AppError, permissions, type WechatProvider } from "../src/contracts";
import { createRuntime } from "../src/runtime";
import { startRuntimeServer } from "../src/server";
import { bootstrapOpsAdmin } from "../src/operations/collections";
import { ChatMcpClient } from "../src/chat/mcp";
import { BrowserScenarioProvider } from "./fixtures/browser-provider";
import { RecordsLegacyFixture } from "./fixtures/records";
import type { CollectorJob } from "../src/collector/service";

if (process.env.NODE_ENV !== "test") throw new Error("Isolated full-stack fixture requires NODE_ENV=test; never use it for production.");
const port = Number(process.env.BUBU_FULLSTACK_FIXTURE_PORT || 4368);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [4340, 4357].includes(port)) throw new Error("Choose an isolated full-stack fixture port, default 4368; existing fixture ports are reserved.");
const origin = `http://127.0.0.1:${port}`, directory = await mkdtemp(path.join(tmpdir(), "bubu-fullstack-browser-"));
const password = `Fixture-${randomBytes(18).toString("hex")}`;
const legacy = new RecordsLegacyFixture();
legacy.babies.set("baby-a", { id: "baby-a", name: "示例宝宝一", isDefault: true });
legacy.babies.set("baby-b", { id: "baby-b", name: "示例宝宝二" });
legacy.babies.set("baby-verify", { id: "baby-verify", name: "示例联调宝宝" });
legacy.memberships.set("old-alice", ["baby-a", "baby-b"]);
legacy.users.add("old-verifier"); legacy.memberships.set("old-verifier", ["baby-verify"]);
/** No real WeChat code is accepted and no external exchange is performed. */
const wechat: WechatProvider = { exchange: async code => {
  const account = /^fixture-(alice|bob):[\w-]+$/.exec(code)?.[1];
  if (!account) throw new AppError(401, "FIXTURE_CODE_REQUIRED", "隔离示例只接受 fixture-alice:随机标识 或 fixture-bob:随机标识，不验证真实微信登录。");
  return { appId: "fixture-fullstack", openId: account };
} };
const runtime = await createRuntime({ directory, secret: randomBytes(48).toString("hex"), publicOrigin: origin, opsOrigin: origin, mcpUrl: `${origin}/api/mcp`, legacy, wechat, provider: new BrowserScenarioProvider() });
let ready = false;
const appHandler = runtime.handler;
const h5Root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../bubu-log-miniapp/dist/h5");
const mime: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };
runtime.handler = async request => {
  const pathname = new URL(request.url).pathname;
  if (pathname === "/__fixture/ready") return Response.json({ fixture: "bubu-fullstack-fixture/v1", ready, synthetic: true }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  if (pathname.startsWith("/api/") || pathname === "/health") return appHandler(request);
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Not found", { status: 404 });
  let target: string;
  try { target = path.resolve(h5Root, `.${decodeURIComponent(pathname === "/" ? "/index.html" : pathname)}`); }
  catch { return new Response("Not found", { status: 404 }); }
  if (!target.startsWith(`${h5Root}/`)) return new Response("Not found", { status: 404 });
  try { return new Response(request.method === "HEAD" ? null : new Uint8Array(await readFile(target)), { headers: { "Content-Type": mime[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" } }); }
  catch { return new Response("Build the isolated H5 preview first.", { status: 404 }); }
};
const running = await startRuntimeServer(runtime, { port, production: true });
let closing = false;
async function close() {
  if (closing) return;
  closing = true; ready = false;
  // Close only this server's sockets; no other local test or preview is touched.
  running.server.closeAllConnections();
  await running.close();
}
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void close().then(() => process.exit(0), () => process.exit(1)); });
try {
  const users = { admin: "admin@fixture.invalid", operator: "operator@fixture.invalid", auditor: "auditor@fixture.invalid" };
  const admin = await bootstrapOpsAdmin(runtime.store.payload, { email: users.admin, password, babyIds: ["baby-a", "baby-b", "baby-verify"] });
  const administrator = { id: admin.id, collection: "ops-users" as const };
  const operator = await runtime.store.payload.create({ collection: "ops-users", data: { email: users.operator, password, role: "operator", active: true, babyIds: ["baby-a", "baby-verify"] }, user: administrator, overrideAccess: false });
  await runtime.store.payload.create({ collection: "ops-users", data: { email: users.auditor, password, role: "auditor", active: true, babyIds: ["baby-a", "baby-verify"] }, user: administrator, overrideAccess: false });
  const aliceToken = (await runtime.identity.loginLegacy("old-alice", "correct-password", "native")).token;
  const alice = await runtime.identity.authenticate(aliceToken, "bearer");
  const bobToken = (await runtime.identity.loginLegacy("old-bob", "correct-password", "native")).token;
  const verificationToken = (await runtime.identity.loginLegacy("old-verifier", "correct-password", "native")).token;
  // Fixed test account mappings support explicit fixture codes without granting arbitrary code holders another baby.
  for (const account of ["alice", "bob"]) {
    const login = await runtime.identity.loginWechat(`fixture-${account}:seed`);
    await runtime.identity.bindLegacy(await runtime.identity.authenticate(login.token), `old-${account}`, "correct-password");
  }
  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#e5b692" } }).png().toBuffer();
  const image = await runtime.attachments.upload(alice, "baby-a", bytes, "image/png", "fullstack-example-image");
  const client = new ChatMcpClient(`${origin}/api/mcp`, aliceToken);
  await client.connect();
  let eventId: string;
  try {
    const receipt = await client.call("bubu_record_events", { babyId: "baby-a", requestId: "fullstack-example-pending", events: [{ facts: { type: "DIAPER", startTime: "2026-10-23T08:00:00+08:00", hasPee: true, hasPoop: false }, attachmentIds: [image.id], sources: [{ kind: "chat", accountId: "fixture-alice", conversationId: "fixture-preview", messageId: "example-record-1", eventKey: "diaper", sentAt: "2026-10-23T08:00:00+08:00", senderId: "示例照护者" }] }] }) as { events: Array<{ id: string }> };
    eventId = receipt.events[0]!.id;
  } finally { await client.close(); }
  const issued = await runtime.identity.provisionOperator(`ops:${operator.id}`, "baby-a", 15 * 60_000, { userId: String(operator.id), permissions });
  const principal = await runtime.identity.authenticate(issued.token, "bearer");
  const group = { accountId: "fixture-account", chatId: "fixture-fullstack@chatroom", agentId: "fixture-fullstack-collector" };
  const groupId = `wechat:${group.accountId}:${group.chatId}`;
  await runtime.identity.bindGroup(principal, "baby-a", groupId, group.agentId, true);
  const configured = await runtime.collector.dispatch(principal, { action: "configure", babyId: "baby-a", ...group, enabled: false, intervalMs: 60_000 }) as { job: CollectorJob };
  await runtime.identity.logout(principal);
  const filename = path.join(directory, "fixture.json");
  await writeFile(filename, JSON.stringify({ fixture: "bubu-fullstack-fixture/v1", synthetic: true, origin, directory, password, users, babyIds: ["baby-a", "baby-b"], aliceToken, bobToken, eventId, attachmentId: image.id, verification: { babyId: "baby-verify", token: verificationToken }, collector: { ...group, groupId, jobId: configured.job.id }, legacyLogin: { username: "old-alice", password: "correct-password" }, nativeFixtureCode: "fixture-alice:preview" }, null, 2), { mode: 0o600, flag: "wx" });
  ready = true;
  console.log(`Isolated full-stack fixture ready: ${origin}; native Payload: ${origin}/admin; private fixture file: ${filename}`);
  console.log("EXAMPLE DATA ONLY: synthetic old business/model/WeChat boundaries; no customer group reader, real model, or payment provider is started.");
} catch (error) { await close(); throw error; }
