import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { illustrationPng } from "../src/domain/artifact-rendering";
import { imageSchema } from "@cfp/base-chat-protocol";

const root = process.argv[2];
if (!root) throw new Error("Usage: verify-regression-illustrations EVIDENCE_DIRECTORY");
globalThis.fetch = async () => { throw new Error("Offline evidence verification only"); };
const output = path.join(root, "系统插画核验");
await mkdir(output, { recursive: true });
const results: Record<string, unknown>[] = [];
for (const dir of await readdir(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  const folder = path.join(root, dir.name);
  const source = await readFile(path.join(folder, "results.jsonl"), "utf8").catch(() => "");
  if (!source) continue;
  const reviews = (await readFile(path.join(folder, "图片调用.jsonl"), "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  for (const line of source.trim().split("\n")) {
    const row = JSON.parse(line);
    for (const candidate of row.output?.artifacts || []) {
      if (candidate.kind !== "image" || candidate.source?.type !== "illustration") continue;
      const artifact = imageSchema.parse(candidate);
      const png = await illustrationPng(artifact);
      const reviewed = await sharp(png).flatten({ background: "white" }).jpeg({ quality: 85 }).toBuffer();
      const sha256 = createHash("sha256").update(reviewed).digest("hex");
      const receipt = reviews.find(r => r.caseId === row.id && r.service === "green-baselineCheck" && r.sha256 === sha256 && r.verdict.decision === "allow");
      if (!receipt) throw new Error(`Illustration differs from reviewed pixels: ${row.id}`);
      const filename = `${dir.name}-${String(row.id).replace(/[^a-zA-Z0-9_-]/g, "-")}-${artifact.id}.png`;
      await writeFile(path.join(output, filename), png);
      results.push({ caseId: row.id, batch: dir.name, artifactId: artifact.id, file: `系统插画核验/${filename}`, reviewedPixelSha256: sha256, sha256: createHash("sha256").update(png).digest("hex"), samePixelsAsOriginalGreenReview: true, usesWan: false, newPaidCalls: 0 });
    }
  }
}
await writeFile(path.join(output, "manifest.json"), JSON.stringify(results, null, 2));
console.log(JSON.stringify({ illustrations: results.length, newPaidCalls: 0 }));
