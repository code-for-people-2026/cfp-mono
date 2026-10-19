import { afterEach, describe, expect, it, vi } from "vitest";
import { configuredImageProvider, imageGenerationConfigured, ImageTaskFailed, validateWanImageUrl, wanProvider } from "./wan";

const input = { prompt: "窗台的一盆番茄，温暖插画", title: "小番茄", alt: "红色番茄", aspectRatio: "square" as const };
const resultUrl = "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/result.png?Expires=1&Signature=temporary";
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("万相图片供应商边界", () => {
  it.each(["", " \t\r\n ", "synthetic key", "synthetic\nkey", "synthetic\tkey", "synthetic\u0007key", "synthetic\u007fkey", "syntheticé"])("无效凭证既不报告可用也不创建供应商：%j", (key) => {
    vi.stubEnv("DASHSCOPE_API_KEY", key); vi.stubGlobal("fetch", vi.fn());
    expect(imageGenerationConfigured()).toBe(false);
    expect(() => configuredImageProvider()).toThrow("生图服务尚未配置");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("readiness 与实际请求共用去除首尾空白后的凭证", async () => {
    vi.stubEnv("DASHSCOPE_API_KEY", " \t synthetic-wan-key \r\n "); vi.stubEnv("HELLO_IMAGE_WORKSPACE_ID", "");
    const transport = vi.fn<typeof fetch>().mockResolvedValue(reply({ output: { task_id: "configured-task", task_status: "PENDING" } }));
    vi.stubGlobal("fetch", transport);
    expect(imageGenerationConfigured()).toBe(true);
    expect(await configuredImageProvider().submit(input, AbortSignal.timeout(1000))).toBe("configured-task");
    expect(new Headers(transport.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer synthetic-wan-key");
  });
  it("接受真实北京任务返回的精确加速桶，不放宽到任意 OSS 桶", () => {
    expect(validateWanImageUrl("https://dashscope-a717.oss-accelerate.aliyuncs.com/result.png?Signature=temporary").hostname).toBe("dashscope-a717.oss-accelerate.aliyuncs.com");
    expect(() => validateWanImageUrl("https://other.oss-accelerate.aliyuncs.com/result.png")).toThrow();
    expect(() => validateWanImageUrl("https://dashscope-a717.oss-accelerate.aliyuncs.com.evil.test/result.png")).toThrow();
  });
  it("提交一张带标识的图片，轮询原任务，下载时不携带密钥", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(reply({ output: { task_id: "task-1", task_status: "PENDING" } }))
      .mockResolvedValueOnce(reply({ output: { task_id: "task-1", task_status: "RUNNING" } }))
      .mockResolvedValueOnce(reply({ output: { task_id: "task-1", task_status: "SUCCEEDED", choices: [{ message: { content: [{ image: resultUrl }] } }] } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    const provider = wanProvider("https://dashscope.aliyuncs.com", "private-test-key", transport, 1);
    const signal = AbortSignal.timeout(3000);
    const task = await provider.submit(input, signal);
    expect(await provider.result(task, signal)).toEqual(Buffer.from([1, 2, 3]));
    expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toMatchObject({ model: "wan2.6-t2i", parameters: { n: 1, watermark: true, prompt_extend: false, size: "1280*1280" } });
    expect(transport.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { Authorization: "Bearer private-test-key", "X-DashScope-Async": "enable" } });
    expect(transport.mock.calls[3][1]).not.toHaveProperty("headers");
    expect(transport.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
  it.each(["http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a", "https://127.0.0.1/a", "https://dashscope-result-bj.oss-cn-beijing.aliyuncs.com.evil.test/a", "https://user:secret@dashscope-result-bj.oss-cn-beijing.aliyuncs.com/a", "https://other.oss-cn-beijing.aliyuncs.com/a"])("拒绝不受信任的下载来源 %s", (url) => {
    expect(() => validateWanImageUrl(url)).toThrow();
  });
  it("拒绝超大响应和任务编号不匹配，失败只返回安全错误", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("secret-provider-body", { status: 403 }))
      .mockResolvedValueOnce(reply({ output: { task_id: "other-task", task_status: "RUNNING" } }));
    const provider = wanProvider("https://dashscope.aliyuncs.com", "private-test-key", transport, 1);
    await expect(provider.submit(input, AbortSignal.timeout(1000))).rejects.toThrow("凭证或模型权限");
    await expect(provider.result("task-1", AbortSignal.timeout(1000))).rejects.toThrow("编号不一致");
    transport.mockResolvedValueOnce(new Response("x", { headers: { "Content-Length": "9999999" } }));
    await expect(provider.submit(input, AbortSignal.timeout(1000))).rejects.toThrow("过大");
  });
  it("终止失败任务，不重复创建；拒绝下载重定向", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(reply({ output: { task_id: "task-1", task_status: "FAILED" } }));
    const provider = wanProvider("https://dashscope.aliyuncs.com", "key", transport, 1);
    await expect(provider.result("task-1", AbortSignal.timeout(1000))).rejects.toBeInstanceOf(ImageTaskFailed);
    transport.mockResolvedValueOnce(reply({ output: { task_id: "task-1", task_status: "SUCCEEDED", choices: [{ message: { content: [{ image: resultUrl }] } }] } }))
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/" } }));
    await expect(provider.result("task-1", AbortSignal.timeout(1000))).rejects.toThrow("下载未完成");
    expect(transport.mock.calls.at(-1)?.[1]?.redirect).toBe("error");
  });
});
