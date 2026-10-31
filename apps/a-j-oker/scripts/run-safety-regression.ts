import "./load-local-env";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, appendFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";
import type { ImageProvider } from "../src/images/wan";
import type { ImageReviewer } from "../src/operations/image-review";
import { openBudget, reserveForRequest } from "./safety/budget";
import { fingerprint, type SafetyCase } from "./safety/bank";

const [samplePath, priorBudget, outputDir, consent, imageEnvArg, mode, resumeDb, resumeId] = process.argv.slice(2);
const imageEnv = imageEnvArg === "-" ? undefined : imageEnvArg;
if (mode && !["--full-bank", "--finish-bank", "--resume-stored"].includes(mode)) throw new Error("Unsupported evaluation mode");
const stopCny = ["--finish-bank", "--resume-stored"].includes(mode) ? 49.5 : 45;
if (mode === "--resume-stored" && (!resumeDb || !/^\d+$/.test(resumeId))) throw new Error("Missing stored recovery fixture");
if (mode !== "--resume-stored" && (resumeDb || resumeId)) throw new Error("Unexpected recovery arguments");
const imageLimit = mode === "--full-bank" ? 200 : 6;
const reviewLimit = mode === "--full-bank" ? 400 : 20;
if (!samplePath || !priorBudget || !outputDir || consent !== "--live-within-50-cny") throw new Error("Usage: run-safety-regression sample.jsonl prior-budget.json NEW-output-directory --live-within-50-cny");
if (!process.env.DEEPSEEK_API_KEY) throw new Error("DeepSeek configuration missing; no live evaluation performed");
const items: SafetyCase[] = (await readFile(samplePath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
if (mode === "--resume-stored" && (items.length !== 1 || items[0].turns.length !== 1)) throw new Error("Recovery requires exactly one original case");
if (!items.length || items.length > 500 || items.some(item => (item.modality !== "text" && !(imageEnv && item.modality === "image")) || item.split !== "development" || !item.turns.length || item.turns.some(t => typeof t !== "string" || t.length > 4000))) throw new Error("Invalid development sample");
// Wan may throttle eight concurrent submissions; keep image batches and mixed
// retries at two workers while preserving the real application behavior.
const concurrency = mode === "--full-bank" ? (items.some(item => item.modality === "image") ? 2 : 8) : 1;
if (imageEnv) {
  const config = parseEnv(await readFile(imageEnv, "utf8"));
  for (const key of ["DASHSCOPE_API_KEY", "HELLO_IMAGE_WORKSPACE_ID", "HELLO_GREEN_ACCESS_KEY_ID", "HELLO_GREEN_ACCESS_KEY_SECRET"]) {
    if (!config[key]?.trim()) throw new Error("Image configuration incomplete");
    process.env[key] = config[key];
  }
  process.env.HELLO_IMAGE_REVIEW_MODE = "aliyun-green";
}
await mkdir(outputDir); // Never overwrite prior evidence or silently resume a partial case.
const budget = openBudget(priorBudget, stopCny);
const startReserve = budget.total;
process.env.HELLO_DATABASE_URI = `file:${path.resolve(outputDir, "isolated.db")}`;
process.env.PAYLOAD_SECRET = randomUUID() + randomUUID();
process.env.HELLO_DEPLOYED = "false";
process.env.HELLO_MODEL = "deepseek-flash";
process.env.HELLO_PRIVACY_DELETION_LEDGER = path.resolve(outputDir, "deletions.jsonl");
process.env.HELLO_MEDIA_STORAGE = "database"; // All approved test pixels stay local.
if (!imageEnv) {
  process.env.DASHSCOPE_API_KEY = "";
  process.env.HELLO_GREEN_ACCESS_KEY_ID = "";
  process.env.HELLO_GREEN_ACCESS_KEY_SECRET = "";
}
process.env.HELLO_IMAGE_REVIEW_TOKEN = "";
process.env.HELLO_FEISHU_WEBHOOK = "";
const nativeFetch = globalThis.fetch;
const scope = new AsyncLocalStorage<{ id: string; guardFailure: string }>();
const currentCase = () => {
  const value = scope.getStore();
  if (!value) throw new Error("Paid request outside an evaluation case");
  return value;
};
let stopped = false, calls = 0;
let imageSubmissions = 0, imageReviews = 0;
let interrupted = false;
const stopAfterTurn = () => { interrupted = true; };
process.on("SIGTERM", stopAfterTurn); process.on("SIGINT", stopAfterTurn);
const usage = { prompt: 0, completion: 0, hit: 0, miss: 0, requestsWithUsage: 0 };
const states: Record<string, number> = {};
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  if (url !== "https://api.deepseek.com/chat/completions") {
    // Background SDK telemetry must not overwrite the classification of an unrelated application response.
    await appendFile(path.join(outputDir, "拒绝联网.jsonl"), JSON.stringify({ at: new Date().toISOString(), host: new URL(url).hostname }) + "\n");
    throw new Error("network_outside_text_scope");
  }
  const body = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
  let reservation: string;
  const active = currentCase();
  try { reservation = budget.reserve(reserveForRequest(body), active.id); }
  catch { stopped = true; active.guardFailure = "budget_or_request_guard"; throw new Error(active.guardFailure); }
  calls++;
  const at = new Date().toISOString();
  try {
    const response = await nativeFetch(input, init);
    const data = response.ok ? await response.clone().json().catch(() => ({})) : {};
    const u = data.usage;
    // Synthetic evaluation only: retain structure/finish codes, never headers,
    // credentials, signed image URLs, or unconstrained model content.
    const request = JSON.parse(body);
    const choice = data.choices?.[0];
    let verdict: unknown = undefined;
    if (request.max_tokens <= 256 && typeof choice?.message?.content === "string") {
      try {
        const parsed = JSON.parse(choice.message.content);
        verdict = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k.slice(0, 40), typeof v === "string" && /^[a-z_]{1,40}$/.test(v) ? v : typeof v]));
      } catch { verdict = { format: "not_json", length: choice.message.content.length }; }
    }
    await appendFile(path.join(outputDir, "响应诊断.jsonl"), JSON.stringify({ at, caseId: active.id, status: response.status, maxTokens: request.max_tokens, finishReason: choice?.finish_reason, verdict, tools: choice?.message?.tool_calls?.map((c: { function?: { name?: string } }) => c.function?.name) }) + "\n");
    let measured = null;
    if (u && [u.prompt_tokens, u.completion_tokens].every(x => Number.isFinite(x) && x >= 0)) {
      const hit = Number.isFinite(u.prompt_cache_hit_tokens) ? Math.min(u.prompt_tokens, Math.max(0, u.prompt_cache_hit_tokens)) : 0;
      measured = { prompt: u.prompt_tokens, completion: u.completion_tokens, hit, miss: u.prompt_tokens - hit };
      for (const k of ["prompt", "completion", "hit", "miss"] as const) usage[k] += measured[k];
      usage.requestsWithUsage++;
    }
    const evidence = JSON.stringify({ at, caseId: active.id, reservation, status: response.status, model: typeof data.model === "string" ? data.model : null, usage: measured });
    await appendFile(path.join(outputDir, "调用用量.jsonl"), evidence + "\n");
    if (measured && response.status === 200 && data.model === "deepseek-flash") budget.settle({ id: reservation, caseId: active.id, status: 200, model: data.model, usage: measured, evidenceSha256: fingerprint(evidence) });
    return response;
  } catch {
    await appendFile(path.join(outputDir, "调用用量.jsonl"), JSON.stringify({ at, caseId: active.id, reservation, error: "transport_or_evidence_error", usage: null }) + "\n");
    throw new Error("Budgeted provider request did not complete");
  }
};
const payloads: Awaited<ReturnType<typeof import("../src/cms/client").cms>>[] = [];
let completedCases = 0;
try {
  const { BasePayload } = await import("payload");
  const { cms } = await import("../src/cms/client");
  const { sqliteAdapter } = await import("@payloadcms/db-sqlite");
  const baseConfig = await (await import("../payload.config")).default;
  const { seedAgents } = await import("../src/cms/seed");
  const { Repository } = await import("../src/cms/repository");
  const { GreetingService } = await import("../src/domain/greetings");
  const { AppError, ContentPendingReviewError } = await import("../src/domain/contracts");
  const { seedSyntheticAge } = await import("./synthetic-age");
  const { PrivacyService } = await import("../src/privacy/service");
  const { privacyPolicy } = await import("../src/privacy/policy");
  const { PROMPT_VERSION } = await import("../src/agent/instruction");
  const { INTERACTION_VERSION } = await import("../src/interaction/policy");
  const { defaultRule } = await import("../src/operations/policy");
  let imageProvider: (() => ImageProvider) | undefined, imageReviewer: ImageReviewer | undefined;
  if (imageEnv) {
    const { wanProvider } = await import("../src/images/wan");
    const { configuredGreenReviewer } = await import("../src/images/aliyun-image-review");
    const workspace = process.env.HELLO_IMAGE_WORKSPACE_ID!;
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(workspace)) throw new Error("Invalid workspace");
    const provider = wanProvider(`https://${workspace}.cn-beijing.maas.aliyuncs.com`, process.env.DASHSCOPE_API_KEY!, async (input, init) => {
      const response = await nativeFetch(input, init);
      const pathname = new URL(String(input)).pathname;
      if (pathname.startsWith("/api/v1/")) {
        const data = await response.clone().json().catch(() => ({}));
        const safeCode = (value: unknown) => typeof value === "string" && /^[A-Za-z_.]{1,80}$/.test(value) ? value : undefined;
        await appendFile(path.join(outputDir, "万相响应诊断.jsonl"), JSON.stringify({ at: new Date().toISOString(), caseId: currentCase().id, operation: init?.method, status: response.status, taskStatus: safeCode(data.output?.task_status), code: safeCode(data.code || data.output?.code) }) + "\n");
      }
      return response;
    });
    imageProvider = () => ({
      async submit(input, signal) {
        if (mode === "--resume-stored") throw new Error("Stored recovery must never submit a new image");
        const active = currentCase();
        if (imageSubmissions >= imageLimit) throw new Error("Evaluation image limit reached");
        let reservation: string;
        try { reservation = budget.reserve(0.25, `${active.id}:wan`); }
        catch { stopped = true; active.guardFailure = "budget_or_request_guard"; throw new Error(active.guardFailure); }
        imageSubmissions++;
        const taskId = await provider.submit(input, signal);
        await appendFile(path.join(outputDir, "图片调用.jsonl"), JSON.stringify({ at: new Date().toISOString(), caseId: active.id, reservation, service: "wan2.6-t2i", taskId, reservedCny: 0.25 }) + "\n");
        return taskId;
      }, result: (id, signal) => provider.result(id, signal),
    });
    imageReviewer = async bytes => {
      const active = currentCase();
      if (imageReviews >= reviewLimit) throw new Error("Evaluation review limit reached");
      let reservation: string;
      try { reservation = budget.reserve(0.01, `${active.id}:green`); }
      catch { stopped = true; active.guardFailure = "budget_or_request_guard"; throw new Error(active.guardFailure); }
      imageReviews++;
      const verdict = await configuredGreenReviewer(bytes);
      await appendFile(path.join(outputDir, "图片调用.jsonl"), JSON.stringify({ at: new Date().toISOString(), caseId: active.id, reservation, service: "green-baselineCheck", sha256: createHash("sha256").update(bytes).digest("hex"), verdict, reservedCny: 0.01 }) + "\n");
      return verdict;
    };
  }
  // Build and close one schema-complete fixture before copying it. Each worker
  // has a separate SQLite file and its own Payload instance; no shared writer.
  const template = await cms();
  try { await seedAgents(template); } finally { await template.destroy(); }
  for (let worker = 0; worker < concurrency; worker++) {
    const workerPath = path.resolve(outputDir, `worker-${worker}.db`);
    await copyFile(mode === "--resume-stored" ? resumeDb : path.resolve(outputDir, "isolated.db"), workerPath);
    const activePayload = await new BasePayload().init({ config: { ...baseConfig,
      db: { ...sqliteAdapter({ client: { url: `file:${workerPath}` }, transactionOptions: {}, push: false }), allowIDOnCreate: false, name: "sqlite" },
    } });
    payloads.push(activePayload);
  }
  await writeFile(path.join(outputDir, "metadata.json"), JSON.stringify({ startedAt: new Date().toISOString(), sampleHash: fingerprint(JSON.stringify(items)), promptVersion: PROMPT_VERSION, interactionVersion: INTERACTION_VERSION, rule: defaultRule, model: "deepseek-flash", officialMapping: "DeepSeek-V4.1-Flash-1017", initialReservationCny: startReserve, capCny: 50, stopCny, cases: items.length, concurrency, imageLimit, reviewLimit, imageScope: imageEnv ? "Real Wan generation and Green pixel review; approved pixels stored in local isolated DB; cumulative budget enforced before every paid call" : "text-only", scope: "Real GreetingService + fresh seeded prompts + real text moderation/generation, synthetic local DB/adult identities/consent. No real identity verification, external notifications, deployment or formal human safety verdict. No holdout used." }, null, 2));
  const runCase = async (item: SafetyCase, activePayload: (typeof payloads)[number], worker: number) => {
    const stored = mode === "--resume-stored" ? await activePayload.findByID({ collection: "greetings", id: Number(resumeId), overrideAccess: true }) : undefined;
    if (stored && (!stored.owner.startsWith("regression:") || stored.input.text !== item.turns[0] || stored.imageGeneration?.status !== "stored" || !stored.imageGeneration.mediaId || stored.status === "completed")) throw new Error("Not the expected unfinished synthetic stored image");
    const owner = { id: stored?.owner || `regression:${randomUUID()}`, auth: "cookie" as const, wechatKey: "" };
    if (!stored) await seedSyntheticAge(activePayload, owner);
    const repo = new Repository(activePayload, owner);
    if (!stored) await new PrivacyService(repo).consent({ version: privacyPolicy().version, core: true, model: true, sensitive: true, external: false });
    const service = new GreetingService(repo, undefined, undefined, undefined, { imageProvider, imageReviewer }), session = stored ? { id: Number(stored.sessionId) } : await service.createSession("合成安全评测");
    for (const [turn, input] of item.turns.entries()) {
      if (stopped || interrupted) break;
      const active = currentCase(); active.id = `${item.id}:${turn + 1}`; active.guardFailure = "";
      const startedAt = new Date().toISOString();
      await appendFile(path.join(outputDir, "进度.jsonl"), JSON.stringify({ id: active.id, startedAt, event: "started" }) + "\n");
      let result: Record<string, unknown>;
      try {
        const row = stored ? await service.resumeImage(stored.id) : await service.generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input: { text: input, mediaIds: [] } });
        result = { state: "completed", output: { greeting: row.greeting, association: row.association, artifacts: row.artifacts }, model: row.model, promptVersion: row.promptVersion };
        if (imageEnv) {
          const files: string[] = [];
          for (const media of await repo.all("media")) {
            const { bytes } = await service.media.read(media.id);
            const filename = `${item.id}-${turn + 1}-${media.id}.jpg`;
            await writeFile(path.join(outputDir, filename), bytes, { mode: 0o600 }); files.push(filename);
          }
          result.imageFiles = files;
        }
      } catch (error) {
        result = { state: active.guardFailure === "budget_or_request_guard" ? "budget_stopped" : active.guardFailure ? "out_of_scope" : error instanceof ContentPendingReviewError ? "review_pending" : error instanceof AppError && error.status === 422 ? "blocked" : error instanceof AppError && error.status === 403 ? "restricted" : "failed", error: error instanceof AppError ? error.message : "应用未完成，具体内部错误不写入评测材料", guardFailure: active.guardFailure || undefined };
      }
      const state = String(result.state); states[state] = (states[state] ?? 0) + 1;
      await appendFile(path.join(outputDir, "results.jsonl"), JSON.stringify({ id: active.id, worker, family: item.family, scene: item.sourceCategory, input, expected: item.expected, source: item.source, provenance: item.provenance, turn: turn + 1, startedAt, endedAt: new Date().toISOString(), ...result, humanJudgment: "pending" }) + "\n");
    }
    if (!stopped && !interrupted) completedCases++;
    console.log(JSON.stringify({ cases: completedCases, total: items.length, states, calls, reservedCny: Number(budget.total.toFixed(6)) }));
  };
  let next = 0;
  const workers = await Promise.allSettled(payloads.map(async (workerPayload, worker) => {
    while (!stopped && !interrupted && next < items.length) {
      const item = items[next++];
      try { await scope.run({ id: `${item.id}:setup`, guardFailure: "" }, () => runCase(item, workerPayload, worker)); }
      catch (error) { stopped = true; throw error; }
    }
  }));
  const failure = workers.find(r => r.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
} finally {
  globalThis.fetch = nativeFetch;
  const peakEstimate = (usage.hit * 0.04 + usage.miss * 2 + usage.completion * 8) / 1e6;
  await writeFile(path.join(outputDir, "summary.json"), JSON.stringify({ at: new Date().toISOString(), completedCases, totalCases: items.length, states, calls, usage, imageSubmissions, imageReviews, imageReservedCny: imageSubmissions * 0.25 + imageReviews * 0.01, initialReservationCny: startReserve, cumulativeReservedUpperCny: budget.total, newMeasuredPeakEstimateCny: peakEstimate, missingUsageCalls: calls - usage.requestsWithUsage, stopped, interrupted, note: "公开高峰单价与接口usage估算，非账单。缺少usage的请求及图片服务保留完整预算预留。人工结论待评阅，不计算正式合格率。" }, null, 2));
  try { await Promise.allSettled(payloads.map(p => p.destroy())); } finally { budget.close(); }
  process.off("SIGTERM", stopAfterTurn); process.off("SIGINT", stopAfterTurn);
}
