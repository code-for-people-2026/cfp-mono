import { createHash } from "node:crypto";
import { COMPANY } from "../privacy/policy";

export function aiMetadata(contentId: string, external = false) {
  const id = createHash("sha256").update(contentId).digest("hex");
  return { AIGC: { Label: external ? "2" : "1", ContentProducer: COMPANY, ProduceID: id, ReservedCode1: external ? "external-client-declared;platform-rendered" : "", ContentPropagator: COMPANY, PropagateID: id, ReservedCode2: "" } };
}
export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}
function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
// PNG iTXt supports UTF-8 names; insert one uncompressed AIGC field after IHDR.
// Rendering always creates a new PNG, so there are no conflicting old labels.
export function labelPng(png: Buffer, metadata: ReturnType<typeof aiMetadata>) {
  if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("Not a PNG");
  const data = Buffer.concat([Buffer.from("AIGC\0\0\0\0\0"), Buffer.from(JSON.stringify(metadata), "utf8")]);
  const type = Buffer.from("iTXt");
  const chunk = Buffer.alloc(data.length + 12);
  chunk.writeUInt32BE(data.length, 0); type.copy(chunk, 4); data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
  return Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
}
