import { BaseLlm, type LlmRequest, type LlmResponse } from "@google/adk";
import type { Part } from "@google/genai";
import { z } from "zod";
import {
  completeDeepSeek,
  type ModelContent,
  type ModelMessage,
  type ModelRequest,
  type ModelTool,
} from "../models/deepseek";

// ADK 使用 Google 的内容类型，但这些类型不决定模型供应商。
// 此适配器只支持本例需要的文本、内联图片和函数调用；不支持实时连接或隐藏推理。
function jsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(jsonSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "type" && typeof child === "string"
        ? child.toLowerCase()
        : [
              "minLength",
              "maxLength",
              "minItems",
              "maxItems",
              "minProperties",
              "maxProperties",
            ].includes(key) &&
            typeof child === "string" &&
            /^\d+$/.test(child)
          ? Number(child)
          : jsonSchema(child),
    ]),
  );
}

export function toDeepSeekRequest(
  request: LlmRequest,
  model: string,
): ModelRequest {
  const messages: ModelMessage[] = [];
  const instruction = request.config?.systemInstruction;
  if (instruction) {
    if (typeof instruction !== "string")
      throw new Error("仅支持独立文本系统指令");
    messages.push({ role: "system", content: instruction });
  }
  for (const content of request.contents) {
    const blocks: ModelContent[] = [];
    const calls: NonNullable<ModelMessage["tool_calls"]> = [];
    const responses: ModelMessage[] = [];
    for (const part of content.parts || []) {
      if (part.thought) continue;
      if (part.text !== undefined)
        blocks.push({ type: "text", text: part.text });
      else if (
        part.inlineData?.data &&
        part.inlineData.mimeType?.startsWith("image/")
      ) {
        if (content.role !== "user")
          throw new Error("图片只允许出现在用户输入中");
        blocks.push({
          type: "image_url",
          image_url: {
            url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
          },
        });
      } else if (part.functionCall?.id && part.functionCall.name) {
        calls.push({
          id: part.functionCall.id,
          type: "function",
          function: {
            name: part.functionCall.name,
            arguments: JSON.stringify(part.functionCall.args || {}),
          },
        });
      } else if (part.functionResponse?.id) {
        responses.push({
          role: "tool",
          tool_call_id: part.functionResponse.id,
          content: JSON.stringify(part.functionResponse.response || {}),
        });
      } else throw new Error("存在不支持的模型内容，未静默忽略");
    }
    if (blocks.length || calls.length)
      messages.push({
        role: content.role === "model" ? "assistant" : "user",
        content: blocks.length
          ? content.role === "model"
            ? blocks
                .map((block) => (block.type === "text" ? block.text : ""))
                .join("\n")
            : blocks
          : null,
        ...(calls.length ? { tool_calls: calls } : {}),
      });
    messages.push(...responses);
  }
  const tools: ModelTool[] = [];
  for (const tool of request.config?.tools || []) {
    if (!("functionDeclarations" in tool) || !tool.functionDeclarations)
      throw new Error("仅支持函数工具");
    for (const declaration of tool.functionDeclarations) {
      if (!declaration.name) throw new Error("工具缺少名称");
      tools.push({
        type: "function",
        function: {
          name: declaration.name,
          description: declaration.description,
          parameters: jsonSchema(
            declaration.parametersJsonSchema ||
              declaration.parameters || { type: "object", properties: {} },
          ),
        },
      });
    }
  }
  const config = request.config?.toolConfig?.functionCallingConfig;
  const allowed = config?.allowedFunctionNames;
  const selected = allowed?.length
    ? tools.filter((tool) => allowed.includes(tool.function.name))
    : tools;
  const toolChoice: ModelRequest["tool_choice"] =
    config?.mode === "NONE"
      ? "none"
      : config?.mode === "ANY"
        ? selected.length === 1
          ? { type: "function", function: { name: selected[0].function.name } }
          : "required"
        : "auto";
  return {
    model,
    messages,
    tools: selected,
    tool_choice: toolChoice,
    max_tokens: request.config?.maxOutputTokens || 2048,
  };
}

export class DeepSeekModel extends BaseLlm {
  constructor(private readonly settings: { model: string; apiKey: string }) {
    super({ model: settings.model });
  }

  async *generateContentAsync(
    request: LlmRequest,
    stream = false,
    signal?: AbortSignal,
  ): AsyncGenerator<LlmResponse> {
    if (stream) throw new Error("此示例未实现流式模型响应");
    const input = toDeepSeekRequest(request, this.model);
    const response = await completeDeepSeek(
      input,
      this.settings.apiKey,
      signal,
    );
    const choice = response.choices[0];
    if (!["stop", "tool_calls"].includes(choice.finish_reason))
      throw new Error("模型输出未完整结束");
    const parts: Part[] = [];
    if (choice.message.content) parts.push({ text: choice.message.content });
    for (const call of choice.message.tool_calls || []) {
      if (
        !input.tools.some((tool) => tool.function.name === call.function.name)
      )
        throw new Error("模型选择了未授权工具");
      let args: Record<string, unknown>;
      try {
        args = z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(call.function.arguments));
      } catch {
        throw new Error("模型工具参数无效");
      }
      parts.push({
        functionCall: { id: call.id, name: call.function.name, args },
      });
    }
    if (!parts.length) throw new Error("模型没有返回内容");
    yield {
      content: { role: "model", parts },
      modelVersion: response.model,
      usageMetadata: response.usage
        ? {
            promptTokenCount: response.usage.prompt_tokens,
            candidatesTokenCount: response.usage.completion_tokens,
            totalTokenCount: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  async connect(): Promise<never> {
    throw new Error("此模型适配器不支持实时连接");
  }
}
