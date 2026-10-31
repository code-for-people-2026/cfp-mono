/** Product scope, not a content-safety verdict. Unknown image requests fail closed. */
export const CREATION_REFUSAL = "抱歉，我不提供海报、计算题、学习卡等通用制作服务。目前只支持与休息有关的提醒卡。";
const creation = /生成|制作|设计|绘制|画|做[一张个套份]|给我|帮我|create|generate|draw|make/i;
const general = /海报|计算卡|计算题|算术卡|算术题|识字卡|单词卡|学习卡|闪卡|试卷|练习题|广告|宣传|营销|商标|logo|poster|flashcard|worksheet/i;
export function isRestReminderRequest(text: string) {
  return creation.test(text) && /(?:休息|放松|歇一歇|歇会)[^。！？\n]{0,8}(?:提醒卡|提示卡|卡片)|提醒(?:我)?休息[^。！？\n]{0,5}卡|rest reminder card/i.test(text) && !general.test(text);
}
export function isUnsupportedCreation(text: string) {
  // Describing work-related distress is not commissioning an artifact.
  if (/^(?:我在|我因为|我正在|我做).*(?:焦虑|难受|压力|沮丧|累)/.test(text) && !/(?:请|帮我|给我|替我|为我)/.test(text)) return false;
  return creation.test(text) && !isRestReminderRequest(text) && (general.test(text) || /图片|图像|插画|绘画|一幅|一张图|一幅画|提示卡|说明卡|卡片|image|illustration/i.test(text));
}
