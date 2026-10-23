import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { CodexAgentExecutor } from "../src/collector/codex";
import { ExactLocalMediaResolver } from "../src/collector/media";
import type { AgentTask } from "../src/collector/runner";
import type { SourceMessage } from "../src/collector/types";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function temp() { const directory = await mkdtemp(path.join(tmpdir(), "bubu-collector-adapter-")); directories.push(directory); return directory; }
const message: SourceMessage = { sourceId: "fixture-source", accountId: "fixture-account", groupId: "wechat:fixture-account:fixture@chatroom", chatId: "fixture@chatroom", databaseId: "message/message_0.db", tableName: "Msg_fixture", localId: 1, sentAt: "2026-10-23T00:00:01Z", senderId: "fixture-sender", kind: "image", text: "[image]", media: [{ sourceId: "fixture-source", kind: "image", state: "unresolved", reason: "EXACT_PATH_REQUIRED" }] };
const image = () => sharp({ create: { width: 2, height: 2, channels: 3, background: "#8badf0" } }).png().toBuffer();

describe("exact local media resolver", () => {
  it("accepts only an exact source mapping with verified decoded bytes", async () => {
    const root = await temp(), bytes = await image(), file = path.join(root, "decoded.png"); await writeFile(file, bytes);
    const mapping = { sourceId: message.sourceId, index: 0, path: file, sha256: createHash("sha256").update(bytes).digest("hex") };
    const resolver = new ExactLocalMediaResolver({ roots: [root], mappings: [mapping] });
    expect(await resolver.resolve(message, 0)).toEqual({ available: true, bytes, mime: "image/png" });
    expect(await new ExactLocalMediaResolver({ roots: [root], mappings: [{ ...mapping, sha256: "0".repeat(64) }] }).resolve(message, 0)).toMatchObject({ available: false, reason: "MEDIA_MAPPING_HASH_MISMATCH" });
    expect(await resolver.resolve({ ...message, sourceId: "another-message" }, 0)).toMatchObject({ available: false, reason: "MEDIA_EXACT_MAPPING_REQUIRED" });
  });
  it("matches XML MD5 bytes by exact filename and rejects monthly first-file guessing", async () => {
    const root = await temp(), bytes = await image(), md5 = createHash("md5").update(bytes).digest("hex");
    await writeFile(path.join(root, "unrelated.png"), bytes);
    const source = { ...message, media: [{ ...message.media[0]!, fingerprint: `md5:${md5}` }] };
    const resolver = new ExactLocalMediaResolver({ roots: [root], md5Directories: [root] });
    expect(await resolver.resolve(source, 0)).toMatchObject({ available: false, reason: "MEDIA_EXACT_FILE_MISSING" });
    await writeFile(path.join(root, `${md5}.png`), bytes);
    expect(await resolver.resolve(source, 0)).toMatchObject({ available: true, mime: "image/png" });
    await writeFile(path.join(root, `${md5}.jpg`), bytes);
    expect(await resolver.resolve(source, 0)).toMatchObject({ available: false, reason: "MEDIA_MAPPING_AMBIGUOUS" });
  });
  it("rejects paths outside allowed roots, symlinks, corrupt images and hash mismatches", async () => {
    const root = await temp(), outside = await temp(), bytes = await image(), file = path.join(outside, "outside.png"); await writeFile(file, bytes);
    const mapping = { sourceId: message.sourceId, index: 0, path: file, sha256: createHash("sha256").update(bytes).digest("hex") };
    expect(await new ExactLocalMediaResolver({ roots: [root], mappings: [mapping] }).resolve(message, 0)).toMatchObject({ available: false, reason: "MEDIA_PATH_NOT_ALLOWED" });
    const link = path.join(root, "link.png"); await symlink(file, link);
    expect(await new ExactLocalMediaResolver({ roots: [root], mappings: [{ ...mapping, path: link }] }).resolve(message, 0)).toMatchObject({ available: false, reason: "MEDIA_PATH_NOT_ALLOWED" });
    const corrupt = path.join(root, "corrupt.png"); await writeFile(corrupt, "not an image");
    expect(await new ExactLocalMediaResolver({ roots: [root], mappings: [{ ...mapping, path: corrupt, sha256: createHash("sha256").update("not an image").digest("hex") }] }).resolve(message, 0)).toMatchObject({ available: false });
    const mismatch = { ...message, media: [{ ...message.media[0]!, fingerprint: `md5:${"0".repeat(32)}` }] };
    await writeFile(path.join(root, `${"0".repeat(32)}.png`), bytes);
    expect(await new ExactLocalMediaResolver({ roots: [root], md5Directories: [root] }).resolve(mismatch, 0)).toMatchObject({ available: false, reason: "MEDIA_XML_HASH_MISMATCH" });
  });
});

