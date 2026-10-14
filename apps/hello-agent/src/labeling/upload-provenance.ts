import { inflateSync } from "node:zlib";
import sharp from "sharp";
import { z } from "zod";
import { AppError } from "../domain/contracts";
import { escapeHtml } from "./metadata";

const value = z.string().max(2048);
const schema = z.object({ AIGC: z.object({ Label: z.enum(["1", "2", "3"]), ContentProducer: value, ProduceID: value, ReservedCode1: value, ContentPropagator: value, PropagateID: value, ReservedCode2: value }).strict() }).strict();
const invalid = () => new AppError(400, "这张图片的 AI 来源标识无法完整保留，请使用原始有效文件；不会去除标识后上传");
const MAX_PNG_TEXT_BYTES = 64 * 1024;
const MAX_LABEL_BYTES = 16 * 1024;
function pngLabels(bytes: Buffer) {
  const texts: string[] = [];
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return texts;
  const chunks: { type: string; data: Buffer; end: number; isLabel: boolean }[] = [];
  let offset = 8, encodedBytes = 0, labels = 0;
  // Preflight the entire PNG before any inflate: duplicates and total encoded
  // text (including framing) are bounded independently of compressed size.
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) throw invalid();
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (["iTXt", "tEXt", "zTXt"].includes(type)) {
      encodedBytes += length + 12;
      if (encodedBytes > MAX_PNG_TEXT_BYTES) throw invalid();
      const end = data.indexOf(0);
      if (end < 1 || end > 79) throw invalid();
      const isLabel = data.subarray(0, end).toString().includes("AIGC");
      if (isLabel && ++labels > 1) throw invalid();
      chunks.push({ type, data, end, isLabel });
    }
    offset += length + 12;
  }
  let decodedBytes = 0;
  for (const { type, data, end, isLabel } of chunks) {
    try {
      let content = data.subarray(end + 1);
      let compressed = false;
      if (type === "zTXt") {
        if (content[0] !== 0) throw invalid();
        compressed = true; content = content.subarray(1);
      }
      if (type === "iTXt") {
        if (![0, 1].includes(content[0]) || content[1] !== 0) throw invalid();
        compressed = content[0] === 1; content = content.subarray(2);
        for (let field = 0; field < 2; field++) {
          const next = content.indexOf(0);
          if (next < 0) throw invalid();
          // Language and translated keyword also count toward the total.
          decodedBytes += next + 1; content = content.subarray(next + 1);
        }
      }
      const remaining = Math.min(MAX_PNG_TEXT_BYTES - decodedBytes, isLabel ? MAX_LABEL_BYTES : MAX_PNG_TEXT_BYTES);
      if (remaining <= 0) throw invalid();
      if (compressed) content = inflateSync(content, { maxOutputLength: remaining });
      if (content.length > remaining) throw invalid();
      decodedBytes += content.length;
      if (isLabel) texts.push(content.toString("utf8"));
    } catch { throw invalid(); }
  }
  return texts;
}
export async function uploadedAiXmp(bytes: Uint8Array) {
  const buffer = Buffer.from(bytes);
  const texts = pngLabels(buffer);
  const metadata = await sharp(buffer, { limitInputPixels: 20_000_000 }).metadata();
  if (metadata.xmp && metadata.xmp.length > MAX_PNG_TEXT_BYTES) throw invalid();
  const xmp = metadata.xmp?.toString("utf8");
  if (xmp?.includes("AIGC")) {
    const decoded = xmp.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    const matches = decoded.match(/\{\s*"AIGC"\s*:\s*\{[^{}]+\}\s*\}/g);
    if (!matches?.length) throw invalid();
    texts.push(...matches);
  }
  if (!texts.length) return undefined;
  if (texts.length !== 1) throw invalid();
  let label: z.infer<typeof schema>;
  try { label = schema.parse(JSON.parse(texts[0])); } catch { throw invalid(); }
  // Keep only AI provenance, never user EXIF/GPS or unrelated XMP properties.
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:aj="https://codeforpeople.cn/ns/aigc/1.0/"><aj:AIGC>${escapeHtml(JSON.stringify(label))}</aj:AIGC></rdf:Description></rdf:RDF></x:xmpmeta>`;
}
