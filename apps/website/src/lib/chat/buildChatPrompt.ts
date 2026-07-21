import type { RetrievedChunk } from "@/lib/knowledge/retriever";
import type { ChatMessage, EntryMode } from "./conversation";

const modeLabels: Record<EntryMode, string> = {
  intro: "我先看看这是啥",
  doubt: "我有点怀疑",
  continue: "我想继续了解",
  free: "直接输入",
};

// Canonical pages that already host the full texts. When a visitor wants to read
// the original/full text, the assistant links here instead of pasting it in chat.
// 宣言/协议/矩阵 are all on this site now (the 牛马能力剥夺矩阵 互动版 lives at /wam). We hand
// the model ready-made markdown links (not bare paths): a bare relative path like "/license"
// is not auto-linked by the markdown renderer, so the visitor cannot click it.
const docLinks = {
  manifesto: "[《数据平权宣言》全文](/manifesto)",
  license: "[《牛马互助协议》全文](/license)",
  map: "[牛马能力剥夺矩阵](/wam)",
};

const sourceIdToLink: Record<string, string> = {
  "source-data-equality-manifesto": docLinks.manifesto,
  "source-cattle-license": docLinks.license,
  "source-direction-map-handout": docLinks.map,
  "source-7x7-capability-theory": docLinks.map,
};

export function buildChatPrompt(input: {
  mode: EntryMode;
  conversationSummary?: string;
  retrievedChunks: RetrievedChunk[];
  linkOutSourceIds?: string[];
}) {
  const materials = input.retrievedChunks.length
    ? input.retrievedChunks
        .map(
          (item, index) =>
            `材料 ${index + 1}\n标题：${item.chunk.title}\n材料类型：${item.chunk.kind}\n内容：${item.chunk.text}`,
        )
        .join("\n\n")
    : "没有检索到足够相关的材料。";

  const linkOutLinks = Array.from(
    new Set((input.linkOutSourceIds ?? []).map((id) => sourceIdToLink[id]).filter(Boolean)),
  );

  return [
    "你是码成仝官网的问答助手。码成仝是一个想在 AI 时代为“工友”敲键盘的组织构想。",
    "你的任务是帮助第一次了解码成仝的访客读懂公开材料，接住疑问，并在合适时引导他们继续阅读公开文本。",
    "只基于下面提供的材料回答。材料不足时，温和说明材料没有充分展开，并把问题转回“数据平权，AI 下乡”“AI 到底服务谁”“为工友敲键盘想解决什么”等主题。",
    "默认不要展示或罗列材料来源，也不要编造文件名、链接或路径。用户追问依据、来源、原文时，再用自然语言说明依据的是哪份公开文本（《数据平权宣言》《牛马互助协议》或 牛马能力剥夺矩阵）。",
    "回答应克制、白话、短。不要喊口号，不要攻击其他立场，不要替项目做材料之外的承诺。",
    "每次回答都沿着“接住问题 → 对应核心材料 → 自然邀请继续阅读”的链路：先直接回答用户当前问题，再把问题自然引向《数据平权宣言》《牛马互助协议》或 牛马能力剥夺矩阵之一。",
    "只选择最相关的一份核心内容，不要在每次回答里同时硬塞三份。引导必须像顺着用户问题往下走，不要像营销话术。",
    "核心内容路由参考：理念、为什么做、数据归谁、AI 红利，优先引向《数据平权宣言》；组织约束、工友价、1/3 价、怎么防止变质，优先引向《牛马互助协议》；具体做什么、服务谁、哪些人和哪些能力，优先引向 牛马能力剥夺矩阵。",
    "如果材料不足，先说明不足，再选择最接近的一份核心内容作为继续理解的入口，不要泛泛结束。",
    "不要编造联系方式、二维码、产品上线时间、融资情况或法律效力；项目仍在早期，不要声称已经成熟或已经代表工友。",
    // Link-out rule: never reproduce a long original text in chat; point to the page instead.
    "官网已经公开了这些文本的原文。当用户想读全文或原文时，不要在对话里整段复制原文（太啰嗦），用一两句话说明它讲什么，再给出对应链接引导他到官网阅读。",
    "给链接时必须原样使用下面这种 markdown 链接格式 [文字](地址)，不要改写成纯文本路径或裸地址，否则用户点不开。",
    `原文链接：${docLinks.manifesto}；${docLinks.license}；${docLinks.map}。`,
    linkOutLinks.length
      ? `用户当前正在要原文，请直接给出对应链接（${linkOutLinks.join("、")}）并简要说明，不要在对话里复制全文。`
      : "",
    `当前入口模式：${modeLabels[input.mode]}`,
    input.conversationSummary ? `较早对话摘要：${input.conversationSummary}` : "较早对话摘要：无",
    "可用材料：",
    materials,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildSummaryPrompt(messages: ChatMessage[]) {
  const transcript = messages.map((message) => `${message.role}: ${message.content}`).join("\n");

  return [
    "请把以下较早对话压缩成一段简短摘要。",
    "只总结用户问过什么、助手回答过什么、用户仍关心什么。",
    "不要添加新观点。",
    "不能补充知识库没有的项目立场。",
    "不确定内容标记为“不确定”。",
    "摘要控制在 500 个中文字符以内。",
    "",
    transcript,
  ].join("\n");
}
