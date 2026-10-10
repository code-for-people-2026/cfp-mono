import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { Decoder } from "@cfp/hello-agent-contracts";

// MCP 兼容响应是外部数据；先校验内容块，再按每个工具的契约解析文本。
export function readToolResult<T>(value: unknown, decoder: Decoder<T>): T {
  const result = CallToolResultSchema.parse(value);
  const content = result.content.find((item) => item.type === "text");
  if (!content) throw new Error("MCP 响应缺少文本内容");
  return decoder.parse(JSON.parse(content.text));
}
