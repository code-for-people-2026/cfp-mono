import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConfig, getPayload, type Payload } from "payload";
import { sqliteAdapter, sql } from "@payloadcms/db-sqlite";
import { Store, collections, tables } from "../src/store";
import { migrations } from "../src/migrations";
import { recordCollections, recordTables, RecordsRepository } from "../src/records/persistence";
import { chatCollections } from "../src/chat/persistence";
import { buildRuntimeConfig } from "../src/runtime-config";
import { bootstrapOpsAdmin, operationsCollections, decorateCollections } from "../src/operations/collections";
import { serializeDatabaseTransactions } from "../src/database-queue";
import { MembershipRepository } from "../src/membership/persistence";

if (process.env.NODE_ENV !== "production") throw new Error("Run with NODE_ENV=production to verify real migrations, never schema push.");
const directory = await mkdtemp(join(tmpdir(), "bubu-production-schema-"));
const secret = "isolated-production-schema-verification-secret";
let store: Store | undefined;
async function openCurrent(directory: string) {
  const payload = await getPayload({ config: await buildRuntimeConfig({ directory, secret, origin: "http://127.0.0.1:3320" }), key: `production-ops-${randomUUID()}` });
  serializeDatabaseTransactions(payload);
  return new Store(payload);
}
async function snapshot(payload: Payload, slugs: readonly string[]) {
  const result: Record<string, unknown[]> = {};
  for (const collection of slugs) {
    const docs = await payload.find({ collection, overrideAccess: true, depth: 0, pagination: false, limit: 0 });
    result[collection] = docs.docs.map(doc => ({ id: doc.id, key: doc.key, babyId: doc.babyId, identityId: doc.identityId, value: doc.value, createdAt: doc.createdAt, updatedAt: doc.updatedAt }));
  }
  return result;
}
async function assertPreserved(payload: Payload, before: Record<string, unknown[]>) {
  const after = await snapshot(payload, Object.keys(before));
  for (const [collection, docs] of Object.entries(before)) for (const doc of docs) assert.deepEqual(after[collection]?.find(row => (row as { id: unknown }).id === (doc as { id: unknown }).id), doc, `${collection} original row must remain byte-for-byte equivalent JSON`);
}
async function verifyOps(payload: Payload, suffix: string) {
  const admin = await bootstrapOpsAdmin(payload, { email: `${suffix}@fixture.invalid`, password: "isolated-admin-password-012345", babyIds: ["schema-baby"] });
  const user = { id: admin.id, collection: "ops-users" };
  const login = await payload.login({ collection: "ops-users", data: { email: admin.email, password: "isolated-admin-password-012345" } });
  assert.equal(login.user?.id, admin.id); assert.equal(login.token, undefined);
  await assert.rejects(payload.delete({ collection: "ops-users", id: admin.id, user, overrideAccess: false }), /最后一位/);
  const db = payload.db as unknown as { drizzle: { run: (query: ReturnType<typeof sql>) => Promise<unknown> } };
  await assert.rejects(db.drizzle.run(sql`UPDATE ops_users SET active = 0 WHERE id = ${admin.id}`));
  await payload.create({ collection: "ops-requests", overrideAccess: true, data: { id: `ops-${suffix}`, key: `ops-${suffix}`, babyId: "schema-baby", value: { commandFingerprint: "fixture-only", receipt: { status: "done" } } } });
}
async function verifyMembership(store: Store, suffix: string) {
  const repository = new MembershipRepository(store);
  await store.transaction(async req => {
    const before = { version: 0, policy: { startsAt: null, endsAt: null, expiryPolicy: null, paused: false } };
    const after = { version: 1, policy: { ...before.policy, paused: true } };
    await repository.save("schema-baby", `membership-${suffix}`, { version: 1, before, after, action: "pause", at: "2026-10-23T12:00:00Z", actorId: "synthetic-operator", reason: "隔离生产迁移验证", fingerprint: `test-${suffix}` }, req);
    assert.deepEqual(await repository.state("schema-baby", req), after);
  });
}
const currentTables = [...tables, ...recordTables, "chat-turns", "ops-requests", "service-memberships", "service-membership-changes"];
try {
  store = await openCurrent(directory);
  await store.transaction(async () => { await store!.put("identities", "production-check", { restored: true }); });
  await assert.rejects(store.transaction(async () => {
    await store!.put("identities", "rollback-check", { mustNotPersist: true });
    throw new Error("injected rollback");
  }), /injected rollback/);
  await store.transaction(async req => { const records = new RecordsRepository(store!.payload); for (const table of recordTables) await records.put(table, "schema-baby", `${table}:persistence`, { persisted: true }, req); });
  await store.transaction(async req => { await store!.payload.create({ collection: "chat-turns", data: { id: "chat-schema-check", key: "chat-schema-check", identityId: "schema-person", babyId: "schema-baby", value: { status: "needs_recovery", requestId: "same-request-after-restart" } }, overrideAccess: true, req }); });
  await verifyOps(store.payload, "empty");
  await verifyMembership(store, "empty");
  const emptyBefore = await snapshot(store.payload, currentTables);
  await store.close(); store = undefined;
  store = await openCurrent(directory);
  await assertPreserved(store.payload, emptyBefore);
  assert.equal(await store.get("identities", "rollback-check"), undefined);
  assert.equal((await store.payload.find({ collection: "ops-users", overrideAccess: true })).docs[0]?.email, "empty@fixture.invalid");
  await store.close(); store = undefined;

  for (const previousVersion of [1, 2, 3, 4]) {
    const upgradeDirectory = join(directory, `upgrade-${previousVersion}`); await mkdir(upgradeDirectory);
    const previousCollections = [...collections, ...(previousVersion >= 2 ? recordCollections : []), ...(previousVersion >= 3 ? chatCollections : []), ...(previousVersion >= 4 ? operationsCollections : [])];
    const config = await buildConfig({ secret, ...(previousVersion >= 4 ? { admin: { user: "ops-users" } } : {}), collections: previousVersion >= 4 ? decorateCollections(previousCollections) : previousCollections, db: sqliteAdapter({ client: { url: `file:${upgradeDirectory}/identity.db` }, push: false, prodMigrations: migrations.slice(0, previousVersion), transactionOptions: {} }), typescript: { autoGenerate: false }, telemetry: false });
    store = new Store(await getPayload({ config, key: `old-schema-${randomUUID()}` }));
    await store.transaction(async () => { for (const table of tables) await store!.put(table, `${table}:before-upgrade`, { historical: true, nested: { unchanged: [null, 0, false, "旧来源"] }, sessionId: "fixture-session-digest-preserve", babyId: "schema-baby" }); });
    if (previousVersion >= 2) await store.transaction(async req => { const records = new RecordsRepository(store!.payload); for (const table of recordTables) await records.put(table, "schema-baby", `${table}:before-upgrade`, { historical: true, facts: { type: "BOTTLE", milkAmount: 0, notes: null }, state: "open", sessionId: "fixture-actor-digest-preserve" }, req); });
    if (previousVersion >= 3) await store.transaction(async req => { await store!.payload.create({ collection: "chat-turns", data: { id: "chat-before-upgrade", key: "chat-before-upgrade", identityId: "schema-person", babyId: "schema-baby", value: { status: "needs_recovery", requestId: "same-chat-request", transcript: [{ role: "user", content: "合成私人对话" }] } }, overrideAccess: true, req }); });
    if (previousVersion >= 4) await verifyOps(store.payload, `upgrade-${previousVersion}`);
    const before = await snapshot(store.payload, previousCollections.map(collection => collection.slug));
    await store.close(); store = undefined;
    store = await openCurrent(upgradeDirectory);
    await assertPreserved(store.payload, before);
    if (previousVersion < 4) await verifyOps(store.payload, `upgrade-${previousVersion}`);
    await verifyMembership(store, `upgrade-${previousVersion}`);
    await store.transaction(async req => { const records = new RecordsRepository(store!.payload); for (const table of recordTables) await records.put(table, "schema-baby", `${table}:after-upgrade`, { persisted: true }, req); });
    await store.transaction(async req => { await store!.payload.create({ collection: "chat-turns", data: { id: "chat-after-upgrade", key: "chat-after-upgrade", identityId: "schema-person", babyId: "schema-baby", value: { persisted: true } }, overrideAccess: true, req }); });
    const upgraded = await snapshot(store.payload, currentTables);
    await store.close(); store = undefined;
    store = await openCurrent(upgradeDirectory);
    await assertPreserved(store.payload, before);
    await assertPreserved(store.payload, upgraded);
    assert.equal((await store.payload.find({ collection: "ops-users", overrideAccess: true })).docs[0]?.email, `upgrade-${previousVersion}@fixture.invalid`);
    await store.close(); store = undefined;
  }
  console.log("Production migrations verified: empty initialization and identity / records / chat / ops upgrades to membership; original JSON, private session fields and timestamps preserved; rollback, admin constraints, membership state and close/reopen passed in isolated SQLite fixtures.");
} finally {
  await store?.close();
  await rm(directory, { recursive: true, force: true });
}
