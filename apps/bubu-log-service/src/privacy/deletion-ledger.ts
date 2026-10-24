import { createHash } from "node:crypto";
import { constants, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const entrySchema = z.object({ version: z.literal(1), jobId: z.string().uuid(), kind: z.enum(["account", "family"]), identityId: z.string().min(1).max(200), babyId: z.string().min(1).max(200).optional(), identityIds: z.array(z.string().min(1).max(200)).max(1000).optional(), createdAt: z.string().datetime() }).strict().refine(entry => (entry.kind === "family") === !!entry.babyId && (!entry.identityIds || entry.kind === "account" && entry.identityIds.includes(entry.identityId)), "Invalid deletion scope");
export type DeletionEntry = z.infer<typeof entrySchema>;
/** Independent of database snapshots. Append is durable before any destructive step. */
export class DeletionLedger {
  readonly file: string;
  private initialized: boolean;
  constructor(file: string, requireExisting = process.env.NODE_ENV === "production") {
    if (!path.isAbsolute(file)) throw new Error("Deletion ledger requires an absolute path");
    this.file = file;
    this.initialized = requireExisting || existsSync(file);
    if (requireExisting && !existsSync(file)) throw new Error("Independent deletion ledger is missing; provision or recover it before starting");
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  }
  read(): DeletionEntry[] {
    if (!existsSync(this.file)) { if (this.initialized) throw new Error("Deletion ledger disappeared; stop all data processing"); return []; }
    const fd = openSync(this.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    let content: string;
    try { content = readFileSync(fd, "utf8"); } finally { closeSync(fd); }
    if (content && !content.endsWith("\n")) throw new Error("Deletion ledger has an incomplete entry; stop processing until recovered");
    let previous = "0".repeat(64);
    return content.split("\n").filter(Boolean).map(line => {
      const row = JSON.parse(line) as { entry: unknown; previous: string; digest: string };
      const entry = entrySchema.parse(row.entry);
      const digest = createHash("sha256").update(previous + JSON.stringify(entry)).digest("hex");
      if (row.previous !== previous || row.digest !== digest) throw new Error("Deletion ledger integrity failure");
      previous = digest;
      return entry;
    });
  }
  append(raw: DeletionEntry) {
    const entry = entrySchema.parse(raw), entries = this.read();
    const existing = entries.find(value => value.jobId === entry.jobId);
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(entry)) throw new Error("Deletion job namespace conflict");
      return;
    }
    let previous = "0".repeat(64);
    for (const item of entries) previous = createHash("sha256").update(previous + JSON.stringify(item)).digest("hex");
    const digest = createHash("sha256").update(previous + JSON.stringify(entry)).digest("hex");
    const fd = openSync(this.file, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW, 0o600);
    try {
      const bytes = Buffer.from(JSON.stringify({ entry, previous, digest }) + "\n");
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset);
      fsyncSync(fd);
      this.initialized = true;
    } finally { closeSync(fd); }
    const parent = openSync(path.dirname(this.file), constants.O_RDONLY);
    try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  frozen(kind: "account" | "family", id: string): boolean {
    return this.read().some(entry => entry.kind === kind && (kind === "account" ? (entry.identityIds || [entry.identityId]).includes(id) : entry.babyId === id));
  }
}
