import { createHash } from "node:crypto";
import type { Payload, Where } from "payload";
import { AppError, type Owner } from "../domain/contracts";

export type Row = { id: number; owner: string; [key: string]: unknown };

export class Repository {
  constructor(
    readonly payload: Payload,
    readonly owner: Owner,
  ) {}
  private get options() {
    return {
      overrideAccess: false,
      context: { helloOwner: this.owner.id, helloWrite: true },
    };
  }
  async list(
    collection: string,
    where: Where = {},
    limit = 100,
    sort = "createdAt",
  ) {
    const result = await this.payload.find({
      collection,
      ...this.options,
      where: { and: [{ owner: { equals: this.owner.id } }, where] },
      limit,
      sort,
      depth: 0,
    });
    return result.docs as Row[];
  }
  async all(collection: string, where: Where = {}) {
    const rows: Row[] = [];
    let cursor = 0;
    while (true) {
      const page = await this.list(
        collection,
        { and: [where, { id: { greater_than: cursor } }] },
        100,
        "id",
      );
      rows.push(...page);
      if (page.length < 100) return rows;
      cursor = page[page.length - 1].id;
    }
  }
  async get(collection: string, id: number) {
    const rows = await this.list(collection, { id: { equals: id } }, 1);
    if (!rows[0]) throw new AppError(404, "记录不存在或无权访问");
    return rows[0];
  }
  async create(collection: string, data: Record<string, unknown>) {
    return (await this.payload.create({
      collection,
      ...this.options,
      data: { ...data, owner: this.owner.id },
    })) as Row;
  }
  async update(collection: string, id: number, data: Record<string, unknown>) {
    await this.get(collection, id);
    return (await this.payload.update({
      collection,
      id,
      ...this.options,
      data: { ...data, owner: this.owner.id },
    })) as Row;
  }
  async remove(collection: string, id: number) {
    await this.get(collection, id);
    await this.payload.delete({ collection, id, ...this.options });
  }
  async acquire(sessionId: number) {
    await this.get("sessions", sessionId);
    const sessionKey = `${this.owner.id}:${sessionId}`;
    // 过期锁用带条件删除，不能删掉另一轮新获取的锁。
    await this.payload.delete({
      collection: "session-locks",
      ...this.options,
      where: {
        and: [
          { owner: { equals: this.owner.id } },
          { sessionKey: { equals: sessionKey } },
          { expiresAt: { less_than: new Date().toISOString() } },
        ],
      },
    });
    let lock: Row;
    try {
      lock = await this.create("session-locks", {
        sessionKey,
        expiresAt: new Date(Date.now() + 180_000).toISOString(),
      });
    } catch {
      throw new AppError(
        409,
        "阿J正在回复，请稍后重试；若刚才意外中断，请三分钟后再试",
      );
    }
    return async () => {
      await this.remove("session-locks", lock.id);
    };
  }
}

export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
