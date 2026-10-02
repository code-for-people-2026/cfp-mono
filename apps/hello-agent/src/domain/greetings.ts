import sharp from "sharp";
import { Repository, fingerprint, type Row } from "../cms/repository";
import {
  AppError,
  externalSchema,
  turnSchema,
  greetingSchema,
  type Greeting,
  type Mode,
  type Inspiration,
} from "./contracts";
import { PROMPT_VERSION } from "../agent/instruction";
import type { Generator } from "../agent/runtime";
import { DEFAULT_MODEL } from "../models/deepseek";
import { ContextService } from "./context";
import { MAX_STORED_IMAGE_BYTES } from "./media-policy";
import { MediaService } from "./media";

// 外部 MCP 路径只保存产物，不加载或启动平台的 Agent 运行时。
const platformGenerator: Generator = async (request) => {
  const { runGreeting } = await import("../agent/runtime");
  return runGreeting(request);
};

export class GreetingService {
  constructor(
    readonly repo: Repository,
    private generate: Generator = platformGenerator,
    readonly media = new MediaService(repo),
  ) {}

  async sessions() {
    return (await this.repo.all("sessions")).map(
      ({ id, title, createdAt }) => ({ id, title, createdAt }),
    );
  }
  async createSession(title = "与阿J的日常") {
    return this.repo.create("sessions", { title: title.slice(0, 80) });
  }
  async history(sessionId: number) {
    await this.repo.get("sessions", sessionId);
    return this.repo.all("greetings", { sessionId: { equals: sessionId } });
  }
  async upload(data: Uint8Array) {
    if (data.length > 5 * 1024 * 1024)
      throw new AppError(413, "单张图片不能超过 5 MB");
    let buffer: Buffer;
    try {
      const metadata = await sharp(data, {
        limitInputPixels: 20_000_000,
      }).metadata();
      if (!["jpeg", "png", "webp"].includes(metadata.format || ""))
        throw new Error("unsupported");
      buffer = await sharp(data, { limitInputPixels: 20_000_000 })
        .rotate()
        .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch {
      throw new AppError(400, "请上传有效的 JPEG、PNG 或 WebP 图片");
    }
    if (buffer.length > MAX_STORED_IMAGE_BYTES)
      throw new AppError(413, "处理后的图片仍过大");
    const row = await this.media.save(buffer);
    return {
      id: row.id,
      mimeType: "image/jpeg",
      url: `/api/hello/media/${row.id}`,
    };
  }
  private async begin(
    sessionId: number,
    requestId: string,
    mode: Mode,
    input: Inspiration,
    model: string,
    extra?: unknown,
  ) {
    await this.repo.get("sessions", sessionId);
    await Promise.all(input.mediaIds.map((id) => this.repo.get("media", id)));
    const requestKey = `${this.repo.owner.id}:${requestId}`;
    const hash = fingerprint({ sessionId, mode, input, model, extra });
    const existing = (
      await this.repo.list(
        "greetings",
        { requestKey: { equals: requestKey } },
        1,
      )
    )[0];
    if (existing) {
      if (existing.fingerprint !== hash)
        throw new AppError(409, "同一个请求标识不能用于不同内容");
      if (existing.status === "running")
        throw new AppError(
          409,
          "本轮仍在执行；若进程曾中断，请使用新的请求标识重试",
        );
      if (existing.status === "failed")
        throw new AppError(409, "该请求此前失败，请使用新的请求标识重试");
      return { row: existing, duplicate: true };
    }
    await new ContextService(this.repo).ensureRoom(sessionId);
    const row = await this.repo.create("greetings", {
      sessionId,
      requestKey,
      fingerprint: hash,
      mode,
      input,
      status: "running",
      model,
      promptVersion: mode === "external" ? "external-declared" : PROMPT_VERSION,
    });
    return { row, duplicate: false };
  }
  async complete(id: number, value: Greeting) {
    const output = greetingSchema.parse(value);
    const row = await this.repo.get("greetings", id);
    if (row.status === "completed") {
      if (
        row.greeting !== output.greeting ||
        row.association !== output.association
      )
        throw new AppError(409, "本轮产物已保存，不能覆盖");
      return row;
    }
    if (row.status !== "running") throw new AppError(409, "本轮不再接受产物");
    return this.repo.update("greetings", id, {
      ...output,
      status: "completed",
    });
  }
  async generateGreeting(value: unknown) {
    const args = turnSchema.parse(value);
    const key =
      args.mode === "byok" ? args.apiKey : process.env.DEEPSEEK_API_KEY;
    if (!key)
      throw new AppError(
        503,
        args.mode === "byok"
          ? "请填写本次使用的 DeepSeek API Key"
          : "平台尚未配置 DeepSeek API Key，可先使用 BYOK 或外部 Agent",
      );
    const model = process.env.HELLO_MODEL || DEFAULT_MODEL;
    const release = await this.repo.acquire(args.sessionId);
    let row: Row | undefined;
    const started = Date.now();
    try {
      const result = await this.begin(
        args.sessionId,
        args.requestId,
        args.mode,
        args.input,
        model,
      );
      row = result.row;
      if (result.duplicate) return row;
      await this.generate({
        repo: this.repo,
        turnId: row.id,
        sessionId: args.sessionId,
        input: args.input,
        apiKey: key,
        model,
        readImage: (id) => this.media.read(id),
        save: (output) => this.complete(row!.id, output),
      });
      const saved = await this.repo.get("greetings", row.id);
      if (saved.status !== "completed")
        throw new AppError(502, "模型没有调用保存工具，本轮未产生吉祥话");
      return await this.repo.update("greetings", row.id, {
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (row) {
        const saved = await this.repo.get("greetings", row.id);
        // 工具已经成功保存时，后续说明或事件失败不能把成功产物标为失败。
        if (saved.status === "completed") return saved;
        await this.repo.update("greetings", row.id, {
          status: "failed",
          error: "模型调用或保存失败，请检查配置后重试",
          durationMs: Date.now() - started,
        });
      }
      if (error instanceof AppError) throw error;
      // 供应商原始异常可能含请求、密钥或图片；不写日志、数据库或响应。
      throw new AppError(
        502,
        "生成失败：请检查模型密钥、配额和网络；没有使用假回复替代",
      );
    } finally {
      await release();
    }
  }
  async acceptExternal(value: unknown) {
    const args = externalSchema.parse(value);
    const release = await this.repo.acquire(args.sessionId);
    try {
      const { row, duplicate } = await this.begin(
        args.sessionId,
        args.requestId,
        "external",
        args.input,
        args.model,
        args.output,
      );
      if (duplicate) return row;
      return await this.complete(row.id, args.output);
    } finally {
      await release();
    }
  }
}
