import { getPayload } from "payload";
import { Store } from "../src/store";
import { IdentityService } from "../src/identity";
import { legacyBackendFromEnv } from "../src/legacy";
import { WechatCodeProvider } from "../src/wechat";
import { acquireRuntimeLock } from "../src/runtime-lock";
import { buildRuntimeConfig, identityDirectory, operationsOrigin } from "../src/runtime-config";

const [operatorId, babyId] = process.argv.slice(2);
if (!operatorId || !babyId) throw new Error("Usage: pnpm operator <operator-id> <baby-id>. Stop the service first; this offline tool holds its database lease. Token is shown once; keep it out of model context.");
const directory = identityDirectory();
const release = acquireRuntimeLock(directory);
try {
  // Full shared schema: an old partial dev schema must never remove newer ops/chat tables.
  const config = await buildRuntimeConfig({ directory, secret: process.env.BUBU_PAYLOAD_SECRET, origin: operationsOrigin() });
  const store = new Store(await getPayload({ config }));
  try {
    const service = new IdentityService(store, legacyBackendFromEnv(), new WechatCodeProvider("", ""));
    console.log(JSON.stringify(await service.provisionOperator(operatorId, babyId, 3600000)));
  } finally { await store.close(); }
} finally { release(); }
