import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const key = (secret: string) =>
  createHash("sha256").update(`hello-knowledge:${secret}`).digest();

export function encryptKnowledgeSecret(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

export function decryptKnowledgeSecret(value: string, secret: string) {
  const [version, nonce, tag, body] = value.split(".");
  if (version !== "v1" || !nonce || !tag || !body)
    throw new Error("知识库密钥不可用，请管理员重新填写");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(secret),
    Buffer.from(nonce, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(body, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
