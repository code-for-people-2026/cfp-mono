/** Only explicit creation requests; mentioning a card does not force a paid image. */
export function needsLearningCardImage(text: string) {
  if (/(?:只(?:要|需|用)|仅(?:需|要|用))[^。！？\n]{0,8}(?:文字|文本)|(?:不要|不用|无需|不必)[^。！？\n]{0,6}(?:图片|配图|生图)/.test(text)) return false;
  return /(?:计算卡|算术卡|识字卡|单词卡|学习卡|闪卡)/.test(text)
    && /(?:生成|制作|画|设计|做一|做[张个套]|给我[^。！？\n]{0,8}[张套])/.test(text);
}
