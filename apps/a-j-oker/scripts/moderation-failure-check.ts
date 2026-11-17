import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql, type MigrateDownArgs, type MigrateUpArgs } from "@payloadcms/db-sqlite";
import {
  ContentPendingReviewError,
  ContentReviewError,
  ServiceProblemError,
} from "../src/domain/contracts";

const dir = await mkdtemp(path.join(tmpdir(), "hello-moderation-failure-"));
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${dir}/test.db`,
  PAYLOAD_SECRET: "moderation-failure-isolated-test-only",
  HELLO_DEPLOYED: "true",
  HELLO_MEDIA_STORAGE: "database",
  NODE_ENV: "test",
});

const { cms } = await import("../src/cms/client");
const { migrations } = await import("../src/cms/migrations");
const { Repository } = await import("../src/cms/repository");
const { operationalModerator } = await import("../src/operations/moderation");
const payload = await cms();

type FailureMode =
  | "invalid-key"
  | "quota"
  | 500
  | 503
  | "network"
  | "timeout"
  | "bad-json"
  | "schema"
  | "allow"
  | "block"
  | "uncertain";
let mode: FailureMode = 500;
let providerCalls = 0;
const originalFetch = globalThis.fetch;
const originalInfo = console.info;
const logs: string[] = [];
console.info = (...values: unknown[]) => {
  logs.push(values.map((value) => String(value)).join(" "));
};

globalThis.fetch = async (url, options) => {
  assert.equal(
    String(url),
    "https://api.deepseek.com/chat/completions",
    "only an intercepted official request is permitted",
  );
  assert.equal(
    new Headers(options?.headers).get("authorization"),
    "Bearer synthetic-review-key",
  );
  providerCalls++;
  if (mode === "network")
    throw new Error("synthetic-review-key provider private body");
  if (mode === "timeout")
    throw new DOMException("synthetic private timeout", "TimeoutError");
  if (mode === "bad-json") return new Response("not JSON");
  if (mode === "schema")
    return Response.json({ model: "synthetic-review", choices: [] });
  if (mode === 500 || mode === 503)
    return new Response("synthetic provider private body", { status: mode });
  return Response.json({
    model: "synthetic-review",
    choices: [{
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          decision: mode === "allow" ? "allow" : mode,
          category: "fraud",
        }),
      },
    }],
  });
};

const counts = () => Promise.all(
  (["safety-cases", "safety-evidence", "safety-audit"] as const).map(
    async (collection) =>
      (await payload.count({ collection, overrideAccess: true })).totalDocs,
  ),
);
const clear = async () => {
  await payload.db.drizzle.run(sql`DELETE FROM safety_evidence`);
  await payload.db.drizzle.run(sql`DELETE FROM safety_audit`);
  await payload.db.drizzle.run(sql`DELETE FROM safety_cases`);
};

type ModerationRequest = Parameters<
  ReturnType<typeof operationalModerator>
>[0];
const invoke = (
  owner: string,
  request: Partial<ModerationRequest> = {},
) => operationalModerator(new Repository(payload, { id: owner, auth: "cookie" }))({
  stage: "input",
  mode: "byok",
  texts: ["我遭遇诈骗，想寻求帮助"],
  requestId: randomUUID(),
  apiKey: "synthetic-review-key",
  ...request,
});

async function technicalFailure(
  nextMode: FailureMode,
  expected: {
    phase: string;
    reason: string;
    responseStage?: string;
    timeout?: boolean;
    retryable?: boolean;
  },
) {
  await clear();
  mode = nextMode;
  const beforeCalls = providerCalls;
  const request: Partial<ModerationRequest> =
    nextMode === "quota"
      ? { mode: "platform", apiKey: "synthetic-review-key" }
      : nextMode === "invalid-key"
        ? { apiKey: "synthetic\nkey" }
        : {};
  if (nextMode === "quota") process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = "0";
  try {
    await assert.rejects(invoke(randomUUID(), request), (error: unknown) => {
      assert.ok(error instanceof ServiceProblemError);
      assert.equal(error.status, 503);
      assert.equal(error.code, "SERVICE_PROBLEM");
      assert.equal(error.retryable, expected.retryable ?? true);
      assert.equal(error.definitive, true);
      assert.match(error.message, /本次尚未开始生成/);
      assert.ok(!(error instanceof ContentReviewError));
      assert.doesNotMatch(error.message, /synthetic-review-key|private body/);
      return true;
    });
  } finally {
    if (nextMode === "quota")
      process.env.HELLO_PLATFORM_DAILY_CALL_LIMIT = "100";
  }
  assert.equal(
    providerCalls,
    nextMode === "invalid-key" || nextMode === "quota"
      ? beforeCalls
      : beforeCalls + 1,
  );
  assert.deepEqual(
    await counts(),
    [0, 0, 1],
    "technical failures must not create cases or evidence",
  );
  const audits = await payload.find({
    collection: "safety-audit",
    overrideAccess: true,
    limit: 1,
    sort: "-id",
  });
  const audit = audits.docs[0] as unknown as {
    event?: string;
    metadata?: Record<string, unknown>;
  };
  assert.equal(audit.event, "moderation.service_failed");
  assert.equal(audit.metadata?.phase, expected.phase);
  assert.equal(audit.metadata?.reason, expected.reason);
  if (expected.responseStage !== undefined)
    assert.equal(audit.metadata?.responseStage, expected.responseStage);
  if (expected.timeout !== undefined)
    assert.equal(audit.metadata?.timeout, expected.timeout);
  const safeRecord = JSON.stringify({ logs, audits: audits.docs });
  assert.doesNotMatch(
    safeRecord,
    /synthetic-review-key|private body|我遭遇诈骗/,
  );
}

let succeeded = false;
try {
  await payload.db.migrate({
    migrations: migrations.map((migration) => ({
      name: migration.name,
      up: (args: unknown) => migration.up(args as MigrateUpArgs),
      down: (args: unknown) => migration.down(args as MigrateDownArgs),
    })),
  });
  Object.assign(process.env, { HELLO_PLATFORM_DAILY_CALL_LIMIT: "100" });

  await technicalFailure("invalid-key", {
    phase: "configuration",
    reason: "api_key_invalid",
    retryable: false,
  });
  await technicalFailure("quota", {
    phase: "quota",
    reason: "quota_exhausted",
  });
  await technicalFailure(500, { phase: "http", reason: "http_status" });
  await technicalFailure(503, { phase: "http", reason: "http_status" });
  await technicalFailure("network", {
    phase: "network",
    reason: "network",
  });
  await technicalFailure("timeout", {
    phase: "timeout",
    reason: "timeout",
    timeout: true,
  });
  await technicalFailure("bad-json", {
    phase: "response",
    reason: "response_json",
    responseStage: "response_json",
  });
  await technicalFailure("schema", {
    phase: "response",
    reason: "response_schema",
    responseStage: "response_schema",
  });
  assert.ok(
    logs.some((line) => line.includes('"event":"hello_moderation_service_failure"')),
    "every technical failure also emits a structured local server event",
  );
  console.log("✓ technical moderation failures fail closed with safe logs/audits and no content cases or evidence");

  await clear();
  mode = "block";
  await assert.rejects(invoke(randomUUID()), (error: unknown) => {
    assert.ok(error instanceof ContentReviewError);
    assert.ok(!(error instanceof ServiceProblemError));
    assert.equal(error.status, 422);
    return true;
  });
  assert.deepEqual(await counts(), [1, 1, 2]);

  await clear();
  mode = "uncertain";
  await assert.rejects(invoke(randomUUID()), (error: unknown) => {
    assert.ok(error instanceof ContentPendingReviewError);
    assert.ok(!(error instanceof ServiceProblemError));
    assert.equal(error.status, 409);
    assert.match(error.message, /人工复核/);
    return true;
  });
  assert.deepEqual(await counts(), [1, 1, 2]);
  console.log("✓ definitive block and uncertain verdicts retain content-review case/evidence behavior");

  await clear();
  mode = 500;
  await assert.rejects(
    invoke(randomUUID(), {
      stage: "output",
      sessionId: 7,
      turnId: 19,
    }),
    (error: unknown) => {
      assert.ok(error instanceof ServiceProblemError);
      assert.equal(error.definitive, false);
      assert.match(error.message, /请先确认本轮状态/);
      return true;
    },
  );
  assert.deepEqual(await counts(), [0, 0, 1]);
  console.log("✓ output moderation service failures stay uncertain and never masquerade as content blocks");

  succeeded = true;
} finally {
  globalThis.fetch = originalFetch;
  console.info = originalInfo;
  await payload.destroy();
  if (succeeded) await rm(dir, { recursive: true, force: true });
  else console.log(`Synthetic failure database/logs retained: ${dir}`);
}
