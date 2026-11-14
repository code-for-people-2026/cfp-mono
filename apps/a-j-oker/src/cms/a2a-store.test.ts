import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { sqliteAdapter, sql } from "@payloadcms/db-sqlite";
import {
  type ServerCallContext,
  type Task,
  type TaskState,
} from "@cfp/agent-a2a";
import { BasePayload, buildConfig, type Payload } from "payload";
import { expect, it } from "vitest";

import { collections } from "./collections";
import {
  PayloadA2ARequestLedger,
  PayloadA2ATaskStore,
} from "./a2a-store";
import { migrations } from "./migrations";
import { installSqliteContentionWait } from "./sqlite-contention";
import { holdSessionLease } from "./session-lease";

const SUBMITTED = 1 as TaskState;
const WORKING = 2 as TaskState;
const COMPLETED = 3 as TaskState;
const FAILED = 4 as TaskState;

function context(owner: string, tenant = "aj-platform", agentId = "cbt") {
  return {
    tenant,
    requestedVersion: "1.0",
    user: {
      isAuthenticated: true,
      userName: JSON.stringify([tenant, owner, agentId]),
    },
    state: new Map<string, unknown>([
      ["cfp.agentA2a.principal", { owner, tenant }],
      ["cfp.agentA2a.agentId", agentId],
    ]),
  } as ServerCallContext;
}

function task(state: TaskState, id = "task-1"): Task {
  return {
    id,
    contextId: `context-${id}`,
    status: { state, message: undefined, timestamp: new Date().toISOString() },
    artifacts: [],
    history: [],
    metadata: {},
  };
}

async function open(filename: string, migrate = false): Promise<Payload> {
  const payload = await new BasePayload().init({
    config: buildConfig({
      secret: "isolated-a2a-store-test",
      telemetry: false,
      db: sqliteAdapter({
        client: { url: `file:${filename}` },
        push: false,
        transactionOptions: {},
      }),
      collections: collections.map((collection) => ({ ...collection })),
    }),
  });
  installSqliteContentionWait(payload);
  if (migrate) await payload.db.migrate({
    migrations: migrations.map((migration) => ({
      name: migration.name,
      up: (args: unknown) => migration.up(args as never),
      down: (args: unknown) => migration.down(args as never),
    })),
  });
  return payload;
}

