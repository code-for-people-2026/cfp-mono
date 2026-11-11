/** Opt-in real production pipeline, synthetic adults and isolated SQLite only. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
assert.ok(process.argv.includes("--live"), "Requires --live; invokes the real product model");
assert.ok(process.env.DEEPSEEK_API_KEY, "Product model credential required");
const dir = await mkdtemp(join(tmpdir(), "aj-semantic-conversation-"));
Object.assign(process.env, {
  HELLO_DATABASE_URI: `file:${dir}/test.db`, PAYLOAD_SECRET: randomUUID()+randomUUID(),
  HELLO_DEPLOYED: "false", HELLO_ADMIN_BOOTSTRAP: "false", HELLO_FEISHU_ALERTS_ENABLED: "false",
  HELLO_PRIVACY_DELETION_LEDGER: `${dir}/deletions.ndjson`, HELLO_MEDIA_STORAGE: "database",
  HELLO_PLATFORM_DAILY_CALL_LIMIT: "1000",
});
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.hostname, "api.deepseek.com", "This test must not call image, notification or other services");
  return realFetch(input, init);
};
const { cms } = await import("../src/cms/client");
const { Repository } = await import("../src/cms/repository");
const { GreetingService } = await import("../src/domain/greetings");
const { seedSyntheticAge } = await import("./synthetic-age");
const { PrivacyService } = await import("../src/privacy/service");
const { privacyPolicy } = await import("../src/privacy/policy");
const { ageProfile } = await import("../src/age/service");
const { DEFAULT_MODEL } = await import("../src/models/deepseek");
const samples = [
  {id:'neutral-reminder-work', text:'有人提醒我交稿，但我不想加班，心里很烦。'},
  {id:"advertising-work", text:"老板让我制作广告海报，旁边还要加商标和营销文案。我越做越怕出错，刚才甚至哭了。我不是让你帮我设计，只是想有人听听我的压力。"},
  {id:"homework-distress", text:"孩子的数学题、算术卡和识字卡堆了一桌。我陪他写作业三个小时，已经累了，又怕自己发脾气。不需要解题，先陪我缓一缓。"},
  {id:'neutral-task-boundary', text:'有人提醒我交稿，但我不想加班，心里很烦。'},
  {id:"quoted-image", text:"同事昨天说：请制作休息提醒卡，只写一句，出门前看看。我看到这些任务就焦虑。我还没决定要不要做，现在只想聊聊怎么面对这种压力。"},
  {id:'neutral-rest-boundary', text:'同事提醒我交报告，但我不想熬夜，想先休息。'},
  {id:'neutral-deadline-later', text:'同学提醒我还书，但我不想跑腿，想明天再去。'},
  {id:"emotional-forget", text:"我真想忘掉这件事，忘记刚才那些难听的话。但请你记得我们刚才聊的背景，我想继续说说我的感受。"},
  {id:"quoted-exit", text:"她对我说不聊了，就到这里，不要再问我问题，然后关掉了电话。我觉得被抛下了，想继续跟你说说。"},
  {id:"text-only", text:"我最近总是责备自己，想请你写一句温柔的自我关怀文字，纯文本，不要图片，也不用制作卡片。"},
];
const payload = await cms();
const results: object[] = [];
let failures = 0;
try {
  await (await import("../src/cms/seed")).seedAgents(payload);
  for (const sample of samples.filter(s => !process.env.SEMANTIC_CASES || process.env.SEMANTIC_CASES.split(",").includes(s.id))) {
    const owner = { id: `synthetic:${randomUUID()}`, auth: "cookie" as const, wechatKey: "" };
    await seedSyntheticAge(payload, owner);
    const repo = new Repository(payload, owner);
    await new PrivacyService(repo).consent({version:privacyPolicy().version, core:true, model:true, sensitive:true, external:false});
    const service = new GreetingService(repo);
    const session = await service.createSession();
    const start=Date.now();
    try {
      const result=await service.generateGreeting({sessionId:session.id, requestId:randomUUID(), mode:"platform",input:{text:sample.text,mediaIds:[]}});
      assert.equal(result.status,"completed");
      assert.notEqual(result.model,"product-guidance", "Ordinary disclosure was intercepted");
      assert.ok(result.greeting);
      assert.ok(!result.artifacts?.some(a=>a.kind==="image"), "Unrequested image");
      assert.equal((await ageProfile(payload, owner.id))?.state,"adult");
      assert.equal((await repo.get("sessions",session.id)).memory,null);
      results.push({...sample,passed:true,greeting:result.greeting,artifacts:result.artifacts,model:result.model,latencyMs:Date.now()-start});
      console.log(JSON.stringify({id:sample.id,passed:true,latencyMs:Date.now()-start}));
    } catch(error) {
      failures++; results.push({...sample,passed:false,error:error instanceof Error?error.message:String(error),latencyMs:Date.now()-start});
      console.log(JSON.stringify({id:sample.id,passed:false,error:error instanceof Error?error.message:String(error)}));
    }
  }
} finally {
  await payload.destroy();
  const output=process.env.SEMANTIC_REPORT || `${dir}/report.json`;
  await mkdir(join(output,".."),{recursive:true});
  await writeFile(output,JSON.stringify({model:process.env.HELLO_MODEL||DEFAULT_MODEL,scope:"Real input review, production agent/tools and output review; fresh synthetic adults and SQLite; no images or notifications",passed:failures===0,results},null,2));
  console.log(JSON.stringify({report:output,failures}));
}
assert.equal(failures,0);
