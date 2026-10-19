import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { artifactsSchema, CATALOG_ID, createRunReader, surfaceName, validateA2uiMessages, toA2ui, type ClientEvent } from "@cfp/hello-agent-protocol";

// Explicit remote test: creates a named test conversation and makes two paid model calls.
const origin = process.env.HELLO_ORIGIN;
if (origin !== "https://aj-preview.codeforpeople.cn") throw new Error("请显式指定阿J测试环境 HELLO_ORIGIN");
const response = await fetch(`${origin}/api/hello/identity`, { method: "POST", headers: { Origin: origin } });
assert.equal(response.status, 200);
assert.match(response.headers.get("set-cookie") || "", /Secure/);
const cookie = response.headers.get("set-cookie")!.split(";")[0];
const headers = { Origin: origin, Cookie: cookie, "Content-Type": "application/json" };
async function json(route: string, data?: unknown) {
  const res = await fetch(`${origin}${route}`, { headers, ...(data === undefined ? {} : { method: "POST", body: JSON.stringify(data) }), signal: AbortSignal.timeout(90_000) });
  assert.equal(res.status, 200, `${route}: ${res.status}`);
  return res.json();
}
const ready = await json("/api/ready");
assert.equal(ready.release, process.env.HELLO_RELEASE);
const config = await json("/api/hello/config");
assert.equal(config.protocols.catalogId, CATALOG_ID);
assert.equal(config.advertisement.mode, "disabled");
const session = await json("/api/hello/sessions", { title: "回应作品发布验收（合成测试数据）" });
const timings: { firstEventMs: number; durationMs: number }[] = [];
async function run(text: string, clientEvent?: ClientEvent) {
  const runId = randomUUID();
  const start = Date.now();
  let firstEventMs = 0;
  const result = await fetch(`${origin}/api/hello/ag-ui`, {
    method: "POST", headers: { ...headers, Accept: "text/event-stream" }, signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ protocolVersion: "1.0", threadId: String(session.id), runId, tools: [], context: [], messages: [{ id: `user_${runId}`, role: "user", content: text }], forwardedProps: { mode: "platform", clientEvent, a2uiClientCapabilities: { supportedCatalogIds: [CATALOG_ID] } } }),
  });
  assert.equal(result.status, 200);
  assert.match(result.headers.get("content-type") || "", /text\/event-stream/);
  const stream = result.body!.getReader();
  const decoder = new TextDecoder();
  const reader = createRunReader(runId);
  for (;;) {
    const chunk = await stream.read();
    if (chunk.done) break;
    if (!firstEventMs) firstEventMs = Date.now() - start;
    reader.push(decoder.decode(chunk.value, { stream: true }));
  }
  reader.push(decoder.decode());
  const progress = reader.finish();
  assert.ok(progress.text.length > 1);
  timings.push({ firstEventMs, durationMs: Date.now() - start });
}
await run("发布验收的合成情境：我开会说错了一个数字，后来已更正，但还在自责。请同时给我五件简短作品：一张行动卡、一张事实和想法的对照表、一幅暖太阳照绿芽的几何插画、一页休息指南、一份可填写的 CBT 表单。表单只需情境、想法、情绪和0到100的强度，所有字段选填，不替我填答案。");
const initial = await json(`/api/hello/sessions/${session.id}`);
assert.equal(initial.length, 1);
const turn = initial[0];
assert.equal(turn.status, "completed");
assert.equal(turn.promptVersion, "aj-v3.2");
const artifacts = artifactsSchema.parse(turn.artifacts);
assert.deepEqual(new Set(artifacts.map((item) => item.kind)), new Set(["card", "table", "image", "page", "form"]));
for (const artifact of artifacts.filter((item) => item.kind === "image" || item.kind === "page")) {
  const url: string = `${origin}/api/hello/artifact-${artifact.kind}/${turn.id}/${artifact.id}`;
  const res: Response = await fetch(url, { headers });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", artifact.kind === "image" ? /image\/png/ : /text\/html/);
  if (artifact.kind === "image") assert.ok((await res.arrayBuffer()).byteLength > 100);
  else { assert.match(res.headers.get("content-security-policy") || "", /default-src 'none'/); assert.ok((await res.text()).includes(artifact.title)); }
  assert.equal((await fetch(url)).status, 401);
}
const form = artifacts.find((item) => item.kind === "form")!;
validateA2uiMessages(toA2ui(turn.id, artifacts));
const values = Object.fromEntries(form.fields.map((field) => [field.id, field.type === "number" ? 0 : /想法|thought/.test(field.id + field.label) ? "担心一次失误等于什么都做不好" : /情绪|emotion/.test(field.id + field.label) ? "当时羞愧，现在平静一些" : "周会上说错一个数字，同事提醒后我已更正"]));
await run("", { version: "v0.9.1", action: { name: "submit_form", surfaceId: surfaceName(turn.id, form.id), sourceComponentId: "submit", timestamp: new Date().toISOString(), context: { values } } });
const history = await json(`/api/hello/sessions/${session.id}`);
assert.equal(history.length, 2);
assert.equal(history[1].status, "completed");
assert.deepEqual(history[1].input.formResponse.values, values);
assert.equal(history[1].promptVersion, "aj-v3.2");
const stranger = await fetch(`${origin}/api/hello/sessions/${session.id}`);
assert.equal(stranger.status, 401);
const output = new URL("../.data/ecs-preview/artifacts-20261010/", import.meta.url);
await mkdir(output, { recursive: true, mode: 0o700 });
await writeFile(new URL("identity.json", output), JSON.stringify({ cookie, sessionId: session.id }), { mode: 0o600 });
const report = { release: ready.release, promptVersion: turn.promptVersion, sessionId: session.id, turnIds: history.map((item: { id: number }) => item.id), kinds: artifacts.map((item) => item.kind), timings, followup: history[1].greeting };
await writeFile(new URL("report.json", output), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("✓ HTTPS + AG-UI/A2UI 五类作品、私有图片/网页、零分表单续接与身份隔离通过。");
