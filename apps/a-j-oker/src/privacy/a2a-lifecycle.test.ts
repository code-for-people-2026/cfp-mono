import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import type { ServerCallContext, TaskState } from "@cfp/agent-a2a";
import { BasePayload, buildConfig, type Payload } from "payload";
import { expect, it, vi } from "vitest";

import { PayloadA2ARequestLedger, PayloadA2ATaskStore } from "../cms/a2a-store";
import { collections } from "../cms/collections";
import { migrations } from "../cms/migrations";
import { Repository } from "../cms/repository";
import { PrivacyService, profileFor } from "./service";

vi.mock("./deletion-ledger", async (original) => ({
  ...await original<typeof import("./deletion-ledger")>(),
  writeDeletionLedger: vi.fn(async () => undefined),
}));

const scope = { tenant: "aj-platform", agentId: "cbt" };

function context(owner: string) {
  return {
    tenant: scope.tenant,
    requestedVersion: "1.0",
    user: { isAuthenticated: true, userName: JSON.stringify([scope.tenant, owner, scope.agentId]) },
    state: new Map<string, unknown>([
      ["cfp.agentA2a.principal", { owner, tenant: scope.tenant }],
      ["cfp.agentA2a.agentId", scope.agentId],
    ]),
  } as ServerCallContext;
}

async function seed(payload: Payload, owner: string) {
  await payload.create({
    collection: "privacy-profiles",
    overrideAccess: true,
    data: {
      owner,
      state: "active",
      revision: 0,
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  });
  const taskStore = new PayloadA2ATaskStore(payload, owner, scope.tenant);
  await taskStore.save({
    id: `${owner}-task`,
    contextId: `${owner}-context`,
    status: { state: 1 as TaskState, message: undefined, timestamp: new Date().toISOString() },
    artifacts: [],
    history: [],
    metadata: {},
  }, context(owner));
  const ledger = new PayloadA2ARequestLedger(payload, owner, scope.tenant);
  await ledger.reserve(
    { owner, tenant: scope.tenant, agentId: scope.agentId },
    `${owner}-request`,
    `${owner}-fingerprint`,
  );
}

async function count(payload: Payload, collection: "a2a-execution-tasks" | "a2a-request-ledgers", owner: string) {
  return (await payload.count({ collection, overrideAccess: true, where: { owner: { equals: owner } } })).totalDocs;
}

it("privacy deletion removes both A2A state collections and retries a partial ledger deletion from a frozen tombstone", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "hello-a2a-privacy-"));
  let payload: Payload | undefined;
  try {
    payload = await new BasePayload().init({
      config: buildConfig({
        secret: "isolated-a2a-privacy-test",
        telemetry: false,
        db: sqliteAdapter({
          client: { url: `file:${path.join(directory, "privacy.db")}` },
          push: false,
          transactionOptions: {},
        }),
        collections: collections.map((collection) => ({ ...collection })),
      }),
    });
    await payload.db.migrate({
      migrations: migrations.map((migration) => ({
        name: migration.name,
        up: (args: unknown) => migration.up(args as never),
        down: (args: unknown) => migration.down(args as never),
      })),
    });

    const deletedOwner = "a2a-delete-complete";
    await seed(payload, deletedOwner);
    await expect(new PrivacyService(new Repository(payload, { id: deletedOwner, auth: "cookie" })).deleteData())
      .resolves.toMatchObject({ deleted: true });
    expect(await count(payload, "a2a-execution-tasks", deletedOwner)).toBe(0);
    expect(await count(payload, "a2a-request-ledgers", deletedOwner)).toBe(0);
    expect(await profileFor(payload, deletedOwner)).toMatchObject({ state: "deleted" });

    const retryOwner = "a2a-delete-retry";
    await seed(payload, retryOwner);
    const service = new PrivacyService(new Repository(payload, { id: retryOwner, auth: "cookie" }));
    const originalDelete = payload.delete.bind(payload);
    let failed = false;
    const erase = vi.spyOn(payload, "delete").mockImplementation(async (options) => {
      if (failed || options.collection !== "a2a-request-ledgers") return originalDelete(options);
      failed = true;
      return { docs: [], errors: [{ id: 1, isPublic: false, message: "simulated partial failure" }] };
    });
    try {
      await expect(service.deleteData()).rejects.toMatchObject({ status: 503 });
      expect(await profileFor(payload, retryOwner)).toMatchObject({ state: "deleting" });
      expect(await count(payload, "a2a-request-ledgers", retryOwner)).toBe(1);
      erase.mockRestore();
      await expect(service.deleteData()).resolves.toMatchObject({ deleted: true });
      expect(await count(payload, "a2a-execution-tasks", retryOwner)).toBe(0);
      expect(await count(payload, "a2a-request-ledgers", retryOwner)).toBe(0);
      expect(await profileFor(payload, retryOwner)).toMatchObject({ state: "deleted" });
    } finally {
      erase.mockRestore();
    }
  } finally {
    await payload?.destroy();
    await rm(directory, { recursive: true, force: true });
  }
}, 30_000);
