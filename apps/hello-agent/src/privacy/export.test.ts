import type { Payload } from "payload";
import { expect, it, vi } from "vitest";
import { Repository } from "../cms/repository";
import { PrivacyService } from "./service";
import { AppError } from "../domain/contracts";

vi.mock("../operations/retention", () => ({ eraseOperationsEvidence: vi.fn() }));
function fixture(imageCount = 0, greetingCount = 0) {
  const find = vi.fn(async ({ collection, where }: { collection: string; where?: { and?: { id?: { greater_than: number } }[] } }) => {
    const cursor = where?.and?.find((item) => item.id)?.id?.greater_than || 0;
    if (collection === "media" && cursor < imageCount) return { docs: [{ id: cursor + 1, createdAt: "2026-10-13" }] };
    if (collection === "greetings" && cursor < greetingCount) return { docs: [{ id: cursor + 1, mode: "external", status: "completed", greeting: "合成回复", fingerprint: "test" }] };
    if (collection === "credentials" && cursor < 1) return { docs: [{ id: 1, kind: "cookie", expiresAt: "2030-01-01", createdAt: "2026-10-13", digest: "must-not-export" }] };
    if (collection === "safety-cases" && cursor < 1) return { docs: [{ id: 1, receipt: "test-receipt", status: "open", reply: "not-yet-published", feedbackAt: null }] };
    return { docs: [] };
  });
  const service = new PrivacyService(new Repository({ find } as unknown as Payload, { id: "test-owner", auth: "cookie" }));
  const read = vi.spyOn(service.media, "read").mockResolvedValue({ bytes: Buffer.alloc(2 * 1024 * 1024), mimeType: "image/jpeg" });
  return { service, find, read };
}
it("300 张图片在达到总量上限时停止，逐条查询而不是先收集所有图片", async () => {
  const { service, find, read } = fixture(300);
  await expect(service.exportData()).rejects.toMatchObject({ status: 413 });
  expect(read).toHaveBeenCalledTimes(3);
  for (const [options] of find.mock.calls) {
    expect(options).toMatchObject({ limit: 1 });
    expect(JSON.stringify(options.where)).toContain("test-owner");
    expect(options).not.toHaveProperty("pagination", false);
  }
});
it("小导出仍完整保留本人数据、来源与已发布反馈，不泄露凭证摘要", async () => {
  const { service, read } = fixture(1, 1);
  read.mockResolvedValue({ bytes: Buffer.from("test-pixels"), mimeType: "image/jpeg" });
  const result = await service.exportData();
  expect(result.records.greetings).toEqual([expect.objectContaining({ aiLabel: "AI 生成（外部客户端声明）" })]);
  expect(result.media[0].base64).toBe(Buffer.from("test-pixels").toString("base64"));
  expect(result.credentials).toHaveLength(1);
  expect(result.retainedSafetyRecords).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("must-not-export");
  expect(JSON.stringify(result)).not.toContain("not-yet-published");
});
it("大量小记录同样受数量上限保护，超限不会返回部分导出", async () => {
  const { service, find } = fixture(0, 5000);
  await expect(service.exportData()).rejects.toMatchObject({ status: 413 });
  expect(find.mock.calls.filter(([options]) => options.collection === "greetings")).toHaveLength(1001);
});
it("隔离图片只导出说明，其他存储错误不被误报为成功", async () => {
  const { service, read } = fixture(1);
  read.mockRejectedValue(new AppError(404, "withheld"));
  expect((await service.exportData()).media[0]).toMatchObject({ withheld: true });
  read.mockRejectedValue(new Error("storage unavailable"));
  await expect(service.exportData()).rejects.toThrow("storage unavailable");
});
