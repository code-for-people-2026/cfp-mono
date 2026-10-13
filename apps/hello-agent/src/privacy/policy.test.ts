import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { privacyPolicy } from "./policy";

beforeEach(() => {
  for (const [key, value] of Object.entries({
    HELLO_PRIVACY_CONTACT: "test@example.invalid", HELLO_PRIVACY_RESPONSE_DAYS: "7", HELLO_PRIVACY_STORAGE_LOCATION: "隔离测试", HELLO_PRIVACY_RETENTION_DAYS: "30", HELLO_PRIVACY_BACKUP_DAYS: "7", HELLO_PRIVACY_DELETION_LEDGER: "/test-only/deletions.ndjson", HELLO_PRIVACY_OPERATIONS_APPROVED: "true",
    HELLO_IMAGE_REVIEW_PROVIDER: "合成审核器", HELLO_IMAGE_REVIEW_CONTACT: "test@example.invalid", HELLO_IMAGE_REVIEW_REGION: "隔离测试", HELLO_IMAGE_REVIEW_PRIVACY_URL: "https://example.invalid/privacy",
  })) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());
it.each([undefined, "", "   "])("没有图审地址时仅关闭图片，普通文字的运营就绪不受影响（%s）", (url) => {
  vi.stubEnv("HELLO_IMAGE_REVIEW_URL", url);
  expect(privacyPolicy()).toMatchObject({ imageReviewDisclosed: false, ready: true });
});
it("图审接收方全部配置后才可开放，缺少联系渠道仍拒绝", () => {
  vi.stubEnv("HELLO_IMAGE_REVIEW_URL", "https://review.example.invalid");
  expect(privacyPolicy()).toMatchObject({ imageReviewDisclosed: true, ready: true });
  vi.stubEnv("HELLO_IMAGE_REVIEW_CONTACT", " ");
  expect(privacyPolicy()).toMatchObject({ imageReviewDisclosed: false, ready: true });
});

it("文字运营资料不完整时仍不开放基础处理", () => {
  vi.stubEnv("HELLO_IMAGE_REVIEW_URL", "https://review.example.invalid");
  vi.stubEnv("HELLO_PRIVACY_CONTACT", " ");
  expect(privacyPolicy()).toMatchObject({ imageReviewDisclosed: true, ready: false });
});
