/** Product scope, not a content-safety verdict. Unknown image requests fail closed. */
export const CREATION_REFUSAL = "抱歉，我不提供通用海报、计算题、学习卡等无关制作服务。只提供与心理支持有关的图片制作，例如休息提醒、情绪调节和自我关怀。";
const creation = /生成|制作|设计|绘制|整理成|做成|画|做[一张个套份]|给我|帮我|create|generate|draw|make/i;
const general = /海报|计算卡|计算题|算术卡|算术题|识字卡|单词卡|学习卡|闪卡|试卷|练习题|广告|宣传|营销|商标|logo|poster|flashcard|worksheet/i;
export function isRestReminderRequest(text: string) {
  return creation.test(text) && /(?:休息|放松|歇一歇|歇会)[^。！？\n]{0,8}(?:提醒卡|提示卡|卡片)|提醒(?:我)?休息[^。！？\n]{0,5}卡|rest reminder card/i.test(text) && !general.test(text);
}
/** Topic admission only; every candidate still needs original-request safety review. */
export function isSupportImageRequest(text: string) {
  const unrelated = /计算卡|计算题|算术|数学题|解题|做题|作业答案|识字卡|单词卡|学习卡|闪卡|试卷|练习题|广告|营销|商标|logo|编程|代码|翻译|flashcard|worksheet/i;
  if (unrelated.test(text)) return false;
  if (isRestReminderRequest(text)) return true;
  const medium = /图片|图像|插画|绘画|一幅|一张图|卡片|提示卡|提醒卡|说明卡|海报|image|illustration|card|poster/i;
  const support = /心理支持|情绪支持|心理健康|情绪调节|自我关怀|自我接纳|安抚情绪|缓解焦虑|放松练习|呼吸练习|正念|休息|很困|累了|歇一歇|歇会|emotional support|self.care|relaxation|mindfulness/i;
  return creation.test(text) && medium.test(text) && support.test(text);
}
export function isUnsupportedCreation(text: string) {
  // Describing work-related distress is not commissioning an artifact.
  if (/^(?:我在|我因为|我正在|我做).*(?:焦虑|难受|压力|沮丧|累)/.test(text) && !/(?:请|帮我|给我|替我|为我)/.test(text)) return false;
  return creation.test(text) && !isSupportImageRequest(text) && (general.test(text) || /图片|图像|插画|绘画|一幅|一张图|一幅画|提示卡|说明卡|卡片|image|illustration/i.test(text));
}

/** An artifact commissioning request, including content supplied as a quoted brief. */
export function isArtifactRequest(text: string) {
  return /(?:请|帮我|给我|替我|为我|我想|我要)?(?:生成|制作|设计|绘制|画|整理成|做成)[^。！？\n]{0,80}(?:卡|海报|图片|图像|插画)|(?:卡片|卡|海报|图片)[^。！？\n]{0,25}(?:生成|制作|整理)/.test(text);
}
export function requiresSupportImage(text: string) {
  return isSupportImageRequest(text) && !/(?:只要|仅要|仅需|只需|只生成|仅生成|仅用|只用|纯)文字|(?:只要|仅要|仅需|只需|只生成|仅生成|纯)文本|不要(?:图片|生图)|不(?:要|需要)画图/.test(text);
}
