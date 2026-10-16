import type { Payload } from "payload";
import type { OwnedCollection } from "../cms/repository";
import type { DataFromCollectionSlug } from "payload";
import type { Greeting } from "../payload-types";
import { AppError } from "../domain/contracts";
export async function enforcements(payload: Payload, owner: string) {
  return (await payload.find({ collection: "safety-enforcements", overrideAccess: true, limit: 0, pagination: false, where: { and: [{ owner: { equals: owner } }, { active: { equals: true } }] } })).docs;
}
export async function assertGenerationAllowed(payload: Payload, owner: string) {
  if ((await enforcements(payload, owner)).some((row) => row.targetType === "owner")) throw new AppError(403, "当前身份的生成权限已被限制，可在投诉与申诉入口查看并申请复核");
}
function mediaIds(row: Pick<Greeting, "input" | "artifacts" | "imageGeneration">) {
  const input = row.input as { mediaIds?: number[] } | undefined;
  const artifacts = (row.artifacts || []) as { kind: string; source?: { type: string; mediaId?: number } }[];
  const generated = row.imageGeneration as { mediaId?: number } | undefined;
  return [...(input?.mediaIds || []), ...(generated?.mediaId ? [generated.mediaId] : []), ...artifacts.flatMap((item) => item.kind === "image" && item.source?.type === "media" && item.source.mediaId ? [item.source.mediaId] : [])];
}
async function restrictedMedia(payload: Payload, owner: string, restrictions: Awaited<ReturnType<typeof enforcements>>) {
  const ids = new Set<number>(restrictions.filter((row) => row.targetType === "media").map((row) => Number(row.targetId)));
  const turnIds = restrictions.filter((row) => row.targetType === "turn").map((row) => row.targetId);
  if (turnIds.length) {
    const turns = await payload.find({ collection: "greetings", overrideAccess: true, pagination: false, limit: 0, where: { and: [{ owner: { equals: owner } }, { id: { in: turnIds } }] } });
    for (const row of turns.docs) for (const id of mediaIds(row)) ids.add(id);
    // A media write may have committed before its turn reference was saved.
    const generated = await payload.find({ collection: "media", overrideAccess: true, pagination: false, limit: 0, where: { and: [{ owner: { equals: owner } }, { generationKey: { in: turnIds.map((id) => `${owner}:${id}`) } }] } });
    for (const row of generated.docs) ids.add(Number(row.id));
  }
  return ids;
}
export async function assertMediaAllowed(payload: Payload, owner: string, id: number) {
  if ((await restrictedMedia(payload, owner, await enforcements(payload, owner))).has(id)) throw new AppError(404, "图片或所属内容已停止展示");
}
export async function projectVisibleRows<C extends OwnedCollection>(payload: Payload, owner: string, collection: C, rows: DataFromCollectionSlug<C>[]): Promise<(DataFromCollectionSlug<C> & { visibility?: "quarantined" })[]> {
  if (!["greetings", "sessions"].includes(collection) || !rows.length) return rows;
  const restrictions = await enforcements(payload, owner);
  const blockedMedia = await restrictedMedia(payload, owner, restrictions);
  const affectedSessions = new Set(restrictions.filter((item) => item.targetType !== "owner").map((item) => item.sessionId));
  if (collection === "sessions" && blockedMedia.size) {
    // 自动标题可能含首条输入；复用被隔离图片的会话也需隐藏标题。
    // 只检查当前返回的会话，并分页读取，避免一次加载全部聊天历史。
    let cursor = 0;
    while (true) {
      const page = await payload.find({ collection: "greetings", overrideAccess: true, depth: 0, limit: 100, sort: "id", where: { and: [{ owner: { equals: owner } }, { sessionId: { in: rows.map((row) => row.id) } }, { id: { greater_than: cursor } }] }, select: { sessionId: true, input: true, artifacts: true, imageGeneration: true } });
      for (const turn of page.docs) if (mediaIds(turn).some((id) => blockedMedia.has(id))) affectedSessions.add(turn.sessionId);
      if (page.docs.length < 100) break;
      cursor = page.docs[page.docs.length - 1].id;
    }
  }
  return rows.map((row) => {
    if (collection === "sessions" && (blockedMedia.size > 0 || affectedSessions.has(row.id)))
      return { ...row, memory: null, ...(affectedSessions.has(row.id) ? { title: "内容复核中的会话" } : {}) }; // 共享图片可能出现在别的会话旧摘要中；保守停用摘要，原文仍保留。
    if (collection === "greetings" && "input" in row && (restrictions.some((item) => item.targetType === "turn" && item.targetId === row.id) || mediaIds(row).some((id) => blockedMedia.has(id))))
      return { id: row.id, owner, sessionId: row.sessionId, requestKey: row.requestKey, fingerprint: row.fingerprint, mode: row.mode, status: "failed", input: { text: "此轮内容已停止展示，可提交申诉", mediaIds: [] }, greeting: null, artifacts: [], error: "内容已隔离", createdAt: row.createdAt, updatedAt: row.updatedAt, visibility: "quarantined" };
    return row;
  }) as (DataFromCollectionSlug<C> & { visibility?: "quarantined" })[]; // Projection preserves each collection identity and required fields while removing all quarantined content.
}
