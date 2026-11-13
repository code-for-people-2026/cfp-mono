import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";

// Updates are reviewed changes to this pinned revision and the expected hashes.
const commit = "fe6fc2921836217b8c90619db81b24af8b22d80f";
const source = "https://github.com/houbb/sensitive-word-data";
const base = `https://raw.githubusercontent.com/houbb/sensitive-word-data/${commit}/`;
const files = [
  ["src/main/resources/sensitive_word_dict.txt", "78ae99be25f542d0bd1e950a32ca1dec620b2ac91046c9c785f46244d29db85f"],
  ["LICENSE.txt", "68f716036e0a24f3b23f6fc0c6342db0ef936fb397ad077cc1b6e9e9ba31da26"],
];
const contents = await Promise.all(files.map(async ([path, sha256]) => {
  const response = await fetch(base + path, { redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Cannot download ${path}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error(`Checksum mismatch: ${path}`);
  return bytes.toString("utf8");
}));
const rawWords = contents[0].split(/\r?\n/).map((word) => word.trim()).filter(Boolean);
const initial = [...new Set(rawWords.map((word) => word.normalize("NFKC").toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, "")))]
  .filter((word) => [...word].length >= 2 && [...word].length <= 120).sort();
// Preserve the reviewed clean-v2 sequence and its evidence row identifiers:
// control-character cleanup was applied after the original normalized sort.
const words = [...new Set(initial.map((word) => word.replace(/[\u0000-\u001f\u007f-\u009f]/gu, "").trim()))]
  .filter((word) => [...word].length >= 2 && [...word].length <= 120);
if (words.length < 50_000) throw new Error("Unexpected lexicon size; inspect before updating");
const output = new URL("../src/moderation/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("lexicon.json", output), JSON.stringify({
  version: `houbb-${commit.slice(0, 12)}-clean-v2`,
  source, commit, license: "Apache-2.0", sourcePath: files[0][0], sourceSha256: files[0][1],
  rawCount: rawWords.length, count: words.length,
  modifications: "NFKC/lowercase; remove control and invisible format characters; trim; deduplicate; retain 2–120 code points. Keywords trigger contextual review, not automatic blocking. No official endorsement or GB/T category equivalence claimed.",
  words,
}, null, 2) + "\n");
await writeFile(new URL("LICENSE.houbb.txt", output), contents[1]);
console.log(`Verified ${rawWords.length} source entries; bundled ${words.length} normalized keywords.`);
