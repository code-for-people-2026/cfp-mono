import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { AppError } from "../contracts";
import { protectRecordPhotos } from "../media";
import type { IdentityService, Principal } from "../identity";
import { collectorInputSchema, resolveMediaSchema, type CollectorService } from "../collector/service";
import type { RecordsService } from "./service";
import { identifier, baseMutation, eventMutation, recordSchema, updateSchema, answerSchema, querySchema } from "./schemas";
import { activityTypes } from "./types";
import { evaluateEvent } from "./rules";

function createRecordsMcp(identity: IdentityService, records: RecordsService, collector: CollectorService, token: string) {
  const server = new McpServer({ name: "bubu-diary", version: "1.0.0" });
  const result = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
  function register<S extends z.ZodType>(name:string,description:string,schema:S,handler:(principal:Principal,args:z.output<S>)=>Promise<unknown>) {
    const transportSchema:z.ZodType=schema;
    server.registerTool(name,{description,inputSchema:transportSchema},async(raw:unknown)=>{
      try {
        // The credential is never an argument or a prompt field. Check it again for every tool.
        const principal = await identity.authenticate(token,"bearer");
        const args=schema.parse(raw);
        const value=await handler(principal,args);
        return result(protectRecordPhotos(value,(args as {babyId:string}).babyId));
      } catch(error) {
        const failure = error instanceof AppError ? {code:error.code,error:error.message,status:error.status,retryable:error.retryable ?? error.status>=500}
          : error instanceof z.ZodError ? {code:"INVALID_INPUT",error:"工具参数不符合契约。",retryable:false}
          : {code:"SERVICE_UNAVAILABLE",error:"请求未确认完成，请使用原请求号查询或重试。",retryable:true};
        return {...result(failure),isError:true};
      }
    });
  }
  register("bubu_record_events","创建或批量整理照护记录。允许缺项；只有回执saved或needs_information才表示可靠保存，pending_projection须用原请求号恢复。",recordSchema,(p,a)=>records.record(p,a));
  register("bubu_update_event","按版本补充或更正原事件，不创建另一件事。来源重放不会覆盖人类修订。",updateSchema,(p,a)=>records.update(p,a));
  register("bubu_retract_event","撤销或删除误记，保留来源防重放和修订。",eventMutation,(p,a)=>records.retract(p,a));
  register("bubu_restore_event","用户明确恢复已撤销事件；采集重跑不得使用此工具自动恢复。",eventMutation,(p,a)=>records.retract(p,a,true));
  register("bubu_undo_event","撤销指定事件的最新修订，须带当前版本及修订ID。",eventMutation.extend({revisionId:identifier}),(p,a)=>records.undo(p,a));
  register("bubu_query_events","查询宝宝结构化事实、候选、版本与待补充事项。date是北京时间日期。",querySchema,(p,a)=>records.query(p,a));
  register("bubu_get_summary","读取同一业务投影的日报指标、已知/未知覆盖、进行中和待核对数量，不另算聊天统计。",z.object({babyId:identifier,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).strict(),(p,a)=>records.summary(p,a.babyId,a.date));
  register("bubu_get_pending","读取持久化待补充、冲突及待补图片；明确不知道的字段不重复催问。",z.object({babyId:identifier}).strict(),async(p,a)=>[...await records.pending(p,a.babyId),...await collector.pendingMedia(p,a.babyId)]);
  register("bubu_answer_pending","回答指定版本的问题并更新原事件；过期或已关闭问题拒绝迟到回答。",answerSchema,(p,a)=>records.answer(p,a));
  register("bubu_attach_images","设置事件图片关联，传已上传受保护附件ID；空数组移除关联。",eventMutation.extend({attachmentIds:z.array(identifier).max(10)}),(p,a)=>records.attach(p,a));
  register("bubu_resolve_media","照护者为待补图事项确认已上传并关联的替代图片，或明确不知道；校验当前事件版本并保留处理结果。",resolveMediaSchema,(p,a)=>collector.resolveMedia(p,a));
  register("bubu_resolve_duplicate","由知情照护者核对疑似重复：同一事件合并来源，不同事件才分别计入。",eventMutation.extend({resolution:z.enum(["distinct","same"]),targetEventId:identifier.optional(),targetVersion:z.number().int().positive().optional()}),(p,a)=>records.resolveDuplicate(p,a));
  register("bubu_confirm_overlap","照护者明确确认真实时间重叠，保留理由；对方或自身时间变化后须重新核对，采集不能自动确认。",eventMutation.extend({conflictingEventIds:z.array(identifier).min(1).max(25),reason:z.string().trim().min(1).max(500)}),(p,a)=>records.confirmOverlap(p,a));
  register("bubu_get_request","超时后查询原请求结果。retry=true恢复同一个持久化操作，不重新生成请求号。",baseMutation.extend({retry:z.boolean().optional()}),(p,a)=>records.getRequest(p,a));
  register("bubu_get_revisions","读取原事件修订及原始来源，便于核对或撤销。",z.object({babyId:identifier,eventId:identifier}).strict(),(p,a)=>records.revisions(p,a.babyId,a.eventId));
  register("bubu_accept_legacy","核对外部冲突后明确接受旧业务库最新事实。先读取修订和记录，再由用户确认使用。",eventMutation,(p,a)=>records.reconcile(p,a));
  register("bubu_get_rules","读取当前活动分支应收集的字段和状态；备注、图片可选，尚未发生不强问，禁止使用旧表单默认值。",z.object({babyId:identifier,type:z.enum(activityTypes).optional(),milkSource:z.enum(["BREAST_MILK","FORMULA"]).optional()}).strict(),async(p,a)=>{
    await identity.executeAuthorized(p,a.babyId,"records:read",async()=>undefined,p.kind==="collector"?p.groupId:undefined);
    return {types:activityTypes,rule:evaluateEvent({facts:{type:a.type,milkSource:a.milkSource}}),timezone:"Asia/Shanghai",notesOptional:true,photosOptional:true};
  });
  // MCP's tool-list renderer requires an object at the root. Keep the full action
  // fields discoverable; dispatch still validates the strict discriminated union.
  const collectorFields:Record<string,z.ZodType>={};
  for(const option of collectorInputSchema.options)for(const [key,value] of Object.entries(option.shape))if(key!=="action"&&key!=="babyId")collectorFields[key]=(value instanceof z.ZodDefault?value.removeDefault():value).optional();
  const collectorTransportSchema=z.object({...collectorFields,babyId:identifier,action:z.enum(collectorInputSchema.options.map(option=>option.shape.action.value))}).strict();
  register("bubu_collector","受控群采集批次、进度、失败、重试和补采。运营配置与采集权限分别核验。",collectorTransportSchema,(p,a)=>collector.dispatch(p,a));
  return server;
}
export async function handleRecordsMcp(request:Request,body:unknown,identity:IdentityService,records:RecordsService,collector:CollectorService) {
  const authorization=request.headers.get("authorization");
  if(!authorization?.startsWith("Bearer ")||request.headers.has("cookie"))throw new AppError(401,"MCP_BEARER_REQUIRED","MCP需要服务端持有的受限Bearer凭证。");
  const token=authorization.slice(7);await identity.authenticate(token,"bearer");
  const server=createRecordsMcp(identity,records,collector,token);
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  await server.connect(transport);
  try{return await transport.handleRequest(request,{parsedBody:body});}finally{await server.close();}
}
