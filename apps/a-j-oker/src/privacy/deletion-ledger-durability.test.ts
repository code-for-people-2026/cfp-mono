import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { writeDeletionLedger } from "./deletion-ledger";

const state = vi.hoisted(() => ({ events: [] as string[], failedDirectory: "" }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined), // Also exercise a concurrent mkdir result.
  open: vi.fn(async (file: string) => ({
    writeFile: async () => { state.events.push(`write:${file}`); },
    sync: async () => { state.events.push(`sync:${file}`); if (file === state.failedDirectory) throw new Error("directory sync failed"); },
    close: async () => { state.events.push(`close:${file}`); },
  })),
}));
beforeEach(() => { state.events = []; state.failedDirectory = ""; vi.stubEnv("HELLO_PRIVACY_DELETION_LEDGER", "/ledger/new/nested/deletions.ndjson"); });
afterEach(() => vi.unstubAllEnvs());
it("文件同步后依次同步所有父目录，再允许调用方继续删除", async () => {
  await writeDeletionLedger("isolated");
  expect(state.events.filter((event) => event.startsWith("sync:"))).toEqual([
    "sync:/ledger/new/nested/deletions.ndjson", "sync:/ledger/new/nested", "sync:/ledger/new", "sync:/ledger", "sync:/",
  ]);
  expect(state.events.at(-1)).toBe("close:/");
});
it("目录同步失败时返回失败且关闭句柄，不能继续数据库删除", async () => {
  state.failedDirectory = "/ledger/new";
  await expect(writeDeletionLedger("isolated")).rejects.toThrow("directory sync failed");
  expect(state.events.at(-1)).toBe("close:/ledger/new");
});
