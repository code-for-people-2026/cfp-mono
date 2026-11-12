import { randomUUID } from "node:crypto";
import type { PayloadRequest } from "payload";
import { AppError } from "../contracts";
import type { ActorScope, IdentityService } from "../identity";
import { hash } from "../records/persistence";
import { PrivacyRepository } from "../privacy/persistence";
import type { AttachmentObjectStore } from "./attachment-objects";

export interface MediaUploadIntent {
  version: 1;
  operation: "put";
  babyId: string;
  identityId: string;
  actor: Pick<ActorScope["actor"], "kind" | "id" | "onBehalfOf">;
  attachmentId: string;
  objectKey: string;
  state: "inflight" | "uncertain" | "completed";
  processId: string;
  startedAt: string;
  updatedAt: string;
}

export interface MediaUploadActor {
  kind: ActorScope["actor"]["kind"];
  id: string;
  onBehalfOf?: string;
}

export interface VerifiedMediaPut<TContext, TResult> {
  babyId: string;
  actor: MediaUploadActor;
  attachmentId: string;
  objectKey: string;
  beforePut(req: PayloadRequest): Promise<TContext>;
  put(): Promise<void>;
  verify(): Promise<void>;
  afterPut(context: TContext): Promise<TResult>;
}

interface StoredAttachmentReference {
  babyId: string;
  sha256: string;
  storage?: { kind: "oss"; key: string };
}

const MEDIA_PROCESS_ID = randomUUID();
const OBJECT_KEY = /^[a-f0-9]{64}\/[a-f0-9]{64}$/;
const uncertain = () => new AppError(
  503,
  "MEDIA_UPLOAD_UNCERTAIN",
  "照片远端结果尚未核实，删除保持重试，需外部核对后处理。",
);

function objectKeyFor(value: StoredAttachmentReference): string | undefined {
  const derived = `${hash(value.babyId)}/${value.sha256}`;
  if (!OBJECT_KEY.test(derived) || value.storage?.kind !== "oss" || value.storage.key !== derived) return OBJECT_KEY.test(derived) ? derived : undefined;
  return derived;
}

/** Serializes remote writes/purges independently from the identity transaction queue. */
export class MediaOperations {
  private readonly repository: PrivacyRepository;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly activeKeys = new Map<string, number>();
  private startupError?: unknown;
  private readonly startup: Promise<void>;

  constructor(private readonly identity: IdentityService, private readonly objectStore: AttachmentObjectStore) {
    this.repository = new PrivacyRepository(identity.store.payload);
    this.startup = this.transaction(async req => {
      const rows = await this.repository.list<MediaUploadIntent>("privacy-state", undefined, req);
      for (const row of rows) {
        if (!row.key.startsWith("media-upload:") || row.value.state !== "inflight" || row.value.processId === MEDIA_PROCESS_ID) continue;
        await this.repository.put("privacy-state", row.key, { ...row.value, state: "uncertain", updatedAt: new Date(this.identity.now()).toISOString() }, { babyId: row.value.babyId, identityId: row.value.identityId }, req);
      }
    }).catch(error => { this.startupError = error; });
  }

  private transaction<T>(action: (req: PayloadRequest) => Promise<T>): Promise<T> {
    return this.identity.exclusive(() => this.identity.store.transaction(action));
  }

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const run = async () => {
      await this.startup;
      if (this.startupError !== undefined) throw this.startupError;
      return action();
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }

  async putVerified<TContext, TResult>(operation: VerifiedMediaPut<TContext, TResult>): Promise<TResult> {
    if (!OBJECT_KEY.test(operation.objectKey)) throw new Error("Invalid media object key");
    return this.enqueue(async () => {
      this.reserveActiveKey(operation.objectKey);
      const intentId = `media-upload:${randomUUID()}`;
      const now = () => new Date(this.identity.now()).toISOString();
      const intent = (state: MediaUploadIntent["state"]): MediaUploadIntent => ({
        version: 1, operation: "put", babyId: operation.babyId,
        identityId: operation.actor.onBehalfOf || operation.actor.id,
        actor: { kind: operation.actor.kind, id: operation.actor.id, ...(operation.actor.onBehalfOf ? { onBehalfOf: operation.actor.onBehalfOf } : {}) },
        attachmentId: operation.attachmentId, objectKey: operation.objectKey,
        state, processId: MEDIA_PROCESS_ID, startedAt: now(), updatedAt: now(),
      });
      const initial = intent("inflight");
      try {
        const context = await this.transaction(async req => {
          const value = await operation.beforePut(req);
          const identityId = operation.actor.onBehalfOf || operation.actor.id;
          await this.repository.put("privacy-state", intentId, initial, { babyId: operation.babyId, identityId }, req);
          return value;
        });
        try {
          await operation.put();
          await operation.verify();
        } catch {
          // A failed PUT/verification (including a 404) does not prove the provider stopped
          // writing. Keep the durable non-completed intent and keep deletion retrying.
          await this.markUncertain(intentId, { ...initial, state: "uncertain", updatedAt: now() });
          throw uncertain();
        }
        const identityId = operation.actor.onBehalfOf || operation.actor.id;
        await this.transaction(req => this.repository.put("privacy-state", intentId, { ...initial, state: "completed", updatedAt: now() }, { babyId: operation.babyId, identityId }, req));
        // A post-verification authorization/metadata failure is a real failure. The remote
        // object is already verified, so it must not turn into MEDIA_UPLOAD_UNCERTAIN.
        return await operation.afterPut(context);
      } finally {
        this.releaseActiveKey(operation.objectKey);
      }
    });
  }

