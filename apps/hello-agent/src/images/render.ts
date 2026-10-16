import sharp from "sharp";
import { aiMetadata, escapeHtml } from "../labeling/metadata";
import { uploadedAiXmp } from "../labeling/upload-provenance";
import { MAX_STORED_IMAGE_BYTES } from "../domain/media-policy";
import { AppError } from "../domain/contracts";

export async function generatedJpeg(bytes: Buffer, contentId: string) {
  try {
    const source = await uploadedAiXmp(bytes);
    const metadata = await sharp(bytes, { limitInputPixels: 20_000_000 }).metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format || "")) throw new Error("invalid format");
    const label = aiMetadata(contentId);
    // Preserve valid supplier provenance when present; otherwise record our generated artifact.
    const xmp = source || `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:aj="https://codeforpeople.cn/ns/aigc/1.0/"><aj:AIGC>${escapeHtml(JSON.stringify(label))}</aj:AIGC></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const pixels = await sharp(bytes, { limitInputPixels: 20_000_000 }).rotate().resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).flatten({ background: "white" }).png().toBuffer();
    const { width, height } = await sharp(pixels).metadata();
    if (!width || !height) throw new Error("missing size");
    const footer = Buffer.from(`<svg width="${width}" height="48"><rect width="100%" height="48" fill="white"/><text x="${width - 16}" y="34" text-anchor="end" font-family="sans-serif" font-size="24" fill="#111">AI 生成</text></svg>`);
    for (const quality of [90, 80, 65]) {
      const output = await sharp(pixels).extend({ bottom: 48, background: "white" }).composite([{ input: footer, top: height, left: 0 }]).withXmp(xmp).jpeg({ quality }).toBuffer();
      if (output.length <= MAX_STORED_IMAGE_BYTES) return output;
    }
    throw new AppError(413, "生成图片超过保存上限，请选择更简单的画面后重试");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, "生成图片格式无效，未保存或展示");
  }
}
