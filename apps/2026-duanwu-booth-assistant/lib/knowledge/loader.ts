import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { z } from "zod";

const metadataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  visibility: z.literal("public"),
  status: z.literal("approved"),
  kind: z.enum(["topic", "source"]).default("topic"),
  sources: z.array(z.string()).default([]),
  source_path: z.string().min(1).optional(),
  tags: z.array(z.string()).default([]),
});

export type KnowledgeDocument = Omit<z.infer<typeof metadataSchema>, "source_path"> & {
  sourcePath?: string;
  content: string;
  filePath: string;
};

export type KnowledgeChunk = {
  id: string;
  sourceId: string;
  title: string;
  kind: "topic" | "source";
  sources: string[];
  sourcePath?: string;
  tags: string[];
  text: string;
  filePath: string;
};

const defaultPublicRoot = path.join(process.cwd(), "knowledge/public");
const defaultSourceRoot = path.join(process.cwd(), "knowledge/sources");
const defaultKnowledgeRoots = [defaultPublicRoot, defaultSourceRoot];

async function listMarkdownFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(fullPath);
      if (entry.isFile() && entry.name.endsWith(".md")) return [fullPath];
      return [];
    }),
  );

  return files.flat().sort();
}

export async function loadKnowledgeBase(rootDir: string | string[] = defaultPublicRoot) {
  const rootDirs = Array.isArray(rootDir) ? rootDir : [rootDir];
  const files = (await Promise.all(rootDirs.map((dir) => listMarkdownFiles(dir)))).flat().sort();
  const documents: KnowledgeDocument[] = [];

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = matter(raw);
    const metadata = metadataSchema.safeParse(parsed.data);

    if (!metadata.success) continue;

    documents.push({
      id: metadata.data.id,
      title: metadata.data.title,
      visibility: metadata.data.visibility,
      status: metadata.data.status,
      kind: metadata.data.kind,
      tags: metadata.data.tags,
      sources: metadata.data.sources.length
        ? metadata.data.sources
        : metadata.data.source_path
          ? [metadata.data.source_path]
          : [],
      sourcePath: metadata.data.source_path,
      content: parsed.content.trim(),
      filePath,
    });
  }

  return documents;
}

export function splitIntoChunks(document: KnowledgeDocument): KnowledgeChunk[] {
  const blocks = document.content
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((text) => ({
      isHeading: /^#{1,6}\s+/.test(text),
      text: text.replace(/^#{1,6}\s+/, "").trim(),
    }))
    .filter((block) => Boolean(block.text));

  const sections: string[] = [];
  let currentHeading = "";

  for (const block of blocks) {
    if (block.isHeading) {
      currentHeading = block.text;
      continue;
    }

    sections.push(currentHeading ? `${currentHeading}\n\n${block.text}` : block.text);
  }

  return sections
    .map((text, index) => ({
      id: `${document.id}#${index}`,
      sourceId: document.id,
      title: document.title,
      kind: document.kind,
      sources: document.sources,
      sourcePath: document.sourcePath,
      tags: document.tags,
      text,
      filePath: document.filePath,
    }));
}

export async function loadKnowledgeChunks(rootDir: string | string[] = defaultKnowledgeRoots) {
  const documents = await loadKnowledgeBase(rootDir);
  return documents.flatMap(splitIntoChunks);
}
