import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { caseQueueFilters, collectionURL } from "../src/operations/admin-presentation";
const base = "http://127.0.0.1:3317";
const fixture = JSON.parse(await readFile(new URL("../../../.codex-tmp/operations-preview-access.json", import.meta.url), "utf8"));
if (fixture.url !== base + "/admin/collections/safety-cases") throw new Error("仅允许本任务的本地合成验收服务");
async function call(path: string, options: RequestInit = {}) { return fetch(base + path, options); }
async function login(email: string, password: string) {
  const response = await call("/api/admins/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ email, password }) });
  assert.equal(response.status, 200); return `payload-token=${(await response.json()).token}`;
}
const adminCookie = await login(fixture.email, fixture.password);
const reviewerCookie = await login("reviewer@preview.example", "Local-Review-Preview-2026!");
assert.equal((await call("/operations")).status, 404);
const anonymousAdmin = await call("/admin/collections/safety-cases", { redirect: "manual" });
// Next may send a redirect in the RSC stream after response headers are committed.
if (anonymousAdmin.status === 200) assert.match(await anonymousAdmin.text(), /NEXT_REDIRECT;replace;\/admin\/login\?/);
else {
  assert.ok([302, 303, 307, 308].includes(anonymousAdmin.status));
  assert.ok(anonymousAdmin.headers.get("location")?.includes("/admin/login"));
}
assert.equal((await call("/api/operations/cases")).status, 401);
assert.equal((await call("/api/operations/settings", { headers: { Cookie: reviewerCookie } })).status, 403);
assert.equal((await call("/api/safety-evidence", { headers: { Cookie: adminCookie } })).status, 403);
for (const path of ["/api/agent-configs", "/api/knowledge-bases", "/api/hello-admin/turns/1/knowledge"]) assert.equal((await call(path, { headers: { Cookie: reviewerCookie } })).status, 403);
assert.equal((await call("/api/hello-admin/knowledge/1/test", { method: "POST", headers: { Cookie: reviewerCookie, Origin: base } })).status, 403);
assert.equal((await call("/api/greetings", { headers: { Cookie: reviewerCookie } })).status, 403);
assert.equal((await call("/api/operations/settings", { method: "POST", headers: { Cookie: adminCookie, Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}" })).status, 403);
const statusResponse = await call("/api/operations/status", { headers: { Cookie: adminCookie } });
const status = await statusResponse.json(); assert.equal(status.imageReviewConfigured, false); assert.equal(status.configuration.configured, false);
const report = await call("/api/hello/safety", { method: "POST", headers: { Cookie: `hello_identity=${fixture.ownerCookie}`, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ category: "other", description: "本地 HTTP 验收合成举报：验证本人记录、处理状态和越权保护。" }) });
assert.equal(report.status, 200); const receipt = (await report.json()).receipt;
const mine = await call(`/api/hello/safety/${receipt}`, { headers: { Cookie: `hello_identity=${fixture.ownerCookie}` } });
assert.equal(mine.status, 200); assert.equal((await mine.json()).cases[0].status, "pending");
const stranger = await call("/api/hello/identity", { method: "POST", headers: { Origin: base } });
const strangerCookie = stranger.headers.get("set-cookie")!.split(";")[0];
assert.equal((await call(`/api/hello/safety/${receipt}`, { headers: { Cookie: strangerCookie } })).status, 404);
const cases = await (await call("/api/operations/cases", { headers: { Cookie: adminCookie } })).json();
const row = cases.find((r: { receipt: string }) => r.receipt === receipt);
const nativeDetail = await call(`/admin/collections/safety-cases/${row.id}`, { headers: { Cookie: reviewerCookie } });
assert.equal(nativeDetail.status, 200);
const detailHTML = await nativeDetail.text();
assert.ok(detailHTML.includes("案件处理") && detailHTML.includes("查看证据并留痕"));
assert.ok(!detailHTML.includes("本地 HTTP 验收合成举报"), "原生详情页不得预取证据正文");
const nativeRules = await call("/admin/collections/safety-rules", { headers: { Cookie: adminCookie } });
assert.equal(nativeRules.status, 200); assert.ok((await nativeRules.text()).includes("新增规则版本"));
const filters = caseQueueFilters(2);
for (const key of ["pending", "mine", "overdue"] as const) {
  const response = await call(collectionURL("safety-cases", filters[key]).replace("/admin/collections/", "/api/"), { headers: { Cookie: reviewerCookie } });
  assert.equal(response.status, 200, `原生 ${key} 筛选可被 Payload 解析`);
  const { docs } = await response.json();
  if (key === "pending") { assert.ok(docs.some((doc: { id: number }) => doc.id === row.id)); assert.ok(docs.every((doc: { status: string }) => doc.status === "pending")); }
  if (key === "mine") assert.ok(docs.every((doc: { assignedTo: number }) => doc.assignedTo === 2));
}
assert.equal((await call(`/api/safety-cases/${row.id}`, { method: "PATCH", headers: { Cookie: adminCookie, Origin: base, "Content-Type": "application/json" }, body: '{"status":"resolved"}' })).status, 403);
const audit = await call("/api/operations/audit", { headers: { Cookie: adminCookie } }); assert.equal(audit.status, 200);
const exported = await call("/api/operations/export", { headers: { Cookie: adminCookie } }); assert.equal(exported.status, 200); assert.ok(exported.headers.get("content-disposition")?.includes("attachment"));
console.log("✓ 本地 HTTP：原生登录与资源操作区、证据不预取、原生队列筛选、旧页面 404、角色隔离、CSRF、私有证据/聊天拒绝、本人举报与越权保护、禁止直改案件、审计与报告导出通过");
