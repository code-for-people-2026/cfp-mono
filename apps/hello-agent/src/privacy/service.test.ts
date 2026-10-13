import type { Payload } from "payload";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Repository } from "../cms/repository";
import type { PrivacyProfile } from "../payload-types";
import { PrivacyService } from "./service";
import { privacyPolicy } from "./policy";

// #383 is not submitted yet. No deletion path is exercised by this unit test.
vi.mock("../operations/retention", () => ({ eraseOperationsEvidence: vi.fn() }));
beforeEach(() => {
  for (const [key, value] of Object.entries({
    HELLO_DEPLOYED: "true", HELLO_PRIVACY_CONTACT: "test@example.invalid", HELLO_PRIVACY_RESPONSE_DAYS: "7", HELLO_PRIVACY_STORAGE_LOCATION: "隔离测试", HELLO_PRIVACY_RETENTION_DAYS: "30", HELLO_PRIVACY_BACKUP_DAYS: "7", HELLO_PRIVACY_DELETION_LEDGER: "/test-only/deletions.ndjson", HELLO_PRIVACY_OPERATIONS_APPROVED: "true",
  })) vi.stubEnv(key, value);
  vi.stubEnv("HELLO_IMAGE_REVIEW_URL", undefined);
});
afterEach(() => vi.unstubAllEnvs());
function fixture(priorInputs: unknown[] = []) {
  let profile: PrivacyProfile = { id: 1, owner: "isolated", state: "active", sensitiveHistory: false, createdAt: "2026-10-13", updatedAt: "2026-10-13", consent: { version: privacyPolicy().version, core: true, model: true, sensitive: true, external: false } };
  const update = vi.fn(async ({ data }: { data: Partial<PrivacyProfile> }) => (profile = { ...profile, ...data }));
  const payload = {
    find: vi.fn(async ({ collection }: { collection: string }) => ({ docs: collection === "privacy-profiles" ? [profile] : priorInputs.map((input, index) => ({ id: index + 1, input })) })),
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
