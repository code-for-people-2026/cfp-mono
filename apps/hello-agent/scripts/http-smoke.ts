import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import sharp from "sharp";

const origin = process.env.HELLO_ORIGIN || "http://127.0.0.1:3310";
// 只在脚本自己建立的隔离实例尝试注册，避免在用户已开放注册的本地库创建测试管理员。
if (process.env.HELLO_HTTP_ISOLATED === "true") {
  const registration = await fetch(`${origin}/api/admins/first-register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "untrusted-test@example.invalid",
      password: "test-only-not-a-real-password",
    }),
  });
  assert.equal(
    registration.status,
    403,
    "未初始化时也不能通过 Payload 首次注册绕过权限",
  );
}
const response = await fetch(`${origin}/api/hello/identity`, {
  method: "POST",
  headers: { Origin: origin },
});
assert.equal(response.status, 200);
const cookie = response.headers.get("set-cookie")!.split(";")[0];
async function post(path: string, body: unknown) {
  return fetch(`${origin}/api/hello/${path}`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
const session = await (
  await post("sessions", { title: "HTTP 集成验证（测试数据）" })
).json();
assert.ok(session.id);
const image = await sharp({
  create: { width: 16, height: 16, channels: 3, background: "#eeaa44" },
})
  .png()
  .toBuffer();
const media = await (
  await post("upload", { base64: image.toString("base64") })
).json();
assert.ok(media.id);
const nativeIdentity = await fetch(`${origin}/api/hello/miniapp-identity`, {
  method: "POST",
});
assert.equal(nativeIdentity.status, 200);
const device = await nativeIdentity.json();
const nativeHeaders = {
  Authorization: `Bearer ${device.token}`,
  "Content-Type": "application/json",
};
const nativeSession = await fetch(`${origin}/api/hello/sessions`, {
  method: "POST",
  headers: nativeHeaders,
  body: JSON.stringify({ title: "小程序请求验证（测试数据）" }),
});
assert.equal(nativeSession.status, 200);
const nativeId = (await nativeSession.json()).id;
assert.equal(
  (
    await fetch(`${origin}/api/hello/sessions/${nativeId}`, {
      headers: nativeHeaders,
    })
  ).status,
  200,
);
assert.equal(
  (
    await fetch(`${origin}/api/hello/sessions/${session.id}`, {
      headers: nativeHeaders,
    })
  ).status,
  404,
);
assert.equal(
  (await fetch(`${origin}/api/mcp`, { method: "POST", headers: nativeHeaders }))
    .status,
  401,
);
assert.equal(
  (
    await fetch(`${origin}/api/hello/miniapp-identity`, {
      method: "POST",
      headers: { Origin: origin },
    })
  ).status,
  403,
);
assert.equal(
  (
    await fetch(`${origin}/api/hello/sessions`, {
      method: "POST",
      headers: { ...nativeHeaders, Origin: "https://evil.example" },
      body: "{}",
    })
  ).status,
  403,
);
const nativeImage = await fetch(`${origin}/api/hello/upload`, {
  method: "POST",
  headers: nativeHeaders,
  body: JSON.stringify({ base64: image.toString("base64") }),
});
assert.equal(nativeImage.status, 200);
assert.equal(
  (
    await fetch(`${origin}/api/hello/media/${(await nativeImage.json()).id}`, {
      headers: nativeHeaders,
    })
  ).status,
  200,
);
const credential = await (await post("token", {})).json();
const client = new Client({ name: "hello-http-test", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(
  new URL(`${origin}/api/mcp`),
  {
    requestInit: { headers: { Authorization: `Bearer ${credential.token}` } },
  },
);
await client.connect(transport);
try {
  assert.equal((await client.listTools()).tools.length, 7);
  const args = {
    sessionId: session.id,
    requestId: randomUUID(),
    input: { text: "测试用的橙色方块", mediaIds: [media.id] },
    output: {
      greeting: "愿日子如暖橙般明亮，心有所盼，步步生光。",
      association: "HTTP 测试固定产物，并非真实模型生成。",
    },
    model: "http-fixture-not-a-model",
  };
  const result = await client.callTool({
    name: "hello_save_greeting",
    arguments: args,
  });
  assert.ok(!result.isError, JSON.stringify(result));
  await client.callTool({ name: "hello_save_greeting", arguments: args });
  const history = await (
    await fetch(`${origin}/api/hello/sessions/${session.id}`, {
      headers: { Cookie: cookie },
    })
  ).json();
  assert.equal(history.length, 1);
  assert.equal(history[0].greeting, args.output.greeting);
  const memory = await (await fetch(`${origin}/api/hello/context/${session.id}`, { headers: { Cookie: cookie } })).json();
  assert.equal(memory.canCompact, false);
  assert.ok(memory.remainingPercent < 100);
  assert.equal((await post("context/ad-start", { sessionId: session.id })).status, 409);
  assert.equal((await post("context/compact", { sessionId: session.id, rewardId: randomUUID() })).status, 403);
  const modelContext = await client.callTool({ name: "hello_get_context", arguments: { sessionId: session.id } });
  assert.ok(!modelContext.isError);
  assert.equal(
    (await fetch(`${origin}/api/hello/media/${media.id}`)).status,
    401,
  );
  assert.equal(
    (await fetch(`${origin}/api/mcp`, { method: "POST" })).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/hello/greet`, {
        method: "POST",
        headers: { Cookie: cookie, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  const cmsRows = await fetch(`${origin}/api/greetings`);
  assert.ok([401, 403].includes(cmsRows.status));
  const wrongOwner = await fetch(`${origin}/api/hello/identity`, {
    method: "POST",
    headers: { Origin: origin },
  });
  const otherCookie = wrongOwner.headers.get("set-cookie")!.split(";")[0];
  assert.equal((await fetch(`${origin}/api/hello/context/${session.id}`, { headers: { Cookie: otherCookie } })).status, 404);
  assert.equal(
    (
      await fetch(`${origin}/api/hello/sessions/${session.id}`, {
        headers: { Cookie: otherCookie },
      })
    ).status,
    404,
  );
  await post("token/revoke", {});
  assert.equal(
    (
      await fetch(`${origin}/api/mcp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${credential.token}` },
      })
    ).status,
    401,
  );
  console.log(
    "✓ HTTP + 标准 MCP 客户端：握手、工具发现、图片上传、外部产物、历史、幂等、访客隔离、CMS 原始接口、CSRF、撤销，以及小程序独立凭证验证通过",
  );
  console.log(`测试会话 ${session.id}，产物明确标为测试数据；未调用付费模型。`);
} finally {
  await client.close();
}
