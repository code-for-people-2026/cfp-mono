import { describe, expect, it, vi } from "vitest";
import { greenImageReviewer, configuredImageReviewer, type GreenPorts } from "../src/images/aliyun-review";
import { privacyPolicy } from "../src/privacy/policy";
import { testPrivacyConfig } from "./fixtures/privacy";

const token = () => ({ accessKeyId: "temporary-id", accessKeySecret: "temporary-secret", securityToken: "temporary-token", bucketName: "oss-cip-example", ossInternetEndPoint: "https://oss-cn-shanghai.aliyuncs.com", fileNamePrefix: "upload/test/", expiration: Date.now() / 1000 + 3600 });
const ports = (risk = "none"): GreenPorts => ({ token: vi.fn(async () => token()), upload: vi.fn(async () => ({})), inspect: vi.fn(async () => ({ code: 200, data: { riskLevel: risk }, ignored: "private supplier response" })) });
describe("Green adapter only sends normalized bytes to validated temporary storage", () => {
  it.each([["none", "allow"], ["high", "block"], ["low", "uncertain"], ["medium", "uncertain"], ["unknown", "unavailable"]])("maps %s without forwarding raw labels", async (risk, decision) => {
    const p = ports(risk), bytes = Buffer.from("synthetic image bytes");
    expect(await greenImageReviewer(p)(bytes, "image/png")).toBe(decision);
    expect(p.upload).toHaveBeenCalledWith(expect.any(Object), expect.stringMatching(/^upload\/test\/[a-f0-9-]{36}\.png$/), bytes, "image/png");
    expect(p.inspect).toHaveBeenCalledWith("oss-cip-example", expect.any(String), expect.stringMatching(/^[a-f0-9-]{36}$/));
  });
  it.each([
    { ossInternetEndPoint: "https://attacker.example" }, { bucketName: "customer-public-bucket" },
    { fileNamePrefix: "upload/../../" }, { expiration: 1 },
  ])("rejects an unsafe or expired upload token before sending pixels: %j", async change => {
    const p = ports(); p.token = async () => ({ ...token(), ...change });
    expect(await greenImageReviewer(p)(Buffer.from("pixels"), "image/png")).toBe("unavailable");
    expect(p.upload).not.toHaveBeenCalled(); expect(p.inspect).not.toHaveBeenCalled();
  });
  it("does not continue to upload when a token request finishes after the deadline", async () => {
    const p = ports(); let resolve!: (value: unknown) => void;
    p.token = () => new Promise(r => { resolve = r; });
    expect(await greenImageReviewer(p, 10)(Buffer.from("pixels"), "image/jpeg")).toBe("unavailable");
    resolve(token()); await new Promise(r => setTimeout(r, 10));
    expect(p.upload).not.toHaveBeenCalled(); expect(p.inspect).not.toHaveBeenCalled();
  });
  it("does not begin moderation after an upload times out; errors never expose secrets", async () => {
    const p = ports(); let finish!: () => void;
    p.upload = () => new Promise(r => { finish = () => r({}); });
    expect(await greenImageReviewer(p, 10)(Buffer.from("pixels"), "image/jpeg")).toBe("unavailable");
    finish(); await new Promise(r => setTimeout(r, 10)); expect(p.inspect).not.toHaveBeenCalled();
    p.token = async () => { throw new Error("temporary-secret"); };
    expect(await greenImageReviewer(p)(Buffer.from("pixels"), "image/webp")).toBe("unavailable");
  });
  it("has no environment-based allow mode or credential-free success", () => {
    vi.stubEnv("BUBU_IMAGE_REVIEW_MODE", "allow"); expect(configuredImageReviewer()).toBeUndefined();
    vi.stubEnv("BUBU_IMAGE_REVIEW_MODE", "aliyun-green"); vi.stubEnv("BUBU_GREEN_ACCESS_KEY_ID", ""); expect(configuredImageReviewer()).toBeUndefined();
    vi.unstubAllEnvs();
  });
  it("changes consent versions when supplier handling changes while text can remain enabled", () => {
    const missing = privacyPolicy({ ...testPrivacyConfig, imageReview: undefined });
    expect(missing.ready).toBe(true); expect(missing.imageProcessingReady).toBe(false);
    const configured = privacyPolicy(testPrivacyConfig);
    expect(configured.imageProcessingReady).toBe(true); expect(configured.version).not.toBe(missing.version);
    expect(privacyPolicy({ ...testPrivacyConfig, imageReview: { ...testPrivacyConfig.imageReview!, handling: "revised terms" } }).version).not.toBe(configured.version);
  });
});
