import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { sessionSchema, privacyPolicySchema, privacyStatusSchema, deletionSchema, credentialSchema, historySchema, memoryStatusSchema, submissionResultSchema } from "@cfp/hello-agent-contracts";

if (process.env.HELLO_HTTP_ISOLATED !== "true" || !process.env.HELLO_HTTP_FIXTURES) throw new Error("HTTP 检查仅允许由 e2e 脚本启动的隔离测试库");
const fixtures = JSON.parse(process.env.HELLO_HTTP_FIXTURES) as {
  cookie: string; native: { token: string; expiresAt: string }; otherCookie: string;
  historySessionId: number; history: { id: number; requestId: string; mode: string; greeting: string }[]; legacyToken: string;
};
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
async function post(path: string, body: unknown, requestCookie = cookie) {
  return fetch(`${origin}/api/hello/${path}`, {
    method: "POST",
    headers: {
      Cookie: requestCookie,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
const policy = privacyPolicySchema.parse(await (await fetch(`${origin}/api/hello/legal`)).json());
const consent = { version: policy.version, core: true, model: true, sensitive: true, external: false };
assert.equal((await post("sessions", { title: "未授权不能创建" })).status, 403);
assert.equal((await post("token", {})).status, 403);
assert.equal((await post("privacy/consent", { ...consent, external: true,
  externalRecipient: { name: "合成 HTTP 客户端", contact: "test@example.invalid", region: "隔离测试", privacyUrl: "https://example.invalid/privacy" },
})).status, 403);
assert.equal(privacyStatusSchema.parse(await (await post("privacy/consent", consent)).json()).state, "active");
assert.equal((await post("token", {})).status, 403, "有效平台同意也不能签发外部令牌");
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
  method: "POST", headers: nativeHeaders, body: JSON.stringify(consent),
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
  403,
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
// Historical external records and tokens are pre-upgrade synthetic fixtures;
// new external submissions stay disabled on every public entrypoint.
const legacyHeaders = { Authorization: `Bearer ${fixtures.legacyToken}` };
for (const method of ["GET", "POST", "DELETE"]) {
  for (const headers of [{}, nativeHeaders, legacyHeaders]) {
    assert.equal((await fetch(`${origin}/api/mcp`, { method, headers })).status, 403);
  }
}
assert.equal((await fetch(`${origin}/api/hello/sessions`, { headers: legacyHeaders })).status, 403);
assert.equal((await fetch(`${origin}/api/hello/privacy/export`, { headers: legacyHeaders })).status, 403);
for (const mode of ["byok", "external"]) {
  assert.equal((await post("greet", {
    sessionId: session.id, requestId: randomUUID(), mode,
    input: { text: "外部入口关闭检查", mediaIds: [] },
    ...(mode === "byok" ? { apiKey: "synthetic-test-key-not-real" } : {}),
  })).status, 403);
}
const historyPath = `${origin}/api/hello/sessions/${fixtures.historySessionId}`;
const history = historySchema.parse(await (await fetch(historyPath, { headers: { Cookie: cookie } })).json());
assert.equal(history.length, fixtures.history.length);
for (const expected of fixtures.history) {
  const row = history.find((item) => item.id === expected.id);
  assert.ok(row);
  assert.equal(row.mode, expected.mode);
  assert.equal(row.greeting, expected.greeting);
  const statusPath = `${historyPath}/requests/${expected.requestId}`;
  const status = await fetch(statusPath, { headers: { Cookie: cookie } });
  assert.equal(status.status, 200);
  assert.equal(submissionResultSchema.parse(await status.json()).turn?.id, expected.id);
  assert.equal((await fetch(statusPath)).status, 401);
  assert.equal((await fetch(statusPath, { headers: { Cookie: fixtures.otherCookie } })).status, 404);
}
const missing = await fetch(`${historyPath}/requests/${randomUUID()}`, { headers: { Cookie: cookie } });
assert.deepEqual(submissionResultSchema.parse(await missing.json()), { turn: null });
assert.equal((await fetch(`${historyPath}/requests/invalid`, { headers: { Cookie: cookie } })).status, 400);
const memoryPath = `${origin}/api/hello/context/${fixtures.historySessionId}`;
const memory = memoryStatusSchema.parse(await (await fetch(memoryPath, { headers: { Cookie: cookie } })).json());
assert.equal(memory.canCompact, true, "三条既有记录保留最后两轮之外的记忆候选");
assert.ok(memory.remainingPercent < 100);
assert.equal((await post("context/ad-start", { sessionId: session.id })).status, 409);
assert.equal((await post("context/compact", { sessionId: fixtures.historySessionId, rewardId: randomUUID() })).status, 403);
assert.equal((await post("context/preview-compact", { sessionId: fixtures.historySessionId, requestId: randomUUID(), revision: 0 })).status, 403);
assert.equal((await fetch(`${origin}/api/hello/media/1`)).status, 401);
assert.equal((await fetch(`${origin}/api/hello/greet`, {
  method: "POST", headers: { Cookie: cookie, Origin: "https://evil.example" },
})).status, 403);
const cmsRows = await fetch(`${origin}/api/greetings`);
assert.ok([401, 403].includes(cmsRows.status));
assert.equal((await fetch(historyPath, { headers: { Cookie: fixtures.otherCookie } })).status, 404);
assert.equal((await fetch(memoryPath, { headers: { Cookie: fixtures.otherCookie } })).status, 404);
const revoked = await post("token/revoke", {}, fixtures.otherCookie);
assert.equal(revoked.status, 200);
assert.deepEqual(await revoked.json(), { revoked: true });
assert.equal((await fetch(`${origin}/api/hello/sessions`, { headers: legacyHeaders })).status, 401,
  "撤销必须真正删除旧 bearer 凭证，不能只依赖入口返回403");
assert.equal((await fetch(`${origin}/api/hello/sessions`, { headers: { Cookie: fixtures.otherCookie } })).status, 200,
  "撤销外部令牌不能撤销本人凭证");
const exported = await fetch(`${origin}/api/hello/privacy/export`, { headers: { Cookie: cookie } });
assert.equal(exported.status, 200);
const exportedRows = (await exported.json()).records.greetings;
assert.equal(exportedRows.length, fixtures.history.length);
assert.deepEqual(exportedRows.map((row: { mode: string }) => row.mode).sort(), ["byok", "external", "platform"]);
assert.equal((await post("privacy/withdraw", {})).status, 200);
assert.equal((await post("sessions", { title: "撤回后不能创建" })).status, 403);
assert.equal((await fetch(historyPath, { headers: { Cookie: cookie } })).status, 200,
  "撤回后仍可查阅既有历史");
const deletion = await post("privacy/delete", { confirmation: "删除我的全部在线数据" });
assert.equal(deletion.status, 200);
assert.equal(deletionSchema.parse(await deletion.json()).deleted, true);
assert.equal((await fetch(`${origin}/api/hello/sessions`, { headers: { Cookie: cookie } })).status, 401);
assert.equal((await fetch(`${origin}/api/hello/sessions/${nativeId}`, { headers: nativeHeaders })).status, 200);
console.log("✓ 真实 HTTP：仅平台同意，BYOK/外部产物/MCP/令牌签发关闭，旧外部令牌真实撤销，本人三类历史及状态查询、导出、撤回、删除与其他身份保留通过");
console.log("✓ 未接图审拒绝上传、访客隔离、CMS 原始接口、CSRF 及小程序独立凭证通过；使用隔离合成历史，未调用付费模型。");
