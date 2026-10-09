import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { IdSchema, LoginInputSchema } from "@cfp/kith-inn-contracts";
import { createWechatExchanger } from "../src/auth.ts";
import { loadKithInnRuntimeConfig } from "../src/config.ts";
import { createKithInnPool } from "../src/database.ts";
import { grantMember, revokeMember } from "../src/members.ts";

/**
 * @param {import('pg').Pool} pool
 * @param {unknown} input
 * @param {{appId: string, exchange: (code: string) => Promise<string>}} wechat
 */
export async function runMemberCommand(pool, input, wechat) {
  if (!input || typeof input !== "object" || Array.isArray(input) || !("action" in input) ||
      !("database" in input) || typeof input.database !== "string" || !input.database.trim()) throw new Error("Invalid command");
  const allowed = input.action === "revoke" ? ["action", "database", "memberId"] :
    input.action === "grant" ? ["action", "database", "code", "merchantId"] :
      input.action === "create-store" ? ["action", "database", "code"] : [];
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new Error("Invalid command");
  const { rows: [target] } = await pool.query("SELECT current_database() AS name");
  if (target.name !== input.database) throw new Error("Wrong database");
  if (input.action === "revoke") {
    const memberId = IdSchema.parse("memberId" in input ? input.memberId : undefined);
    await revokeMember(pool, memberId);
    return { revoked: true, memberId };
  }
  const merchantId = input.action === "grant" ? IdSchema.parse("merchantId" in input ? input.merchantId : undefined) : undefined;
  const { code } = LoginInputSchema.parse({ code: "code" in input ? input.code : undefined });
  const openid = await wechat.exchange(code);
  return grantMember(pool, { appId: wechat.appId, openid }, merchantId);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let pool;
  try {
    // Input is a private file on stdin, never credentials in argv or public logs.
    const input = JSON.parse(readFileSync(0, "utf8"));
    const config = loadKithInnRuntimeConfig();
    pool = createKithInnPool();
    const result = await runMemberCommand(pool, input, { appId: config.wechatAppId,
      exchange: createWechatExchanger({ appId: config.wechatAppId, appSecret: config.wechatAppSecret }) });
    console.log(JSON.stringify(result));
  } catch {
    console.error("Member operation failed; verify the command, database, permissions and fresh WeChat code");
    process.exitCode = 1;
  } finally { await pool?.end(); }
}
