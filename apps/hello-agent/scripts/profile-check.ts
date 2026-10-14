import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import type { ImageObjectStore } from "../src/storage/oss";

const dir = await mkdtemp(path.join(tmpdir(), "aj-profile-check-"));
Object.assign(process.env, { HELLO_DATABASE_URI: `file:${dir}/onboarding-preview.db`, PAYLOAD_SECRET: "isolated-profile-check", HELLO_DEPLOYED: "false", HELLO_MEDIA_STORAGE: "database", HELLO_WECHAT_APP_ID: "fixture-app", HELLO_WECHAT_APP_SECRET: "fixture-secret", HELLO_AGE_SECRET_KEY: "", HELLO_AGE_SECRET_ID: "" });
const { cms } = await import("../src/cms/client");
const { wechatLogin } = await import("../src/age/wechat");
const { ageNotice } = await import("../src/age/policy");
const { onboardingPreview } = await import("../src/age/preview");
const { readProfile, profileBinding, generatedProfile, saveLoginProfile, readAvatar, exportProfile, deleteProfileImages } = await import("../src/profile/service");
const { mintCredential, authenticate } = await import("../src/server/auth");
const payload = await cms();
const objects = new Map<string, Buffer>();
const store: ImageObjectStore = {
  bucket: "isolated-avatars", region: "test-region",
  async put(key, bytes) { objects.set(key, bytes); },
  async get(key) { assert.ok(objects.has(key)); return objects.get(key)!; },
  async remove(key) { objects.delete(key); },
  async removePrefix(prefix) { for (const key of objects.keys()) if (key.startsWith(prefix)) objects.delete(key); },
};
const request = (token?: string) => new Request("http://localhost/api/hello/wechat-login", { headers: token ? { Authorization: `Bearer ${token}` } : {} });
const input = { code: "synthetic", consent: true, noticeVersion: ageNotice().version, migrateCurrent: false };
const call = (path: string, token: string, body?: unknown) => onboardingPreview(payload, new Request(`http://localhost/api/hello/${path}`, { method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
try {
  const visitor = await mintCredential(payload, "miniapp");
  for (const route of ["sessions", "profile", "profile/avatar"]) assert.equal((await call(route, visitor.token)).status, 403);
  assert.equal((await call("privacy", visitor.token)).status, 200);
  const first = await wechatLogin(payload, request(), { ...input, nickname: " " }, async () => "fixture-wechat-profile");
  const defaults = await readProfile(payload, first.owner);
  assert.deepEqual(defaults, generatedProfile(first.owner));
  assert.ok(defaults.nickname.length <= 24);
  assert.ok(new Set(Array.from({ length: 100 }, (_, index) => generatedProfile(`owner-${index}`).nickname)).size > 50);
  const repeated = await wechatLogin(payload, request(), input, async () => "fixture-wechat-profile");
  assert.equal(repeated.owner, first.owner);
  assert.deepEqual(await readProfile(payload, first.owner), defaults);
  await wechatLogin(payload, request(), { ...input, nickname: "  小确幸  " }, async () => "fixture-wechat-profile");
  await wechatLogin(payload, request(), { ...input, nickname: "" }, async () => "fixture-wechat-profile");
  assert.equal((await readProfile(payload, first.owner)).nickname, "小确幸");
  let exchanged = false;
  for (const bad of [{ nickname: "x".repeat(25) }, { nickname: "a\u202eb" }, { avatarBase64: "https://example.invalid/photo.jpg" }, { avatarUrl: "https://example.invalid" }]) {
    await assert.rejects(() => wechatLogin(payload, request(), { ...input, ...bad }, async () => { exchanged = true; return "bad"; }));
  }
  assert.equal(exchanged, false);
  const pixels = await sharp({ create: { width: 500, height: 300, channels: 3, background: "#acd4bd" } }).png().toBuffer();
  const row = (await profileBinding(payload, first.owner))!;
  await saveLoginProfile(payload, row, { avatarBase64: pixels.toString("base64") }, () => store);
  assert.equal(objects.size, 1);
  assert.equal((await readProfile(payload, first.owner)).avatar.image, true);
  const photo = await readAvatar(payload, first.owner, () => store);
  const metadata = await sharp(photo).metadata();
  assert.equal(metadata.width, 256); assert.equal(metadata.height, 256); assert.equal(metadata.format, "jpeg"); assert.equal(metadata.exif, undefined);
  const exported = await exportProfile(payload, first.owner, () => store);
  assert.equal(exported?.nickname, "小确幸"); assert.equal(exported?.avatarBase64, photo.toString("base64"));
  assert.ok(!JSON.stringify(exported).includes("hello-agent/"));
  await assert.rejects(() => readAvatar(payload, "another-owner", () => store), /尚未设置/);
  const latest = (await profileBinding(payload, first.owner))!;
  await assert.rejects(() => saveLoginProfile(payload, latest, { avatarBase64: Buffer.from("invalid-pixels").toString("base64") }, () => store), /重新选择/);
  assert.equal(objects.size, 1);
  await assert.rejects(() => deleteProfileImages(payload, first.owner, () => ({ ...store, async removePrefix() { throw new Error("offline"); } })), /offline/);
  assert.equal((await readProfile(payload, first.owner)).avatar.image, true);
  // A failed private-object deletion must not revoke the caller's retry credential.
  const deletion = { confirmation: "删除我的全部在线数据" };
  assert.equal((await call("privacy/delete", first.token, deletion)).status, 503);
  assert.equal((await authenticate(payload, request(first.token))).id, first.owner);
  await saveLoginProfile(payload, latest, { avatarBase64: pixels.toString("base64") }, () => store);
  assert.equal(objects.size, 1, "replaced photo removed after database update");
  const current = (await profileBinding(payload, first.owner))!;
  await payload.create({ collection: "wechat-identities", overrideAccess: true, data: { owner: "foreign", key: "foreign-key", profile: current.profile } });
  await assert.rejects(() => readAvatar(payload, "foreign", () => store), /暂不可用/);
  await assert.rejects(() => deleteProfileImages(payload, "foreign", () => store), /暂不可用/);
  assert.equal(objects.size, 1);
  await deleteProfileImages(payload, first.owner, () => store);
  assert.equal(objects.size, 0);
  await payload.update({ collection: "wechat-identities", overrideAccess: true, id: current.id, data: { profile: defaults } });
  assert.equal((await call("privacy/delete", first.token, deletion)).status, 200);
  await assert.rejects(() => authenticate(payload, request(first.token)));
  assert.equal(await profileBinding(payload, first.owner), undefined);
  console.log("Profile checks passed: mandatory login, optional stable defaults, WeChat account restore, private resized avatars, owner isolation, export and retryable deletion.");
} finally { await payload.destroy(); await rm(dir, { recursive: true, force: true }); }
