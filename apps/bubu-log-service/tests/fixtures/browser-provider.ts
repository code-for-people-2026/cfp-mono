import type { ChatProvider, ProviderInput, ProviderOutput } from "../../src/chat/contracts";
import { chatModelContext, chatUserInput } from "./chat";

const row=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const rows=(value:unknown):Record<string,unknown>[]=>Array.isArray(value)?value.map(row):[];
/** Deliberately small, explicit synthetic script; no inference claims or production fallback. */
export class BrowserScenarioProvider implements ChatProvider {
  async complete(input:ProviderInput):Promise<ProviderOutput> {
    if(input.responseFormat?.name==="bubu_reply_verdict")return{text:JSON.stringify({verdict:"pass",issues:[]}),calls:[]};
    const last=input.messages.at(-1);
    if(input.responseFormat?.name==="bubu_chat_reply"&&last?.role==="user"&&typeof last.content==="string") {
      try {
        const envelope=row(JSON.parse(last.content));
        if(envelope.type==="bubu_reply_regeneration")return{text:JSON.stringify({text:"这项内容需要选择后才能继续。",questions:[{id:"fixture-required-choice",prompt:"这次是哪一种？",choices:[
          {id:"fixture-choice-a",label:"选项一",action:{type:"reply",text:"选择选项一"}},
          {id:"fixture-choice-b",label:"选项二",action:{type:"reply",text:"选择选项二"}},
        ]}]}),calls:[]};
      } catch { /* The ordinary trusted chat envelopes are handled below. */ }
    }
    if(input.messages.at(-1)?.role==="tool")return{text:JSON.stringify({text:"已有内容已整理，当前待补项显示在下方。",questions:[]}),calls:[]};
    const user=chatUserInput(input),context=chatModelContext(input),events=rows(context.events),pending=rows(context.pending);
    const call=(name:string,args:Record<string,unknown>):ProviderOutput=>({text:"",calls:[{id:`fixture-${input.messages.length}-${name}`,name,arguments:args}]});
    const selected=row(context.selectedEvent);
    const feeding=events.find(event=>row(event.facts).type==="BOTTLE"||event.intent==="feeding"||(!row(event.facts).type&&event.lifecycle==="active"));
    const fieldQuestion=(eventId?:unknown)=>pending.find(question=>question.id===row(context.question).id)||pending.find(question=>question.eventId===eventId);
    const answer=(question:Record<string,unknown>|undefined,patch:Record<string,unknown>)=>{
      if(!question)throw new Error("Synthetic question not found");
      return call("bubu_answer_pending",{questionId:question.id,patch});
    };
    if(user.attachmentIds.length)return call("bubu_record_events",{events:[{facts:{type:"DIAPER",startTime:"2026-10-23T19:55:00+08:00"},attachmentIds:user.attachmentIds,evidence:[
      {field:"hasPoop",kind:"image",confirmed:false},{field:"hasPee",kind:"image",confirmed:false},
    ]}]});
    if(user.text==="晚上喝奶 200 羊奶，150 奶粉")return call("bubu_record_events",{events:[{facts:{type:"BOTTLE",milkItems:[
      {id:"fixture-goat-milk",milkDescription:"羊奶",milkAmount:200},
      {id:"fixture-formula",milkSource:"FORMULA",milkAmount:150},
    ]},progress:"ended"}]});
    if(user.text==="18点这餐羊奶200，奶粉奶量待补")return call("bubu_record_events",{events:[{facts:{type:"BOTTLE",startTime:"2026-10-23T18:00:00+08:00",milkItems:[
      {id:"fixture-partial-goat",milkDescription:"羊奶",milkAmount:200},
      {id:"fixture-partial-formula",milkSource:"FORMULA"},
    ]},progress:"ended"}]});
    if(user.text==="喝奶了")return call("bubu_record_events",{events:[{intent:"feeding",facts:{startTime:"2026-10-23T19:30:00+08:00"}}]});
    if(user.text.includes("奶瓶")&&user.text.includes("奶粉"))return call("bubu_update_event",{eventId:feeding?.id,patch:{facts:{type:"BOTTLE",milkItems:[{id:"fixture-formula",milkSource:"FORMULA"}]}}});
    if(user.text.includes("泡了120")) {
      const facts=row(feeding?.facts),items=rows(facts.milkItems);
      return call("bubu_update_event",{eventId:feeding?.id,patch:{facts:{preparedMilkAmount:120,remainingMilkAmount:20,sameBottle:true,milkItems:items.map((item,index)=>({...item,...(index===0?{milkAmount:100}:{})}))}}});
    }
    if(user.text.includes("喂了10分钟"))return answer(fieldQuestion(feeding?.id),{facts:{durationMinutes:10,burpSuccess:true}});
    if(user.text==="触发选择题校验")return{text:JSON.stringify({text:"请告诉我你选哪一个",questions:[]}),calls:[]};
    if(user.text.includes("实际喝入80")) {
      const target=selected.id?selected:feeding,facts=row(target?.facts),items=rows(facts.milkItems);
      return call("bubu_update_event",{eventId:target?.id,patch:{facts:{remainingMilkAmount:40,sameBottle:true,milkItems:items.map((item,index)=>({...item,...(index===0?{milkAmount:80}:{})}))}}});
    }
    if(user.text.includes("删除这条"))return call("bubu_retract_event",{eventId:selected.id||feeding?.id});
    if(user.text.includes("恢复这条"))return call("bubu_restore_event",{eventId:selected.id||feeding?.id});
    if(user.text.includes("不知道有没有大便")) {
      const question=pending.find(item=>Array.isArray(item.fields)&&item.fields.includes("hasPoop"));
      if(question)return answer(question,{facts:{},states:{hasPoop:"unknown"}});
      if(selected.id)return call("bubu_update_event",{eventId:selected.id,patch:{facts:{},states:{hasPoop:"unknown"}}});
      const event=events.find(item=>row(item.facts).type==="DIAPER"&&row(item.facts).hasPee===true&&!Array.isArray(item.attachmentIds));
      if(!event)throw new Error("Synthetic seeded diaper not found");
      return call("bubu_update_event",{eventId:event.id,patch:{facts:{},states:{hasPoop:"unknown"}}});
    }
    if(user.text.includes("黄色便便")) {
      const event=events.find(item=>row(item.facts).type==="DIAPER"&&Array.isArray(item.attachmentIds)&&item.attachmentIds.length);
      return answer(fieldQuestion(event?.id),{facts:{hasPoop:true,hasPee:false,poopColor:"YELLOW"},evidence:[{field:"hasPoop",kind:"reported",confirmed:true},{field:"hasPee",kind:"reported",confirmed:true},{field:"poopColor",kind:"reported",confirmed:true}]});
    }
    return{text:JSON.stringify({text:"这是隔离验证会话，仅处理测试场景中的照护描述。",questions:[]}),calls:[]};
  }
}
