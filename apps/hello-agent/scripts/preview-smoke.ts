import "./load-local-env";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import sharp from "sharp";

const origin = process.env.HELLO_ORIGIN;
if (!origin?.startsWith("https://")) throw new Error("此验收要求显式 HTTPS 预览地址");
const recordPath = new URL("../.data/ecs-preview/smoke.json", import.meta.url);
type Saved = { cookie: string; sessionId: number; ids: number[] };
async function json(route: string, init?: RequestInit) {
  const response = await fetch(`${origin}${route}`, init);
  assert.equal(response.status, 200, `${route} 应当成功，实际 ${response.status}`);
  return response.json();
}

let saved: Saved;
if (process.argv.includes("--verify-only")) {
  saved = JSON.parse(await readFile(recordPath, "utf8"));
} else {
  const identity = await fetch(`${origin}/api/hello/identity`, { method: "POST", headers: { Origin: origin } });
  assert.equal(identity.status, 200);
  assert.match(identity.headers.get("set-cookie") || "", /Secure/);
  const cookie = identity.headers.get("set-cookie")!.split(";")[0];
  const headers = { Origin: origin, Cookie: cookie, "Content-Type": "application/json" };
  const post = (route: string, data: unknown) => json(`/api/hello/${route}`, { method: "POST", headers, body: JSON.stringify(data) });
  const session = await post("sessions", { title: "ECS 部署验收（测试数据）" });
  const platform = await post("greet", {
    sessionId: session.id, requestId: randomUUID(), mode: "platform",
    input: { text: "部署验收：我的第一个小程序今天连接上自己的服务器了，请给我一句实在的鼓励。", mediaIds: [] },
  });
  assert.equal(platform.status, "completed");
  assert.ok(platform.greeting.length > 1);
  console.log(`平台真实回复：${platform.greeting}`);
  const image = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#ef5934" } }).png().toBuffer();
  const media = await post("upload", { base64: image.toString("base64") });
  const byok = await post("greet", {
    sessionId: session.id, requestId: randomUUID(), mode: "byok", apiKey: process.env.DEEPSEEK_API_KEY,
    input: { text: "部署验收：这张暖橙色测试图让你想到什么？请说一句吉祥话。", mediaIds: [media.id] },
  });
  assert.equal(byok.status, "completed");
  console.log(`BYOK 图文真实回复：${byok.greeting}`);
  saved = { cookie, sessionId: session.id, ids: [platform.id, byok.id] };
  await writeFile(recordPath, JSON.stringify(saved), { mode: 0o600 });
}
const history = await json(`/api/hello/sessions/${saved.sessionId}`, { headers: { Cookie: saved.cookie } });
assert.deepEqual(history.map((row: { id: number }) => row.id), saved.ids);
assert.ok(!JSON.stringify(history).includes(process.env.DEEPSEEK_API_KEY || "missing-secret"));
loadEnvFile(new URL("../.data/ecs-preview/private/admin.env", import.meta.url));
const admin = await json("/api/admins/login", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ email: process.env.HELLO_ADMIN_EMAIL, password: process.env.HELLO_ADMIN_PASSWORD }),
});
const records = await json(`/api/greetings?where[sessionId][equals]=${saved.sessionId}&depth=0`, { headers: { Authorization: `JWT ${admin.token}` } });
assert.equal(records.totalDocs, saved.ids.length);
assert.ok(!JSON.stringify(records).includes(process.env.DEEPSEEK_API_KEY || "missing-secret"));
const config = await json("/api/hello/config");
assert.equal(config.advertisement.mode, "disabled");
const unauthorized = await fetch(`${origin}/api/greetings`);
assert.ok([401, 403].includes(unauthorized.status));
console.log(`HTTPS、平台/BYOK 产物、CMS 管理员读取、未登录隔离、远程广告关闭验收通过。测试会话 ${saved.sessionId}。`);
