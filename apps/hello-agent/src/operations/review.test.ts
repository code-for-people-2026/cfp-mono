import { afterEach, describe, expect, it, vi } from "vitest";
import { completeDeepSeek } from "../models/deepseek";
import { evaluateText } from "../domain/moderation";
import { defaultRule } from "./policy";
import { configuredImageReviewer } from "./image-review";
vi.mock("../models/deepseek", () => ({ DEFAULT_MODEL: "test-model", completeDeepSeek: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.mocked(completeDeepSeek).mockReset(); });
describe("审核覆盖与失败行为", () => {
  it("全量模式对无关键词文本也调用语境复核，并保存类别", async () => {
    vi.mocked(completeDeepSeek).mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: '{"decision":"block","category":"fraud"}' } }], model: "test-model" });
    const result = await evaluateText({ stage: "input", texts: ["天气晴朗"], apiKey: "test-key", requestId: "all-test" }, { ...defaultRule, mode: "all" });
    expect(completeDeepSeek).toHaveBeenCalledOnce(); expect(result).toMatchObject({ decision: "block", category: "fraud" });
  });
  it("关键词模式明确记录未复核，而非假称允许", async () => {
    const result = await evaluateText({ stage: "output", texts: ["天气晴朗"], requestId: "legacy" }, defaultRule);
    expect(result.decision).toBe("not_reviewed"); expect(completeDeepSeek).not.toHaveBeenCalled();
  });
  it("规则追加召回词对第一段也生效，缺服务不能放行", async () => {
    const result = await evaluateText({ stage: "input", texts: ["天气晴朗"], requestId: "extra" }, { ...defaultRule, extraWords: ["晴朗"] });
    expect(result.decision).toBe("unavailable");
  });
  it("图像审核未配置时失败关闭且不发送像素", async () => {
    vi.stubEnv("HELLO_IMAGE_REVIEW_URL", ""); vi.stubEnv("HELLO_IMAGE_REVIEW_TOKEN", ""); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect((await configuredImageReviewer(Buffer.from("test pixels"))).decision).toBe("unavailable"); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([new Response("{}", { status: 503 }), new Response('{"decision":"allow"}'), new Response('{"decision":"uncertain","version":"v1","category":"other"}')])("服务失败/缺少版本/不确定都不能成为通过", async (response) => {
    vi.stubEnv("HELLO_IMAGE_REVIEW_URL", "https://review.example/inspect"); vi.stubEnv("HELLO_IMAGE_REVIEW_TOKEN", "test-token"); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    expect((await configuredImageReviewer(Buffer.from("test pixels"))).decision).not.toBe("allow");
  });
  it("接口契约成功时记录真实服务版本，禁止跟随重定向", async () => {
    vi.stubEnv("HELLO_IMAGE_REVIEW_URL", "https://review.example/inspect"); vi.stubEnv("HELLO_IMAGE_REVIEW_TOKEN", "test-token"); const fetch = vi.fn().mockResolvedValue(new Response('{"decision":"allow","version":"test-provider-v2","category":"other"}')); vi.stubGlobal("fetch", fetch);
    expect(await configuredImageReviewer(Buffer.from("test pixels"))).toEqual({ decision: "allow", version: "test-provider-v2", category: "other" });
    expect(fetch.mock.calls[0][1].redirect).toBe("error");
  });
});
