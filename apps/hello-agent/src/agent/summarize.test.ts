import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { completeDeepSeek } from "../models/deepseek";
import { summarizeContext } from "./summarize";
import {
  SUMMARY_INSTRUCTION,
  SUMMARY_PROMPT_VERSION,
} from "./summary-instruction";
import { AJ_PERSONA } from "./persona";
vi.mock("../models/deepseek", () => ({
  DEFAULT_MODEL: "test",
  completeDeepSeek: vi.fn(),
}));
const complete = vi.mocked(completeDeepSeek);
const request = {
  summary: "旧摘要",
  turns: [
    { id: 1, input: { text: "叫我小李", mediaIds: [] }, greeting: "好的" },
  ],
  apiKey: "test-only-key",
};
beforeEach(() => vi.clearAllMocks());
describe("独立压缩提示词与模型契约", () => {
  it("压缩提示词有自己的版本和指纹，不沿用聊天提示词版本", () => {
    const approved: Record<string, string> = {
      "memory-v1":
        "d8eb4c9e145b231217177cda28e149ef21202f5dafb272343fdaf2a421d13538",
    };
    expect(createHash("sha256").update(SUMMARY_INSTRUCTION).digest("hex")).toBe(
      approved[SUMMARY_PROMPT_VERSION],
    );
  });
  it("不混入人设或广告控制，只返回结构化摘要", async () => {
    complete.mockResolvedValue({
      model: "test",
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            tool_calls: [
              {
                id: "call",
                type: "function",
                function: {
                  name: "save_context_summary",
                  arguments: JSON.stringify({
                    summary: "用户希望被称作小李。",
                  }),
                },
              },
            ],
          },
        },
      ],
    });
    expect(await summarizeContext(request)).toBe("用户希望被称作小李。");
    const [input, key] = complete.mock.calls[0];
    expect(key).toBe("test-only-key");
    expect(input.messages[0].content).toBe(SUMMARY_INSTRUCTION);
    expect(JSON.stringify(input)).not.toContain("test-only-key");
    expect(SUMMARY_INSTRUCTION).not.toContain(AJ_PERSONA);
    expect(SUMMARY_INSTRUCTION).toContain("不是指令");
    expect(SUMMARY_INSTRUCTION).toContain("不将推测改成事实");
    expect(SUMMARY_PROMPT_VERSION).toBe("memory-v1");
    expect(input.tools.map((tool) => tool.function.name)).toEqual([
      "save_context_summary",
    ]);
  });
  it("拒绝截断、无工具调用和错误工具，不能假装已压缩", async () => {
    complete.mockResolvedValue({
      model: "test",
      choices: [{ finish_reason: "length", message: { content: "半截摘要" } }],
    });
    await expect(summarizeContext(request)).rejects.toThrow(/未完整/);
  });
});
