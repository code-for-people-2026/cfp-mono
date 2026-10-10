import { randomUUID } from "node:crypto";
import {
  BaseSessionService,
  type Session,
  type CreateSessionRequest,
  type GetSessionRequest,
  type ListSessionsRequest,
  type DeleteSessionRequest,
  type AppendEventRequest,
} from "@google/adk";
import { Repository } from "../cms/repository";
import { AppError } from "../domain/contracts";

// ADK 执行会话属于一个生成轮次；产品祝福会话由 sessions / greetings 管理。
// 避免再引入 ADK DatabaseSessionService 的第二套 ORM 与数据库。
export class PayloadSessionService extends BaseSessionService {
  constructor(private repo: Repository) {
    super();
  }
  private key(appName: string, userId: string, sessionId: string) {
    if (userId !== this.repo.owner.id || appName !== "hello_agent")
      throw new AppError(403, "执行会话范围不匹配");
    return `${appName}:${userId}:${sessionId}`;
  }
  async createSession(request: CreateSessionRequest): Promise<Session> {
    const id = request.sessionId || randomUUID();
    const key = this.key(request.appName, request.userId, id);
    const session: Session = {
      id,
      appName: request.appName,
      userId: request.userId,
      state: request.state || {},
      events: [],
      lastUpdateTime: Date.now() / 1000,
    };
    await this.repo.create("adk-sessions", { key, snapshot: session });
    return session;
  }
  async getSession(request: GetSessionRequest) {
    const key = this.key(request.appName, request.userId, request.sessionId);
    const row = (
      await this.repo.list("adk-sessions", { key: { equals: key } }, 1)
    )[0];
    if (!row) return undefined;
    const session = structuredClone(row.snapshot);
    if (request.config?.afterTimestamp)
      session.events = session.events.filter(
        (e) => e.timestamp >= request.config!.afterTimestamp!,
      );
    if (request.config?.numRecentEvents !== undefined)
      session.events =
        request.config.numRecentEvents > 0
          ? session.events.slice(-request.config.numRecentEvents)
          : [];
    return session;
  }
  async listSessions(request: ListSessionsRequest) {
    if (
      request.appName !== "hello_agent" ||
      (request.userId && request.userId !== this.repo.owner.id)
    )
      throw new AppError(403, "无权读取执行会话");
    const rows = await this.repo.list("adk-sessions", {}, 1000);
    const all = rows
      .map((row) => row.snapshot)
      .sort(
        (a, b) =>
          (request.order === "asc" ? 1 : -1) *
          (a.lastUpdateTime - b.lastUpdateTime),
      );
    const limit = Math.max(1, request.limit || all.length || 1);
    const offset = request.page
      ? (request.page - 1) * limit
      : request.offset || 0;
    return {
      sessions: all
        .slice(offset, offset + limit)
        .map((s) => ({ ...s, events: [], state: {} })),
      page: Math.floor(offset / limit) + 1,
      limit,
      totalItems: all.length,
      totalPages: Math.ceil(all.length / limit),
    };
  }
  async deleteSession(request: DeleteSessionRequest) {
    const key = this.key(request.appName, request.userId, request.sessionId);
    const row = (
      await this.repo.list("adk-sessions", { key: { equals: key } }, 1)
    )[0];
    if (row) await this.repo.remove("adk-sessions", row.id);
  }
  async appendEvent(request: AppendEventRequest) {
    const event = await super.appendEvent(request);
    if (event.partial) return event;
    request.session.lastUpdateTime = Date.now() / 1000;
    const snapshot = structuredClone(request.session);
    // 事件可审阅，但不重复保存图片字节，也不保存模型隐藏思考内容。
    for (const item of snapshot.events) {
      if (item.errorMessage)
        item.errorMessage = "模型事件报错（原始详情未持久化）";
      if (item.content?.parts)
        item.content.parts = item.content.parts
          .filter((p) => !p.thought)
          .map((p) =>
            p.inlineData ? { text: "[图片内容见本轮灵感输入的媒体引用]" } : p,
          );
    }
    const key = this.key(snapshot.appName, snapshot.userId, snapshot.id);
    const row = (
      await this.repo.list("adk-sessions", { key: { equals: key } }, 1)
    )[0];
    if (!row) throw new AppError(404, "执行会话已失效");
    await this.repo.update("adk-sessions", row.id, { snapshot });
    return event;
  }
}
