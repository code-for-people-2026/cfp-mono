import { AppError } from "../contracts";
import type { Principal } from "../identity";
import { chinaDayRange, chinaDate, computeStatistics, activityInDate, isActivityOngoing } from "./statistics";
import type { RecordsService } from "./service";
import type { CollectorJob, CollectorService } from "../collector/service";

/** Existing chart routes and chat tools share the same facts and deterministic summary. */
export async function readRecordView(records:RecordsService,principal:Principal,babyId:string,path:string,query:URLSearchParams):Promise<unknown> {
  const snapshot=await records.query(principal,{babyId});
  const [collection,detail]=path.split("/");
  if(collection==="activities") {
    let rows=snapshot.activities;
    const types=query.get("types")?.split(",")||[];const type=query.get("type");
    if(type)rows=rows.filter(row=>row.type===type);else if(types.length)rows=rows.filter(row=>types.includes(row.type));
    rows=[...rows].sort((a,b)=>Date.parse(b.startTime)-Date.parse(a.startTime)||a.id.localeCompare(b.id));
    if(detail&&detail!=="latest") {const row=rows.find(row=>row.id===decodeURIComponent(detail));if(!row)throw new AppError(404,"NOT_FOUND","未找到此记录。");return row;}
    if(detail==="latest")return rows[0]||null;
    const limit=Number(query.get("limit")||50);if(!Number.isInteger(limit)||limit<1||limit>1000)throw new AppError(400,"INVALID_LIMIT","记录数量应为1到1000。");
    const from=query.get("startTimeGte"),until=query.get("startTimeLt"),date=query.get("date");
    const ongoing=(row:typeof rows[number])=>isActivityOngoing(row,snapshot.events.find(event=>event.legacyId===row.id));
    const through=(row:typeof rows[number])=>row.endTime?Date.parse(row.endTime):ongoing(row)?records.identity.now():Date.parse(row.startTime);
    const parse=(value:string|null)=>{if(value===null)return undefined;const time=Date.parse(value);if(!Number.isFinite(time))throw new AppError(400,"INVALID_TIME","日期时间无效。");return time;};
    if(from||until) {
      const start=parse(from),end=parse(until);
      rows=rows.filter(row=>{const at=Date.parse(row.startTime),to=through(row);return (start===undefined||at>=start)&&(end===undefined||at<end)
        ||query.get("crossStartTime")==="true"&&start!==undefined&&at<start&&to>=start
        ||query.get("crossEndTime")==="true"&&end!==undefined&&at<end&&to>=end;});
    }else if(date) rows=rows.filter(row=>activityInDate(row,date,ongoing(row),records.identity.now()));
    return rows.slice(0,limit);
  }
  if(collection!=="daily-stats")throw new AppError(404,"NOT_FOUND","未找到此接口。");
  const first=detail||query.get("startDate")||records.today(),last=detail||query.get("endDate")||first;
  const start=chinaDayRange(first).start,end=chinaDayRange(last).start;
  if(end<start||(end-start)/86400000>366)throw new AppError(400,"INVALID_RANGE","统计查询范围应在一年内。");
  const rows=[];
  for(let at=start;at<=end;at+=86400000) {
    const date=chinaDate(at),summary=computeStatistics(snapshot.activities,date,snapshot.events,records.identity.now());
    rows.push({id:`projection:${babyId}:${date}`,babyId,date:new Date(at).toISOString(),...summary.metrics,coverage:summary.coverage,byType:summary.byType});
  }
  return detail?rows[0]:rows;
}
export async function readSyncStatus(records:RecordsService,principal:Principal,babyId:string,collector?:CollectorService) {
  const media=collector?await collector.pendingMedia(principal,babyId):undefined;
  return records.identity.executeAuthorized(principal,babyId,"records:read",async(scope,req)=>{
    const jobs=await records.repo.list<CollectorJob>("care-sync",babyId,req);
    return jobs.filter(job=>scope.actor.kind!=="collector"||job.groupId===scope.groupId).map(job=>({id:job.id,enabled:job.enabled,lastSuccessAt:job.lastSuccessAt||null,
      heartbeatAt:job.heartbeatAt||null,processedThrough:(job as CollectorJob&{processedThrough?:string}).processedThrough||null,
      pending:!!job.activeBatchId,pendingMedia:media?media.filter(question=>question.source.groupId===job.groupId).length:job.pendingMedia||0,nextRunAt:job.nextRunAt,failure:job.failure||null}));
  },principal.kind==="collector"?principal.groupId:undefined);
}
