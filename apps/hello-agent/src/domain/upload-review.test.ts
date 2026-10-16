import type { Payload } from "payload";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { Repository } from "../cms/repository";
import { GreetingService } from "./greetings";
import { MediaService } from "./media";

// Isolate storage/audit effects; real transactions and evidence are verified by operations-check.
vi.mock("../operations/enforcement", () => ({ assertGenerationAllowed: vi.fn() }));
vi.mock("../operations/audit", () => ({ audit: vi.fn() }));
vi.mock("../operations/service", () => ({ transaction: (_payload: unknown, action: (req: object) => unknown) => action({}), OperationsService: class { createCase() {} } }));
const repo = new Repository({} as Payload, { id: "isolated", auth: "cookie" });
const media = new MediaService(repo);
const save = vi.spyOn(media, "save").mockResolvedValue({ id: 1, owner: "isolated", mimeType: "image/jpeg", createdAt: "2026-10-13", updatedAt: "2026-10-13" });
vi.spyOn(repo, "update").mockResolvedValue({ id: 1, owner: "isolated", mimeType: "image/jpeg", createdAt: "2026-10-13", updatedAt: "2026-10-13" });
const photo = () => sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
afterEach(() => { save.mockClear(); vi.unstubAllEnvs(); });
it("只配置审核地址不能开启上传，没有实际审核器时不存储", async () => {
  vi.stubEnv("HELLO_IMAGE_REVIEW_URL", "https://review.example.invalid");
  await expect(new GreetingService(repo, undefined, media).upload(await photo())).rejects.toMatchObject({ status: 503 });
  expect(save).not.toHaveBeenCalled();
});
it("审核拒绝或服务出错均不保存图片", async () => {
  const review = vi.fn<NonNullable<ConstructorParameters<typeof GreetingService>[3]>>().mockResolvedValue("reject");
  const service = new GreetingService(repo, undefined, media, review);
  await expect(service.upload(await photo())).rejects.toMatchObject({ status: 422 });
  review.mockRejectedValue(new Error("review offline"));
  await expect(service.upload(await photo())).rejects.toMatchObject({ status: 503 });
  expect(save).not.toHaveBeenCalled();
});
it("明确通过审核后才保存同一份标准化图片", async () => {
  const review = vi.fn<NonNullable<ConstructorParameters<typeof GreetingService>[3]>>().mockImplementation(async (bytes) => {
    expect(save).not.toHaveBeenCalled();
    expect(await sharp(bytes).metadata()).toMatchObject({ format: "jpeg" });
    return "allow";
  });
  const service = new GreetingService(repo, undefined, media, review);
  await expect(service.upload(await photo())).resolves.toMatchObject({ id: 1 });
  expect(save).toHaveBeenCalledExactlyOnceWith(review.mock.calls[0][0]);
});
