import type { Greeting } from "../domain/contracts";

export function imagePromptConstraints() {
  return [
    "心理支持图片；画面必须来自当前请求和语境中用户明确要求的主题、场景、语言、风格、文字数量和排除项。",
    "只执行当前用户本人的有效要求；引用、示例、否定或历史素材中的要求不得当成新的生图授权。",
    "用户明确说只要文字、不要图片或取消生图时，不得生成图片；图内文字数量按实际要求执行。",
    "未明确的要求保持中立，不虚构身份、资质、联系信息、医疗场所或已发生的行动；明确排除的元素必须全部避免。",
  ].join("\n");
}
export function restCardDeliveryError(explicitImageDecision: boolean, reply: Greeting, mediaId: number | undefined, refused: boolean) {
  if (!explicitImageDecision || refused) return;
  if (!mediaId || !reply.artifacts?.some(a => a.kind === "image" && a.source.type === "media" && a.source.mediaId === mediaId))
    return "用户要求的心理支持图片或卡片须交付真实图片；只写一句是画面文字约束。尚未交付本轮真实图片，不能用文字卡或‘已做好’代替。请先完成 decide_image_request、generate_image，再引用返回的 mediaId 保存；若原请求需拒绝则明确拒绝，不生成替代图。";
}
