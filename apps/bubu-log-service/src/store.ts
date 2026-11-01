import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { buildConfig, getPayload, createLocalReq, initTransaction, commitTransaction, killTransaction, type PayloadRequest, type Payload, type CollectionConfig, type Where, type Config } from "payload";
import { migrations } from "./migrations";
import { sqliteAdapter } from "@payloadcms/db-sqlite";

/** @public Core table registry for downstream runtime and operations schema composition. */
export const tables = ["identities", "sessions", "grants", "invitations", "group-bindings", "audit"] as const;
type Table = typeof tables[number];
interface Row { id: string; key: string; value: Record<string, unknown>; createdAt?: string }
export const collections: CollectionConfig[] = tables.map((slug) => ({
  slug, timestamps: true,
  access: { read: () => false, create: () => false, update: () => false, delete: () => false },
  fields: [{ name: "id", type: "text" }, { name: "key", type: "text", required: true, unique: true },
    { name: "value", type: "json", required: true }],
}));
// Internal Local API repository. Never expose Payload REST for these collections.
export class Store {
  private readonly transactions = new AsyncLocalStorage<PayloadRequest>();
  constructor(readonly payload: Payload) {}
  /** The callback and every Store operation share one real Payload/SQLite transaction. */
  async transaction<T>(action: (req: PayloadRequest) => Promise<T>): Promise<T> {
    const current = this.transactions.getStore();
    if (current) return action(current);
    const req = await createLocalReq({ context: { bubuInternal: true } }, this.payload);
    await initTransaction(req);
    if (!req.transactionID) throw new Error("Identity database requires transaction support");
    try {
      const result = await this.transactions.run(req, () => action(req));
      await commitTransaction(req);
      return result;
    } catch (error) { await killTransaction(req); throw error; }
  }
  async list(table: Table, where?: Where): Promise<Row[]> {
    const result = await this.payload.find({ collection: table, where, limit: 0, pagination: false, depth: 0, overrideAccess: true, req: this.transactions.getStore() });
    return result.docs as unknown as Row[];
  }
  async get(table: Table, key: string): Promise<Row | undefined> {
    return (await this.list(table, { key: { equals: key } }))[0];
  }
  async put(table: Table, key: string, value: Record<string, unknown>): Promise<Row> {
    const old = await this.get(table, key);
    const row = old
      ? await this.payload.update({ collection: table, id: old.id, data: { value }, overrideAccess: true, req: this.transactions.getStore() })
      : await this.payload.create({ collection: table, data: { id: key, key, value }, overrideAccess: true, req: this.transactions.getStore() });
    return row as unknown as Row;
  }
  currentRequest(): PayloadRequest | undefined { return this.transactions.getStore(); }
  async close() { await this.payload.destroy(); }
}
interface StoreOptions { directory: string; secret?: string; extensions?: CollectionConfig[]; schemaOnly?: boolean; configure?: (config: Config) => Config }
export async function buildStoreConfig(options: StoreOptions) {
  const directory = path.resolve(options.directory);
  if (!options.schemaOnly) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const secretFile = path.join(directory, "secret");
  if (!options.secret && !existsSync(secretFile)) writeFileSync(secretFile, randomBytes(48).toString("hex"), { flag: "wx", mode: 0o600 });
  const config: Config = {
    secret: options.secret || readFileSync(secretFile, "utf8"), collections: [...collections, ...(options.extensions || [])],
    db: sqliteAdapter({ client: { url: options.schemaOnly ? "file::memory:" : `file:${directory}/identity.db` }, push: !options.schemaOnly && process.env.NODE_ENV !== "production", prodMigrations: options.schemaOnly ? [] : migrations, transactionOptions: {} }),
    typescript: { autoGenerate: false }, telemetry: false,
  };
  return buildConfig(options.configure ? options.configure(config) : config);
}
export async function openStore(options: StoreOptions): Promise<Store> {
  const config = await buildStoreConfig(options);
  return new Store(await getPayload({ config, key: `${path.resolve(options.directory)}:${randomBytes(12).toString("hex")}` }));
}
