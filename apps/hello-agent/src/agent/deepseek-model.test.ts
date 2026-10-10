import { afterEach, describe, expect, it, vi } from "vitest";
import { FunctionTool, type LlmRequest } from "@google/adk";
import { FunctionCallingConfigMode } from "@google/genai";
import { greetingSchema } from "../domain/contracts";
import { completeDeepSeek } from "../models/deepseek";
import { DeepSeekModel, toDeepSeekRequest } from "./deepseek-model";

const save = new FunctionTool({
  name: "save_greeting",
  description: "保存吉祥话",
  parameters: greetingSchema,
  execute: async () => ({ saved: true }),
});
function request(): LlmRequest {
  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: "一朵花" },
          { inlineData: { mimeType: "image/png", data: "aW1hZ2U=" } },
        ],
      },
    ],
    toolsDict: { save_greeting: save },
    liveConnectConfig: {},
    config: {
      systemInstruction: "独立指令",
      tools: [{ functionDeclarations: [save._getDeclaration()] }],
      toolConfig: {
        functionCallingConfig: {
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ["save_greeting"],
        },
      },
    },
  };
}
function completion(
  name = "save_greeting",
  args = JSON.stringify({
    greeting: "花开有时，愿你心中有光。",
    association: "从小花联想到成长。",
  }),
  finish = "tool_calls",
) {
  return {
    model: "deepseek-flash",
    choices: [
      {
        finish_reason: finish,
        message: {
          content: null,
          reasoning_content: "不应被保存的隐藏推理",
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name, arguments: args },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}
afterEach(() => vi.unstubAllGlobals());

describe("DeepSeek 协议适配", () => {
  it("保留系统指令、文字和图片，转换真实 ADK 工具 Schema 并强制保存工具", () => {
    const input = toDeepSeekRequest(request(), "deepseek-flash");
    expect(input.messages[0]).toEqual({ role: "system", content: "独立指令" });
    expect(input.messages[1].content).toEqual([
      { type: "text", text: "一朵花" },
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,aW1hZ2U=" },
      },
    ]);
    expect(input.tools[0].function.parameters).toMatchObject({
      type: "object",
      properties: {
        greeting: { type: "string", minLength: 2, maxLength: 1000 },
        association: { type: "string", minLength: 1, maxLength: 500 },
      },
    });
    expect(input.tool_choice).toEqual({
      type: "function",
      function: { name: "save_greeting" },
    });
  });

  it("保留工具调用 ID 与工具结果的对应关系", () => {
    const input = request();
    input.contents.push({
      role: "model",
      parts: [
        {
          functionCall: {
            id: "call-1",
            name: "save_greeting",
            args: { greeting: "祝福" },
          },
        },
      ],
    });
    input.contents.push({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: "call-1",
            name: "save_greeting",
            response: { saved: true },
          },
        },
      ],
    });
    const result = toDeepSeekRequest(input, "deepseek-flash");
    expect(result.messages[2].tool_calls?.[0].id).toBe("call-1");
    expect(result.messages[3]).toEqual({
      role: "tool",
      tool_call_id: "call-1",
      content: '{"saved":true}',
    });
  });

  it("只向官方端点发送当次密钥，关闭思考与重定向，不返回隐藏推理", async () => {
    const mock = vi.fn().mockResolvedValue(Response.json(completion()));
    vi.stubGlobal("fetch", mock);
    const result = await new DeepSeekModel({
      model: "deepseek-flash",
      apiKey: "private-test-key",
    })
      .generateContentAsync(request())
      .next();
    expect(mock.mock.calls[0][0]).toBe(
      "https://api.deepseek.com/chat/completions",
    );
    const options = mock.mock.calls[0][1];
    expect(options.headers.Authorization).toBe("Bearer private-test-key");
    expect(options.redirect).toBe("error");
    expect(options.body).not.toContain("private-test-key");
    expect(JSON.parse(options.body)).toMatchObject({
      thinking: { type: "disabled" },
      stream: false,
    });
    expect(result.value).toMatchObject({
      content: {
        parts: [{ functionCall: { id: "call-1", name: "save_greeting" } }],
      },
      usageMetadata: { totalTokenCount: 30 },
    });
    expect(JSON.stringify(result.value)).not.toContain("隐藏推理");
  });

  it.each([
    ["未知工具", completion("delete_everything")],
    ["非法参数", completion("save_greeting", "not-json-with-secret")],
    ["被截断", completion("save_greeting", "{}", "length")],
  ])("拒绝%s，错误不泄露原始内容", async (_, response) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(response)));
    await expect(
      new DeepSeekModel({ model: "deepseek-flash", apiKey: "test-key" })
        .generateContentAsync(request())
        .next(),
    ).rejects.toThrow(/^模型/);
  });

  it("拒绝不支持的文件输入，不静默丢弃图片", () => {
    const input = request();
    input.contents = [
      {
        role: "user",
        parts: [{ fileData: { fileUri: "https://private.example/image.png" } }],
      },
    ];
    expect(() => toDeepSeekRequest(input, "deepseek-flash")).toThrow("不支持");
  });

  it("HTTP 与网络错误不会携带响应原文或密钥", async () => {
    const input = toDeepSeekRequest(request(), "deepseek-flash");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("private-test-key", { status: 401 })),
    );
    await expect(completeDeepSeek(input, "private-test-key")).rejects.toThrow(
      "HTTP 401",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private-test-key")),
    );
    await expect(completeDeepSeek(input, "private-test-key")).rejects.toThrow(
      "DeepSeek 请求未完成",
    );
  });
});
