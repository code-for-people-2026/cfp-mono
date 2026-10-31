import { aiMetadata, labelPng } from "../labeling/metadata";
import sharp from "sharp";
import {
  artifactsSchema,
  identifier,
  imageSchema,
  pageSchema,
  type ImageArtifact,
  type PageArtifact,
} from "@cfp/base-chat-protocol";
import type { Repository } from "../cms/repository";
import { AppError } from "./contracts";

export async function readArtifact(
  repo: Repository,
  turnId: number,
  artifactId: string,
) {
  const row = await repo.get("greetings", turnId);
  if (row.status !== "completed") throw new AppError(404, "作品尚未完成");
  const id = identifier.parse(artifactId);
  const artifact = artifactsSchema
    .parse(row.artifacts ?? [])
    .find((item) => item.id === id);
  if (!artifact) throw new AppError(404, "作品不存在");
  return artifact;
}
function escapeMarkup(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
export async function illustrationPng(value: ImageArtifact, contentId?: string, external = false) {
  const artifact = imageSchema.parse(value);
  if (artifact.source.type !== "illustration")
    throw new AppError(400, "这件作品不是插画");
  const shapes = artifact.source.shapes
    .map((shape) => {
      switch (shape.type) {
        case "circle":
          return `<circle cx="${shape.x}" cy="${shape.y}" r="${shape.radius}" fill="${shape.fill}"/>`;
        case "rect":
          return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${shape.fill}"/>`;
        case "line":
          return `<line x1="${shape.x}" y1="${shape.y}" x2="${shape.x2}" y2="${shape.y2}" stroke="${shape.stroke}" stroke-width="${shape.width}"/>`;
        case "text":
          return `<text x="${shape.x}" y="${shape.y}" fill="${shape.fill}" font-size="${shape.size}" font-family="sans-serif">${escapeMarkup(shape.text)}</text>`;
      }
    })
    .join("");
  const visibleLabel = external ? "AI 生成（外部客户端声明）" : "AI 生成";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="448" viewBox="0 0 640 448"><rect width="640" height="400" fill="${artifact.source.background}"/>${shapes}<rect x="0" y="400" width="640" height="48" fill="#fff"/><text x="620" y="435" text-anchor="end" fill="#111" font-size="32" font-weight="bold" font-family="sans-serif">${visibleLabel}</text></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  return labelPng(bytes, aiMetadata(contentId || JSON.stringify(artifact), external));
}
export function pageHtml(value: PageArtifact, contentId?: string, external = false) {
  const page = pageSchema.parse(value);
  const e = escapeMarkup;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="AIGC" content="${e(JSON.stringify(aiMetadata(contentId || JSON.stringify(page), external)))}"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(page.title)} · 阿 J 先生</title><style>body{margin:0;background:#f5f4ed;color:#243b35;font:17px/1.9 system-ui,sans-serif}main{max-width:760px;margin:48px auto;padding:32px}header{border-bottom:1px solid #ccd5ca;padding-bottom:28px}h1{font-size:36px;line-height:1.35}h2{font-size:23px}p{white-space:pre-wrap;overflow-wrap:anywhere}section{padding:20px 0}small{color:#6b7e71}li{margin:8px 0}@media(max-width:600px){main{margin:0;padding:24px}h1{font-size:28px}}</style></head><body><main><header><small>阿 J 先生 · AI 生成${external ? "（外部来源声明）" : ""}</small><h1>${e(page.title)}</h1>${page.subtitle ? `<p>${e(page.subtitle)}</p>` : ""}</header>${page.sections.map((section) => `<section><h2>${e(section.heading)}</h2><p>${e(section.body)}</p>${section.items ? `<ul>${section.items.map((item) => `<li>${e(item)}</li>`).join("")}</ul>` : ""}</section>`).join("")}<footer><small>AI 生成 · 根据这次对话整理 · 请保留生成标识</small></footer></main></body></html>`;
}
