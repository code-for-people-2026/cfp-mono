import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Payload } from "payload";
import { beforeEach, expect, it, vi } from "vitest";
import { configuredImageStore, type ImageObjectStore } from "../storage/oss";
import { maintainPrivacy, PrivacyMaintenanceError } from "./maintenance";

vi.mock("../storage/oss", () => ({ configuredImageStore: vi.fn() }));
beforeEach(() => { vi.mocked(configuredImageStore).mockReset(); });
const cleanup = vi.hoisted(() => vi.fn<(owner: string) => Promise<{ deleted: boolean }>>().mockResolvedValue({ deleted: true }));
vi.mock("./service", () => ({ PrivacyService: class {
  constructor(readonly repo: { owner: { id: string } }) {}
  deleteData() { return cleanup(this.repo.owner.id); }
} }));
it("恢复按有限页只读归属和状态，已删墓碑不阻断后续身份", async () => {
  cleanup.mockClear();
  const directory = await mkdtemp(path.join(tmpdir(), "hello-ledger-pages-"));
  try {
    const ledger = path.join(directory, "ledger.ndjson");
    await writeFile(ledger, [...Array<string>(5000).fill("already-deleted"), "remaining"].map((owner) => JSON.stringify({ ownerDigest: createHash("sha256").update(owner).digest("hex") })).join("\n"));
    const source = Array.from({ length: 215 }, (_, index) => ({ id: index + 1, owner: index === 0 ? "already-deleted" : index === 214 ? "remaining" : `other-${index}`, state: index === 0 ? "deleted" : "active", expiresAt: null }));
    const find = vi.fn(async ({ collection, where, select, limit, pagination, sort, depth }) => {
      if (where.and || collection === "wechat-identities" || collection === "age-profiles") return { docs: [] };
      expect({ limit, pagination, sort, depth }).toEqual({ limit: 100, pagination: false, sort: "id", depth: 0 });
      expect(Object.keys(select).sort()).toEqual((collection === "privacy-profiles" && select.state ? ["id", "owner", "state", "expiresAt"] : ["id", "owner"]).sort());
      const rows = source.filter((row) => row.id > where.id.greater_than).slice(0, limit);
      return { docs: rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => select[key]))) };
    });
    const payload = { find, delete: vi.fn().mockResolvedValue({ errors: [] }) } as unknown as Payload;
    const result = await maintainPrivacy(payload, { apply: true, restoreLedger: ledger });
    expect(result).toMatchObject({ eligibleIdentities: 2, deleted: 2 });
    expect(cleanup.mock.calls).toEqual([["already-deleted"], ["remaining"]]);
    expect(find).toHaveBeenCalledTimes(34); // Bounded restore scans plus empty legacy scans
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("一个身份失败仍尝试其余身份及凭证清理，汇总失败并允许重试", async () => {
  const firstError = new Error("private-object-key must not appear in maintenance output");
  cleanup.mockReset().mockImplementation(async (owner) => {
    if (owner === "broken") throw firstError;
    return { deleted: true };
  });
  const payload = {
    find: vi.fn(async ({ collection, where }) => ({ docs: where.and || ["wechat-identities", "age-profiles"].includes(collection) ? [] : [
      { id: 1, owner: "broken", state: "deleting" },
      { id: 2, owner: "withdrawn", state: "withdrawn" },
      { id: 3, owner: "expired", state: "active", expiresAt: "2000-01-01" },
    ] })),
    delete: vi.fn().mockResolvedValue({ errors: [] }),
  };
  try {
    const failure = await maintainPrivacy(payload as unknown as Payload, { apply: true }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PrivacyMaintenanceError);
    const summary = failure as PrivacyMaintenanceError;
    expect(summary.result).toEqual({ dryRun: false, eligibleIdentities: 3, deleted: 2 });
    expect(summary.message).toContain("禁止恢复开放");
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].message).toContain(createHash("sha256").update("broken").digest("hex"));
    expect(String(summary.errors[0])).not.toContain(firstError.message);
    expect(cleanup.mock.calls).toEqual([["broken"], ["withdrawn"], ["expired"]]);
    expect(payload.delete).toHaveBeenCalledTimes(2);

    cleanup.mockReset().mockResolvedValue({ deleted: true });
    await expect(maintainPrivacy(payload as unknown as Payload, { apply: true })).resolves.toMatchObject({ deleted: 3 });
    expect(cleanup.mock.calls).toEqual([["broken"], ["withdrawn"], ["expired"]]);
  } finally { cleanup.mockReset().mockResolvedValue({ deleted: true }); }
});

