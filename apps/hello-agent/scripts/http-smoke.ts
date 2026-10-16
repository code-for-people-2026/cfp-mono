import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import sharp from "sharp";
import { sessionSchema, privacyPolicySchema, privacyStatusSchema, deletionSchema, credentialSchema, historySchema, memoryStatusSchema, submissionResultSchema } from "@cfp/hello-agent-contracts";

if (process.env.HELLO_HTTP_ISOLATED !== "true" || !process.env.HELLO_HTTP_FIXTURES) throw new Error("HTTP 检查仅允许由 e2e 脚本启动的隔离测试库");
const fixtures = JSON.parse(process.env.HELLO_HTTP_FIXTURES) as { cookie: string; native: { token: string; expiresAt: string }; otherCookie: string };
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
const guestCookie = response.headers.get("set-cookie")!.split(";")[0];
assert.equal((await fetch(`${origin}/api/hello/sessions`, { headers: { Cookie: guestCookie } })).status, 403);
const cookie = fixtures.cookie;
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
const policy = privacyPolicySchema.parse(await (await fetch(`${origin}/api/hello/legal`)).json());
const consent = { version: policy.version, core: true, model: true, sensitive: true, external: true,
  externalRecipient: { name: "合成 HTTP 客户端", contact: "test@example.invalid", region: "隔离测试", privacyUrl: "https://example.invalid/privacy" } };
assert.equal((await post("sessions", { title: "未授权不能创建" })).status, 403);
assert.equal((await post("token", {})).status, 403);
assert.equal(privacyStatusSchema.parse(await (await post("privacy/consent", consent)).json()).state, "active");
const session = sessionSchema.parse(await (
  await post("sessions", { title: "HTTP 集成验证（测试数据）" })
).json());
assert.ok(session.id);
// 页面保持打开但 Cookie 被清除时，恢复入口应签发新身份，不能读到旧身份的聊天。
assert.equal((await fetch(`${origin}/api/hello/sessions`)).status, 401);
const recovered = await fetch(`${origin}/api/hello/identity`, {
  method: "POST",
  headers: { Origin: origin },
});
assert.equal(recovered.status, 200);
assert.match(recovered.headers.get("set-cookie")!, /HttpOnly/);
const recoveredCookie = recovered.headers.get("set-cookie")!.split(";")[0];
assert.notEqual(recoveredCookie, cookie);
assert.equal((await fetch(`${origin}/api/hello/sessions`, { headers: { Cookie: recoveredCookie } })).status, 403);
assert.equal((await fetch(`${origin}/api/hello/sessions/${session.id}`, { headers: { Cookie: recoveredCookie } })).status, 403);
assert.equal((await fetch(`${origin}/api/hello/sessions/${session.id}`, { headers: { Cookie: cookie } })).status, 200);
const image = await sharp({
  create: { width: 16, height: 16, channels: 3, background: "#eeaa44" },
})
  .png()
  .toBuffer();
