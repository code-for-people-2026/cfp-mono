import { afterEach, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({ setClipboardData: vi.fn() }));
vi.mock("@tarojs/taro", () => ({ default: platform }));
afterEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("网页将完整文字写入浏览器剪贴板，权限失败不得报告成功", async () => {
  vi.stubEnv("TARO_ENV", "h5");
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const { copy } = await import("../src/chat/api");
  await copy("第一行\n第二行：0");
  expect(writeText).toHaveBeenCalledWith("第一行\n第二行：0");
  expect(platform.setClipboardData).not.toHaveBeenCalled();
  writeText.mockRejectedValueOnce(new Error("permission denied"));
  await expect(copy("再次复制")).rejects.toThrow("permission denied");
});

it("旧浏览器复制失败必须拒绝，并清理临时输入框及恢复焦点", async () => {
  vi.stubEnv("TARO_ENV", "h5");
  vi.stubGlobal("navigator", {});
  class Element {
    focus = vi.fn();
  }
  const previous = new Element();
  const field = {
    value: "",
    readOnly: false,
    style: {},
    select: vi.fn(),
    setSelectionRange: vi.fn(),
    remove: vi.fn(),
  };
  const execCommand = vi.fn().mockReturnValue(false);
  vi.stubGlobal("HTMLElement", Element);
  vi.stubGlobal("document", {
    activeElement: previous,
    createElement: () => field,
    body: { appendChild: vi.fn() },
    execCommand,
  });
  const { copy } = await import("../src/chat/api");
  await expect(copy("一段原文")).rejects.toThrow("复制失败");
  expect(field.remove).toHaveBeenCalledOnce();
  expect(previous.focus).toHaveBeenCalledOnce();
  execCommand.mockReturnValue(true);
  await expect(copy("第一行\n第二行")).resolves.toBeUndefined();
  expect(field.value).toBe("第一行\n第二行");
});
