/** Narrow text safety net, never a diagnosis or an inference from missing diary entries. */
export function safetyCategory(text: string): "breathing" | "consciousness" | undefined {
  for (const sentence of text.normalize("NFKC").split(/[。！？!？\n；;，,]/)) {
    // Education, hypotheticals and explicitly negated symptoms are not incident reports.
    if (/(如果|假如|要是|万一|科普|文章|视频|教我|预防|并无|没有出现|没有发生|没有呼吸困难|没有抽搐|不是呼吸困难|并不呼吸困难)/.test(sentence)) continue;
    if (/(喘不过气|无法呼吸|不能呼吸|没(?:有)?呼吸了|呼吸停止|停止呼吸|呼吸困难|嘴唇(?:发|变)紫|口唇(?:发|变)紫|呛奶.*(?:发紫|呼吸困难))/.test(sentence)) return "breathing";
    if (/(叫不醒|唤不醒|失去意识|意识不清|昏迷|持续抽搐|一直抽搐)/.test(sentence) && !/(没有|并无|不是|不会)(?:再)?(?:叫不醒|唤不醒|失去意识|意识不清|昏迷|持续抽搐|一直抽搐)/.test(sentence)) return "consciousness";
  }
}
export const safetyNotice = "你描述了需要立即关注的危险表现。如果宝宝现在呼吸困难、嘴唇发紫、叫不醒或持续抽搐，请立即拨打 120（中国大陆；境外使用当地急救号码），说明宝宝的情况和位置，按调度员指导行动。不要等 AI、群采集或后台回复。这里不能诊断，也不能判断宝宝已经安全。请先处理现实中的安全，之后再补记；本条未自动写入照护记录。";
export const safetySources = ["https://ws.zibo.gov.cn/art/2026/7/16/art_815_3010993.html", "https://www.nhc.gov.cn/xcs/c100122/202601/b805b5cc607941f1a4445a8b297bf4e9.shtml"];
