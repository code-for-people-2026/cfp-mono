import { projectVisibleRows } from "../operations/enforcement";
import { createHash } from "node:crypto";
import type {
  Payload,
  Where,
  DataFromCollectionSlug,
  RequiredDataFromCollectionSlug,
} from "payload";
import type { Config, SessionLock } from "../payload-types";
import { AppError, type Owner } from "../domain/contracts";
import { assertSessionLease, holdSessionLease, SESSION_LEASE_MS } from "./session-lease";

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
    assertSessionLease(this.owner.id);
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
    return projectVisibleRows(this.payload, this.owner.id, collection, result.docs);
  }
  async all<C extends OwnedCollection>(collection: C, where: Where = {}) {
    const rows: (DataFromCollectionSlug<C> & { visibility?: "quarantined" })[] = [];
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
    const options = this.options;
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
        expiresAt: new Date(Date.now() + SESSION_LEASE_MS).toISOString(),
      });
    } catch {
      throw new AppError(
        409,
        "阿 J 先生正在回复，请稍后重试；若刚才意外中断，请三分钟后再试",
      );
    }
    return holdSessionLease({
      // SQLite can reuse a deleted row ID. A replacement acquired after expiry
      // has a newer creation time, which fences the previous worker as well.
      owner: this.owner.id, id: lock.id, createdAt: lock.createdAt, expiresAt: Date.parse(lock.expiresAt),
      renew: async (now, expiresAt) => {
        const result = await this.payload.update({ collection: "session-locks", ...options,
          where: { and: [{ id: { equals: lock.id } }, { createdAt: { equals: lock.createdAt } }, { owner: { equals: this.owner.id } }, { expiresAt: { greater_than: new Date(now).toISOString() } }] },
          data: { expiresAt: new Date(expiresAt).toISOString() },
        });
        return result.docs.length === 1 && result.errors.length === 0;
      },
      release: async () => {
        await this.payload.delete({ collection: "session-locks", ...options, where: { and: [{ id: { equals: lock.id } }, { createdAt: { equals: lock.createdAt } }, { owner: { equals: this.owner.id } }] } });
      },
    });
  }
}

export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
