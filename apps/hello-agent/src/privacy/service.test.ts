import type { Payload } from "payload";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AppError } from "../domain/contracts";
import { Repository } from "../cms/repository";
import type { PrivacyProfile } from "../payload-types";
import { PrivacyService } from "./service";
import { privacyPolicy } from "./policy";
import { maintainPrivacy } from "./maintenance";
import { writeDeletionLedger } from "./deletion-ledger";

// #383 is not submitted yet. Repository and retention are unit-test doubles;
// ledger durability and actual file writes are covered in separate tests.
vi.mock("../operations/retention", () => ({ eraseOperationsEvidence: vi.fn(async () => ({ held: 0 })) }));
vi.mock("./profile-store", () => ({ updateProfile: async (payload: Payload, expected: PrivacyProfile, data: Partial<PrivacyProfile>) => {
  const latest = (await payload.find({ collection: "privacy-profiles" })).docs[0];
  if (latest.revision !== expected.revision || latest.state !== expected.state) throw new AppError(409, "隐私设置已变更");
  await payload.update({ collection: "privacy-profiles", id: expected.id, data: { ...data, revision: expected.revision + 1 } });
} }));
vi.mock("./deletion-ledger", async (original) => ({ ...await original<typeof import("./deletion-ledger")>(), writeDeletionLedger: vi.fn(async () => {}) }));
beforeEach(() => {
  for (const [key, value] of Object.entries({
    HELLO_DEPLOYED: "true", HELLO_PRIVACY_CONTACT: "test@example.invalid", HELLO_PRIVACY_RESPONSE_DAYS: "7", HELLO_PRIVACY_STORAGE_LOCATION: "隔离测试", HELLO_PRIVACY_RETENTION_DAYS: "30", HELLO_PRIVACY_BACKUP_DAYS: "7", HELLO_PRIVACY_DELETION_LEDGER: "/test-only/deletions.ndjson", HELLO_PRIVACY_OPERATIONS_APPROVED: "true",
  })) vi.stubEnv(key, value);
  vi.stubEnv("HELLO_IMAGE_REVIEW_URL", undefined);
});
afterEach(() => vi.unstubAllEnvs());
function fixture(priorInputs: unknown[] = []) {
  let profile: PrivacyProfile = { id: 1, owner: "isolated", state: "active", revision: 0, historyInspected: priorInputs.length === 0, sensitiveHistory: false, createdAt: "2026-10-13", updatedAt: "2026-10-13", consent: { version: privacyPolicy().version, core: true, model: true, sensitive: true, external: false } };
  const update = vi.fn(async ({ data }: { data: Partial<PrivacyProfile> }) => (profile = { ...profile, ...data }));
  const payload = {
    find: vi.fn(async ({ collection, where }: { collection: string; where?: { and?: { id?: { greater_than?: number } }[] } }) => {
      const cursor = where?.and?.find((clause) => clause.id)?.id?.greater_than || 0;
      return { docs: collection === "privacy-profiles" ? [profile] : priorInputs.map((input, index) => ({ id: index + 1, input })).filter((row) => row.id > cursor).slice(0, 1) };
    }),
    update,
    delete: vi.fn(async () => ({})),
  } as unknown as Payload;
  return { service: new PrivacyService(new Repository(payload, { id: "isolated", auth: "cookie" })), profile: () => profile, update };
}
it("部署环境没有图片审核配置时仍可授权和使用文字，图片单独拒绝", async () => {
  const { service, profile } = fixture();
  await service.consent(profile().consent);
  await expect(service.requireInput({ text: "你好", mediaIds: [] })).resolves.toBeUndefined();
  await expect(service.requireImageInput()).rejects.toMatchObject({ status: 503 });
  // Sensitive text uses its own consent, not the image review configuration.
  await expect(service.requireInput({ text: "我有些焦虑", mediaIds: [] })).resolves.toBeUndefined();
});
it.each([{}, { text: "普通文字", mediaIds: [] }])("勾选敏感授权后普通操作不留下敏感历史：%j", async (input) => {
  const { service, profile, update } = fixture();
  await service.requireInput(input);
  expect(profile().sensitiveHistory).toBe(false);
  expect(update).not.toHaveBeenCalled();
  await service.consent({ ...profile().consent as object, sensitive: false });
  await expect(service.requireInput({ text: "仍然可以普通文字", mediaIds: [] })).resolves.toBeUndefined();
});
it.each([
  { text: "焦虑", mediaIds: [] },
  { text: "图片", mediaIds: [1] },
  { formResponse: { values: { answer: "3" } } },
])("实际敏感输入才记录历史，撤回后不能复用：%j", async (input) => {
  const { service, profile } = fixture();
  await service.requireInput(input);
  expect(profile().sensitiveHistory).toBe(true);
  await service.consent({ ...profile().consent as object, sensitive: false });
  await expect(service.requireInput({ text: "普通文字", mediaIds: [] })).rejects.toMatchObject({ status: 403 });
});
it("已有敏感历史即使没有标记也要授权，拒绝请求不写入标记", async () => {
  const { service, profile, update } = fixture([{ text: "焦虑", mediaIds: [] }]);
  await service.consent({ ...profile().consent as object, sensitive: false });
  update.mockClear();
  await expect(service.requireInput({})).rejects.toMatchObject({ status: 403 });
  expect(update).not.toHaveBeenCalled();
  await service.consent({ ...profile().consent as object, sensitive: true });
  await service.requireInput({});
  expect(profile().sensitiveHistory).toBe(true);
});

