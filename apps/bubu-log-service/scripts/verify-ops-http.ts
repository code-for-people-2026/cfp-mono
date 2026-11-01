import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

// Only the private metadata file produced by NODE_ENV=test tests/ops-browser-server.ts is accepted.
const filename = process.argv[2];
if (!filename) throw new Error("Pass the private fixture.json path emitted by test:ops-server.");
const fixture = JSON.parse(await readFile(filename, "utf8")) as { origin: string; directory: string; users: Record<"admin" | "operator" | "auditor", string>; password: string; eventId: string; otherEventId: string; attachmentId: string; aliceToken: string };
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(fixture.origin) || !Object.values(fixture.users).every(email => email.endsWith("@fixture.invalid"))) throw new Error("Only isolated local fixture accounts are supported.");
let checks = 0;
for (const [script, args] of [["scripts/operator.ts", ["fixture-operator", "baby-a"]], ["scripts/create-admin.ts", []]] as const) {
  const child = spawnSync(process.execPath, ["--import", "tsx", script, ...args], { encoding: "utf8", env: { ...process.env, BUBU_IDENTITY_DIRECTORY: fixture.directory, BUBU_OPS_ADMIN_EMAIL: "blocked@fixture.invalid", BUBU_OPS_ADMIN_PASSWORD: "fixture-only-password-12345" }, timeout: 20_000 });
  assert.notEqual(child.status, 0, `${script} cannot open a second writer`);
  assert.match(child.stderr, /already owned/, `${script} must fail before reading its partial schema or old backend`);
  checks++;
}
const request = (pathname: string, init?: RequestInit) => fetch(`${fixture.origin}${pathname}`, { ...init, headers: { "Sec-Fetch-Site": "same-origin", ...init?.headers } });
async function login(role: "admin" | "operator" | "auditor") {
  const response = await request("/api/cms/ops-users/login", { method: "POST", headers: { Origin: fixture.origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: fixture.users[role], password: fixture.password }) });
  assert.equal(response.status, 200, `native ${role} login`);
  const json = await response.json();
  assert.ok(!("token" in json), "native login must not expose raw JWT");
  noSecrets(json);
  const cookies = response.headers.getSetCookie();
  assert.ok(cookies.some(cookie => cookie.startsWith("bubu-ops-token=")));
  checks++;
  return cookies.map(cookie => cookie.split(";", 1)[0]).join("; ");
}
function noSecrets(value: unknown) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!["password", "hash", "salt", "sessions", "sessionId", "credential", "secret", "resetPasswordToken", "operatorUserId"].includes(key), `sensitive field ${key}`);
    noSecrets(child);
  }
}
const operator = await login("operator"), auditor = await login("auditor"), admin = await login("admin");
for (const [cookie, expected] of [[admin, 200], [operator, 403], [auditor, 403]] as const) {
  const response = await request("/api/ops/health", { headers: { Cookie: cookie } });
  assert.equal(response.status, expected); noSecrets(await response.json()); checks++;
}
const post = (cookie: string, body: unknown, pathname = "/api/ops/action") => request(pathname, { method: "POST", headers: { Cookie: cookie, Origin: fixture.origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
for (const pathname of ["/api/ops/overview?babyId=baby-a", "/api/cms/care-events"]) {
  const response = await request(pathname, { headers: { Cookie: operator } });
  assert.equal(response.status, 200);
  const json = await response.json(); noSecrets(json);
  const text = JSON.stringify(json); assert.ok(!text.includes(fixture.otherEventId));
  checks++;
}
assert.equal((await request("/api/ops/overview?babyId=baby-b", { headers: { Cookie: operator } })).status, 403); checks++;
assert.equal((await request(`/api/cms/care-events/${fixture.otherEventId}`, { headers: { Cookie: operator } })).status, 404); checks++;
for (const path of ["/api/cms/sessions", "/api/cms/identities", "/api/cms/chat-turns"]) {
  assert.equal((await request(path, { headers: { Cookie: admin } })).status, 403); checks++;
}
const nativeWrite = await request(`/api/cms/care-events/${fixture.eventId}`, { method: "PATCH", headers: { Cookie: admin, Origin: fixture.origin, "Content-Type": "application/json" }, body: JSON.stringify({ value: { facts: { milkAmount: 999 } } }) });
assert.equal(nativeWrite.status, 403); checks++;
assert.equal((await request("/api/cms/graphql", { method: "POST", headers: { Cookie: admin, Origin: fixture.origin, "Content-Type": "application/json" }, body: JSON.stringify({ query: "{ CareEvents { docs { id value } } }" }) })).status, 404); checks++;
for (const origin of [undefined, "https://untrusted.invalid"]) {
  for (const pathname of ["/api/cms/ops-users/login", "/api/ops/action", "/admin"]) {
    const response = await request(pathname, { method: "POST", headers: { Cookie: operator, ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 403); checks++;
  }
}
for (const pathname of ["/api/cms/care-events", "/api/ops/context"]) {
  assert.equal((await request(pathname, { headers: { Authorization: `Bearer ${fixture.aliceToken}` } })).status, 401); checks++;
}
const body = { babyId: "baby-a", reason: "隔离权限验收", requestId: `http-${randomUUID()}`, command: { type: "binding", groupId: "wechat:fixture-account:http-group@chatroom", agentId: "http-fixture-agent", active: false } };
assert.equal((await post(auditor, body)).status, 403); checks++;
assert.equal((await post(operator, body)).status, 200); checks++;
assert.equal((await post(operator, body)).status, 200); checks++;
assert.equal((await post(operator, { ...body, command: { ...body.command, active: true } })).status, 409); checks++;
const event = await post(operator, { babyId: "baby-a", kind: "event", id: fixture.eventId, reason: "隔离来源核对" }, "/api/ops/read");
assert.equal(event.status, 200); noSecrets(await event.json()); checks++;
const photo = await post(operator, { babyId: "baby-a", kind: "attachment", id: fixture.attachmentId, reason: "隔离私图审阅" }, "/api/ops/read");
assert.equal(photo.status, 200); assert.match(photo.headers.get("content-type") || "", /image\/png/); const pixels = await photo.arrayBuffer(); assert.ok(pixels.byteLength > 0); checks++;
const upload = (cookie: string, babyId: string) => request(`/api/ops/attachment?babyId=${babyId}&requestId=http-upload-${randomUUID()}`, { method: "POST", headers: { Cookie: cookie, Origin: fixture.origin, "Content-Type": "image/png", "X-Bubu-Reason": encodeURIComponent("隔离图片检测链路验收") }, body: pixels });
const uploaded = await upload(operator, "baby-a"); assert.equal(uploaded.status, 200); noSecrets(await uploaded.json()); checks++;
assert.equal((await upload(auditor, "baby-a")).status, 403); checks++;
assert.equal((await upload(operator, "baby-b")).status, 403); checks++;
assert.equal((await post(operator, { babyId: "baby-b", kind: "attachment", id: fixture.attachmentId, reason: "隔离越权审阅" }, "/api/ops/read")).status, 403); checks++;
console.log(`Native Payload + shared runtime HTTP checks passed: ${checks} (real SQLite/Admin login, role/baby isolation, CSRF, no secret JSON, read-only records, controlled action replay, private image).`);
