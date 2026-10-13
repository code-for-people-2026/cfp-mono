import { createHash } from "node:crypto";
import type { Payload } from "payload";
import { expect, it, vi } from "vitest";
import { Repository } from "../cms/repository";
import { MediaService } from "./media";
import type { ImageObjectStore } from "../storage/oss";

const prefix = (owner: string) => `hello-agent/${createHash("sha256").update(owner).digest("hex").slice(0, 32)}/`;
const reference = (owner: string) => ({ provider: "oss", bucket: "test", region: "isolated", key: `${prefix(owner)}1234.jpg`, sha256: "a".repeat(64), byteLength: 5 });
function fixture(oss: boolean) {
  const owner = "deletion-test";
  const rows = new Map(Array.from({ length: 216 }, (_, index) => [index + 1, { id: index + 1, owner: index < 215 ? owner : "someone-else", object: oss ? reference(index < 215 ? owner : "someone-else") : undefined, get base64(): string { throw new Error("image bodies must not be materialized"); } }]));
  const find = vi.fn(async (options: { collection: string; overrideAccess: boolean; depth: number; pagination: boolean; limit: number; sort: string; select: Record<string, boolean>; where: { and: [{ owner: { equals: string } }, { id: { greater_than: number } }] } }) => {
    expect(options).toMatchObject({ collection: "media", overrideAccess: true, depth: 0, pagination: false, limit: 100, sort: "id", select: { id: true, object: true } });
    expect(Object.keys(options.select).sort()).toEqual(["id", "object"]);
    expect(options.where.and[0].owner.equals).toBe(owner);
    const cursor = options.where.and[1].id.greater_than;
    return { docs: [...rows.values()].filter((row) => row.owner === owner && row.id > cursor).slice(0, options.limit).map(({ id, object }) => ({ id, object })) };
  });
  const erase = vi.fn(async (options: { collection: string; select: Record<string, boolean>; where: { and: [{ owner: { equals: string } }, { id: { in: number[] } }] } }) => {
    expect(options).toMatchObject({ collection: "media", select: { owner: true } });
    expect(Object.keys(options.select)).toEqual(["owner"]);
    expect(options.where.and[0].owner.equals).toBe(owner);
    const ids = options.where.and[1].id.in;
    expect(ids.length).toBeLessThanOrEqual(100);
    for (const id of ids) { expect(rows.get(id)?.owner).toBe(owner); rows.delete(id); }
    return { docs: ids.map((id) => ({ id })), errors: [] as { id: number; isPublic: boolean; message: string }[] };
  });
  const store = { bucket: "test", region: "isolated", put: vi.fn(), get: vi.fn(), removePrefix: vi.fn(async (value: string) => { expect(value).toBe(prefix(owner)); }) } satisfies ImageObjectStore;
  const repo = new Repository({ find, delete: erase } as unknown as Payload, { id: owner, auth: "cookie" });
  return { rows, find, erase, store, service: new MediaService(repo, () => oss ? store : undefined) };
}
it.each([false, true])("分页删除大量图片仅取引用，保留其他身份（OSS=%s）", async (oss) => {
  const { rows, find, erase, store, service } = fixture(oss);
  await service.deleteAll();
  expect([...rows.keys()]).toEqual([216]);
  expect(find).toHaveBeenCalledTimes(6); // validation and deletion each scan three pages
  expect(erase.mock.calls.map(([options]) => options.where.and[1].id.in.length)).toEqual([100, 100, 15]);
  expect(store.removePrefix).toHaveBeenCalledTimes(oss ? 1 : 0);
});
it("后续页发现错误归属时不删除任何对象或记录", async () => {
  const { rows, erase, store, service } = fixture(true);
  rows.get(150)!.object = reference("someone-else");
  await expect(service.deleteAll()).rejects.toMatchObject({ status: 500 });
  expect(rows.size).toBe(216);
  expect(store.removePrefix).not.toHaveBeenCalled();
  expect(erase).not.toHaveBeenCalled();
});
it("对象清理失败保留全部引用，重试能完成分页删除", async () => {
  const { rows, erase, store, service } = fixture(true);
  store.removePrefix.mockRejectedValueOnce(new Error("storage unavailable"));
  await expect(service.deleteAll()).rejects.toThrow("storage unavailable");
  expect(rows.size).toBe(216); expect(erase).not.toHaveBeenCalled();
  await service.deleteAll(); expect([...rows.keys()]).toEqual([216]);
});
it("数据库部分删除失败不伪报成功，保留失败记录供重试", async () => {
  const { rows, erase, service } = fixture(true);
  erase.mockResolvedValueOnce({ docs: [], errors: [{ id: 1, isPublic: false, message: "injected failure" }] });
  await expect(service.deleteAll()).rejects.toMatchObject({ status: 503 });
  expect(rows.size).toBe(216);
  await service.deleteAll(); expect([...rows.keys()]).toEqual([216]);
});
