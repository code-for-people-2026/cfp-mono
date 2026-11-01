import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "../src/http";
import { createNodeServer } from "../src/node-server";
import { ChatService } from "../src/chat/service";
import { ChatMcpClient } from "../src/chat/mcp";
import { chatCollections } from "../src/chat/persistence";
import { chatFixture } from "./fixtures/chat";
import { BrowserScenarioProvider } from "./fixtures/browser-provider";

// This fixture is not imported by production. It can only start explicitly in a test process.
if (process.env.NODE_ENV !== "test") throw new Error("Synthetic browser fixture requires NODE_ENV=test");
const origin="http://127.0.0.1:4340";
const f=await chatFixture(chatCollections);
f.legacy.babies.set("baby-a",{id:"baby-a",name:"合成宝宝一",isDefault:true});
f.legacy.babies.set("baby-b",{id:"baby-b",name:"合成宝宝二"});
f.legacy.memberships.set("old-alice",["baby-a","baby-b"]);
const chat=new ChatService(f.identity,f.attachments,{mcpUrl:`${origin}/api/mcp`,provider:new BrowserScenarioProvider()});
const handler=createHandler(f.identity,origin,{allowedOrigins:[]},{records:f.records,attachments:f.attachments,collector:f.collector,chat});
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../bubu-log-miniapp/dist/h5");
const mime:Record<string,string>={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".svg":"image/svg+xml",".ico":"image/x-icon",".woff2":"font/woff2"};
let ready=false;
const server=createNodeServer(async request=>{
  const pathname=new URL(request.url).pathname;
  if(pathname==="/__fixture/ready")return new Response(ready?"Ready":"Starting",{status:ready?200:503});
  if(pathname==="/api/app/chat"&&request.method==="POST")f.advance(1000);
  if(pathname.startsWith("/api/")||pathname==="/health")return handler(request);
  const target=path.resolve(root,`.${decodeURIComponent(pathname==="/"?"/index.html":pathname)}`);
  if(!target.startsWith(`${root}/`))return new Response("Not found",{status:404});
  try{return new Response(new Uint8Array(await readFile(target)),{headers:{"Content-Type":mime[path.extname(target)]||"application/octet-stream","Cache-Control":"no-store"}});}
  catch{return new Response("Not found",{status:404});}
},origin);
await new Promise<void>(resolve=>server.listen(4340,"127.0.0.1",resolve));
const groupId="wechat:synthetic-account:synthetic-group";
await f.identity.bindGroup(f.operator,"baby-a",groupId,"browser-fixture-collector",true);
const delegate=await f.identity.issueAgent(f.operator,"baby-a","collector",{groupId,agentId:"browser-fixture-collector"});
const client=new ChatMcpClient(`${origin}/api/mcp`,delegate.token);
await client.connect();
await client.call("bubu_record_events",{babyId:"baby-a",requestId:"browser-group-pending",events:[{facts:{type:"DIAPER",startTime:"2026-10-23T08:00:00+08:00",hasPee:true,hasPoop:false},sources:[{kind:"wechat",accountId:"synthetic-account",conversationId:"synthetic-group",groupId,messageId:"group-message-1",eventKey:"diaper",sentAt:"2026-10-23T08:00:00+08:00",senderId:"synthetic-caregiver"}]}]});
await client.close();
ready=true;
console.log(`Synthetic isolated chat browser server ready at ${origin}`);
let closing=false;
for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,()=>{
  if(closing)return;closing=true;
  void chat.close().then(()=>{server.closeAllConnections();server.close(()=>{void f.close().then(()=>process.exit(0));});});
});
