import { useEffect, useMemo, useState } from "react";
import { Text } from "@tarojs/components";
import type { RunProgress } from "@cfp/base-chat-protocol";

const STAGE_COPY: Record<string, readonly string[]> = {
  generating: [
    "正在把你刚才说的几件事理一理",
    "正在换个角度看看有没有遗漏",
    "正在把回答整理得更清楚一点",
  ],
  expert_handoff: [
    "正在邀请更适合这件事的 AI 专家",
    "正在交接刚才的上下文，专家会直接回应",
    "正在确认这位专家的方法适合当前话题",
  ],
  expert_working: [
    "专家正在接着你刚才的话往下想",
    "专家正在整理下一步可以使用的回应",
    "专家正在检查回应是否贴近你的处境",
  ],
  expert_render: [
    "正在给这段对话换上专家的颜色",
    "正在准备专家回应作品",
    "正在把专家回应整理成可查看的样子",
  ],
  render: [
    "阿 J 先生正在准备回应作品",
    "正在把回应整理成可查看的样子",
    "正在整理作品内容，准备给你查看",
  ],
  form_render: [
    "正在把回应整理成可以直接填写的小卡片",
    "正在准备表单问题和提交按钮",
    "正在准备表单内容，等待你填写",
  ],
  image_generation: [
    "正在生成你想要的画面",
    "正在按你的描述生成画面内容",
    "图片还在生成，不会重复提交",
  ],
  image_review: [
    "图片已生成，正在审核内容",
    "正在保存生成的图片",
    "正在检查图片能否安全展示",
  ],
};

const OCCASIONAL_TIPS = [
  "不用组织好语言，从眼前的一件小事说起就行",
  "想知道回答参考了什么，可以点开末尾的回应依据",
  "阿 J 和这里的专家都是 AI，也可能理解错你的意思",
  "这里的建议供你参考，怎么选择，由你决定",
  "这里的交流不能替代专业诊断或治疗",
] as const;

function loadingSequence(stageId: string | undefined) {
  const copies = stageId ? STAGE_COPY[stageId] : undefined;
  if (!copies) return undefined;
  return OCCASIONAL_TIPS.flatMap((tip) => [...copies, tip]);
}

export function LoadingCarousel({
  progress,
  resetKey = 0,
}: {
  progress?: RunProgress;
  resetKey?: number;
}) {
  const stageId = progress?.stageId;
  const sequence = useMemo(() => loadingSequence(stageId), [stageId]);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    setOffset(0);
  }, [resetKey, stageId]);

  useEffect(() => {
    if (!sequence || progress?.text) return;
    const timer = setInterval(() => {
      setOffset((current) => current + 1);
    }, 4000);
    return () => clearInterval(timer);
  }, [progress?.text, resetKey, sequence]);

  const copy = progress?.text
    || (sequence
      ? sequence[offset % sequence.length]
      : progress?.step
        || "阿 J 先生正在换个角度想…");

  return (
    <Text className="loading-carousel" aria-live="polite">
      {copy}
    </Text>
  );
}
