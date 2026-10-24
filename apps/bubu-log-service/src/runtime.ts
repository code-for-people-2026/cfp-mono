import { PrivacyMaintenance } from "./privacy/maintenance";
import { PrivacyOperations } from "./privacy/operations";
import { SafetyService } from "./safety/service";
import path from "node:path";
import { DeletionLedger } from "./privacy/deletion-ledger";
import { DeletionService, type FamilyLifecycle, type AccountLifecycle } from "./privacy/deletion";
import { PrivacyService } from "./privacy/service";
import { privacyConfigFromEnv, type PrivacyConfig } from "./privacy/policy";
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
import { MembershipService } from "./membership/service";
import { OperationsHealth } from "./operations/health";
import { ImageReviewService, type ImageReviewer } from "./images/review";
import { configuredImageReviewer } from "./images/aliyun-review";

export interface BubuRuntime {
  store: Store;
  identity: IdentityService;
  records: RecordsService;
  attachments: AttachmentService;
  collector: CollectorService;
  chat: ChatService;
  membership: MembershipService;
  privacy: PrivacyService;
  deletion: DeletionService;
  safety: SafetyService;
  maintenance: PrivacyMaintenance;
  health: OperationsHealth;
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
  imageReviewer?: ImageReviewer;
  privacy?: PrivacyConfig;
  deletionLedger?: string;
  maintenanceWorker?: boolean;
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
    const ledgerPath = options.deletionLedger || process.env.BUBU_DELETION_LEDGER || (process.env.NODE_ENV !== "production" ? path.join(path.resolve(options.directory), "local-deletion-ledger", "deletions.ndjson") : "");
    if (!ledgerPath || process.env.NODE_ENV === "production" && path.resolve(ledgerPath).startsWith(path.resolve(options.directory) + path.sep)) throw new Error("Production deletion ledger must be configured outside the database snapshot directory");
    const ledger = new DeletionLedger(ledgerPath);
    const privacy = new PrivacyService(identity, options.privacy || privacyConfigFromEnv(), ledger);
    identity.setProcessingGuard((scope, permission) => privacy.guard(scope, permission));
    identity.setLegacyAccountGuard(userId => privacy.requireLegacyAccount(userId));
    identity.setAccountChangeGuard(identityId => privacy.requireIdentityChange(identityId));
    identity.setContextGuard(identityId => privacy.contextAllowed(identityId));
    const membership = new MembershipService(identity);
    identity.setServiceGuard((babyId, capability, req) => membership.requireAvailable(babyId, capability, req));
    const imageReview = new ImageReviewService(privacy, options.imageReviewer || configuredImageReviewer());
    const attachments = new AttachmentService(identity, { directory: options.directory, beforeLegacyAccess: babyId => privacy.requireLegacyStorage(babyId), imageReview });
    const lifecycle = legacy as typeof legacy & Partial<FamilyLifecycle & AccountLifecycle>;
    const deletion = new DeletionService(privacy, attachments, ledger, lifecycle.exportFamilyData && lifecycle.deleteFamilyData ? lifecycle as FamilyLifecycle : undefined, lifecycle.exportAccountData && lifecycle.deleteAccountData ? lifecycle as AccountLifecycle : undefined);
    const safety = new SafetyService(privacy);
    const maintenance = new PrivacyMaintenance(privacy, attachments, deletion);
    const records = new RecordsService(identity, legacy, (scope, req, id) => attachments.validateAttachment(scope, req, id));
    const collector = new CollectorService(identity, (babyId, requestId, req, principal) => records.verifyCollectorReceipt(babyId, requestId, req, principal), (babyId, source, req) => safety.observe(babyId, source.sourceId, source.text, source.sentAt, "group", req));
    chat = new ChatService(identity, attachments, { mcpUrl: options.mcpUrl, provider: options.provider || chatProviderFromEnv(), safetySignal: (babyId, id, text, at, req) => safety.observe(babyId, id, text, at, "chat", req), authorizeModel: (principal, babyId, images) => privacy.requireModel(principal, babyId, images) });
    const appHandler = createHandler(identity, options.publicOrigin, {
      allowedOrigins: (process.env.BUBU_LEGACY_MEDIA_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean),
    }, { records, attachments, collector, chat, membership, privacy, deletion, safety });
    let closed = false;
    let maintenanceTask: Promise<unknown> | undefined;
    const maintain = () => {
      if (closed || maintenanceTask) return;
      maintenanceTask = (async () => {
        await deletion.processPending();
        if (privacy.policy().ready) {
          const report = await maintenance.run(true);
          await identity.exclusive(() => privacy.repository.put("privacy-state", "maintenance:last", { at: new Date().toISOString(), report }, {}));
        }
      })().catch(async () => { try { await identity.exclusive(() => privacy.repository.put("privacy-state", "maintenance:last", { at: new Date().toISOString(), failed: true }, {})); } catch { console.error("bubu_privacy_maintenance_failed"); } }).finally(() => { maintenanceTask = undefined; });
    };
    const timer = options.maintenanceWorker === false || process.env.NODE_ENV === "test" ? undefined : setInterval(maintain, 60_000);
    timer?.unref();
    const runtime: BubuRuntime = {
      store, identity, records, attachments, collector, chat, membership, privacy, deletion, safety, maintenance,
      health: new OperationsHealth(privacy, options.directory, process.env.BUBU_OPERATIONS_REPORT, imageReview),
      mcpUrl: options.mcpUrl, opsOrigin,
      handler: appHandler,
      close: async () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try { await chat!.close(); await maintenanceTask; await store!.close(); }
        finally { clearRuntimeState(); releaseLock(); }
      },
    };
    const opsHandler = createOperationsHandler(runtime, { membership, privacy: new PrivacyOperations(privacy, deletion) });
    runtime.handler = request => new URL(request.url).pathname.startsWith("/api/ops/") ? opsHandler(request) : appHandler(request);
    runtimeState()!.runtime = runtime;
    if (timer) maintain();
    return runtime;
  } catch (error) {
    await chat?.close();
    await store?.close();
    clearRuntimeState();
    releaseLock();
    throw error;
  }
}
