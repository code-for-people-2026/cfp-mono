/**
 * Add one isolated synthetic age-evidence case to the explicitly selected local
 * preview database. The fixture is intentionally left in place for native
 * Payload admin UI review; it never creates an administrator or login token.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

if (process.argv.length !== 3 || process.argv[2] !== "--local-preview") {
  throw new Error("Refusing to run: pass the explicit --local-preview flag to load the local preview environment.");
}

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
if (!existsSync(envFile)) throw new Error("Local preview environment not found: apps/a-j-oker/.env.local");
loadEnvFile(envFile);

const database = process.env.HELLO_DATABASE_URI;
if (!database?.startsWith("file:") || database.includes("?")) {
  throw new Error("Refusing to run: --local-preview requires an explicit local file: SQLite HELLO_DATABASE_URI.");
}
if (process.env.HELLO_DEPLOYED === "true" || process.env.NODE_ENV === "production") {
  throw new Error("Refusing to run against a deployed or production environment.");
}
const origin = process.env.HELLO_ORIGIN;
if (origin && !["http://127.0.0.1:3310", "http://localhost:3310"].includes(origin.replace(/\/$/, ""))) {
  throw new Error("Refusing to run: HELLO_ORIGIN must be the local port 3310 preview.");
}

const [{ cms }, { Repository }, { AJokerService }, { seedSyntheticAge }] = await Promise.all([
  import("../src/cms/client"),
  import("../src/cms/repository"),
  import("../src/domain/a-j-oker"),
  import("./synthetic-age"),
]);

const payload = await cms();
const fixtureId = randomUUID();
const owner = { id: `synthetic:age-evidence-preview:${fixtureId}`, auth: "cookie" as const, wechatKey: "" };
const label = `[SYNTHETIC AGE EVIDENCE PREVIEW ${fixtureId}]`;
const ordinary = { minor: false, crisis: false, dependency: false, overuse: false, exit: false, forget_context: false, image_requested: false, single_choice_only: false, single_open_question_only: false };

try {
  const existing = await payload.count({ collection: "wechat-identities", overrideAccess: true, where: { owner: { equals: owner.id } } });
  assert.equal(existing.totalDocs, 0, "synthetic owner UUID unexpectedly already exists");
  await seedSyntheticAge(payload, owner);

  const repo = new Repository(payload, owner);
  let verdict = ordinary;
  const service = new AJokerService(repo, async () => {
    throw new Error("Synthetic minor preview must stop before the stub model runs");
  }, undefined, undefined, { moderate: async () => ({ serviceScope: "support" as const, interaction: verdict }) });
  const session = await service.createSession();
  await repo.update("sessions", session.id, { title: label });

  for (let index = 1; index <= 6; index++) {
    await payload.create({ collection: "a-j-oker", overrideAccess: true, data: {
      owner: owner.id,
      sessionId: session.id,
      requestKey: `${owner.id}:${randomUUID()}`,
      fingerprint: `synthetic-age-evidence-preview-${fixtureId}-${index}`,
      mode: "platform",
      status: "completed",
      input: { text: `${label} prior synthetic user message ${index}`, mediaIds: [] },
      aJoker: `${label} prior synthetic assistant response ${index}`,
    } });
  }

  verdict = { ...ordinary, minor: true };
  const requestId = randomUUID();
  await assert.rejects(
    service.generateAJoker({ sessionId: session.id, requestId, mode: "platform", input: { text: `${label} synthetic declaration: I am under eighteen`, mediaIds: [] } }),
    /年龄|复核|未成年/,
  );

  const ageCase = (await payload.find({ collection: "safety-cases", overrideAccess: true, limit: 1, sort: "-id", where: { and: [
    { owner: { equals: owner.id } }, { stage: { equals: "age_review" } }, { sessionId: { equals: session.id } },
  ] } })).docs[0];
  assert.ok(ageCase, "synthetic age review case was not created");
  process.stdout.write(`${JSON.stringify({ synthetic: true, label, ownerId: owner.id, sessionId: session.id, caseId: ageCase.id, receipt: ageCase.receipt })}\n`);
} finally {
  await payload.destroy();
}
