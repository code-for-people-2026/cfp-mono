import { Buffer } from "node:buffer";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { it, expect } from "vitest";
import { captureSnapshot, verifySnapshot } from "../scripts/backup-snapshot.mjs";
import { encryptMedia } from "../src/privacy/media-encryption";

it("captures committed WAL records and private photos together, detecting later corruption and unexpected keys", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bubu-snapshot-")), source = path.join(root, "data"), target = path.join(root, "snapshot");
  await mkdir(source); const db = new DatabaseSync(path.join(source, "identity.db"));
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE messages(id TEXT PRIMARY KEY, body TEXT); INSERT INTO messages VALUES('saved','synthetic committed record');");
    const owner = "a".repeat(64), name = "b".repeat(64), media = path.join(source, "private-attachments", owner);
    await mkdir(media, { recursive: true });
    const ciphertext = encryptMedia(Buffer.from("synthetic private photograph"), randomBytes(32), `${owner}:${name}`);
    await writeFile(path.join(media, name), ciphertext);
    await writeFile(path.join(root, "pg"), "synthetic pg fixture; real pg restore verified separately");
    expect(await captureSnapshot(source, path.join(root, "pg"), target)).toEqual({ files: 3 });
    const copy = new DatabaseSync(path.join(target, "sidecar/identity.db"), { readOnly: true });
    try { expect(copy.prepare("SELECT body FROM messages").get()?.body).toBe("synthetic committed record"); } finally { copy.close(); }
    expect(await readFile(path.join(target, "sidecar/private-attachments", owner, name))).toEqual(ciphertext);
    await expect(captureSnapshot(source, path.join(root, "pg"), target)).rejects.toThrow();
    await writeFile(path.join(target, "sidecar/private-attachments", owner, name), "corrupted");
    await expect(verifySnapshot(target)).rejects.toThrow("manifest");
    await writeFile(path.join(source, "secret"), "must never be archived");
    await expect(captureSnapshot(source, path.join(root, "pg"), path.join(root, "bad"))).rejects.toThrow("Unexpected live data");
  } finally { db.close(); await rm(root, { recursive: true, force: true }); }
});

it("refuses active writer leases, linked files and plaintext media", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "bubu-snapshot-")), source = path.join(root, "data");
  await mkdir(source); const db = new DatabaseSync(path.join(source, "identity.db")); db.exec("CREATE TABLE records(id TEXT)"); db.close();
  try {
    const pg = path.join(root, "pg"); await writeFile(pg, "synthetic");
    await writeFile(path.join(source, "runtime.lock"), "active");
    await expect(captureSnapshot(source, pg, path.join(root, "lease"))).rejects.toThrow("active writer");
    await rm(path.join(source, "runtime.lock"));
    const objects = path.join(source, "private-attachments", "a".repeat(64)); await mkdir(objects, { recursive: true });
    const photo = path.join(objects, "b".repeat(64)); await symlink(pg, photo);
    await expect(captureSnapshot(source, pg, path.join(root, "linked"))).rejects.toThrow();
    await rm(photo); await writeFile(photo, "plaintext photo");
    await expect(captureSnapshot(source, pg, path.join(root, "plain"))).rejects.toThrow("Unencrypted");
  } finally { await rm(root, { recursive: true, force: true }); }
});
