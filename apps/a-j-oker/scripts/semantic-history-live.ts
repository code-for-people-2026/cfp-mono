/** Explicit, real-model semantic routing regression; no production database or image provider. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateText } from "../src/domain/moderation";
import { DEFAULT_MODEL } from "../src/models/deepseek";
import { semanticHistoryCases, semanticHistoryCorpus, type SemanticHistoryCase } from "./semantic-history-corpus";
assert.ok(process.argv.includes("--live"), "Pass --live to invoke the real product model");
assert.ok(process.env.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY required");
const filterAt=process.argv.indexOf("--filter");
const cases=semanticHistoryCases(filterAt<0?undefined:process.argv[filterAt+1]);
assert.ok(cases.length,"No matching cases");
const output=resolve(process.env.SEMANTIC_REPORT||".data/semantic-history-live.json");
await mkdir(dirname(output),{recursive:true});
const hashes:Record<string,string>={};
for(const file of ["src/domain/moderation.ts","src/domain/service-scope.ts","docs/semantic-keyword-history.json"])
  hashes[file]=createHash("sha256").update(await readFile(file)).digest("hex");
type Verdict=Awaited<ReturnType<typeof evaluateText>>;
type Attempt={verdict:Verdict;latencyMs:number};
const results:Array<{id:string;input:string;context?:string;purpose?:string;expected:SemanticHistoryCase["expected"];attempts:Attempt[];passed:boolean;differences:string[]}>=[];
let cursor=0;
const startedAt=new Date().toISOString();
async function check(c:SemanticHistoryCase){
 const attempts:Attempt[]=[];
 for(let attempt=0;attempt<2;attempt++){
  const start=Date.now();
  const verdict=await evaluateText({apiKey:process.env.DEEPSEEK_API_KEY,stage:"input",serviceScope:true,interaction:true,purpose:c.purpose,texts:[c.input],context:c.context,requestId:randomUUID()});
  attempts.push({verdict,latencyMs:Date.now()-start});
  if(verdict.decision!=="unavailable")break;
 }
 const actual=attempts.at(-1)!.verdict;
 const differences:string[]=[];
 if(actual.decision!==c.expected.decision)differences.push(`decision: expected ${c.expected.decision}, received ${actual.decision}`);
 // A blocking reviewer need not supply optional metadata. Safety refusal itself denies admission.
 if(actual.decision==="allow"){
  if(actual.serviceScope!==c.expected.serviceScope)differences.push(`scope: expected ${c.expected.serviceScope}, received ${actual.serviceScope}`);
  for(const flag of Object.keys(c.expected.interaction) as Array<keyof SemanticHistoryCase["expected"]["interaction"]>)
   if(actual.interaction?.[flag]!==c.expected.interaction[flag])differences.push(`${flag}: expected ${c.expected.interaction[flag]}, received ${actual.interaction?.[flag]}`);
 }
 const result={id:c.id,input:c.input,context:c.context,purpose:c.purpose,expected:c.expected,attempts,passed:differences.length===0,differences};
 results.push(result);
 if(!result.passed)console.log(JSON.stringify({id:c.id,passed:false,differences,actual}));
 else if(results.length%20===0)console.log(JSON.stringify({completed:results.length,total:cases.length}));
 // Persist progress so interruptions never turn completed calls into invisible retries.
 await writeFile(output,JSON.stringify({startedAt,finishedAt:null,model:process.env.HELLO_MODEL||DEFAULT_MODEL,hashes,corpusCounts:semanticHistoryCorpus.counts,complete:false,results},null,2));
}
await Promise.all(Array.from({length:4},async()=>{while(cursor<cases.length){const c=cases[cursor++];await check(c);}}));
const failures=results.filter(r=>!r.passed);
const firstAttemptUnavailable=results.filter(r=>r.attempts[0].verdict.decision==="unavailable").length;
const report={startedAt,finishedAt:new Date().toISOString(),model:process.env.HELLO_MODEL||DEFAULT_MODEL,hashes,corpusCounts:semanticHistoryCorpus.counts,scope:"Real production evaluateText only; synthetic corpus; no images generated, notifications, accounts or database writes",complete:true,passed:failures.length===0,total:results.length,firstAttemptUnavailable,retried:results.filter(r=>r.attempts.length>1).length,failures:failures.map(r=>r.id),results};
await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({report:output,total:results.length,passed:report.passed,firstAttemptUnavailable,failures:report.failures}));
assert.equal(failures.length,0,"Semantic history regression failed; retained all actual verdicts");
