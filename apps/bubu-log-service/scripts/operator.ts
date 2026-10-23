import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "../src/store";
import { IdentityService } from "../src/identity";
import { legacyBackendFromEnv } from "../src/legacy";
import { WechatCodeProvider } from "../src/wechat";
import { recordCollections } from "../src/records/persistence";
import { chatCollections } from "../src/chat/persistence";
const [operatorId, babyId] = process.argv.slice(2);
if (!operatorId || !babyId) throw new Error("Usage: pnpm operator <operator-id> <baby-id>. Run locally with access to the identity database. Token is shown once; keep it out of model context.");
const store = await openStore({ directory: process.env.BUBU_IDENTITY_DIRECTORY || resolve(dirname(fileURLToPath(import.meta.url)), "../.data"), secret: process.env.BUBU_PAYLOAD_SECRET, extensions: [...recordCollections,...chatCollections] });
try {
  const service = new IdentityService(store, legacyBackendFromEnv(), new WechatCodeProvider("", ""));
  console.log(JSON.stringify(await service.provisionOperator(operatorId, babyId, 3600000)));
} finally { await store.close(); }