// No reviewer is wired in this build; real HTTP uploads must remain closed.
assert.equal((await post("upload", { base64: image.toString("base64") })).status, 503);
const nativeIdentity = await fetch(`${origin}/api/hello/miniapp-identity`, {
  method: "POST",
});
assert.equal(nativeIdentity.status, 200);
const guestDevice = credentialSchema.parse(await nativeIdentity.json());
assert.equal((await fetch(`${origin}/api/hello/sessions`, { headers: { Authorization: `Bearer ${guestDevice.token}` } })).status, 403);
const device = credentialSchema.parse(fixtures.native);
const nativeHeaders = {
  Authorization: `Bearer ${device.token}`,
  "Content-Type": "application/json",
};
const nativeConsent = await fetch(`${origin}/api/hello/privacy/consent`, {
  method: "POST", headers: nativeHeaders, body: JSON.stringify({ ...consent, external: false }),
});
assert.equal(nativeConsent.status, 200);
const nativeSession = await fetch(`${origin}/api/hello/sessions`, {
  method: "POST",
  headers: nativeHeaders,
  body: JSON.stringify({ title: "小程序请求验证（测试数据）" }),
});
assert.equal(nativeSession.status, 200);
const nativeId = sessionSchema.parse(await nativeSession.json()).id;
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
assert.equal(nativeImage.status, 503);
const credential = credentialSchema.parse(await (await post("token", {})).json());
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
    input: { text: "测试用的橙色方块", mediaIds: [] },
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
  const history = historySchema.parse(await (
    await fetch(`${origin}/api/hello/sessions/${session.id}`, {
      headers: { Cookie: cookie },
    })
  ).json());
  assert.equal(history.length, 1);
  assert.equal(history[0].greeting, args.output.greeting);
  const statusPath = `${origin}/api/hello/sessions/${session.id}/requests/${args.requestId}`;
  const status = await fetch(statusPath, { headers: { Cookie: cookie } });
  assert.equal(status.status, 200);
  assert.equal(submissionResultSchema.parse(await status.json()).turn?.id, history[0].id);
  assert.equal((await fetch(statusPath)).status, 401);
  const missing = await fetch(`${origin}/api/hello/sessions/${session.id}/requests/${randomUUID()}`, { headers: { Cookie: cookie } });
  assert.deepEqual(submissionResultSchema.parse(await missing.json()), { turn: null });
  assert.equal((await fetch(`${origin}/api/hello/sessions/${session.id}/requests/invalid`, { headers: { Cookie: cookie } })).status, 400);
  const memory = memoryStatusSchema.parse(await (await fetch(`${origin}/api/hello/context/${session.id}`, { headers: { Cookie: cookie } })).json());
  assert.equal(memory.canCompact, false);
  assert.ok(memory.remainingPercent < 100);
  assert.equal((await post("context/ad-start", { sessionId: session.id })).status, 409);
  assert.equal((await post("context/compact", { sessionId: session.id, rewardId: randomUUID() })).status, 403);
  assert.equal((await post("context/preview-compact", { sessionId: session.id, requestId: randomUUID(), revision: 0 })).status, 403);
  const modelContext = await client.callTool({ name: "hello_get_context", arguments: { sessionId: session.id } });
  assert.ok(!modelContext.isError);
  assert.equal(
    (await fetch(`${origin}/api/hello/media/1`)).status,
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
  assert.equal(wrongOwner.status, 200);
  const otherCookie = fixtures.otherCookie;
  assert.equal((await fetch(statusPath, { headers: { Cookie: otherCookie } })).status, 404);
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
  if (process.env.HELLO_HTTP_ISOLATED === "true") {
    const exported = await fetch(`${origin}/api/hello/privacy/export`, { headers: { Cookie: cookie } });
    assert.equal(exported.status, 200);
    assert.equal((await exported.json()).records.greetings.length, 1);
    assert.equal((await post("privacy/withdraw", {})).status, 200);
    assert.equal((await post("sessions", { title: "撤回后不能创建" })).status, 403);
    const deletion = await post("privacy/delete", { confirmation: "删除我的全部在线数据" });
    assert.equal(deletion.status, 200);
    assert.equal(deletionSchema.parse(await deletion.json()).deleted, true);
    assert.equal((await fetch(`${origin}/api/hello/sessions`, { headers: { Cookie: cookie } })).status, 401);
    assert.equal((await fetch(`${origin}/api/hello/sessions/${nativeId}`, { headers: nativeHeaders })).status, 200);
    console.log("✓ 真实 HTTP 导出、撤回、删除及其他身份保留通过");
  }
  console.log(
    "✓ HTTP + 标准 MCP 客户端：授权、握手、工具发现、未接图审拒绝上传、外部产物、历史、幂等、访客隔离、CMS 原始接口、CSRF、撤销，以及小程序独立凭证验证通过",
  );
  console.log(`测试会话 ${session.id}，产物明确标为测试数据；未调用付费模型。`);
} finally {
  await client.close();
}
