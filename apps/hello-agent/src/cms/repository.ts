import { createHash } from "node:crypto";
import type {
  Payload,
  Where,
  DataFromCollectionSlug,
  RequiredDataFromCollectionSlug,
} from "payload";
import type { Config, SessionLock } from "../payload-types";
import { AppError, type Owner } from "../domain/contracts";

// 认证凭证、管理员与 Payload 内部集合不能通过访客仓库操作。
export type OwnedCollection = Extract<
  keyof Config["collections"],
  "sessions" | "greetings" | "media" | "adk-sessions" | "session-locks"
>;
type CreateData<C extends OwnedCollection> = Omit<
  RequiredDataFromCollectionSlug<C>,
  "owner"
> & { owner?: never };
type UpdateData<C extends OwnedCollection> = Partial<CreateData<C>>;

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
  async list<C extends OwnedCollection>(
    collection: C,
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
    return result.docs;
  }
  async all<C extends OwnedCollection>(collection: C, where: Where = {}) {
    const rows: DataFromCollectionSlug<C>[] = [];
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
  async get<C extends OwnedCollection>(collection: C, id: number) {
    const rows = await this.list(collection, { id: { equals: id } }, 1);
    if (!rows[0]) throw new AppError(404, "记录不存在或无权访问");
    return rows[0];
  }
  async create<C extends OwnedCollection>(
    collection: C,
    data: CreateData<NoInfer<C>>,
  ) {
    return this.payload.create({
      collection,
      ...this.options,
      // TS 无法证明泛型 Omit 再补回 owner 等于原类型。唯一补回的字段由仓库提供；调用者仍受生成类型约束。
      data: {
        ...data,
        owner: this.owner.id,
      } as RequiredDataFromCollectionSlug<C>,
    });
  }
  async update<C extends OwnedCollection>(
    collection: C,
    id: number,
    data: UpdateData<NoInfer<C>>,
  ) {
    await this.get(collection, id);
    const updateById = this.payload.update<C, Config["collectionsSelect"][C]>;
    return updateById.call(this.payload, {
      collection,
      id,
      ...this.options,
      // 与 create 相同，仅在注入 owner 的 SDK 适配点补足泛型证明；不对读取结果强转。
      data: { ...data, owner: this.owner.id } as Parameters<
        typeof updateById
      >[0]["data"],
    });
  }
  async remove<C extends OwnedCollection>(collection: C, id: number) {
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
    let lock: SessionLock;
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
