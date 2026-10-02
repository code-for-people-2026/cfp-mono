import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ScriptedModel } from "./scripted-model";
import { verifyContext } from "./context-checks";

const dir = await mkdtemp(path.join(tmpdir(), "hello-agent-integration-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/test.db`;
process.env.PAYLOAD_SECRET = "integration-only-secret-not-for-deployment";
process.env.DEEPSEEK_API_KEY = "platform-test-secret";
process.env.HELLO_ADMIN_BOOTSTRAP = "false";
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { runGreeting } = await import("../src/agent/runtime");
const { PayloadSessionService } = await import(
  "../src/agent/payload-session-service"
);
const { createMcpServer } = await import("../src/server/mcp");
const { mintCredential, authenticate, revokeTokens, checkClientRequest } =
  await import("../src/server/auth");
const payload = await cms();
let checks = 0;
let persistedFixture: string[] = [];
function pass(name: string) {
  checks++;
  console.log(`✓ ${name}`);
}

try {
  const owner = { id: randomUUID(), auth: "cookie" as const };
  const repo = new Repository(payload, owner);
  const model = new ScriptedModel();
  const service = new GreetingService(repo, (args) => runGreeting(args, model));
  const session = await service.createSession("集成测试");
  const media = await service.upload(
    await sharp({
      create: { width: 32, height: 32, channels: 3, background: "#df573e" },
    })
      .png()
      .toBuffer(),
  );
  pass("真实 Payload 数据库创建会话并保存图片");

  const first = {
    sessionId: session.id,
    requestId: randomUUID(),
    mode: "platform",
    input: { text: "红红火火", mediaIds: [media.id] },
  };
  const greeting = await service.generateGreeting(first);
  assert.equal(greeting.status, "completed");
  assert.equal(model.requests.length, 1);
  assert.deepEqual(Object.keys(model.requests[0].toolsDict), ["save_greeting"]);
  assert.ok(
    model.requests[0].contents.some((c) =>
      c.parts?.some((p) => p.inlineData?.mimeType === "image/jpeg"),
    ),
  );
  pass("真实 ADK Runner 调度工具，文字和图片传到模型接口，产物保存");
  const duplicate = await service.generateGreeting(first);
  assert.equal(duplicate.id, greeting.id);
  assert.equal(model.requests.length, 1);
  await assert.rejects(
    () => service.generateGreeting({ ...first, input: { text: "不同内容" } }),
    /请求标识/,
  );
  pass("相同请求不重复调用模型，不同内容不能复用幂等键");

  let receivedKey = "";
  const byok = new GreetingService(repo, (args) => {
    receivedKey = args.apiKey;
    return runGreeting(args, new ScriptedModel());
  });
  await byok.generateGreeting({
    sessionId: session.id,
    requestId: randomUUID(),
    mode: "byok",
    apiKey: "private-byok-secret",
    input: { mediaIds: [media.id] },
  });
  assert.equal(receivedKey, "private-byok-secret");
  assert.equal(process.env.DEEPSEEK_API_KEY, "platform-test-secret");
  for (const collection of ["greetings", "adk-sessions"]) {
    const data = JSON.stringify(await repo.list(collection));
    assert.ok(
      !data.includes("private-byok-secret") &&
        !data.includes("platform-test-secret"),
    );
  }
  pass("BYOK 请求隔离，密钥未写入产物和 ADK 会话，不修改平台环境变量");

  const other = new GreetingService(
    new Repository(payload, { id: randomUUID(), auth: "cookie" }),
  );
  await assert.rejects(() => other.history(session.id), /无权/);
  await assert.rejects(() => other.repo.get("media", media.id), /无权/);
  await assert.rejects(
    () =>
      other.acceptExternal({
        sessionId: session.id,
        requestId: randomUUID(),
        input: { text: "越权" },
        output: { greeting: "不应成功", association: "测试" },
        model: "external",
      }),
    /无权/,
  );
  pass("其他访客不能读取会话、图片或提交产物");

  const release = await repo.acquire(session.id);
  await assert.rejects(() => repo.acquire(session.id), { status: 409 });
  await release();
  const freshAdapter = new PayloadSessionService(
    new Repository(payload, owner),
  );
  const saved = await freshAdapter.getSession({
    appName: "hello_agent",
    userId: owner.id,
    sessionId: String(greeting.id),
  });
  assert.ok(saved && saved.events.length >= 3);
  assert.ok(!JSON.stringify(saved).includes("inlineData"));
  pass("数据库执行锁防并发，新建 SessionService 可恢复已持久化事件");

  const failed = new GreetingService(repo, async () => {
    throw new Error("private-byok-secret");
  });
  await assert.rejects(
    () => failed.generateGreeting({ ...first, requestId: randomUUID() }),
    /生成失败/,
  );
  const all = await service.history(session.id);
  assert.ok(all.some((row) => row.status === "failed"));
  assert.ok(!JSON.stringify(all).includes("private-byok-secret"));
  pass("模型失败留存失败状态，不存供应商异常或假吉祥话");

  const server = createMcpServer(
    new GreetingService(repo, async () => {
      throw new Error("外部模式不应调用平台模型");
    }),
  );
  const client = new Client({
    name: "integration-external-agent",
    version: "1.0.0",
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 7);
  const prompt = await client.getPrompt({ name: "hello_greeting" });
  const promptText = prompt.messages
    .map((message) =>
      message.content.type === "text" ? message.content.text : "",
    )
    .join("\n");
  assert.ok(promptText.includes("自称「阿J」"));
  assert.ok(promptText.includes("hello_save_greeting 工具一次"));
  assert.ok(promptText.includes("不要让用户选择会话或填写 sessionId"));
  const external = {
    sessionId: session.id,
    requestId: randomUUID(),
    input: { text: "春天来了", mediaIds: [media.id] },
    output: {
      greeting: "愿你春来万事新，心中有暖，脚下有花。",
      association: "从春天联想到新的开始。",
    },
    model: "external-test-declared",
  };
  const response = await client.callTool({
    name: "hello_save_greeting",
    arguments: external,
  });
  assert.ok(!response.isError);
  await client.callTool({ name: "hello_save_greeting", arguments: external });
  const externalRows = (await service.history(session.id)).filter(
    (row) => row.mode === "external",
  );
  assert.equal(externalRows.length, 1);
  assert.equal(externalRows[0].greeting, external.output.greeting);
  await client.close();
  await server.close();
  await verifyContext(repo);
  pass("记忆血条、广告完成门槛、失败重试、消费幂等、隔离与超过 100 条历史的分页恢复");
  pass("标准 MCP 客户端握手、发现工具、保存外部产物，幂等且完全绕过平台模型");

  const credential = await mintCredential(payload, "bearer", owner.id);
  const request = new Request("http://localhost/api/mcp", {
    headers: { Authorization: `Bearer ${credential.token}` },
  });
  assert.equal((await authenticate(payload, request, true)).id, owner.id);
  await revokeTokens(payload, owner);
  await assert.rejects(() => authenticate(payload, request, true), /无效/);
  pass("MCP 凭证哈希验证与撤销");

  const device = await mintCredential(payload, "miniapp", owner.id);
  const deviceRequest = new Request("http://localhost/api/hello/sessions", {
    headers: { Authorization: `Bearer ${device.token}` },
  });
  const deviceOwner = await authenticate(payload, deviceRequest);
  assert.equal(deviceOwner.auth, "miniapp");
  assert.equal(deviceOwner.id, owner.id);
  checkClientRequest(deviceRequest, deviceOwner);
  await assert.rejects(
    () => authenticate(payload, deviceRequest, true),
    /无效/,
  );
  assert.throws(
    () =>
      checkClientRequest(
        new Request("http://localhost/api/hello/sessions", {
          headers: { Origin: "https://evil.example" },
        }),
        deviceOwner,
      ),
    /来源/,
  );
  pass("小程序凭证支持原生请求，但不能冒充 MCP 令牌或绕过浏览器来源校验");

  const adminData = {
    email: "integration-admin@example.invalid",
    password: randomUUID(),
  };
  await assert.rejects(
    () =>
      payload.create({
        collection: "admins",
        overrideAccess: true,
        data: adminData,
      }),
    /管理员注册未开放/,
  );
  process.env.HELLO_ADMIN_BOOTSTRAP = "true";
  await payload.create({
    collection: "admins",
    overrideAccess: true,
    data: adminData,
  });
  await assert.rejects(
    () =>
      payload.create({
        collection: "admins",
        overrideAccess: true,
        data: { email: "second@example.invalid", password: randomUUID() },
      }),
    /管理员注册未开放/,
  );
  process.env.HELLO_ADMIN_BOOTSTRAP = "false";
  const login = await payload.login({ collection: "admins", data: adminData });
  const cmsRows = await payload.find({
    collection: "greetings",
    where: { id: { equals: greeting.id } },
    overrideAccess: false,
    user: login.user,
  });
  assert.ok(cmsRows.docs.some((item) => item.id === greeting.id));
  pass(
    "首次注册开关有效，创建首个管理员后拒绝匿名创建第二个，管理员可登录查看产物",
  );

  const storedBytes = await readFile(path.join(dir, "test.db"));
  assert.ok(!storedBytes.includes(Buffer.from("private-byok-secret")));
  persistedFixture = [
    owner.id,
    String(session.id),
    String(greeting.id),
    String(media.id),
  ];
} finally {
  await payload.destroy();
}

// 销毁连接后，用另一个 Node 进程检查，不能靠内存对象证明持久化。
await promisify(execFile)(
  process.execPath,
  ["--import", "tsx", "scripts/persistence-read.ts", ...persistedFixture],
  {
    cwd: process.cwd(),
    // 重启验证只读取已存在的结构；避免开发模式再次同步 schema。
    env: { ...process.env, NODE_ENV: "production" },
    // 本机测得 Payload + ADK 冷导入约 35 秒，为冷启动留出余量；读取断言不变。
    timeout: 120_000,
  },
);
pass("独立进程重启后仍能读取会话、吉祥话、图片与 ADK 事件");
console.log(
  `\n${checks} 组集成验证通过。脚本模型只证明链路，不代表真实模型质量。`,
);
