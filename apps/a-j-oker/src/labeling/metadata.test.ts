import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { illustrationPng, pageHtml } from "../domain/artifact-rendering";
import { artifacts } from "../../../../packages/a-j-oker-protocol/test/fixtures";
import { aiMetadata } from "./metadata";

describe("下载作品的标识", () => {
  it("PNG有唯一 UTF-8 AIGC 元数据和不可被模型图层覆盖的可见底栏", async () => {
    const artifact = artifacts.find((item) => item.kind === "image")!;
    if (artifact.kind !== "image") throw new Error("fixture");
    const png = await illustrationPng(artifact, "isolated/turn-123/sun");
    const labels = [];
    let offset = 8;
    while (offset < png.length) {
      const size = png.readUInt32BE(offset); const type = png.toString("ascii", offset + 4, offset + 8);
      const bytes = png.subarray(offset + 8, offset + 8 + size);
      if (type === "iTXt" && bytes.subarray(0, 5).toString() === "AIGC\0") labels.push(JSON.parse(bytes.subarray(9).toString("utf8")));
      offset += size + 12;
    }
    expect(labels).toEqual([aiMetadata("isolated/turn-123/sun")]);
    expect(labels[0].AIGC.Label).toBe("1");
    expect(Object.values(labels[0].AIGC).every((value) => typeof value === "string")).toBe(true);
    const decoded = await sharp(png).extract({ left: 480, top: 402, width: 160, height: 46 }).removeAlpha().raw().toBuffer();
    expect([...decoded].some((pixel) => pixel < 50)).toBe(true);
    expect([...decoded].filter((pixel) => pixel === 255).length).toBeGreaterThan(1000);
  });
  it("HTML正文及head同时有标识，编号稳定，外部声明用可能生成属性", () => {
    const page = artifacts.find((item) => item.kind === "page")!;
    if (page.kind !== "page") throw new Error("fixture");
    const html = pageHtml(page, "isolated/page", true);
    expect(html).toContain('name="AIGC"');
    expect(html).toContain("AI 生成（外部来源声明）");
    expect(html).toContain("&quot;Label&quot;:&quot;2&quot;");
    expect(aiMetadata("one")).not.toEqual(aiMetadata("two"));
    expect(aiMetadata("one")).toEqual(aiMetadata("one"));
  });
});

it("上传图片重新编码保留已有来源标识，普通原图不被标成平台生成", async () => {
  const { uploadedAiXmp } = await import("./upload-provenance");
  const source = artifacts.find((item) => item.kind === "image")!;
  if (source.kind !== "image") throw new Error("fixture");
  const generated = await illustrationPng(source, "original-producer-image");
  const provenance = await uploadedAiXmp(generated);
  expect(provenance).toContain("AIGC");
  const normalized = await sharp(generated).jpeg().withXmp(provenance!).toBuffer();
  expect(await uploadedAiXmp(normalized)).toEqual(provenance);
  const metadata = await sharp(normalized).metadata();
  expect(metadata.exif).toBeUndefined();
  expect(await uploadedAiXmp(await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } }).jpeg().toBuffer())).toBeUndefined();
});

it("上传含损坏AI标识的文件不会去掉标识后悄悄保存", async () => {
  const { uploadedAiXmp } = await import("./upload-provenance");
  const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#fff" } }).withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/">AIGC invalid</x:xmpmeta>').jpeg().toBuffer();
  await expect(uploadedAiXmp(jpeg)).rejects.toThrow("来源标识无法完整保留");
});

it("外部插画下载后，来源声明同时保留在可见底栏和元数据中", async () => {
  const artifact = artifacts.find((item) => item.kind === "image")!;
  if (artifact.kind !== "image") throw new Error("fixture");
  const platform = await illustrationPng(artifact, "same-illustration");
  const external = await illustrationPng(artifact, "same-illustration", true);
  const canvas = (bytes: Buffer) => sharp(bytes).extract({ left: 0, top: 0, width: 640, height: 400 }).raw().toBuffer();
  expect((await canvas(external)).equals(await canvas(platform))).toBe(true);
  const sourceStrip = (bytes: Buffer) => sharp(bytes).extract({ left: 160, top: 402, width: 320, height: 46 }).removeAlpha().raw().toBuffer();
  expect([...(await sourceStrip(platform))].every((pixel) => pixel === 255)).toBe(true);
  expect([...(await sourceStrip(external))].filter((pixel) => pixel < 50).length).toBeGreaterThan(100);
  const { uploadedAiXmp } = await import("./upload-provenance");
  expect(await uploadedAiXmp(external)).toContain("external-client-declared;platform-rendered");
});
