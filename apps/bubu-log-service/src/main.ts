import { createServer } from "node:http";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "./store";
import { IdentityService } from "./identity";
import { WechatCodeProvider } from "./wechat";
import { legacyBackendFromEnv } from "./legacy";
import { createHandler } from "./http";
import { recordCollections } from "./records/persistence";
import { AttachmentService, MAX_ATTACHMENT_BYTES } from "./records/attachments";
import { RecordsService } from "./records/service";
import { CollectorService } from "./collector/service";

const origin = process.env.BUBU_PUBLIC_ORIGIN || "http://127.0.0.1:3320";
if (process.env.NODE_ENV === "production" && (!origin.startsWith("https://") || !process.env.BUBU_IDENTITY_DIRECTORY || !process.env.BUBU_PAYLOAD_SECRET)) throw new Error("Production requires HTTPS origin, persistent BUBU_IDENTITY_DIRECTORY and BUBU_PAYLOAD_SECRET.");
const directory = process.env.BUBU_IDENTITY_DIRECTORY || resolve(dirname(fileURLToPath(import.meta.url)), "../.data");
const store = await openStore({ directory, secret: process.env.BUBU_PAYLOAD_SECRET, extensions:recordCollections });
const legacy=legacyBackendFromEnv();
const service = new IdentityService(store, legacy, new WechatCodeProvider(process.env.BUBU_WECHAT_APP_ID || "", process.env.BUBU_WECHAT_APP_SECRET || ""));
const attachments=new AttachmentService(service,{directory});
const records=new RecordsService(service,legacy,(scope,req,id)=>attachments.validateAttachment(scope,req,id));
const collector=new CollectorService(service,(babyId,requestId,req,principal)=>records.verifyCollectorReceipt(babyId,requestId,req,principal));
const handler = createHandler(service, origin, { allowedOrigins: (process.env.BUBU_LEGACY_MEDIA_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean) },{records,attachments,collector});
const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    const pathname=new URL(incoming.url||"/",origin).pathname;
    const maxBytes=pathname==="/api/app/attachments"&&incoming.method==="POST"?MAX_ATTACHMENT_BYTES:pathname==="/api/mcp"?1024*1024:16384;
    for await (const chunk of incoming) {
      size += chunk.length;
      if (size > maxBytes) { outgoing.writeHead(413); outgoing.end(); return; }
      chunks.push(chunk);
    }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    const request = new Request(new URL(incoming.url || "/", origin), { method: incoming.method, headers,
      ...(!["GET", "HEAD"].includes(incoming.method || "GET") ? { body: Buffer.concat(chunks) } : {}) });
    const response = await handler(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end(); }
});
server.requestTimeout = 20000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 3320), process.env.HOST || "127.0.0.1", () => console.log("哺哺日记服务已启动"));
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { server.close(() => { void store.close().then(() => process.exit(0)); }); });
