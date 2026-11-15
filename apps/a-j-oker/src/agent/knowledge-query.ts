import type { PsychologyApproach } from "./psychology";

// Provider requests are assembled only from this server-owned vocabulary.
// Neither model output nor administrator prompts may introduce arbitrary text.
export const KNOWLEDGE_METHODS: Record<PsychologyApproach, string[]> = {
  supportive: ["支持性回应", "情绪确认", "积极倾听", "社会支持"],
  cbt: [
    "CBT", "自动思维", "自动思维记录", "认知重构",
    "认知歪曲", "证据检验", "行为实验",
  ],
  act: ["ACT", "接纳", "认知解离", "价值澄清", "承诺行动", "心理灵活性"],
  dbt: ["DBT", "正念", "情绪调节", "痛苦耐受", "人际效能"],
  behavioral: ["行为激活", "活动记录", "任务分解", "行为实验", "回避行为"],
  solution_focused: ["焦点解决", "例外提问", "量尺提问", "资源探索", "小步行动"],
  self_compassion: ["自我关怀", "自我慈悲", "共同人性", "自我批评", "正念"],
  positive_psychology: ["积极心理学", "性格优势", "品味", "感恩", "意义", "心流"],
};

export function methodQuery(query: string, approach?: PsychologyApproach) {
  const allowed = approach
    ? KNOWLEDGE_METHODS[approach]
    : Object.values(KNOWLEDGE_METHODS).flat();
  const terms = query.trim().split(/[\s，、,；;]+/);
  if (terms.length > 3 || terms.some((term) => !allowed.includes(term)))
    throw new Error("请选择工具列出的方法关键词，不允许发送自由文本。");
  return [...new Set(terms)]
    .map((term) => allowed.find((value) => value === term)!)
    .join(" ");
}