it("full-config Payload A2A storage is private, isolated, durable, and atomic under SQLite contention", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "hello-a2a-store-"));
  const filename = path.join(directory, "a2a.db");
  let payload: Payload | undefined;
  let competitor: Payload | undefined;
  try {
    payload = await open(filename, true);
    competitor = await open(filename);
    const lockColumns = await payload.db.drizzle.all<{ name: string }>(
      sql`PRAGMA table_info(payload_locked_documents_rels)`,
    );
    expect(lockColumns.map((column) => column.name).filter((name) => name.includes("a2a"))).toEqual([]);
    expect(collections.filter((collection) => String(collection.slug).startsWith("a2a-")))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ slug: "a2a-execution-tasks", lockDocuments: false }),
        expect.objectContaining({ slug: "a2a-request-ledgers", lockDocuments: false }),
      ]));

    const store = new PayloadA2ATaskStore(payload, "alice", "aj-platform");
    const ledger = new PayloadA2ARequestLedger(payload, "alice", "aj-platform");
    const alice = context("alice");
    const submitted = task(SUBMITTED);
    submitted.history = Array.from({ length: 12 }, (_, index) => ({
      messageId: `history-${index}`,
      contextId: "context-task-1",
      taskId: "task-1",
      role: 1,
      parts: [{ content: { $case: "text", value: "bounded" }, metadata: {}, filename: "", mediaType: "text/plain" }],
      metadata: {},
      extensions: [],
      referenceTaskIds: [],
    }));
    submitted.artifacts = Array.from({ length: 6 }, (_, index) => ({
      artifactId: `artifact-${index}`,
      name: "bounded",
      description: "",
      parts: [{ content: { $case: "data", value: { index } }, metadata: {}, filename: "", mediaType: "application/json" }],
      metadata: {},
      extensions: [],
    }));
    await store.save(submitted, alice);
    expect(await store.load("task-1", alice)).toMatchObject({ history: { length: 8 }, artifacts: { length: 4 } });
    await store.save(task(COMPLETED), alice);
    await expect(store.save(task(WORKING), alice)).rejects.toThrow(/terminal/);
    const reservation = await ledger.reserve(
      { tenant: "aj-platform", owner: "alice", agentId: "cbt" },
      "message-1",
      "fingerprint-1",
    );
    if (reservation.outcome !== "new") throw new Error("expected reservation");
    await ledger.recordTask(reservation.token, { id: "task-1", contextId: "context-task-1" });

    const ledgers = [
      new PayloadA2ARequestLedger(payload, "alice", "aj-platform"),
      new PayloadA2ARequestLedger(competitor, "alice", "aj-platform"),
    ];
    const concurrent = await Promise.all(ledgers.map((candidate) => candidate.reserve(
      { tenant: "aj-platform", owner: "alice", agentId: "cbt" },
      "message-2",
      "fingerprint-2",
    )));
    expect(concurrent.map((item) => item.outcome).sort()).toEqual(["existing", "new"]);
    const winner = concurrent.findIndex((item) => item.outcome === "new");
    const won = concurrent[winner];
    if (!won || won.outcome !== "new") throw new Error("expected one new reservation");
    await ledgers[winner]!.recordTask(won.token, { id: "task-2", contextId: "context-task-2" });

    const stores = [
      new PayloadA2ATaskStore(payload, "alice", "aj-platform"),
      new PayloadA2ATaskStore(competitor, "alice", "aj-platform"),
    ];
    await stores[0]!.save(task(SUBMITTED, "task-2"), alice);
    const competingTerminal = await Promise.allSettled([
      stores[0]!.save(task(COMPLETED, "task-2"), alice),
      stores[1]!.save(task(FAILED, "task-2"), alice),
    ]);
    expect(competingTerminal.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const terminal = (await stores[0]!.load("task-2", alice))?.status?.state;
    expect([COMPLETED, FAILED]).toContain(terminal);
    await expect(stores[1]!.save(task(WORKING, "task-2"), alice)).rejects.toThrow(/terminal/);
    expect((await stores[1]!.load("task-2", alice))?.status?.state).toBe(terminal);

    await store.save(task(SUBMITTED, "task-agent"), context("alice", "aj-platform", "dbt"));
    expect(await store.load("task-agent", alice)).toBeUndefined();
    expect((await store.load("task-agent", context("alice", "aj-platform", "dbt")))?.id).toBe("task-agent");
    await expect(store.load("task-1", context("alice", "other-tenant"))).rejects.toThrow(/not authorized/);
    expect((await ledger.reserve(
      { tenant: "aj-platform", owner: "alice", agentId: "dbt" },
      "message-1",
      "fingerprint-1",
    )).outcome).toBe("new");
    await expect(ledger.reserve(
      { tenant: "other-tenant", owner: "alice", agentId: "cbt" },
      "message-tenant",
      "fingerprint-tenant",
    )).rejects.toThrow(/not authorized/);

    const visible = await payload.find({
      collection: "a2a-execution-tasks",
      overrideAccess: false,
      context: { helloOwner: "alice", helloA2A: true },
      pagination: false,
    });
    expect(visible.docs.every((row) => row.owner === "alice")).toBe(true);
    await expect(payload.find({
      collection: "a2a-execution-tasks",
      overrideAccess: false,
      pagination: false,
    })).rejects.toThrow(/not allowed/);

    const auditCount = await payload.count({
      collection: "safety-audit",
      overrideAccess: true,
      where: { event: { equals: "business.read" } },
    });
    await payload.find({
      collection: "a2a-execution-tasks",
      overrideAccess: false,
      user: { id: 999, collection: "admins", role: "administrator" } as never,
      limit: 1,
    });
    expect((await payload.count({
      collection: "safety-audit",
      overrideAccess: true,
      where: { event: { equals: "business.read" } },
    })).totalDocs).toBe(auditCount.totalDocs + 1);

    const bobStore = new PayloadA2ATaskStore(payload, "bob", "aj-platform");
    await bobStore.save(task(SUBMITTED, "bob-task"), context("bob"));
    const bobRow = (await payload.find({
      collection: "a2a-execution-tasks",
      overrideAccess: true,
      where: { taskId: { equals: "bob-task" } },
      limit: 1,
    })).docs[0]!;
    await expect(payload.update({
      collection: "a2a-execution-tasks",
      id: bobRow.id,
      overrideAccess: false,
      context: { helloOwner: "alice", helloWrite: true, helloA2A: true },
      data: { state: WORKING },
    })).rejects.toThrow(/not allowed/);
    await expect(payload.delete({
      collection: "a2a-execution-tasks",
      id: bobRow.id,
      overrideAccess: false,
      context: { helloOwner: "alice", helloWrite: true, helloA2A: true },
    })).rejects.toThrow(/not allowed/);
    const aliceRow = (await payload.find({
      collection: "a2a-execution-tasks",
      overrideAccess: true,
      where: { taskId: { equals: "task-1" } },
      limit: 1,
    })).docs[0]!;
    await expect(payload.update({
      collection: "a2a-execution-tasks",
      id: aliceRow.id,
      overrideAccess: false,
      context: { helloOwner: "alice", helloWrite: true, helloA2A: true },
      data: { owner: "bob" },
    })).rejects.toThrow(/owner is not authorized/);

    for (const [owner, state, expiresAt] of [
      ["withdrawn-owner", "withdrawn", undefined],
      ["deleted-owner", "deleted", undefined],
      ["expired-owner", "active", "2000-01-01T00:00:00.000Z"],
    ] as const) {
      await payload.create({
        collection: "privacy-profiles",
        overrideAccess: true,
        data: { owner, state, revision: 0, expiresAt },
      });
      await expect(new PayloadA2ATaskStore(payload, owner, "aj-platform").save(
        task(SUBMITTED, `${owner}-task`),
        context(owner),
      )).rejects.toMatchObject({ status: 403 });
    }

    const leaseOwner = "expired-lease-owner";
    const releaseLease = holdSessionLease({
      owner: leaseOwner,
      id: 77,
      createdAt: new Date().toISOString(),
      expiresAt: Date.now() + 10,
      renew: async () => false,
      release: async () => undefined,
    });
    try {
      const lateWrite = releaseLease.run(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new PayloadA2ATaskStore(payload!, leaseOwner, "aj-platform").save(
          task(SUBMITTED, "expired-lease-task"),
          context(leaseOwner),
        );
      });
      await expect(lateWrite).rejects.toThrow();
      expect(await new PayloadA2ATaskStore(payload, leaseOwner, "aj-platform").load(
        "expired-lease-task",
        context(leaseOwner),
      )).toBeUndefined();
    } finally {
      await releaseLease();
    }

    await competitor.destroy();
    competitor = undefined;
    await payload.destroy();

    payload = await open(filename);
    const recreatedStore = new PayloadA2ATaskStore(payload, "alice", "aj-platform");
    expect((await recreatedStore.load("task-1", alice))?.status?.state).toBe(COMPLETED);
    const recreatedLedger = new PayloadA2ARequestLedger(payload, "alice", "aj-platform");
    expect(await recreatedLedger.recoverCompletedTask({
      scope: { tenant: "aj-platform", owner: "alice", agentId: "cbt" },
      requestIdentity: "missing-message",
    })).toBeUndefined();
    await recreatedStore.save(task(SUBMITTED, "pending-task"), alice);
    const pendingReservation = await recreatedLedger.reserve(
      { tenant: "aj-platform", owner: "alice", agentId: "cbt" },
      "pending-message",
      "pending-fingerprint",
    );
    if (pendingReservation.outcome !== "new") throw new Error("expected pending reservation");
    await recreatedLedger.recordTask(pendingReservation.token, {
      id: "pending-task",
      contextId: "context-pending-task",
    });
    expect(await recreatedLedger.recoverCompletedTask({
      scope: { tenant: "aj-platform", owner: "alice", agentId: "cbt" },
      requestIdentity: "pending-message",
    })).toBeUndefined();
    const replay = await recreatedLedger.reserve(
      { tenant: "aj-platform", owner: "alice", agentId: "cbt" },
      "message-1",
      "fingerprint-1",
    );
    expect(replay).toMatchObject({ outcome: "existing", entry: { status: "recorded", taskId: "task-1" } });
    expect(await recreatedLedger.recoverCompletedTask({
      scope: { tenant: "aj-platform", owner: "alice", agentId: "cbt" },
      requestIdentity: "message-1",
    })).toMatchObject({ id: "task-1", status: { state: COMPLETED } });
    expect(await recreatedLedger.recoverCompletedTask({
      scope: { tenant: "aj-platform", owner: "alice", agentId: "dbt" },
      requestIdentity: "message-1",
    })).toBeUndefined();
    expect(await new PayloadA2ARequestLedger(payload, "bob", "aj-platform")
      .recoverCompletedTask({
        scope: { tenant: "aj-platform", owner: "bob", agentId: "cbt" },
        requestIdentity: "message-1",
      })).toBeUndefined();
    const concurrentReplay = await recreatedLedger.reserve(
      { tenant: "aj-platform", owner: "alice", agentId: "cbt" },
      "message-2",
      "fingerprint-2",
    );
    expect(concurrentReplay).toMatchObject({ outcome: "existing", entry: { status: "recorded", taskId: "task-2" } });
    expect((await recreatedStore.load("task-2", alice))?.status?.state).toBe(terminal);

    expect(await new PayloadA2ATaskStore(payload, "bob", "aj-platform").load("task-1", context("bob"))).toBeUndefined();
  } finally {
    await competitor?.destroy();
    await payload?.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
