import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "../src/http";
import { createNodeServer } from "../src/node-server";
import { ChatService } from "../src/chat/service";
import { ChatMcpClient } from "../src/chat/mcp";
import { chatCollections } from "../src/chat/persistence";
import { privacyCollections } from "../src/privacy/persistence";
import { membershipCollections } from "../src/membership/persistence";
import { PrivacyService } from "../src/privacy/service";
import { MembershipService } from "../src/membership/service";
import { SafetyService } from "../src/safety/service";
import { AttachmentService } from "../src/records/attachments";
import { RecordsService } from "../src/records/service";
import { CollectorService } from "../src/collector/service";
import { ImageReviewService } from "../src/images/review";
import { hash } from "../src/records/persistence";
import { canonicalGroupId, sourceFingerprint, type SourceMessage } from "../src/collector/types";
import { chatFixture } from "./fixtures/chat";
import { BrowserScenarioProvider } from "./fixtures/browser-provider";
import { fixtureImageReviewer, testPrivacyConfig } from "./fixtures/privacy";

// This fixture is not imported by production. It can only start explicitly in a test process.
if (process.env.NODE_ENV !== "test") throw new Error("Synthetic browser fixture requires NODE_ENV=test");
const origin="http://127.0.0.1:4340";
const f=await chatFixture([...chatCollections, ...privacyCollections, ...membershipCollections]);
f.legacy.babies.set("baby-a",{id:"baby-a",name:"合成宝宝一",isDefault:true});
f.legacy.babies.set("baby-b",{id:"baby-b",name:"合成宝宝二"});
f.legacy.memberships.set("old-alice",["baby-a","baby-b"]);
const privacy=new PrivacyService(f.identity,testPrivacyConfig);
const membership=new MembershipService(f.identity);
f.identity.setProcessingGuard((scope,permission)=>privacy.guard(scope,permission));
f.identity.setLegacyAccountGuard(userId=>privacy.requireLegacyAccount(userId));
f.identity.setAccountChangeGuard(identityId=>privacy.requireIdentityChange(identityId));
f.identity.setContextGuard(identityId=>privacy.contextAllowed(identityId));
f.identity.setServiceGuard((babyId,capability,req)=>membership.requireAvailable(babyId,capability,req));
const attachments=new AttachmentService(f.identity,{directory:f.directory,beforeLegacyAccess:babyId=>privacy.requireLegacyStorage(babyId),imageReview:new ImageReviewService(privacy,fixtureImageReviewer)});
const records=new RecordsService(f.identity,f.legacy,(...args)=>attachments.validateAttachment(...args));
const collector=new CollectorService(f.identity,(...args)=>records.verifyCollectorReceipt(...args));
const safety=new SafetyService(privacy);
const chat=new ChatService(f.identity,attachments,{mcpUrl:`${origin}/api/mcp`,provider:new BrowserScenarioProvider(),safetySignal:(babyId,id,text,at,req)=>safety.observe(babyId,id,text,at,"chat",req),authorizeModel:(principal,babyId,images)=>privacy.requireModel(principal,babyId,images)});
const handler=createHandler(f.identity,origin,{allowedOrigins:[]},{records,attachments,collector,chat,membership,privacy,safety});
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
const eventFormsFixture=process.env.BUBU_CHAT_EVENT_FORMS==="1";
const accountId="synthetic-account",conversationId="synthetic-group@chatroom";
const groupId=canonicalGroupId(accountId,conversationId);
const databaseId="message/message_0.db",tableName=`Msg_${createHash("md5").update(conversationId).digest("hex")}`;
const fixtureMessage=(localId:number,eventKey:string,sentAt:string,senderId:string,senderName:string,text:string):SourceMessage=>({
  sourceId:`wechat:${hash(["wechat",accountId,databaseId,tableName,localId])}`,
  accountId,chatId:conversationId,groupId,databaseId,tableName,localId,sentAt,senderId,senderName,kind:"text",text,media:[]
});
const fixtureSource=({source,eventKey}: {source:SourceMessage;eventKey:string})=>({
  kind:"wechat" as const,accountId,conversationId,groupId,messageId:`${databaseId}/${tableName}/${source.localId}`,
  eventKey,sentAt:source.sentAt,senderId:source.senderId
});
const bottleXiaolin=fixtureMessage(1,"bottle:xiaolin","2026-10-23T08:00:00+08:00","sender-xiaolin","小林","八点喝了羊奶200毫升，又喝了奶粉");
const bottleXiaozhou=fixtureMessage(2,"bottle:xiaozhou","2026-10-23T08:01:00+08:00","sender-xiaozhou","小周","奶粉实际喝入量晚点补");
const sleepXiaozhao=fixtureMessage(3,"sleep:xiaozhao","2026-10-23T09:00:00+08:00","sender-xiaozhao","小赵","九点睡着了，睡眠时长晚点补");
const diaperXiaochen=fixtureMessage(4,"diaper:xiaochen","2026-10-23T10:00:00+08:00","sender-xiaochen","小陈","十点换尿布，有尿也有便");
const unrelatedXiaowu=fixtureMessage(5,"unrelated:xiaowu","2026-10-23T10:30:00+08:00","sender-xiaowu","小吴","今天天气不错，和照护记录无关");
const fixtureMessages=eventFormsFixture?[bottleXiaolin,bottleXiaozhou,sleepXiaozhao,diaperXiaochen,unrelatedXiaowu]:[];
const policyVersion=privacy.policy().version;
const personalConsent={policyVersion,accepted:true,adultCaregiver:true,sensitive:true,ai:true,images:true} as const;
const guardianConsent={policyVersion,guardian:true,sensitive:true,ai:true,images:true,collection:true,groupMembersInformed:true} as const;
for(const principal of [f.alice,f.bob]) await privacy.consent(principal,personalConsent);
await privacy.guardian(f.alice,"baby-a",guardianConsent);
await privacy.guardian(f.alice,"baby-b",guardianConsent);
const operator=await f.identity.authenticate((await f.identity.provisionOperator("browser-fixture-operator","baby-a",3_600_000)).token,"bearer");
const defaultDiaper=fixtureMessage(1,"diaper:default","2026-10-23T08:00:00+08:00","sender-default","默认照护者","八点换尿布，有尿");
const fixtureEvents=eventFormsFixture?[
  {facts:{type:"BOTTLE",endTime:"2026-10-23T08:00:00+08:00",milkItems:[{id:"browser-goat-milk",milkDescription:"羊奶",milkAmount:200},{id:"browser-formula",milkSource:"FORMULA"}],burpSuccess:false},sources:[fixtureSource({source:bottleXiaolin,eventKey:"bottle:xiaolin"}),fixtureSource({source:bottleXiaozhou,eventKey:"bottle:xiaozhou"})]},
  {facts:{type:"SLEEP",startTime:"2026-10-23T09:00:00+08:00"},states:{endTime:"pending"},progress:"ended",sources:[fixtureSource({source:sleepXiaozhao,eventKey:"sleep:xiaozhao"})]},
  {facts:{type:"DIAPER",startTime:"2026-10-23T10:00:00+08:00",hasPee:true,hasPoop:true},sources:[fixtureSource({source:diaperXiaochen,eventKey:"diaper:xiaochen"})]},
]:[
  {facts:{type:"DIAPER",startTime:"2026-10-23T08:00:00+08:00",hasPee:true},sources:[fixtureSource({source:defaultDiaper,eventKey:"diaper:default"})]},
];
if(eventFormsFixture)await f.identity.executeAuthorized(operator,"baby-a","records:write",async(_scope,request)=>{
  for(const source of fixtureMessages)await collector.repository.put("care-messages","baby-a",source.sourceId,{
    source,contentHash:hash(sourceFingerprint(source)),state:"processed",batchId:"browser-fixture-sources"
  },request);
});
await f.identity.bindGroup(operator,"baby-a",groupId,"browser-fixture-collector",true);
const delegate=await f.identity.issueAgent(operator,"baby-a","collector",{groupId,agentId:"browser-fixture-collector"});
const client=new ChatMcpClient(`${origin}/api/mcp`,delegate.token);
await client.connect();
await client.call("bubu_record_events",{babyId:"baby-a",requestId:"browser-group-pending",events:fixtureEvents});
await client.close();
ready=true;
console.log(`Synthetic isolated chat browser server ready at ${origin}`);
let closing=false;
for(const signal of ["SIGTERM","SIGINT"] as const)process.once(signal,()=>{
  if(closing)return;closing=true;
  void chat.close().then(()=>{server.closeAllConnections();server.close(()=>{void f.close().then(()=>process.exit(0));});});
});
