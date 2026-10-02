import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const dir = await mkdtemp(path.join(tmpdir(), "hello-external-retry-"));
process.env.HELLO_DATABASE_URI = `file:${dir}/test.db`;
process.env.PAYLOAD_SECRET = "external-retry-not-for-deployment";
process.env.HELLO_DEPLOYED = "false";
process.env.HELLO_MEDIA_STORAGE = "database";
const config = await (await import("../payload.config")).default;
const collection = config.collections.find((item) => item.slug === "greetings");
assert.ok(collection);
let failCompletion = true;
let reachedWrittenOutput = false;
collection.hooks.afterChange.push(async ({ doc, operation, req }) => {
  if (failCompletion && operation === "update" && doc.status === "completed") {
    const written = await req.payload.findByID({
      collection: "greetings",
      id: doc.id,
      req,
    });
    assert.equal(written.status, "completed");
    reachedWrittenOutput = true;
    throw new Error("injected-external-after-write-failure");
  }
  return doc;
});
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { createMcpServer } = await import("../src/server/mcp");
const payload = await cms();
const service = new GreetingService(
  new Repository(payload, { id: randomUUID(), auth: "bearer" }),
  async () => {
    throw new Error("外部保存不应调用模型");
  },
);
const server = createMcpServer(service);
const client = new Client({
  name: "external-retry-regression",
  version: "1.0.0",
});
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
await client.connect(clientTransport);
function value(result: Awaited<ReturnType<typeof client.callTool>>) {
  const content = result.content as { type: string; text?: string }[];
  assert.equal(content[0].type, "text");
  return JSON.parse(content[0].text!);
}
try {
  const session = value(
    await client.callTool({ name: "hello_create_session", arguments: {} }),
  );
  const args = {
    sessionId: session.id,
    requestId: randomUUID(),
    input: { text: "故障恢复回归", mediaIds: [] },
    output: {
      greeting: "愿每次重试都走得稳。",
      association: "仅为合成回归产物。",
    },
    model: "external-test-declared",
  };
  const save = (input = args) =>
    client.callTool({ name: "hello_save_greeting", arguments: input });
  assert.equal((await save()).isError, true);
  assert.equal(
    reachedWrittenOutput,
    true,
    "必须故障在真实写入后，而不是参数校验阶段",
  );
  const history = () =>
    client.callTool({
      name: "hello_get_history",
      arguments: { sessionId: session.id },
    });
  const failed = value(await history());
  assert.equal(failed.length, 1);
  assert.equal(failed[0].status, "running");
  assert.equal(failed[0].greeting, null, "完成写入失败后不能留下部分产物");

  failCompletion = false;
  const retried = await save();
  assert.notEqual(
    retried.isError,
    true,
    "恢复存储后，相同请求必须能够重试完成",
  );
  const saved = value(retried);
  assert.equal(saved.id, failed[0].id);
  assert.equal(saved.status, "completed");
  assert.equal(saved.greeting, args.output.greeting);
  assert.equal(value(await save()).id, saved.id);
  assert.equal(value(await history()).length, 1, "重试不得创建第二个产物");
  const conflict = await save({
    ...args,
    output: { ...args.output, greeting: "不能覆盖原产物" },
  });
  assert.equal(conflict.isError, true);
  assert.match(value(conflict).error, /不同内容/);
  console.log(
    "✓ MCP 外部保存写入后失败可用原请求恢复，重复提交不新增，变更内容仍被拒绝",
  );
} finally {
  await client.close();
  await server.close();
  await payload.destroy();
}
