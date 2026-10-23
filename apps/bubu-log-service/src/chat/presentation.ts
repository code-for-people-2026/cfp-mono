import type { CareEvent } from "../records/types";
import type { ChatPending, ChatReceipt } from "./contracts";

const activityLabels: Record<string, string> = { BREASTFEED: "亲喂", BOTTLE: "瓶喂", PUMP: "吸奶", SLEEP: "睡眠", DIAPER: "换尿布", HEAD_LIFT: "抬头", PASSIVE_EXERCISE: "被动操", GAS_EXERCISE: "排气操", BATH: "洗澡", OUTDOOR: "户外活动", EARLY_EDUCATION: "早教", ROLL_OVER: "翻身", PULL_TO_SIT: "拉坐", SUPPLEMENT: "补剂", SPIT_UP: "吐奶" };

/** Provider prose cannot create a successful operation receipt. Keep clarification and read-only answers. */
export function uncommittedReply(text: string): string {
  const completionClaim = /(?:已(?:经)?|成功|完成)[^。！？\n]{0,20}(?:记下|记好|记录|保存|存好|删除|删掉|更正|修改|改好|撤销|恢复|更新|入账|入帐|入库)|(?:记录|保存|存储|修改|更正|删除|撤销|恢复|更新|入账|入帐|入库)[^。！？\n]{0,6}(?:成功|完成|好了|好啦)|(?:记下|记好|存好|删掉|改好|入账|入帐|入库)了|\b(?:saved|recorded|deleted|updated|restored|logged|reverted)\b/i;
  return !text.trim() || completionClaim.test(text) ? "本轮没有获得记录变更回执，尚未确认保存。请核对要记录或修改的内容。" : text;
}

/** Presentation of MCP-selected fields only; this function never decides which fields are required. */
export function renderPendingQuestion(question: ChatPending, event?: CareEvent): string {
  if (question.kind === "media") return "这条记录的照片还没有取得。可以补一张照片；找不到或不方便提供，也可以直接说。";
  if (question.duplicateCandidates.length) return "这条可能与已有记录重复，是同一件事，还是不同的两件事？";
  if (question.conflicts.length) return `${question.conflicts[0]!.message} 能帮忙核对一下吗？`;
  const fields = new Set(question.fields);
  if (fields.has("type")) return event?.intent === "feeding"
    ? "这次是亲喂还是奶瓶喂？如果是奶瓶，里面是母乳还是奶粉？"
    : "这次具体是什么活动？可以直接说喂奶、换尿布、睡觉等；不确定也可以说。";
  const prompts: string[] = [];
  if (fields.has("hasPee") || fields.has("hasPoop")) {
    if (fields.has("hasPee") && fields.has("hasPoop")) prompts.push("这次尿布里有尿、有便，还是都有？");
    else prompts.push(fields.has("hasPee") ? "这次尿布里有尿吗？" : "这次尿布里有便便吗？");
    // Ask the branch-defining question first. Its answer lets MCP determine the next question.
    return `${prompts.join(" ")} 不清楚也可以说不知道。`;
  }
  if (fields.has("startTime")) prompts.push("这件事大约几点发生？");
  if (fields.has("milkSource")) prompts.push("奶瓶里是母乳还是奶粉？");
  if (fields.has("preparedMilkAmount")) prompts.push("这瓶奶粉一共泡好了多少毫升？");
  if (fields.has("milkAmount")) prompts.push(event?.facts.type === "PUMP" ? "这次一共泵出了多少毫升？" : "宝宝实际喝进了多少毫升？");
  if (fields.has("remainingMilkAmount")) prompts.push("这一瓶还剩多少毫升？");
  if (fields.has("sameBottle")) prompts.push("泡好量和剩余量说的是同一瓶奶吗？");
  if (fields.has("endTime") || fields.has("durationMinutes")) prompts.push(event?.facts.type === "SLEEP" ? "宝宝还在睡，还是已经醒了？如果醒了，是几点醒的？" : "大约持续了多久，或者是几点结束的？");
  if (fields.has("burpSuccess")) prompts.push("这次拍嗝了吗，拍嗝是否成功？");
  if (fields.has("breastFirmness")) prompts.push("喂完后乳房摸起来偏软、有弹性，还是偏硬？");
  if (fields.has("peeAmount")) prompts.push("尿量大约偏少、中等，还是偏多？");
  if (fields.has("poopColor")) prompts.push("便便是什么颜色？例如黄、绿、棕、黑、白或红色。照片里的判断还需要你确认。");
  if (fields.has("count")) prompts.push("这次大约做了几次？");
  if (fields.has("supplementType")) prompts.push("这次吃的是 AD、D3、益生菌，还是益生元？");
  if (fields.has("spitUpType")) prompts.push("这次是普通溢奶，还是明显喷射出来的？");
  return prompts.length ? `${prompts.join(" ")} 不清楚的也可以说不知道。` : "还有需要补充或核对的内容吗？";
}

