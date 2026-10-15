import { randomUUID } from "node:crypto";
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
  console.log(JSON.stringify({ cookie: `${COOKIE}=${credentials[0].token}`, native: credentials[1], otherCookie: `${COOKIE}=${credentials[2].token}` }));
} finally { await payload.destroy(); }
