import { beforeEach, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ request: vi.fn(), clipboard: vi.fn(), get: vi.fn(), set: vi.fn(), remove: vi.fn(), unlink: vi.fn() }));
vi.mock("@tarojs/taro", () => ({ default: { request: calls.request, setClipboardData: calls.clipboard, getStorageSync: calls.get, setStorageSync: calls.set, removeStorageSync: calls.remove, getFileSystemManager: () => ({ unlink: calls.unlink }) } }));
beforeEach(() => { vi.resetModules(); Object.values(calls).forEach((fn) => fn.mockReset()); vi.stubEnv("TARO_ENV", "weapp"); vi.stubGlobal("HELLO_API_ORIGIN", "http://127.0.0.1:3337"); });
it("AI回应复制带标识，恢复码/连接信息复制不被误标", async () => {
  const api = await import("../src/chat/api");
  await api.copyAiReply("一段生成回应");
  expect(calls.clipboard).toHaveBeenLastCalledWith({ data: "AI 生成 · 阿 J 先生\n一段生成回应" });
  await api.copy("test-recovery-code");
  expect(calls.clipboard).toHaveBeenLastCalledWith({ data: "test-recovery-code" });
});
it("删除失败保留身份以便重试，成功才清除本地凭证", async () => {
  calls.get.mockReturnValue("isolated-token");
  const api = await import("../src/chat/api");
  await api.establishIdentity();
  calls.request.mockResolvedValueOnce({ statusCode: 503, data: { error: "OSS 暂不可用" } });
  await expect(api.deletePersonalData("删除我的全部在线数据")).rejects.toThrow("OSS");
  expect(calls.remove).not.toHaveBeenCalled();
  calls.request.mockResolvedValueOnce({ statusCode: 200, data: { deleted: true, backupNotice: "备份单独处理" } });
  await api.deletePersonalData("删除我的全部在线数据");
  expect(calls.remove).toHaveBeenCalledWith("hello-miniapp-identity:http://127.0.0.1:3337");
  expect(calls.request.mock.calls[0][0].header.Authorization).toBe("Bearer isolated-token");
});

it("退出清理已登记下载缓存，不触碰用户原相册", async () => {
  calls.get.mockImplementation((key: string) => key.startsWith("hello-private-files:") ? ["wxfile://tmp/export.json", "wxfile://tmp/private.jpg"] : "isolated-token");
  calls.unlink.mockImplementation((args: { complete: () => void }) => args.complete());
  calls.request.mockResolvedValue({ statusCode: 200, data: { loggedOut: true } });
  const api = await import("../src/chat/api");
  await api.establishIdentity();
  await api.logoutIdentity();
  expect(calls.unlink.mock.calls.map(([arg]) => arg.filePath)).toEqual(["wxfile://tmp/export.json", "wxfile://tmp/private.jpg"]);
  expect(calls.remove).toHaveBeenCalledWith("hello-private-files:http://127.0.0.1:3337");
});
