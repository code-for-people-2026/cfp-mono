import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const header = Buffer.from("BUBUMEDIA1\0");
export function mediaKey(directory: string, configured = process.env.BUBU_MEDIA_ENCRYPTION_KEY): Buffer {
  if (configured) {
    if (!/^[a-f0-9]{64}$/i.test(configured)) throw new Error("BUBU_MEDIA_ENCRYPTION_KEY must be a 32-byte hex key");
    return Buffer.from(configured, "hex");
  }
  if (process.env.NODE_ENV === "production") throw new Error("Private media encryption key is required in production");
  // Local-only persistent key. Production keeps its key outside data/ and its snapshots.
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, ".development-media-key");
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
  const key = readFileSync(file, "utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error("Invalid local media key");
  return Buffer.from(key, "hex");
}
export const encryptedMediaOverhead = header.length + 12 + 16;
export function encryptMedia(bytes: Uint8Array, key: Buffer, scope: string): Buffer {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(scope));
  const content = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([header, nonce, cipher.getAuthTag(), content]);
}
export function decryptMedia(bytes: Buffer, key: Buffer, scope: string): Buffer {
  if (bytes.length < encryptedMediaOverhead || !bytes.subarray(0, header.length).equals(header)) throw new Error("Unencrypted or invalid private media object");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(header.length, header.length + 12));
  decipher.setAAD(Buffer.from(scope)); decipher.setAuthTag(bytes.subarray(header.length + 12, encryptedMediaOverhead));
  return Buffer.concat([decipher.update(bytes.subarray(encryptedMediaOverhead)), decipher.final()]);
}
