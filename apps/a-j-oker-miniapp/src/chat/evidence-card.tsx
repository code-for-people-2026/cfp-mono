import { useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import type { Turn } from "./model";
import { modes } from "./model";
import { BottomSheet } from "./bottom-sheet";
import { MessageText } from "./message-text";
import type { PresentationOrigin } from "@cfp/base-chat-protocol";

const approaches: Record<string, string> = {
  supportive: "支持性回应",
  cbt: "认知行为视角",
  act: "接纳与承诺",
  dbt: "情绪调节",
  solution_focused: "焦点解决",
  self_compassion: "自我关怀",
  positive_psychology: "积极心理学",
  behavioral: "行为视角",
};
export function EvidenceCard({
  turn,
  origin,
}: {
  turn: Turn;
  origin?: PresentationOrigin;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View className="evidence-note">
      <Button
        className="control evidence-toggle"
        ariaLabel="查看为什么这样说"
        onClick={() => setOpen(true)}
      >
        看看为什么这样说 ＋
      </Button>
      {open && (
        <BottomSheet title="回应依据" onClose={() => setOpen(false)}>
          {turn.association && (
            <MessageText
              aiGenerated
              external={turn.mode === "external"}
              className="artifact-text"
            >
              {turn.association}
            </MessageText>
          )}
          {origin && (
            <Text className="artifact-caption">
              {origin.sources.length
                ? `实际参考：${origin.sources
                    .map(
                      (source) =>
                        `${source.library} / ${source.title}（${
                          source.readStatus === "document"
                            ? "已读正文"
                            : "已读片段"
                        }）`,
                    )
                    .join("；")}`
                : "本轮未使用可核对的知识库正文"}
            </Text>
          )}
          <Text className="artifact-caption">
            {approaches[turn.approach || ""] || turn.approach}
          </Text>
          <Text className="artifact-caption">
            {modes.find((item) => item.id === turn.mode)?.label}
            {turn.mode === "external"
              ? " · 来源由客户端声明"
              : turn.model
                ? ` · ${turn.model}`
                : ""}
          </Text>
        </BottomSheet>
      )}
    </View>
  );
}
