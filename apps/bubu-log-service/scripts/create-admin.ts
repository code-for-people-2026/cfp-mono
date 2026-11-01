import path from "node:path";
import { getPayload } from "payload";
import { buildRuntimeConfig, identityDirectory, operationsOrigin } from "../src/runtime-config";
import { bootstrapOpsAdmin } from "../src/operations/collections";
import { acquireRuntimeLock } from "../src/runtime-lock";

const directory = path.resolve(identityDirectory());
const email = process.env.BUBU_OPS_ADMIN_EMAIL;
const password = process.env.BUBU_OPS_ADMIN_PASSWORD;
const babyIds = (process.env.BUBU_OPS_ADMIN_BABY_IDS || "").split(",").map(id => id.trim()).filter(Boolean);
if (!email || !password) throw new Error("请设置 BUBU_OPS_ADMIN_EMAIL、BUBU_OPS_ADMIN_PASSWORD（至少 14 位）和明确的 BUBU_OPS_ADMIN_BABY_IDS。");
const release = acquireRuntimeLock(directory);
try {
  const payload = await getPayload({ config: await buildRuntimeConfig({ directory, secret: process.env.BUBU_PAYLOAD_SECRET, origin: operationsOrigin() }) });
  try {
    const user = await bootstrapOpsAdmin(payload, { email, password, babyIds });
    process.stdout.write(`${JSON.stringify({ id: user.id, email: user.email, role: user.role, babyIds: user.babyIds })}\n`);
  } finally { await payload.destroy(); }
} finally { release(); }