it.each(["", "  ", "relative-ledger.ndjson"])("恢复入口拒绝无效清单路径并且不访问数据：%j", async (restoreLedger) => {
  const find = vi.fn();
  await expect(maintainPrivacy({ find } as unknown as Payload, { apply: false, restoreLedger })).rejects.toThrow("绝对路径");
  expect(find).not.toHaveBeenCalled();
});

it("重复确认相同授权不重写记录、不延长有效期；过期后可以重新同意", async () => {
  const { service, profile, update } = fixture();
  await service.consent(profile().consent);
  const expiresAt = profile().expiresAt;
  const events = profile().events;
  update.mockClear();
  for (let count = 0; count < 25; count++) await service.consent(profile().consent);
  expect(update).not.toHaveBeenCalled();
  expect(profile()).toMatchObject({ expiresAt, events });
  await update({ data: { expiresAt: "2020-01-01T00:00:00.000Z" } });
  update.mockClear();
  await service.consent(profile().consent);
  expect(update).toHaveBeenCalledTimes(1);
  expect(Date.parse(profile().expiresAt!)).toBeGreaterThan(Date.now());
});
it("反复变更授权和恢复码仍限制历史体积，保留最近一次同意快照", async () => {
  const { service, profile } = fixture();
  for (let count = 0; count < 100; count++) await service.consent({ ...profile().consent as object, sensitive: count % 2 === 0 });
  expect(Buffer.byteLength(JSON.stringify(profile().events))).toBeLessThanOrEqual(128 * 1024);
  for (let count = 0; count < 100; count++) await service.recoveryCode();
  const events = profile().events;
  if (!Array.isArray(events)) throw new Error("expected event history");
  expect(events.length).toBeLessThanOrEqual(64);
  expect(Buffer.byteLength(JSON.stringify(events))).toBeLessThanOrEqual(128 * 1024);
  expect(events).toContainEqual(expect.objectContaining({ action: "consent", consent: profile().consent, policySnapshot: privacyPolicy().documents }));
  expect(events.at(-1)).toMatchObject({ action: "rotate-recovery" });
});

it("删除敏感身份后只保留冻结墓碑，不保留敏感标记或到期时间", async () => {
  const { service, profile, update } = fixture();
  await update({ data: { sensitiveHistory: true, expiresAt: "2030-01-01T00:00:00.000Z" } });
  vi.spyOn(service.media, "deleteAll").mockResolvedValue(undefined);
  await expect(service.deleteData()).resolves.toMatchObject({ deleted: true });
  expect(profile()).toMatchObject({ state: "deleted", sensitiveHistory: null, historyInspected: null, expiresAt: null, consent: null, events: null, recoveryDigest: null });
});

it("清单落盘失败时保留冻结状态，不能删除图片或会话", async () => {
  const { service, profile } = fixture();
  vi.mocked(writeDeletionLedger).mockRejectedValueOnce(new Error("directory sync failed"));
  const deleteMedia = vi.spyOn(service.media, "deleteAll");
  await expect(service.deleteData()).rejects.toThrow("directory sync failed");
  expect(profile().state).toBe("deleting");
  expect(deleteMedia).not.toHaveBeenCalled();
  expect(vi.mocked(service.repo.payload.delete).mock.calls.every(([options]) => options.collection === "credentials")).toBe(true);
});

it("已有敏感标记时不再读取任何旧聊天", async () => {
  const { service, update } = fixture([{ text: "旧聊天" }]);
  await update({ data: { sensitiveHistory: true } });
  await service.requireInput({ text: "普通文字" });
  expect(vi.mocked(service.repo.payload.find).mock.calls.some(([options]) => options.collection === "greetings")).toBe(false);
});
it("当前输入已触发敏感授权时无需扫描旧聊天", async () => {
  const { service } = fixture([{ text: "旧聊天" }]);
  await service.requireInput({ text: "焦虑" });
  expect(vi.mocked(service.repo.payload.find).mock.calls.some(([options]) => options.collection === "greetings")).toBe(false);
});
it("未标记历史只逐条取输入，命中后停止并保存标记", async () => {
  const { service, profile } = fixture([{ text: "普通文字" }, { text: "焦虑" }, { text: "不应继续读取" }]);
  await service.requireInput({ text: "你好" });
  const reads = vi.mocked(service.repo.payload.find).mock.calls.map(([options]) => options).filter((options) => options.collection === "greetings");
  expect(reads).toHaveLength(2);
  for (const [index, options] of reads.entries()) expect(options).toMatchObject({ limit: 1, depth: 0, sort: "id", select: { id: true, input: true }, overrideAccess: false, context: { helloOwner: "isolated" }, where: { and: [{ owner: { equals: "isolated" } }, { id: { greater_than: index } }] } });
  expect(profile().sensitiveHistory).toBe(true);
});

it("没有敏感内容的旧历史只检查一次，后续新敏感输入仍要单独授权", async () => {
  const { service, profile } = fixture([{ text: "旧普通文字" }]);
  await service.requireInput({ text: "你好" });
  expect(profile()).toMatchObject({ sensitiveHistory: false, historyInspected: true });
  vi.mocked(service.repo.payload.find).mockClear();
  await service.requireInput({ text: "再次你好" });
  expect(vi.mocked(service.repo.payload.find).mock.calls.some(([options]) => options.collection === "greetings")).toBe(false);
  await service.consent({ ...profile().consent as object, sensitive: false });
  await expect(service.requireInput({ text: "焦虑" })).rejects.toMatchObject({ status: 403 });
});
