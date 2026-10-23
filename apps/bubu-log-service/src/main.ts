import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openStore } from "./store";
import { IdentityService } from "./identity";
import { WechatCodeProvider } from "./wechat";
import { legacyBackendFromEnv } from "./legacy";
import { createHandler } from "./http";
import { recordCollections } from "./records/persistence";
import { AttachmentService } from "./records/attachments";
import { RecordsService } from "./records/service";
import { CollectorService } from "./collector/service";
import { chatCollections } from "./chat/persistence";
import { ChatService } from "./chat/service";
import { chatProviderFromEnv } from "./chat/provider";
import { createNodeServer } from "./node-server";

const origin = process.env.BUBU_PUBLIC_ORIGIN || "http://127.0.0.1:3320";
if (process.env.NODE_ENV === "production" && (!origin.startsWith("https://") || !process.env.BUBU_IDENTITY_DIRECTORY || !process.env.BUBU_PAYLOAD_SECRET)) throw new Error("Production requires HTTPS origin, persistent BUBU_IDENTITY_DIRECTORY and BUBU_PAYLOAD_SECRET.");
const directory = process.env.BUBU_IDENTITY_DIRECTORY || resolve(dirname(fileURLToPath(import.meta.url)), "../.data");
const store = await openStore({ directory, secret: process.env.BUBU_PAYLOAD_SECRET, extensions:[...recordCollections,...chatCollections] });
const legacy=legacyBackendFromEnv();
const service = new IdentityService(store, legacy, new WechatCodeProvider(process.env.BUBU_WECHAT_APP_ID || "", process.env.BUBU_WECHAT_APP_SECRET || ""));
const attachments=new AttachmentService(service,{directory});
const records=new RecordsService(service,legacy,(scope,req,id)=>attachments.validateAttachment(scope,req,id));
const collector=new CollectorService(service,(babyId,requestId,req,principal)=>records.verifyCollectorReceipt(babyId,requestId,req,principal));
const chat=new ChatService(service,attachments,{
  mcpUrl:process.env.BUBU_CHAT_MCP_URL||`http://127.0.0.1:${process.env.PORT||3320}/api/mcp`,
  provider:chatProviderFromEnv(),
});
const handler = createHandler(service, origin, { allowedOrigins: (process.env.BUBU_LEGACY_MEDIA_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean) },{records,attachments,collector,chat});
const server = createNodeServer(handler, origin);
server.listen(Number(process.env.PORT || 3320), process.env.HOST || "127.0.0.1", () => console.log("哺哺日记服务已启动"));
let closing=false;
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => {
  if(closing)return;closing=true;
  void chat.close().then(()=>server.close(()=>{void store.close().then(()=>process.exit(0));}));
});
