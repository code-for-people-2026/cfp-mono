// Explicit live smoke: one billable generation, fresh synthetic identity/database, real providers, cleanup.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { seedSyntheticAge } from "./synthetic-age";
if (process.env.HELLO_IMAGE_LIVE_CHECK !== "true") throw new Error("Set HELLO_IMAGE_LIVE_CHECK=true to run one billable image test with the configured providers");
const folder=fs.mkdtempSync(path.join(process.env.HELLO_IMAGE_CHECK_DIRECTORY || os.tmpdir(),"aj-image-live-"));
Object.assign(process.env, { NODE_ENV: "test", HELLO_DEPLOYED: "false", HELLO_DATABASE_URI: `file:${folder}/test.db`, PAYLOAD_SECRET: "isolated-live-image-test", HELLO_PRIVACY_DELETION_LEDGER: `${folder}/deletions.ndjson` });
const {cms}=await import("../src/cms/client");
const {Repository}=await import("../src/cms/repository");
const {GreetingService}=await import("../src/domain/greetings");
const {PrivacyService}=await import("../src/privacy/service");
const {privacyPolicy}=await import("../src/privacy/policy");
const {configuredImageStore}=await import("../src/storage/oss");
const {COOKIE,mintCredential}=await import("../src/server/auth");
const {GET}=await import("../src/app/api/hello/[...path]/route");
const {DEFAULT_MODEL}=await import("../src/models/deepseek");
const payload=await cms();
await (await import("../src/cms/seed")).seedAgents(payload);
const owner={id:randomUUID(),auth:"cookie" as const};
const repo=new Repository(payload,owner);
const service=new GreetingService(repo);
const privacy=new PrivacyService(repo,service.media);
let testedObject:string|undefined;
let cleaned = false;
try {
 await seedSyntheticAge(payload,owner); // Isolated test identity, never written to the deployed database.
 await privacy.consent({version:privacyPolicy().version,core:true,model:true,sensitive:true,external:false});
 const session=await service.createSession("隔离真实图片链路验收");
 const input={text:"请为我画一盆阳光下窗台上的红番茄，清新水彩画。",mediaIds:[]};
 const model=process.env.HELLO_MODEL||DEFAULT_MODEL;
 const saved=await service.generateGreeting({ sessionId: session.id, requestId: randomUUID(), mode: "platform", input }, (message) => console.log(message));
 assert.equal(saved.status,"completed");
 const media=(await repo.all("media"))[0]; assert.ok(media); assert.equal(media.base64,null);
 const object=media.object as {key:string;bucket:string;region:string}; testedObject=object.key;
 const bytes=(await service.media.read(media.id)).bytes;
 assert.ok(bytes.length>10000); assert.equal((media.generation as {review:{decision:string}}).review.decision,"allow");
 const credential=await mintCredential(payload,"cookie",owner.id);
 const outsider=await mintCredential(payload,"cookie",randomUUID());
 const segments=["media",String(media.id)],url=`http://127.0.0.1:3310/api/hello/${segments.join("/")}`;
 for(const [token,status] of [[credential.token,200],[outsider.token,404],["",401]] as const){
  const response=await GET(new Request(url,{headers:token?{Cookie:`${COOKIE}=${token}`}:{}}),{params:Promise.resolve({path:segments})});
  assert.equal(response.status,status); if(status===200)assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 }
 const publicResponse=await fetch(`https://${object.bucket}.${object.region}.aliyuncs.com/${object.key}`,{signal:AbortSignal.timeout(20000)}); assert.equal(publicResponse.status,403);
 const exported=await privacy.exportData();assert.equal(exported.media.length,1);
 const report={verifiedAt:new Date().toISOString(),model,wan:"wan2.6-t2i",imageBytes:bytes.length,review:"allow",storage:"private OSS",checks:["实际 DeepSeek 调用万相新任务","实际 Green 图片审核","实际 OSS 写入与回读校验","应用本人200、他人404、匿名401","OSS匿名403","图片导出"]};
 await privacy.deleteData();
 await assert.rejects(()=>configuredImageStore()!.get(object.key));
 console.log(JSON.stringify({...report,deleted:true}));
} catch(error){
 console.error(JSON.stringify({failed:true,name:(error as Error).name,message:(error as Error).message.slice(0,500)}));process.exitCode=1;
} finally {
 try {await privacy.deleteData();cleaned = true;console.log("隔离测试身份和 OSS 前缀已清理。");}catch{console.log(JSON.stringify({cleanup:"needs retry",folder,hasObject:!!testedObject}));}
 await payload.destroy();
 if (cleaned) fs.rmSync(folder, { recursive: true, force: true });
}
