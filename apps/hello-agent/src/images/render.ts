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
    const fontSize = Math.max(1, Math.min(28, Math.round(Math.min(width, height) * 0.022)));
    const padding = Math.max(1, Math.round(fontSize * 0.8));
    // One in-image label, readable on light and dark pixels without adding a border.
    const watermark = Buffer.from(`<svg width="${width}" height="${height}"><text x="${width - padding}" y="${height - padding}" text-anchor="end" font-family="sans-serif" font-size="${fontSize}" fill="white" fill-opacity="0.9" stroke="black" stroke-opacity="0.6" stroke-width="${fontSize / 14}" stroke-linejoin="round" paint-order="stroke">阿J先生生成</text></svg>`);
    for (const quality of [90, 80, 65]) {
      const output = await sharp(pixels).composite([{ input: watermark, top: 0, left: 0 }]).withXmp(xmp).jpeg({ quality }).toBuffer();
      if (output.length <= MAX_STORED_IMAGE_BYTES) return output;
    }
    throw new AppError(413, "生成图片超过保存上限，请选择更简单的画面后重试");
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(502, "生成图片格式无效，未保存或展示");
  }
}