function factSummary(event: CareEvent): string {
  const facts = event.projection === "synced" && event.projected ? event.projected : event.facts;
  const parts = [facts.type ? activityLabels[facts.type] || "照护记录" : event.intent === "feeding" ? "喂奶" : "照护记录"];
  const known = (field: keyof typeof facts) => event.states[field as keyof CareEvent["states"]] === "known";
  if (typeof facts.milkAmount === "number" && known("milkAmount")) parts.push(facts.type === "PUMP" ? `泵出 ${facts.milkAmount} 毫升` : `实际喝入 ${facts.milkAmount} 毫升`);
  if (typeof facts.preparedMilkAmount === "number" && known("preparedMilkAmount")) parts.push(`泡好 ${facts.preparedMilkAmount} 毫升`);
  if (typeof facts.count === "number" && known("count")) parts.push(`${facts.count} 次`);
  if (event.progress === "ongoing") parts.push("仍在进行");
  if (facts.type === "DIAPER") {
    if (known("hasPee")) parts.push(facts.hasPee ? "有尿" : "无尿");
    if (known("hasPoop")) parts.push(facts.hasPoop ? "有便" : "无便");
  }
  return parts.join("，");
}

/** Success text is derived only from confirmed MCP receipts, never from provider prose. */
export function confirmedReply(receipts: ChatReceipt[], questions: ChatPending[]): string {
  const lines: string[] = [];
  const records = receipts.filter((item): item is Extract<ChatReceipt, { events: CareEvent[] }> => "events" in item);
  const latest = new Map(records.flatMap(item => item.events.map(event => [event.id, event] as const)));
  if (records.some(item => item.status === "pending_projection")) lines.push("输入已经保留，记录或统计尚未确认完成，请继续处理。");
  else if (records.some(item => item.status === "conflict")) lines.push("原记录已发生变化，尚未覆盖，请先核对后再更正。");
  else if (records.length) {
    if ([...latest.values()].every(event => event.lifecycle === "retracted")) lines.push("已撤销所选记录，历史修订仍保留。");
    else for (const event of [...latest.values()].filter(event => event.lifecycle === "active").slice(0, 3)) {
      lines.push(event.projection === "candidate" || event.duplicateCandidates.length
        ? `已保留${factSummary(event)}；待核对内容还没有计入正式统计。`
        : `已记录${factSummary(event)}。`);
    }
  }
  for (const item of receipts) if ("kind" in item && item.kind === "media") lines.push(item.resolution === "unknown" ? "已记下无法提供这张照片，不再重复追问。" : "补充照片已确认关联到原记录。");
  const next = questions.find(item => item.kind === "fields" && (!latest.size || latest.has(item.eventId)));
  if (next?.kind === "fields") lines.push(renderPendingQuestion(next, latest.get(next.eventId)));
  return [...new Set(lines)].join("\n");
}
