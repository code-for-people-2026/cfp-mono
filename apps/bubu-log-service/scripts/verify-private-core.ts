import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { HttpLegacyBackend } from "../src/legacy";
import { emptyDailyMetrics } from "../src/records/statistics";

// Only an explicitly isolated restored database. Never point this exercise at a serving core.
const phase = process.argv[2];
if (!["read", "write"].includes(phase || "") || !new URL(process.env.BUBU_CORE_DATABASE_URL || "").pathname.endsWith("_validation") || process.env.BUBU_CORE_VALIDATION_ISOLATED !== "true") throw new Error("An isolated *_validation restore is required");
const origin = "http://127.0.0.1:3321", coreToken = process.env.BUBU_CORE_SERVICE_TOKEN || "";
const cmsEmail = process.env.BUBU_LEGACY_CMS_EMAIL || "", cmsPassword = process.env.BUBU_LEGACY_CMS_PASSWORD || "";
let stage = "read", transportFailure: {route:string;kind:string} | undefined;
const authDiagnostics: Record<string,unknown>[] = [];
const backend = new HttpLegacyBackend({origin,coreToken,cmsEmail,cmsPassword,fetch:async (input,init) => {
  try {
    const response = await fetch(input,init), path = new URL(String(input)).pathname;
    if (path.startsWith("/api/auth/")) {
      const body = await response.clone().json().catch(()=>({}));
      authDiagnostics.push({action:path.slice(10),status:response.status,keys:Object.keys(body),cookieNames:response.headers.getSetCookie().map(value=>value.split("=",1)[0]),urlOrigin:typeof body.url === "string" ? new URL(body.url,origin).origin : undefined,userIdType:typeof body.user?.id,expiresType:typeof body.expires});
    }
    return response;
  } catch(error) {
    // Route categories only; never IDs, query strings, credentials or provider error messages.
    const route = new URL(String(input)).pathname.split("/").slice(0,3).join("/");
    transportFailure={route,kind:(error as Error).name}; throw error;
  }
}});
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
let token = "";
const request = (path: string, init: RequestInit = {}) => fetch(origin+path,{...init,headers:{"x-bubu-core-token":coreToken,...(token?{Authorization:`JWT ${token}`} : {}),...init.headers},signal:AbortSignal.timeout(20000),redirect:"error"});
async function json(path: string, init: RequestInit = {}) {
  const response = await request(path,init); assert(response.ok,`Core HTTP status ${response.status}`);
  return response.json();
}
try {
  assert.equal((await fetch(origin+"/health")).status,401);
  assert.equal((await json("/health")).writesEnabled,phase === "write");
  assert([401,403].includes((await request("/api/babies")).status));
  const login = await json("/api/cms-admins/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:cmsEmail,password:cmsPassword})});
  assert.equal(typeof login.token,"string"); token=login.token;
  const userPage = await json("/api/app-users?limit=100&depth=0&sort=id");
  const babyPage = await json("/api/babies?limit=100&depth=0&sort=id");
  const users = userPage.docs as {id:string}[], babies = babyPage.docs as {id:string}[];
  assert.equal(userPage.totalDocs,users.length); assert.equal(babyPage.totalDocs,babies.length);
  assert(users.length && babies.length);
  const snapshot = async () => hash({accounts:await Promise.all(users.map(user=>backend.exportAccountData(user.id))),families:await Promise.all(babies.map(baby=>backend.exportFamilyData(baby.id)))});
  const before = await snapshot();
  // Rejection probes must never target restored real rows, even if the write guard regresses.
  const absentUser = randomUUID(), absentBaby = randomUUID();
  assert.equal(await backend.userExists(absentUser),false); assert.equal(await backend.getBaby(absentBaby),null);
  const paths = [`/internal/account?${new URLSearchParams({userId:absentUser})}`,`/internal/family?${new URLSearchParams({babyId:absentBaby})}`,"/internal/media"];
  for (const [index,path] of paths.entries()) assert.equal((await request(path,{method:"HEAD"})).status,index === 1 ? 404 : 200);
  assert.equal(await snapshot(),before,"HEAD must preserve all original account and family data");
  const media = await backend.listLegacyMedia(); assert.equal(media.unresolvedProfiles,0);
  for (const user of users) await backend.listBabies(user.id);
  for (const baby of babies) {
    await backend.listActivities(baby.id);
    await backend.read(baby.id,"daily-stats",new URLSearchParams());
  }
  if (phase === "read") {
    for (const path of paths.slice(0,2)) assert.equal((await request(path,{method:"DELETE"})).status,503);
    assert.equal((await request("/internal/media",{method:"POST"})).status,503);
    assert.equal((await request("/api/babies",{method:"POST"})).status,503);
  } else {
    stage="family-create";
    const identityId = randomUUID(), family = await backend.createFamily(identityId,{name:"隔离验证宝宝"});
    const password = `OnlyValidation-${randomUUID()}`;
    try {
      assert.deepEqual(await backend.findFamilyAccount(identityId),{id:family.userId});
      const user = await json(`/api/app-users/${family.userId}?depth=0`);
      stage="credential-update";
      await json(`/api/app-users/${family.userId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({password})});
      stage="credential-proof";
      assert.deepEqual(await backend.verifyCredentials(user.username,password),{id:family.userId});
      await assert.rejects(()=>backend.verifyCredentials(user.username,"wrong-password"),{code:"LEGACY_CREDENTIALS_INVALID"});
      stage="record-write";
      const updated = await backend.updateBabyNames(family.baby.id,{name:"验证昵称",fullName:null}); assert.equal(updated.name,"验证昵称");
      const activityId = randomUUID(), photo = "https://example.invalid/validation-only.png";
      const activity = await backend.writeActivity(family.baby.id,activityId,{id:activityId,babyId:family.baby.id,type:"DIAPER",startTime:"2026-10-24T01:00:00.000Z",hasPoop:true,poopPhotoUrl:photo},null);
      assert.equal(activity?.poopPhotoUrl,photo);
      await backend.saveDailyStats(family.baby.id,"2026-10-24",emptyDailyMetrics());
      const ref = (await backend.listLegacyMedia()).references.find(row=>row.documentId === activityId); assert(ref);
      const uri = `bubu-attachment:att_${"a".repeat(64)}`;
      await backend.replaceLegacyMedia(ref,uri);
      assert.equal((await backend.getActivity(family.baby.id,activityId))?.poopPhotoUrl,uri);
      stage="account-delete";
      await backend.deleteAccountData(family.userId);
      assert.equal(await backend.userExists(family.userId),false);
      assert(await backend.getBaby(family.baby.id)); assert(await backend.getActivity(family.baby.id,activityId));
      await backend.deleteAccountData(family.userId);
    } finally {
      // These targets come exclusively from this exercise's random identity, never restored user IDs.
      await backend.deleteFamilyData(family.baby.id); await backend.deleteAccountData(family.userId);
    }
    assert.equal(await backend.getBaby(family.baby.id),null);
  }
  assert.equal(await snapshot(),before,"Unrelated restored records changed");
  console.log(JSON.stringify({passed:true,phase,originalUsers:users.length,originalFamilies:babies.length,originalExportsUnchanged:true,headReadOnly:true,mediaInventory:media.references.length}));
} catch (error) {
  console.error(JSON.stringify({passed:false,phase,stage,transportFailure,authDiagnostics,code:(error as {code?:string}).code || (error as Error).name})); process.exitCode=1;
}
