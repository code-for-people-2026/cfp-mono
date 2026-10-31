import { describe, expect, it } from "vitest";
import {
  inputSchema,
  turnSchema,
  turnResultSchema,
  settingsSchema,
  historySchema,
  memoryStatusSchema,
} from "./index";

const turn = {
  id: 1,
  input: { text: "今天开工", mediaIds: [] },
  status: "completed",
  mode: "platform",
  greeting: "开工顺利",
  model: null,
  createdAt: "2026-10-03T00:00:00Z",
};
describe("跨端协议", () => {
  it("允许真实 Payload 可空字段，但不把任意 CMS 字段传给 UI", () => {
    expect(turnResultSchema.parse({ ...turn, owner: "private-owner" })).toEqual(
      turn,
    );
  });
  it("输入校验与服务端保持一致", () => {
    expect(inputSchema.parse({ text: " 测试 " })).toEqual({
      text: "测试",
      mediaIds: [],
    });
    expect(() => inputSchema.parse({ text: "", mediaIds: [] })).toThrow();
    expect(() => inputSchema.parse({ mediaIds: ["1"] })).toThrow();
    expect(() => inputSchema.parse({ mediaIds: [1, 2, 3, 4] })).toThrow();
  });
  it("错误状态、来源和缺字段不能伪装成成功响应", () => {
    expect(() => historySchema.parse([{ ...turn, status: "done" }])).toThrow();
    expect(() =>
      turnResultSchema.parse({ ...turn, mode: "invented" }),
    ).toThrow();
    expect(() =>
      settingsSchema.parse({ platformConfigured: "true" }),
    ).toThrow();
    expect(() => memoryStatusSchema.parse({ level: "unlimited" })).toThrow();
  });
  it("外部 Agent 不能走平台生成请求", () => {
    expect(() =>
      turnSchema.parse({
        sessionId: 1,
        requestId: "550e8400-e29b-41d4-a716-446655440000",
        input: turn.input,
        mode: "external",
      }),
    ).toThrow();
  });
});
