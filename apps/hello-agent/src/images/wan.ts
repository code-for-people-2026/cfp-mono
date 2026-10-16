import { setTimeout as pause } from "node:timers/promises";
import { z } from "zod";
import { AppError } from "../domain/contracts";

export const imageRequestSchema = z.object({
  prompt: z.string().trim().min(2).max(1800),
  title: z.string().trim().min(1).max(80),
  alt: z.string().trim().min(1).max(300),
  aspectRatio: z.enum(["square", "portrait", "landscape"]),
}).strict();
export type ImageRequest = z.infer<typeof imageRequestSchema>;
export const WAN_MODEL = "wan2.6-t2i";
const sizes = { square: "1280*1280", portrait: "1104*1472", landscape: "1472*1104" };
const taskIdSchema = z.string().regex(/^[a-zA-Z0-9-]{1,100}$/);
export class ImageTaskFailed extends AppError {}
export type ImageProvider = {
  submit(input: ImageRequest, signal: AbortSignal): Promise<string>;
  result(taskId: string, signal: AbortSignal): Promise<Buffer>;
};
export function imageGenerationConfigured() {
  return !!process.env.DASHSCOPE_API_KEY?.trim();
}

export function configuredImageProvider(): ImageProvider {
  const key = process.env.DASHSCOPE_API_KEY?.trim();
  if (!key) throw new AppError(503, "生图服务尚未配置，请联系管理员开通百炼万相");
  const workspace = process.env.HELLO_IMAGE_WORKSPACE_ID?.trim();
  if (workspace && !/^[a-zA-Z0-9-]{1,100}$/.test(workspace)) throw new AppError(503, "生图业务空间配置无效");
  // Deliberately fixed to the mainland Beijing service; credentials never follow redirects.
  const origin = workspace ? `https://${workspace}.cn-beijing.maas.aliyuncs.com` : "https://dashscope.aliyuncs.com";
  return wanProvider(origin, key);
}

const responseSchema = z.object({
  code: z.string().optional(),
  output: z.object({
    task_id: taskIdSchema.optional(),
    task_status: z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN"]),
    choices: z.array(z.object({ message: z.object({ content: z.array(z.object({ image: z.string().optional() })) }) })).optional(),
  }).optional(),
});

async function boundedBody(response: Response, maximum: number): Promise<Buffer> {
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel();
    throw new AppError(502, "生图服务返回的文件过大");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new AppError(502, "生图服务返回了空内容");
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximum) throw new AppError(502, "生图服务返回的文件过大");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}

// Exact provider buckets only: the documented Beijing bucket and the accelerated
// bucket returned by the authenticated Beijing Wan 2.6 API in live verification.
const resultHosts = new Set(["dashscope-result-bj.oss-cn-beijing.aliyuncs.com", "dashscope-a717.oss-accelerate.aliyuncs.com"]);
export function validateWanImageUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !resultHosts.has(url.hostname) ||
      url.port || url.username || url.password || url.hash) throw new AppError(502, "生图结果来源不符合约定");
  return url;
}

export function wanProvider(origin: string, key: string, transport: typeof fetch = fetch, pollMs = 10_000): ImageProvider {
  async function api(path: string, signal: AbortSignal, body?: unknown) {
    try {
      const response = await transport(`${origin}${path}`, {
        method: body ? "POST" : "GET", redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json", "X-DashScope-Async": "enable" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) {
        await response.body?.cancel();
        if ([401, 403].includes(response.status)) throw new AppError(503, "百炼生图凭证或模型权限不可用，请联系管理员检查");
        if (response.status === 429) throw new AppError(503, "生图服务繁忙，请稍后继续取图");
        throw new AppError(502, "生图请求未完成，请稍后继续取图");
      }
      const data = responseSchema.parse(JSON.parse((await boundedBody(response, 64 * 1024)).toString("utf8")));
      if (data.code || !data.output) throw new AppError(502, "生图服务未返回有效任务");
      return data.output;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(502, "生图服务连接中断或响应无效，请稍后继续取图");
    }
  }
  return {
    async submit(value, signal) {
      const input = imageRequestSchema.parse(value);
      const output = await api("/api/v1/services/aigc/image-generation/generation", signal, {
        model: WAN_MODEL, input: { messages: [{ role: "user", content: [{ text: input.prompt }] }] },
        parameters: { size: sizes[input.aspectRatio], n: 1, prompt_extend: false, watermark: true },
      });
      return taskIdSchema.parse(output.task_id);
    },
    async result(id, signal) {
      const taskId = taskIdSchema.parse(id);
      while (!signal.aborted) {
        const output = await api(`/api/v1/tasks/${taskId}`, signal);
        if (output.task_id !== taskId) throw new AppError(502, "生图任务编号不一致");
        if (["FAILED", "CANCELED", "UNKNOWN"].includes(output.task_status))
          throw new ImageTaskFailed(502, "这次图片生成失败或任务已过期，请重新提出图片需求");
        if (output.task_status === "SUCCEEDED") {
          const images = output.choices?.flatMap((choice) => choice.message.content.flatMap((part) => part.image ? [part.image] : []));
          if (images?.length !== 1) throw new AppError(502, "生图结果数量不符合约定");
          const url = validateWanImageUrl(images[0]);
          try {
            const response = await transport(url, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
            if (!response.ok) { await response.body?.cancel(); throw new Error("download failed"); }
            return await boundedBody(response, 16 * 1024 * 1024);
          } catch (error) {
            if (error instanceof AppError) throw error;
            throw new AppError(502, "图片已生成但下载未完成，请稍后继续取图");
          }
        }
        try { await pause(pollMs, undefined, { signal }); }
        catch { break; }
      }
      throw new AppError(408, "图片仍在处理中，可稍后继续取图，不会重新提交生图任务");
    },
  };
}
