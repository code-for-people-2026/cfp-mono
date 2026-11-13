import { afterEach, describe, expect, it, vi } from "vitest";
import { greenImageReviewer, configuredGreenReviewer } from "./aliyun-image-review";
import { imageReviewConfigured } from "./image-review";

const uploadToken = () => ({ accessKeyId: "temporary-id", accessKeySecret: "temporary-secret", securityToken: "temporary-token", bucketName: "oss-cip-shanghai", ossInternetEndPoint: "https://oss-cn-shanghai.aliyuncs.com", fileNamePrefix: "upload/test-owner/", expiration: Math.floor(Date.now() / 1000) + 1800 });
afterEach(() => vi.unstubAllEnvs());
describe("Alibaba Green pixel review", () => {
  it.each([["none", "allow"], ["high", "block"], ["medium", "uncertain"], ["low", "uncertain"]])("maps %s without publishing uncertain pixels", async (riskLevel, decision) => {
    const upload = vi.fn().mockResolvedValue(undefined), inspect = vi.fn().mockResolvedValue({ code: 200, data: { riskLevel } });
    const bytes = Buffer.from("synthetic-image");
    const result = await greenImageReviewer({ token: async () => uploadToken(), upload, inspect })(bytes);
    expect(result.decision).toBe(decision);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ bucketName: "oss-cip-shanghai" }), expect.stringMatching(/^upload\/test-owner\/[a-f\d-]+\.jpg$/), bytes);
    expect(inspect.mock.calls[0][1]).toBe(upload.mock.calls[0][1]);
    expect(JSON.stringify(result)).not.toContain("temporary-secret");
  });
  it.each([{ code: 403 }, { code: 200, data: {} }, { code: 200, data: { riskLevel: "unexpected" } }])("fails closed for invalid responses", async (response) => {
    expect((await greenImageReviewer({ token: async () => uploadToken(), upload: async () => {}, inspect: async () => response })(Buffer.from("pixels"))).decision).toBe("unavailable");
  });
  it.each([{ ossInternetEndPoint: "https://attacker.example" }, { expiration: 1 }, { bucketName: "our-private-bucket" }, { fileNamePrefix: "../../" }])("rejects unsafe/expired temporary upload targets", async (override) => {
    const upload = vi.fn();
    expect((await greenImageReviewer({ token: async () => ({ ...uploadToken(), ...override }), upload, inspect: vi.fn() })(Buffer.from("pixels"))).decision).toBe("unavailable");
    expect(upload).not.toHaveBeenCalled();
  });
  it("requires independent reviewer credentials before declaring readiness", async () => {
    vi.stubEnv("HELLO_IMAGE_REVIEW_MODE", "aliyun-green"); vi.stubEnv("HELLO_GREEN_ACCESS_KEY_ID", ""); vi.stubEnv("HELLO_GREEN_ACCESS_KEY_SECRET", "");
    expect(imageReviewConfigured()).toBe(false);
    expect((await configuredGreenReviewer(Buffer.from("pixels"))).decision).toBe("unavailable");
    vi.stubEnv("HELLO_GREEN_ACCESS_KEY_ID", "test"); vi.stubEnv("HELLO_GREEN_ACCESS_KEY_SECRET", "test");
    expect(imageReviewConfigured()).toBe(true);
  });
});
