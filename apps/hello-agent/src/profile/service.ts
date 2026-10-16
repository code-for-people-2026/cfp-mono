import { createHash, randomUUID } from "node:crypto";
import type { Payload } from "payload";
import sharp from "sharp";
import { z } from "zod";
import { uniqueNamesGenerator } from "unique-names-generator";
import { userProfileSchema, type UserProfile } from "@cfp/hello-agent-contracts";
import { AppError } from "../domain/contracts";
import { referenceSchema, type ImageReference } from "../domain/media-policy";
import { configuredImageStore } from "../storage/oss";
import type { WechatIdentity } from "../payload-types";

export const PROFILE_BODY_LIMIT = 192 * 1024;
export const loginProfileSchema = z.object({
  nickname: z.string().trim().max(24).refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), "昵称含有不可见字符").optional(),
  avatarBase64: z.string().min(4).max(4 * Math.ceil(128 * 1024 / 3)).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/).optional(),
});
const storedSchema = userProfileSchema.extend({ image: referenceSchema.optional() });
type StoredProfile = z.output<typeof storedSchema>;
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const prefix = (owner: string) => `hello-agent/${hash(owner).slice(0, 32)}/`;

// The seed is a random account identifier, never a diagnosis or personality assessment.
export function generatedProfile(owner: string): UserProfile {
  const seed = hash(owner);
  const emojis = ["🦦", "🐨", "🐼", "🦊", "🐱", "🐧", "🐢", "🐳"];
  const colors = ["#e4eee5", "#f6e6cc", "#e3e9f5", "#f4e2df", "#e9e1f1"];
  return {
    nickname: uniqueNamesGenerator({ dictionaries: [
      ["会留白的", "练习正念的", "懂得接纳的", "慢慢觉察的", "拥抱情绪的", "寻找心流的", "松弛一点的", "善待自己的", "认真倾听的", "保持好奇的", "收集小确幸的", "守护边界的"],
      ["小水豚", "水獭", "考拉", "小熊猫", "小狐狸", "橘猫", "企鹅", "小海獭", "小海龟", "鲸鱼", "小鹿", "刺猬"],
    ], separator: "", length: 2, seed }),
    avatar: { emoji: emojis[parseInt(seed.slice(0, 2), 16) % emojis.length], color: colors[parseInt(seed.slice(2, 4), 16) % colors.length], image: false },
  };
}
function stored(row: WechatIdentity): StoredProfile {
  if (row.profile == null) return generatedProfile(row.owner);
  const result = storedSchema.safeParse(row.profile);
  if (!result.success || result.data.avatar.image !== !!result.data.image) throw new AppError(503, "个人资料暂时无法读取，请稍后重试");
  return result.data;
}
export async function profileBinding(payload: Payload, owner: string) {
  return (await payload.find({ collection: "wechat-identities", overrideAccess: true, limit: 1, where: { owner: { equals: owner } } })).docs[0];
}
export async function readProfile(payload: Payload, owner: string): Promise<UserProfile> {
  const row = await profileBinding(payload, owner);
  if (!row) throw new AppError(403, "请先微信登录");
  return userProfileSchema.parse(stored(row));
}
function imageStore(owner: string, reference: ImageReference, factory = configuredImageStore) {
  const store = factory();
  if (!reference.key.startsWith(prefix(owner)) || !store || store.bucket !== reference.bucket || store.region !== reference.region) throw new AppError(503, "头像存储暂不可用，请保留当前身份并重试");
  return store;
}
export async function saveLoginProfile(payload: Payload, row: WechatIdentity, input: z.output<typeof loginProfileSchema>, factory = configuredImageStore, assertLease: () => Promise<void> = async () => {}) {
  const previous = stored(row);
  const profile: StoredProfile = { ...previous, nickname: input.nickname || previous.nickname };
  if (input.avatarBase64) {
    let bytes: Buffer;
    try {
      const raw = Buffer.from(input.avatarBase64, "base64");
      if (raw.length > 128 * 1024) throw new Error("large avatar");
      const decoder = sharp(raw, { limitInputPixels: 4_000_000, failOn: "warning" });
      const metadata = await decoder.metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format || "") || (metadata.pages || 1) > 1) throw new Error("unsupported avatar");
      bytes = await decoder.rotate().resize(256, 256, { fit: "cover" }).flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
    } catch { throw new AppError(400, "这张头像暂时无法使用，请重新选择"); }
    const store = factory();
    if (!store) throw new AppError(503, "头像暂时无法保存，可以稍后重试或使用随机头像");
    const key = `${prefix(row.owner)}${randomUUID()}.jpg`;
    await store.put(key, bytes);
    profile.image = referenceSchema.parse({ provider: "oss", bucket: store.bucket, region: store.region, key, sha256: hash(bytes), byteLength: bytes.length });
    profile.avatar = { ...previous.avatar, image: true };
  }
  // Keep uncertain writes for owner-prefix cleanup, rather than delete an object
  // that a successfully committed profile might already reference.
  await assertLease();
  await payload.update({ collection: "wechat-identities", overrideAccess: true, id: row.id, data: { profile } });
  if (previous.image && previous.image.key !== profile.image?.key) {
    try { await imageStore(row.owner, previous.image, factory).remove?.(previous.image.key); }
    catch { /* Orphan remains private; account deletion/expiry purges its namespace. */ }
  }
}
export async function readAvatar(payload: Payload, owner: string, factory = configuredImageStore) {
  const row = await profileBinding(payload, owner);
  const ref = row && stored(row).image;
  if (!ref) throw new AppError(404, "尚未设置照片头像");
  const bytes = await imageStore(owner, ref, factory).get(ref.key);
  if (bytes.length !== ref.byteLength || hash(bytes) !== ref.sha256) throw new AppError(503, "头像内容校验失败，请稍后重试");
  return bytes;
}
export async function avatarResponse(payload: Payload, owner: string) {
  return new Response(new Uint8Array(await readAvatar(payload, owner)), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
export async function exportProfile(payload: Payload, owner: string, factory = configuredImageStore) {
  const row = await profileBinding(payload, owner);
  if (!row) return null;
  const profile = stored(row);
  return { ...userProfileSchema.parse(profile), ...(profile.image ? { avatarMimeType: "image/jpeg", avatarBase64: (await readAvatar(payload, owner, factory)).toString("base64") } : {}) };
}
export async function deleteProfileImages(payload: Payload, owner: string, factory = configuredImageStore) {
  const row = await profileBinding(payload, owner);
  if (!row) return;
  const ref = stored(row).image;
  const store = ref ? imageStore(owner, ref, factory) : factory();
  if (ref && !store?.removePrefix) throw new AppError(503, "头像删除尚未完成，请稍后重试");
  // Includes superseded/uncertain uploads under this account, never another owner.
  await store?.removePrefix?.(prefix(owner));
}
