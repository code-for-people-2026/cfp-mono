import { getPayload } from "payload";
import { Store } from "./store";
import { IdentityService } from "./identity";
import { WechatCodeProvider } from "./wechat";
import { legacyBackendFromEnv } from "./legacy";
import { createHandler } from "./http";
import { AttachmentService } from "./records/attachments";
import { RecordsService } from "./records/service";
import { CollectorService } from "./collector/service";
import { ChatService } from "./chat/service";
import { chatProviderFromEnv } from "./chat/provider";
import type { ChatProvider } from "./chat/contracts";
import type { LegacyBackend, WechatProvider } from "./contracts";
import type { LegacyRecordsBackend } from "./records/types";
import { serializeDatabaseTransactions } from "./database-queue";
import { buildRuntimeConfig } from "./runtime-config";
import { acquireRuntimeLock } from "./runtime-lock";
import { registerRuntimeState, runtimeState, clearRuntimeState } from "./runtime-state";
import { createOperationsHandler } from "./operations/http";
import type { MembershipOperations } from "./operations/contracts";

export interface BubuRuntime {
  store: Store;
  identity: IdentityService;
  records: RecordsService;
  attachments: AttachmentService;
  collector: CollectorService;
  chat: ChatService;
  mcpUrl: string;
  opsOrigin: string;
  handler: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
}
interface RuntimeOptions {
  directory: string;
  secret?: string;
  publicOrigin: string;
  opsOrigin: string;
  mcpUrl: string;
  legacy?: LegacyBackend & LegacyRecordsBackend;
  wechat?: WechatProvider;
  provider?: ChatProvider;
  membership?: MembershipOperations;
}

/** One writer, one Payload instance, and one RecordsService serialization queue. */
export async function createRuntime(options: RuntimeOptions): Promise<BubuRuntime> {
  if (runtimeState()) throw new Error("The Bubu service is already initialized in this process.");
  const defaultCache = (globalThis as typeof globalThis & { _payload?: Map<string, { payload?: unknown; promise?: unknown }> })._payload?.get("default");
  if (defaultCache?.payload || defaultCache?.promise) throw new Error("Another Payload default instance already exists; refusing to share the wrong database.");
  const opsOrigin = new URL(options.opsOrigin).origin;
  const releaseLock = acquireRuntimeLock(options.directory);
  let store: Store | undefined;
  let chat: ChatService | undefined;
  // Payload HMR can destroy/reinitialize its DB; restart the whole server instead.
  process.env.DISABLE_PAYLOAD_HMR = "true";
  try {
    const config = buildRuntimeConfig({ directory: options.directory, secret: options.secret, origin: opsOrigin });
    registerRuntimeState({ config });
    store = new Store(await getPayload({ config }));
    serializeDatabaseTransactions(store.payload);
    const legacy = options.legacy || legacyBackendFromEnv();
    const identity = new IdentityService(store, legacy, options.wechat || new WechatCodeProvider(process.env.BUBU_WECHAT_APP_ID || "", process.env.BUBU_WECHAT_APP_SECRET || ""));
    const attachments = new AttachmentService(identity, { directory: options.directory });
    const records = new RecordsService(identity, legacy, (scope, req, id) => attachments.validateAttachment(scope, req, id));
    const collector = new CollectorService(identity, (babyId, requestId, req, principal) => records.verifyCollectorReceipt(babyId, requestId, req, principal));
    chat = new ChatService(identity, attachments, { mcpUrl: options.mcpUrl, provider: options.provider || chatProviderFromEnv() });
    const appHandler = createHandler(identity, options.publicOrigin, {
      allowedOrigins: (process.env.BUBU_LEGACY_MEDIA_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean),
    }, { records, attachments, collector, chat });
    let closed = false;
    const runtime: BubuRuntime = {
      store, identity, records, attachments, collector, chat,
      mcpUrl: options.mcpUrl, opsOrigin,
      handler: appHandler,
      close: async () => {
        if (closed) return;
        closed = true;
        try { await chat!.close(); await store!.close(); }
        finally { clearRuntimeState(); releaseLock(); }
      },
    };
    const opsHandler = createOperationsHandler(runtime, { membership: options.membership });
    runtime.handler = request => new URL(request.url).pathname.startsWith("/api/ops/") ? opsHandler(request) : appHandler(request);
    runtimeState()!.runtime = runtime;
    return runtime;
  } catch (error) {
    await chat?.close();
    await store?.close();
    clearRuntimeState();
    releaseLock();
    throw error;
  }
}
