import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mintCredential } from "./auth";
import type { Payload } from "payload";

const state = vi.hoisted(() => ({
  credential: "miniapp", rowMode: "platform",
  find: vi.fn(), cms: vi.fn(), generate: vi.fn(), resume: vi.fn(), compact: vi.fn(),
  revoke: vi.fn(), consent: vi.fn(),
}));
vi.mock("../cms/client", () => ({ cms: state.cms }));
vi.mock("../cms/repository", () => ({ Repository: class {} }));
vi.mock("../domain/greetings", () => ({ GreetingService: class {
  repo = { get: async () => ({ id: 1, sessionId: 1, mode: state.rowMode, input: { text: "测试", mediaIds: [] } }) };
  generateGreeting = state.generate;
  resumeImage = state.resume;
} }));
vi.mock("../domain/context", () => ({ ContextService: class { compactPreview = state.compact; compact = state.compact; } }));
vi.mock("../age/service", () => ({ AgeService: class {
  requireCapability = async () => {}; requireLogin = async () => {};
} }));
vi.mock("../privacy/service", () => ({ privacyService: () => ({
  require: async () => {}, requireInput: async () => {}, consent: state.consent,
}), withRecoveredOwner: vi.fn() }));
const request = (path: string, body: unknown = {}, method = "POST") => new Request(`http://localhost/api/hello/${path}`, {
  method, headers: { Authorization: "Bearer test-device-credential", "Content-Type": "application/json" },
  ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
});
const context = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
beforeEach(() => {
  state.credential = "miniapp"; state.rowMode = "platform";
  // Authentication is rechecked in the lease; all reads in a request refer to the same owner.
  const owner = crypto.randomUUID();
  state.find.mockImplementation(async () => ({ docs: [{ kind: state.credential, owner, wechatKey: "test-wechat" }] }));
  state.cms.mockResolvedValue({ find: state.find, delete: state.revoke });
  state.revoke.mockResolvedValue({ errors: [] });
  state.generate.mockResolvedValue({ id: 1, mode: "platform", status: "completed", greeting: "测试回应", artifacts: [] });
  state.resume.mockResolvedValue({ id: 1, status: "completed", greeting: "测试回应", artifacts: [] });
  state.compact.mockResolvedValue({ revision: 1 });
});
afterEach(() => vi.clearAllMocks());

it.each(["greet", "context/compact", "context/preview-compact", "image-resume"])("旧客户端不能从 %s 提交自带密钥", async (path) => {
  const { POST } = await import("../app/api/hello/[...path]/route");
  for (const body of [{ mode: "byok", apiKey: "test-private-key" }, { mode: "platform", apiKey: "test-private-key" }, { mode: "external" }]) {
    const result = await POST(request(path, body), context(path));
    expect(result.status).toBe(403);
    expect(await result.text()).not.toContain("test-private-key");
  }
  expect(state.generate).not.toHaveBeenCalled(); expect(state.resume).not.toHaveBeenCalled(); expect(state.compact).not.toHaveBeenCalled();
});
it.each(["byok", "external"])("继续取图不能恢复旧 %s 轮次", async (mode) => {
  state.rowMode = mode;
  const { POST } = await import("../app/api/hello/[...path]/route");
  const result = await POST(request("image-resume", { turnId: 1, requestId: crypto.randomUUID() }), context("image-resume"));
  expect(result.status).toBe(403); expect(state.resume).not.toHaveBeenCalled();
});
it.each(["greet", "image-resume", "context/preview-compact"])("平台请求仍可通过 %s，测试使用替身、不调用供应商", async (path) => {
  const { POST } = await import("../app/api/hello/[...path]/route");
  const body = { mode: "platform", sessionId: 1, requestId: crypto.randomUUID(), input: { text: "测试", mediaIds: [] }, revision: 0 };
  const result = await POST(request(path, path === "image-resume" ? { turnId: 1, requestId: body.requestId } : body), context(path));
  expect(result.status).toBe(200); await result.text();
  expect(path === "greet" ? state.generate : path === "image-resume" ? state.resume : state.compact).toHaveBeenCalledOnce();
});
it.each(["sessions", "privacy/export", "context/1", "media/1"])("已签发的外部令牌不能读取 %s", async (path) => {
  state.credential = "bearer";
  const { GET } = await import("../app/api/hello/[...path]/route");
  expect((await GET(request(path, {}, "GET"), context(path))).status).toBe(403);
});
it("关闭外部令牌签发，保留本人撤销旧令牌", async () => {
  const { POST } = await import("../app/api/hello/[...path]/route");
  expect((await POST(request("token"), context("token"))).status).toBe(403);
  expect(state.cms).not.toHaveBeenCalled();
  expect((await POST(request("token/revoke"), context("token/revoke"))).status).toBe(200);
  expect(state.revoke).toHaveBeenCalledOnce();
  await expect(mintCredential({} as Payload, "bearer")).rejects.toMatchObject({ status: 403 });
});
it("不能通过旧授权页面重新开启外部授权", async () => {
  const { POST } = await import("../app/api/hello/[...path]/route");
  expect((await POST(request("privacy/consent", { external: true }), context("privacy/consent"))).status).toBe(403);
  expect(state.consent).not.toHaveBeenCalled();
});
it("MCP 所有公开方法关闭，不能触达数据库或模型", async () => {
  const route = await import("../app/api/mcp/route");
  for (const call of [route.POST, route.GET, route.DELETE]) expect(call().status).toBe(403);
  expect(state.cms).not.toHaveBeenCalled(); expect(state.generate).not.toHaveBeenCalled();
});