it.each(["throw", "partial"])("身份和全局凭证失败一并报告（%s），不伪报成功", async (kind) => {
  cleanup.mockReset().mockRejectedValue(new Error("private error"));
  const erase = kind === "throw" ? vi.fn().mockRejectedValue(new Error("private db error")) : vi.fn().mockResolvedValue({ errors: [{ id: 7 }] });
  const payload = { find: vi.fn(async ({ collection, where }) => ({ docs: where.and || ["wechat-identities", "age-profiles"].includes(collection) ? [] : [
    { id: 1, owner: "first", state: "withdrawn" }, { id: 2, owner: "second", state: "deleting" },
  ] })), delete: erase };
  try {
    const failure = await maintainPrivacy(payload as unknown as Payload, { apply: true }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PrivacyMaintenanceError);
    expect((failure as PrivacyMaintenanceError).errors).toHaveLength(4);
    expect((failure as PrivacyMaintenanceError).result).toMatchObject({ deleted: 0 });
    expect(cleanup.mock.calls).toEqual([["first"], ["second"]]);
    expect(erase).toHaveBeenCalledTimes(2);
  } finally { cleanup.mockReset().mockResolvedValue({ deleted: true }); }
});

it("预览只返回待清理身份数，不执行或记录删除失败", async () => {
  cleanup.mockClear();
  const erase = vi.fn();
  const payload = { find: vi.fn(async ({ collection, where }) => ({ docs: where.and || ["wechat-identities", "age-profiles"].includes(collection) ? [] : [{ id: 1, owner: "withdrawn", state: "withdrawn" }] })), delete: erase };
  await expect(maintainPrivacy(payload as unknown as Payload, { apply: false })).resolves.toEqual({ dryRun: true, eligibleIdentities: 1, deleted: 0 });
  expect(erase).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled();
});
it("流式清单末尾损坏时不开始数据库扫描或删除", async () => {
  cleanup.mockClear();
  const directory = await mkdtemp(path.join(tmpdir(), "hello-ledger-invalid-tail-"));
  try {
    const ledger = path.join(directory, "ledger.ndjson");
    await writeFile(ledger, JSON.stringify({ ownerDigest: "a".repeat(64) }) + "\n{broken");
    const find = vi.fn(), erase = vi.fn();
    await expect(maintainPrivacy({ find, delete: erase } as unknown as Payload, { apply: true, restoreLedger: ledger })).rejects.toThrow("禁止恢复开放");
    expect(find).not.toHaveBeenCalled(); expect(erase).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("恢复没有数据库归属记录的图片，预览无写入，重放幂等且保留他人对象", async () => {
  cleanup.mockClear();
  const directory = await mkdtemp(path.join(tmpdir(), "hello-ledger-objects-"));
  try {
    const ledger = path.join(directory, "ledger.ndjson");
    const ownerDigest = createHash("sha256").update("object-only").digest("hex");
    const prefix = `hello-agent/${ownerDigest.slice(0, 32)}/`;
    const otherKey = `hello-agent/${"b".repeat(32)}/other.jpg`;
    const objects = new Set([`${prefix}orphan.jpg`, `${prefix}uncommitted.jpg`, otherKey]);
    const removePrefix = vi.fn(async (value: string) => {
      for (const key of objects) if (key.startsWith(value)) objects.delete(key);
    });
    vi.mocked(configuredImageStore).mockReturnValue({ bucket: "synthetic", region: "isolated", put: vi.fn(), get: vi.fn(), removePrefix });
    await writeFile(ledger, Array<string>(3).fill(JSON.stringify({ ownerDigest })).join("\n"));
    const payload = { find: vi.fn(async ({ collection, where }) => ({ docs: where.and || ["wechat-identities", "age-profiles"].includes(collection) ? [] : [] })), delete: vi.fn().mockResolvedValue({ errors: [] }) };
    const options = { restoreLedger: ledger };
    await expect(maintainPrivacy(payload as unknown as Payload, { ...options, apply: false })).resolves.toEqual({ dryRun: true, eligibleIdentities: 1, deleted: 0 });
    expect(objects.size).toBe(3);
    expect(configuredImageStore).not.toHaveBeenCalled(); expect(payload.delete).not.toHaveBeenCalled();
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(maintainPrivacy(payload as unknown as Payload, { ...options, apply: true })).resolves.toEqual({ dryRun: false, eligibleIdentities: 1, deleted: 1 });
      expect([...objects]).toEqual([otherKey]);
    }
    expect(removePrefix.mock.calls).toEqual([[prefix], [prefix]]);
    expect(cleanup).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("孤立对象清理失败不阻断其他摘要，脱敏汇总并在重试时重新清理", async () => {
  cleanup.mockClear();
  const directory = await mkdtemp(path.join(tmpdir(), "hello-ledger-objects-failure-"));
  try {
    const ledger = path.join(directory, "ledger.ndjson");
    const digests = ["broken-object", "other-object"].map((owner) => createHash("sha256").update(owner).digest("hex"));
    await writeFile(ledger, digests.map((ownerDigest) => JSON.stringify({ ownerDigest })).join("\n"));
    const removePrefix = vi.fn<NonNullable<ImageObjectStore["removePrefix"]>>().mockResolvedValue(undefined).mockRejectedValueOnce(new Error("private object key"));
    vi.mocked(configuredImageStore).mockReturnValue({ bucket: "synthetic", region: "isolated", put: vi.fn(), get: vi.fn(), removePrefix });
    const payload = { find: vi.fn(async ({ collection, where }) => ({ docs: where.and || ["wechat-identities", "age-profiles"].includes(collection) ? [] : [] })), delete: vi.fn().mockResolvedValue({ errors: [] }) };
    const options = { restoreLedger: ledger, apply: true };
    const failure = await maintainPrivacy(payload as unknown as Payload, options).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(PrivacyMaintenanceError);
    expect((failure as PrivacyMaintenanceError).result).toEqual({ dryRun: false, eligibleIdentities: 2, deleted: 1 });
    expect((failure as PrivacyMaintenanceError).errors.map(String)).toEqual([`Error: 对象清理失败，ownerDigest=${digests[0]}`]);
    expect(removePrefix).toHaveBeenCalledTimes(2); expect(payload.delete).toHaveBeenCalledTimes(2);
    await expect(maintainPrivacy(payload as unknown as Payload, options)).resolves.toMatchObject({ eligibleIdentities: 2, deleted: 2 });
    expect(removePrefix.mock.calls).toEqual([...digests, ...digests].map((value) => [`hello-agent/${value.slice(0, 32)}/`]));
    expect(cleanup).not.toHaveBeenCalled();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it("旧匿名会话和图片按配置到期；近期关联记录与已授权身份不会被误删", async () => {
  cleanup.mockReset().mockResolvedValue({ deleted: true });
  const find = vi.fn(async ({ collection, where }) => {
    if (collection === "privacy-profiles") return { docs: [] };
    if (collection === "sessions") return { docs: [{ id: 1, owner: "old" }, { id: 2, owner: "recent-media" }, { id: 3, owner: "consented" }] };
    if (collection === "media") return { docs: [{ id: 4, owner: "old" }, { id: 5, owner: "orphan-image" }] };
    expect(where.and[1].updatedAt.less_than).toBeTypeOf("string");
    return { docs: [] };
  });
  const count = vi.fn(async ({ collection, where }) => ({ totalDocs:
    collection === "privacy-profiles" ? Number(where.owner.equals === "consented") :
      Number(collection === "media" && where.and[0].owner.equals === "recent-media") }));
  const payload = { find, count, delete: vi.fn().mockResolvedValue({ errors: [] }) } as unknown as Payload;
  await expect(maintainPrivacy(payload, { apply: true })).resolves.toMatchObject({ eligibleIdentities: 2, deleted: 2 });
  expect(cleanup.mock.calls).toEqual([["old"], ["orphan-image"]]);
});
