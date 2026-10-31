import type { Greeting } from "../domain/contracts";
import { requiresRestImage } from "../domain/creation-scope";

export function restCardConstraints(text: string) {
  const constraints = ["休息提醒卡；用户要求的场景、文字数量和禁止元素优先，不增加额外文案或建议。"];
  if (/只写一句|仅一句|只有一句/.test(text)) constraints.push("画面中只能有一句温和的休息建议，不加标题、副标题、页脚、第二句提示或装饰文字。");
  if (/出门前/.test(text)) constraints.push("场景为出门前的室内玄关或房间，不是户外街道；不要画已经出门的人。");
  if (/不使用医生|不把AI画成真人医生|不要医生/.test(text)) constraints.push("不出现医生、白大褂或医疗机构形象。");
  if (/不含联系方式/.test(text)) constraints.push("不出现电话号码、地址、二维码或联系方式。");
  return constraints.join("\n");
}
export function restCardDeliveryError(text: string, reply: Greeting, mediaId: number | undefined, refused: boolean) {
  if (!requiresRestImage(text) || refused) return;
  if (!mediaId || !reply.artifacts?.some(a => a.kind === "image" && a.source.type === "media" && a.source.mediaId === mediaId))
    return "用户要求的休息提示卡默认是图片；只写一句是画面文字约束。尚未交付本轮真实图片，不能用文字卡或‘已做好’代替。请先完成 decide_image_request、generate_image，再引用返回的 mediaId 保存；若原请求需拒绝则明确拒绝，不生成替代图。";
}
