import { createHash, randomBytes, randomUUID } from "node:crypto";
import { seedSyntheticAge } from "./synthetic-age";

if (process.env.HELLO_HTTP_ISOLATED !== "true" || !process.env.HELLO_DATABASE_URI?.includes("hello-http-e2e-"))
  throw new Error("仅允许隔离 HTTP 测试库");
const { cms } = await import("../src/cms/client");
const { mintCredential, COOKIE } = await import("../src/server/auth");
const payload = await cms();
try {
  const credentials = [];
  for (const auth of ["cookie", "miniapp", "cookie"] as const) {
    const owner = { id: randomUUID(), auth, wechatKey: "" };
    await seedSyntheticAge(payload, owner);
    credentials.push(await mintCredential(payload, auth, owner.id, owner.wechatKey));
  }
  // Seed historical rows directly in the isolated database. Closed public
  // external endpoints must never be reopened just to manufacture fixtures.
  const owner = credentials[0].owner;
  const session = await payload.create({ collection: "sessions", overrideAccess: true, data: { owner, title: "合成历史兼容性验收（非真实生成）" } });
  const history = [];
  for (const mode of ["platform", "byok", "external"] as const) {
    const requestId = randomUUID();
    const greeting = `合成 ${mode} 历史产物，用于确认关闭外部入口后本人仍可管理既有记录。`;
    const row = await payload.create({ collection: "greetings", overrideAccess: true, data: {
      owner, sessionId: session.id, requestKey: `${owner}:${requestId}`, fingerprint: `synthetic-http-history:${requestId}`,
      mode, status: "completed", input: { text: `合成 ${mode} 历史输入`, mediaIds: [] }, greeting,
      association: "隔离 HTTP 测试预置记录，并非真实模型回答或安全评测结论。",
      model: "synthetic-http-fixture-not-a-model", promptVersion: "synthetic-http-history-v1",
    } });
    history.push({ id: row.id, requestId, mode, greeting });
  }
  const legacyToken = randomBytes(32).toString("base64url");
  await payload.create({ collection: "credentials", overrideAccess: true, data: {
    owner: credentials[2].owner, digest: createHash("sha256").update(legacyToken).digest("hex"), kind: "bearer", expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  } });
  console.log(JSON.stringify({ cookie: `${COOKIE}=${credentials[0].token}`, native: credentials[1], otherCookie: `${COOKIE}=${credentials[2].token}`,
    historySessionId: session.id, history, legacyToken }));
} finally { await payload.destroy(); }
