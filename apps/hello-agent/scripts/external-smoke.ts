import "./load-local-env";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

// 使用独立测试身份和真实模型，不访问浏览器中已有用户的令牌或会话。
if (!process.env.DEEPSEEK_API_KEY) {
  console.error("未执行：需要本地 DeepSeek 凭证；缺少凭证不算通过。");
  process.exit(2);
}
const origin = process.env.HELLO_ORIGIN || "http://127.0.0.1:3310";
const identity = await fetch(`${origin}/api/hello/identity`, {
  method: "POST",
  headers: { Origin: origin },
});
assert.equal(identity.status, 200);
const cookie = identity.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie);
const headers = {
  Origin: origin,
  Cookie: cookie,
  "Content-Type": "application/json",
};
const sessionResponse = await fetch(`${origin}/api/hello/sessions`, {
  method: "POST",
  headers,
  body: JSON.stringify({ title: "独立 DeepSeek 客户端真实验证" }),
});
assert.equal(sessionResponse.status, 200);
const session = await sessionResponse.json();
const tokenResponse = await fetch(`${origin}/api/hello/token`, {
  method: "POST",
  headers,
});
assert.equal(tokenResponse.status, 200);
const credential = await tokenResponse.json();
const directory = await mkdtemp(path.join(tmpdir(), "hello-external-live-"));
const imagePath = path.join(directory, "orange.png");
await sharp({
  create: { width: 128, height: 128, channels: 3, background: "#ef5934" },
})
  .png()
  .toFile(imagePath);
try {
  const result = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/external-agent.ts",
      "这片暖橙色，让我想到傍晚的灯光。",
      imagePath,
    ],
    {
      env: {
        ...process.env,
        HELLO_MCP_TOKEN: credential.token,
        HELLO_SESSION_ID: String(session.id),
      },
      timeout: 90_000,
    },
  );
  const saved = JSON.parse(result.stdout);
  assert.equal(saved.status, "completed");
  const response = await fetch(`${origin}/api/hello/sessions/${session.id}`, {
    headers,
  });
  assert.equal(response.status, 200);
  const history = await response.json();
  assert.equal(history.length, 1);
  assert.equal(history[0].mode, "external");
  assert.equal(history[0].greeting, saved.greeting);
  assert.equal(history[0].input.mediaIds.length, 1);
  assert.ok(!JSON.stringify(history).includes(process.env.DEEPSEEK_API_KEY));
  console.log(
    "✓ 外部客户端：真实 DeepSeek 图文生成 → MCP → Payload → HTTP 历史读取",
  );
  console.log(
    JSON.stringify({
      greeting: saved.greeting,
      model: history[0].model,
      sessionId: session.id,
    }),
  );
} catch {
  console.error(
    "独立客户端验证失败；没有输出进程参数或原始异常，以免泄漏凭证。",
  );
  process.exitCode = 1;
} finally {
  const revoked = await fetch(`${origin}/api/hello/token/revoke`, {
    method: "POST",
    headers,
  });
  assert.equal(revoked.status, 200);
  console.log("测试 MCP 令牌已撤销。");
}