  private async markUncertain(key: string, value: MediaUploadIntent) {
    try {
      await this.transaction(req => this.repository.put("privacy-state", key, value, { babyId: value.babyId, identityId: value.identityId }, req));
    } catch (error) {
      if (this.startupError === undefined) this.startupError = error;
      throw error;
    }
  }

  private reserveActiveKey(key: string) {
    this.activeKeys.set(key, (this.activeKeys.get(key) ?? 0) + 1);
  }

  private releaseActiveKey(key: string) {
    const count = this.activeKeys.get(key);
    if (count === undefined) return;
    if (count <= 1) this.activeKeys.delete(key);
    else this.activeKeys.set(key, count - 1);
  }

  private async intents(req?: PayloadRequest) {
    const rows = await this.repository.list<MediaUploadIntent>("privacy-state", undefined, req);
    return rows.filter(row => row.key.startsWith("media-upload:"));
  }

  async hasUncertainOperations(scope: { babyId?: string; identityIds?: string[] }, req?: PayloadRequest): Promise<boolean> {
    const identities = scope.identityIds && new Set(scope.identityIds);
    return (await this.intents(req)).some(row => row.value.state !== "completed" &&
      (scope.babyId === undefined || row.value.babyId === scope.babyId) &&
      (!identities || identities.has(row.value.identityId)));
  }

  async assertNoUncertainOperations(scope: { babyId?: string; identityIds?: string[] }): Promise<void> {
    if (await this.transaction(req => this.hasUncertainOperations(scope, req))) throw uncertain();
  }

  private async attachmentReferences(req: PayloadRequest) {
    const docs = (await this.identity.store.payload.find({ collection: "care-attachments", pagination: false, limit: 0, depth: 0, overrideAccess: true, req })).docs;
    const references = new Set<string>();
    for (const row of docs) {
      const key = objectKeyFor(row.value as StoredAttachmentReference);
      if (key) references.add(key);
    }
    return references;
  }

  async purgeFamily(babyId: string): Promise<{ removed: number }> {
    return this.enqueue(async () => {
      const prefix = `${hash(babyId)}/`;
      if (!OBJECT_KEY.test(prefix + "0".repeat(64))) throw new Error("Invalid media baby scope");
      // Check before listing/deleting, then again after remote removal. The media queue
      // serializes this purge with every runtime PUT, so a late PUT cannot interleave.
      await this.assertNoUncertainOperations({ babyId });
      const known = new Set<string>();
      for await (const item of this.objectStore.list(prefix)) known.add(item.key);
      let removed = 0;
      for (const key of [...known].sort()) {
        if (!key.startsWith(prefix) || !OBJECT_KEY.test(key)) throw new Error("Unexpected media object key");
        await this.objectStore.remove(key);
        removed += 1;
      }
      await this.assertNoUncertainOperations({ babyId });
      return { removed };
    });
  }

  async purgeAccount(identityIds: string[], candidateKeys: readonly string[]): Promise<{ removed: number }> {
    const identities = new Set(identityIds);
    if (!identities.size) return { removed: 0 };
    const candidates = new Set(candidateKeys.filter(key => OBJECT_KEY.test(key)));
    if (!candidateKeys.every(key => OBJECT_KEY.test(key))) throw new Error("Invalid media object key");
    return this.enqueue(async () => {
      const targets = await this.transaction(async req => {
        if (await this.hasUncertainOperations({ identityIds }, req)) throw uncertain();
        const references = await this.attachmentReferences(req);
        return new Set([...candidates].filter(key => !references.has(key)));
      });
      let removed = 0;
      for (const key of [...targets].sort()) {
        await this.objectStore.remove(key);
        removed += 1;
      }
      await this.transaction(async req => {
        const references = await this.attachmentReferences(req);
        if ([...targets].some(key => references.has(key))) throw new Error("Media object became referenced during account cleanup");
        if (await this.hasUncertainOperations({ identityIds }, req)) throw uncertain();
      });
      return { removed };
    });
  }

  async purgeOrphans(candidateKeys: readonly string[], olderThan: number): Promise<{ removed: number }> {
    const candidates = new Set(candidateKeys.filter(key => OBJECT_KEY.test(key)));
    if (!candidateKeys.every(key => OBJECT_KEY.test(key))) throw new Error("Invalid media object key");
    return this.enqueue(async () => {
      // Listing is remote I/O and deliberately happens before opening the identity transaction.
      const remote = new Map<string, number>();
      for await (const item of this.objectStore.list("")) {
        if (!OBJECT_KEY.test(item.key) || !Number.isFinite(item.lastModified)) throw new Error("Unexpected media object");
        remote.set(item.key, item.lastModified);
      }
      const targets = new Set([...remote.entries()].filter(([key, at]) => at < olderThan && (!candidates.size || candidates.has(key))).map(([key]) => key));
      await this.transaction(async req => {
        const references = await this.attachmentReferences(req);
        for (const row of await this.intents(req)) {
          const key = row.value.objectKey;
          if (references.has(key) || row.value.state !== "completed" || this.activeKeys.has(key)) targets.delete(key);
        }
        for (const key of targets) if (references.has(key) || this.activeKeys.has(key)) targets.delete(key);
      });
      let removed = 0;
      for (const key of [...targets].sort()) {
        await this.objectStore.remove(key);
        removed += 1;
      }
      await this.transaction(async req => {
        const references = await this.attachmentReferences(req);
        for (const row of await this.intents(req)) if (targets.has(row.value.objectKey) && row.value.state !== "completed") throw uncertain();
        if ([...targets].some(key => references.has(key) || this.activeKeys.has(key))) throw new Error("Media object became referenced during cleanup");
      });
      return { removed };
    });
  }
}
