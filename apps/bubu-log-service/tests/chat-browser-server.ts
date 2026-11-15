import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "../src/http";
import { createNodeServer } from "../src/node-server";
import { ChatService } from "../src/chat/service";
import { ChatMcpClient } from "../src/chat/mcp";
import { chatCollections } from "../src/chat/persistence";
import type { ChatProvider, ProviderInput, ProviderOutput } from "../src/chat/contracts";
import { chatFixture, chatModelContext, chatUserInput } from "./fixtures/chat";

// This fixture is not imported by production. It can only start explicitly in a test process.
if (process.env.NODE_ENV !== "test") throw new Error("Synthetic browser fixture requires NODE_ENV=test");
const origin="http://127.0.0.1:4340";
const f=await chatFixture(chatCollections);
f.legacy.babies.set("baby-a",{id:"baby-a",name:"合成宝宝一",isDefault:true});
f.legacy.babies.set("baby-b",{id:"baby-b",name:"合成宝宝二"});
f.legacy.memberships.set("old-alice",["baby-a","baby-b"]);
const row=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.map(row):[];
/** Deliberately small, explicit synthetic script; no inference claims or production fallback. */
class BrowserScenarioProvider implements ChatProvider {
  async complete(input:ProviderInput):Promise<ProviderOutput> {
    if(input.messages.at(-1)?.role==="tool")return{text:"请根据待补问题继续说明。",calls:[]};
    const user=chatUserInput(input),context=chatModelContext(input),events=rows(context.events),pending=rows(context.pending);
    const call=(name:string,args:Record<string,unknown>):ProviderOutput=>({text:"",calls:[{id:`fixture-${input.messages.length}-${name}`,name,arguments:args}]});
    const selected=row(context.selectedEvent);
    const feeding=events.find(event=>row(event.facts).type==="BOTTLE"||event.intent==="feeding"||(!row(event.facts).type&&event.lifecycle==="active"));
    const fieldQuestion=(eventId?:unknown)=>pending.find(question=>question.id===row(context.question).id)||pending.find(question=>question.eventId===eventId);
    const answer=(question:Record<string,unknown>|undefined,patch:Record<string,unknown>)=>{
      if(!question)throw new Error("Synthetic question not found");
      return call("bubu_answer_pending",{questionId:question.id,patch});
    };
    if(user.attachmentIds.length)return call("bubu_record_events",{events:[{facts:{type:"DIAPER",startTime:"2026-10-23T19:55:00+08:00",hasPoop:true,hasPee:false,poopColor:"YELLOW"},attachmentIds:user.attachmentIds,evidence:[{field:"poopColor",kind:"reported",confirmed:true}]}]});
    if(user.text==="喝奶了")return call("bubu_record_events",{events:[{intent:"feeding",facts:{startTime:"2026-10-23T19:30:00+08:00"}}]});
    if(user.text.includes("奶瓶")&&user.text.includes("奶粉"))return answer(fieldQuestion(feeding?.id),{facts:{type:"BOTTLE",milkSource:"FORMULA"}});
    if(user.text.includes("泡了120"))return answer(fieldQuestion(feeding?.id),{facts:{preparedMilkAmount:120,remainingMilkAmount:20,sameBottle:true}});
    if(user.text.includes("喂了10分钟"))return answer(fieldQuestion(feeding?.id),{facts:{durationMinutes:10,burpSuccess:true}});
    if(user.text.includes("实际喝入80"))return call("bubu_update_event",{eventId:selected.id||feeding?.id,patch:{facts:{milkAmount:80,remainingMilkAmount:40,sameBottle:true}}});
    if(user.text.includes("删除这条"))return call("bubu_retract_event",{eventId:selected.id||feeding?.id});
    if(user.text.includes("恢复这条"))return call("bubu_restore_event",{eventId:selected.id||feeding?.id});
    if(user.text.includes("不知道尿量")) {
      const question=pending.find(item=>Array.isArray(item.fields)&&item.fields.includes("peeAmount"));
      return answer(question,{facts:{},states:{peeAmount:"unknown"}});
    }
    if(user.text.includes("黄色便便")) {
      const event=events.find(item=>row(item.facts).type==="DIAPER"&&Array.isArray(item.attachmentIds)&&item.attachmentIds.length);
      return answer(fieldQuestion(event?.id),{facts:{hasPoop:true,hasPee:false,poopColor:"YELLOW"},evidence:[{field:"hasPoop",kind:"reported",confirmed:true},{field:"hasPee",kind:"reported",confirmed:true},{field:"poopColor",kind:"reported",confirmed:true}]});
    }
    return{text:"这是隔离验证会话，请使用测试场景中的照护描述。",calls:[]};
  }
}
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
