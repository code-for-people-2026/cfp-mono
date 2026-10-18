import type { CollectionBeforeChangeHook } from "payload";
import { isDeepStrictEqual } from "node:util";
import { AppError } from "../domain/contracts";
import { referencedMediaIds, restrictedMedia } from "./enforcement";
export const guardSafetyWrite: CollectionBeforeChangeHook = async ({ req, data, originalDoc, collection }) => {
  if (!["greetings", "sessions"].includes(collection.slug)) return data;
  const owner = data.owner ?? originalDoc?.owner;
  if (!owner) return data;
  const restrictions = (await req.payload.find({ collection: "safety-enforcements", overrideAccess: true, req, pagination: false, limit: 0, where: { and: [{ owner: { equals: owner } }, { active: { equals: true } }] } })).docs;
  if (collection.slug === "greetings" && data.status === "completed") {
    // Recheck shared images in the same transaction as publication. A reviewer
    // may quarantine a different turn while this turn awaits output moderation.
    const blockedMedia = await restrictedMedia(req.payload, owner, restrictions, req);
    if (restrictions.some((item) => item.targetType === "owner" || (item.targetType === "turn" && item.targetId === originalDoc?.id)) ||
      referencedMediaIds({ ...originalDoc, ...data }).some((id) => blockedMedia.has(id)))
      throw new AppError(403, "内容或身份已受限，不能发布本轮回应");
  }
  // Payload 的 beforeChange data 已合入原记录；仅更新活动时间不能误当成写入新摘要。
  if (collection.slug === "sessions" && data.memory && !isDeepStrictEqual(data.memory, originalDoc?.memory)) {
    const blockedMedia = await restrictedMedia(req.payload, owner, restrictions, req);
    if (blockedMedia.size || restrictions.some((item) => item.targetType === "turn" && item.sessionId === originalDoc?.id))
      throw new AppError(403, "此会话存在隔离内容，暂不保存可能包含该内容的记忆摘要");
  }
  return data;
};
