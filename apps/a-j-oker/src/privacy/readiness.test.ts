import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET } from "../app/api/ready/route";

const stubs = vi.hoisted(() => ({ cms: vi.fn(), count: vi.fn(), quota: vi.fn() }));
vi.mock("../cms/client", () => ({ cms: stubs.cms }));
vi.mock("../cms/platform-quota", () => ({ checkPlatformQuota: stubs.quota }));

const prerequisites = {
  HELLO_PRIVACY_CONTACT: "readiness-test@example.invalid",
  HELLO_PRIVACY_RESPONSE_DAYS: "7",
  HELLO_PRIVACY_STORAGE_LOCATION: "isolated readiness test",
  HELLO_PRIVACY_RETENTION_DAYS: "30",
  HELLO_PRIVACY_BACKUP_DAYS: "7",
  HELLO_PRIVACY_DELETION_LEDGER: "/isolated-readiness-test/deletions.ndjson",
  HELLO_PRIVACY_OPERATIONS_APPROVED: "true",
};

beforeEach(() => {
  vi.stubEnv("HELLO_DEPLOYED", "true");
  vi.stubEnv("HELLO_RELEASE", "readiness-test");
  vi.stubEnv("HELLO_IMAGE_REVIEW_URL", undefined);
  for (const [key, value] of Object.entries(prerequisites)) vi.stubEnv(key, value);
  stubs.count.mockReset().mockResolvedValue({ totalDocs: 1 });
  stubs.cms.mockReset().mockResolvedValue({ count: stubs.count });
  stubs.quota.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

it.each(Object.entries(prerequisites))("部署缺少 %s 时不报健康，补齐后可恢复", async (key, value) => {
  vi.stubEnv(key, undefined);
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, service: "a-j-oker" });
  expect(stubs.cms).not.toHaveBeenCalled();
  expect(stubs.quota).not.toHaveBeenCalled();
  vi.stubEnv(key, value);
  expect((await GET()).status).toBe(200);
});

it.each([
  ["HELLO_PRIVACY_RETENTION_DAYS", "0"],
  ["HELLO_PRIVACY_BACKUP_DAYS", "invalid"],
  ["HELLO_PRIVACY_RESPONSE_DAYS", "-1"],
  ["HELLO_PRIVACY_DELETION_LEDGER", "relative/deletions.ndjson"],
  ["HELLO_PRIVACY_OPERATIONS_APPROVED", "false"],
])("部署配置 %s=%s 无效时返回 503", async (key, value) => {
  vi.stubEnv(key, value);
  expect((await GET()).status).toBe(503);
});

it("基础隐私配置齐全时可健康，不要求开启图片处理，也不泄露配置", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(await response.json()).toEqual({ ok: true, service: "a-j-oker", release: "readiness-test" });
  expect(stubs.quota).toHaveBeenCalledTimes(1);
});

it.each([undefined, "false"])("本地开发不强制部署隐私配置（%s）", async (deployed) => {
  vi.stubEnv("HELLO_DEPLOYED", deployed);
  for (const key of Object.keys(prerequisites)) vi.stubEnv(key, undefined);
  expect((await GET()).status).toBe(200);
  expect(stubs.quota).toHaveBeenCalledTimes(1);
});

it.each(["database", "agent", "quota"])("隐私配置齐全仍检查 %s", async (failure) => {
  if (failure === "database") stubs.count.mockRejectedValue(new Error("private database details"));
  if (failure === "agent") stubs.count.mockResolvedValue({ totalDocs: 0 });
  if (failure === "quota") stubs.quota.mockRejectedValue(new Error("private quota details"));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false, service: "a-j-oker" });
});