describe("ready Codex subscription bridge without a model call", () => {
  const plan = { plans: [], ignored: [{ sourceId: message.sourceId, reason: "synthetic non-care fixture" }] };
  const task: AgentTask = { protocol: "bubu-collector-agent/v1", instructions: "fixture", batchId: "synthetic-batch", messages: [message], media: [], existingEvents: [], pendingQuestions: [], tools: [], resultSchema: { type: "object" } };
  async function fakeCodex(body: string) {
    const directory = await temp(), executable = path.join(directory, "codex");
    await writeFile(executable, `#!${process.execPath}\n${body}`, { mode: 0o700 }); await chmod(executable, 0o700);
    return { directory, executable };
  }
  it("uses verified exec flags, stdin, strict output and no inherited API or service secrets", async () => {
    const f = await fakeCodex(`const fs=require('node:fs');let prompt='';process.stdin.on('data',c=>prompt+=c);process.stdin.on('end',()=>{const args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(path.join(tmpdir(), "placeholder"))}.replace('placeholder',require('node:path').basename(__dirname)+'-seen'),JSON.stringify({args,prompt,env:process.env,cwd:process.cwd(),schema:JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'))}));fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({planJson:${JSON.stringify(JSON.stringify(plan))}}));});`);
    const seenPath = path.join(tmpdir(), `${path.basename(f.directory)}-seen`);
    const previous = process.env.OPENAI_API_KEY; process.env.OPENAI_API_KEY = "synthetic-secret-not-for-child";
    try {
      expect(await new CodexAgentExecutor({ executable: f.executable }).execute(task)).toEqual(plan);
      const seen = JSON.parse(await readFile(seenPath, "utf8"));
      expect(seen.args).toEqual(expect.arrayContaining(["--no-daemon", "exec", "--ignore-user-config", "--ephemeral", "read-only", "--skip-git-repo-check", "--output-schema", "--output-last-message", 'forced_login_method="chatgpt"', "features.shell_tool=false", "features.apps=false", "features.plugins=false", "mcp_servers={}", "-"]));
      expect(seen.env.OPENAI_API_KEY).toBeUndefined(); expect(seen.prompt).not.toContain("synthetic-secret");
      expect(seen.prompt).toContain(message.sourceId); expect(seen.schema.additionalProperties).toBe(false);
      await expect(readFile(path.join(seen.cwd, "result.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous; await rm(seenPath, { force: true }); }
  });
  it("fails closed on unstructured output and kills a timed-out CLI", async () => {
    const invalid = await fakeCodex("const fs=require('node:fs');const args=process.argv;fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({planJson:'{\"plans\":[{\"tool\":\"change_binding\"}],\"ignored\":[]}'}));");
    await expect(new CodexAgentExecutor({ executable: invalid.executable }).execute(task)).rejects.toThrow("COLLECTOR_CODEX_OUTPUT_INVALID");
    const stalled = await fakeCodex("setTimeout(()=>{},10000);");
    await expect(new CodexAgentExecutor({ executable: stalled.executable, timeoutMs: 100 }).execute(task)).rejects.toThrow("COLLECTOR_CODEX_TIMEOUT");
  });
});
