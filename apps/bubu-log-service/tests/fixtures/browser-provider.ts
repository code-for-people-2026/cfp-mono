import type { ChatProvider, ProviderInput, ProviderOutput } from "../../src/chat/contracts";
import { chatModelContext, chatUserInput } from "./chat";

const row=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.map(row):[];
/** Deliberately small, explicit synthetic script; no inference claims or production fallback. */
export class BrowserScenarioProvider implements ChatProvider {
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
