import type { CollectionConfig } from "payload";

// 只定义后台的阅读方式，不改业务数据、访问权限或模型指令。
export const collectionViews: Record<
  string,
  NonNullable<CollectionConfig["admin"]>
> = {
  sessions: {
    group: "业务验收",
    useAsTitle: "title",
    defaultColumns: ["title", "createdAt", "updatedAt"],
    description:
      "一段聊天对应一份祝福会话。平台、BYOK 和自带 Agent 的产物可归入同一会话；具体输入和回复请看「生成轮次与吉祥话」。",
  },
  greetings: {
    group: "业务验收",
    useAsTitle: "greeting",
    listSearchableFields: ["greeting", "association"],
    defaultColumns: [
      "input",
      "greeting",
      "status",
      "mode",
      "model",
      "createdAt",
    ],
    description:
      "每行是一次输入及其生成结果。先对照输入与吉祥话，再检查状态、使用方式和模型；失败轮次也会保留。点击内容查看完整联想依据、会话 ID 和提示词版本。",
  },
  media: {
    group: "业务验收",
    useAsTitle: "mimeType",
    defaultColumns: ["mimeType", "id", "createdAt"],
    description:
      "用户发送的图片素材，不是模型生成的图片。列表显示缩略图；图片经过服务端校验、缩放和元信息清理，通过生成轮次中的媒体 ID 关联。",
  },
  "adk-sessions": {
    group: "运行诊断",
    useAsTitle: "key",
    defaultColumns: ["snapshot", "id", "updatedAt"],
    description:
      "内置 ADK 每一轮的执行轨迹，不是用户聊天列表。验收时可检查事件数量和工具调用；外部 Agent 不经过平台 ADK，因此没有对应轨迹。",
  },
  "session-locks": {
    group: "运行诊断",
    useAsTitle: "sessionKey",
    defaultColumns: ["sessionKey", "expiresAt", "createdAt"],
    description:
      "防止同一会话并发生成的临时执行锁。正常完成后会释放；异常中断时等待过期。这里不是吉祥话或聊天历史，通常为空。",
  },
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function inputSummary(value: unknown): string {
  const input = record(value);
  const text = typeof input.text === "string" ? input.text.trim() : "";
  const ids = Array.isArray(input.mediaIds)
    ? input.mediaIds.filter((id) => Number.isInteger(id) && Number(id) > 0)
    : [];
  return (
    [
      text,
      ids.length
        ? `${ids.length} 张图片 · ${ids.map((id) => `#${id}`).join("、")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n") || "无可读输入"
  );
}

export function executionSummary(value: unknown): string {
  const snapshot = record(value);
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const calls = events.flatMap((event) => {
    const parts = record(record(event).content).parts;
    return Array.isArray(parts)
      ? parts
          .map((part) => record(record(part).functionCall).name)
          .filter((name): name is string => typeof name === "string")
      : [];
  });
  return `${events.length} 条执行事件\n${calls.length ? `调用工具：${[...new Set(calls)].join("、")}` : "尚无工具调用"}`;
}

export function recommendedColumnsURL(slug: string, adminRoute = "/admin") {
  const columns = collectionViews[slug]?.defaultColumns;
  if (!columns) return undefined;
  const query = new URLSearchParams({
    columns: JSON.stringify(columns),
    sort: "-createdAt",
    page: "1",
  });
  return `${adminRoute}/collections/${slug}?${query}`;
}
