import { activityTypes, type CareEvent } from "../records/types";
import type { CarePreferencesView, PreferenceKey, PreferenceMutationReceipt } from "../records/preferences";
import type { ChatFormControl, ChatPending, ChatReceipt, PendingEventForm, ReplyQuestion, StructuredFormAnswer } from "./contracts";

const activityLabels: Record<string, string> = { BREASTFEED: "亲喂", BOTTLE: "瓶喂", PUMP: "吸奶", SLEEP: "睡眠", DIAPER: "换尿布", HEAD_LIFT: "抬头", PASSIVE_EXERCISE: "被动操", GAS_EXERCISE: "排气操", BATH: "洗澡", OUTDOOR: "户外活动", EARLY_EDUCATION: "早教", ROLL_OVER: "翻身", PULL_TO_SIT: "拉坐", SUPPLEMENT: "补剂", SPIT_UP: "吐奶" };
const fieldLabels: Partial<Record<keyof CareEvent["facts"], string>> = {
  type: "活动类型", startTime: "开始时间", endTime: "结束时间", durationMinutes: "持续时长",
  reportedIntake: "报告摄入量", milkItems: "奶品明细", milkAmount: "奶量", milkSource: "奶源", milkDescription: "奶品原话", preparedMilkAmount: "泡好奶量",
  remainingMilkAmount: "剩余奶量", sameBottle: "是否同一瓶", burpSuccess: "拍嗝结果",
  breastFirmness: "乳房触感", hasPoop: "是否有便", hasPee: "是否有尿", poopColor: "便便颜色",
  peeAmount: "尿量", count: "次数", supplementType: "补剂类型", spitUpType: "吐奶类型",
};
const enumLabels: Record<string, string> = {
  BREAST_MILK: "母乳", FORMULA: "奶粉", SOFT: "偏软", ELASTIC: "有弹性", HARD: "偏硬",
  SMALL: "偏少", MEDIUM: "中等", LARGE: "偏多", YELLOW: "黄色", GREEN: "绿色", BROWN: "棕色",
  BLACK: "黑色", WHITE: "白色", RED: "红色", AD: "AD", D3: "D3", PROBIOTICS: "益生菌",
  PREBIOTICS: "益生元", NORMAL: "普通溢奶", PROJECTILE: "喷射状", ...activityLabels,
};
const TEST_RECORD_MARKER = "[测试记录]";
const readableShanghaiTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
};

/** Provider prose cannot create a successful operation receipt. Keep clarification and read-only answers. */
export function uncommittedReply(text: string): string {
  const completionClaim = /(?:已(?:经)?|成功|完成)[^。！？\n]{0,20}(?:记下|记好|记录|保存|存好|删除|删掉|更正|修改|改好|撤销|恢复|更新|入账|入帐|入库)|(?:记录|保存|存储|修改|更正|删除|撤销|恢复|更新|入账|入帐|入库)[^。！？\n]{0,6}(?:成功|完成|好了|好啦)|(?:记下|记好|存好|删掉|改好|入账|入帐|入库)了|\b(?:saved|recorded|deleted|updated|restored|logged|reverted)\b/i;
  return !text.trim() || completionClaim.test(text) ? "本轮没有获得记录变更回执，因此没有确认任何保存结果。" : text;
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
  if (event.facts.notes?.startsWith(TEST_RECORD_MARKER)) parts.unshift(TEST_RECORD_MARKER);
  const known = (field: keyof typeof facts) => event.states[field as keyof CareEvent["states"]] === "known";
  if (event.facts.milkItems?.length) {
    for (const item of event.facts.milkItems) {
      const name = item.milkDescription || (item.milkSource === "FORMULA" ? "奶粉" : item.milkSource === "BREAST_MILK" ? "母乳" : item.milkSourceState === "unknown" ? "奶品未知" : "奶品待补");
      parts.push(`${name}${item.milkAmountState === "known" ? ` ${item.milkAmount} 毫升` : item.milkAmountState === "unknown" ? "（奶量未知）" : "（奶量待补）"}`);
    }
    if (event.states.milkAmount === "known" && typeof event.facts.milkAmount === "number") parts.push(`合计 ${event.facts.milkAmount} 毫升`);
    else {
      const subtotal = event.facts.milkItems.filter(item => item.milkAmountState === "known").reduce((sum, item) => sum + item.milkAmount!, 0);
      if (subtotal || event.facts.milkItems.some(item => item.milkAmountState === "known" && item.milkAmount === 0)) parts.push(`已知小计 ${subtotal} 毫升（非整餐总量）`);
    }
  } else {
    if (event.states.milkDescription === "known" && event.facts.milkDescription) parts.push(`奶品：${event.facts.milkDescription}`);
    if (typeof facts.milkAmount === "number" && known("milkAmount")) parts.push(facts.type === "PUMP" ? `泵出 ${facts.milkAmount} 毫升` : `实际喝入 ${facts.milkAmount} 毫升`);
  }
  if (typeof facts.preparedMilkAmount === "number" && known("preparedMilkAmount")) parts.push(`泡好 ${facts.preparedMilkAmount} 毫升`);
  if (typeof facts.count === "number" && known("count")) parts.push(`${facts.count} 次`);
  if (event.progress === "ongoing") parts.push("仍在进行");
  if (facts.type === "DIAPER") {
    if (known("hasPee")) parts.push(facts.hasPee ? "有尿" : "无尿");
    if (known("hasPoop")) parts.push(facts.hasPoop ? "有便" : "无便");
  }
  return parts.join("，");
}

const preferenceOption = (preferences: CarePreferencesView | undefined, activityType: CareEvent["facts"]["type"] | undefined,
  field: "milkAmount" | "durationMinutes" | "count") => {
  if (!activityType || (field === "milkAmount" && activityType !== "BOTTLE" && activityType !== "PUMP")) return undefined;
  const option = preferences?.options.find(item => item.key === `${activityType}.${field}`);
  if (!option) return undefined;
  const unit = field === "milkAmount" ? "ml" : field === "durationMinutes" ? "分钟" : "次";
  return { options: option.effectiveValues.map(value => ({ label: `${value} ${unit}`, value: String(value) })), optionsSource: option.source } as const;
};
const relativeTimeOptions = (sourceSentAt: string | undefined) => {
  if (!sourceSentAt || !Number.isFinite(Date.parse(sourceSentAt))) return undefined;
  const instant = Date.parse(sourceSentAt);
  return [
    { label: "按原消息时间", value: new Date(instant).toISOString() },
    { label: "提前 5 分钟", value: new Date(instant - 5 * 60_000).toISOString() },
    { label: "提前 10 分钟", value: new Date(instant - 10 * 60_000).toISOString() },
  ];
};

function control(field: keyof CareEvent["facts"], activityType?: CareEvent["facts"]["type"], preferences?: CarePreferencesView, sourceSentAt?: string): ChatFormControl {
  const base = { field, draftKey: String(field), label: fieldLabels[field] || String(field), allowUnknown: true as const };
  if (field === "type") return { ...base, kind: "enum", options: activityTypes.map(value => ({ label: enumLabels[value] || value, value })) };
  if (field === "milkAmount") return { ...base, kind: "number", unit: "ml", label: activityType === "PUMP" ? "泵出奶量" : "实际喝入奶量", ...preferenceOption(preferences, activityType, field) };
  if (field === "preparedMilkAmount") return { ...base, kind: "number", unit: "ml", label: "泡好奶量" };
  if (field === "remainingMilkAmount") return { ...base, kind: "number", unit: "ml", label: "剩余奶量" };
  if (field === "durationMinutes") return { ...base, kind: "duration", unit: "minutes", ...preferenceOption(preferences, activityType, field) };
  if (field === "count") return { ...base, kind: "number", unit: "times", ...preferenceOption(preferences, activityType, field) };
  if (field === "startTime" || field === "endTime") return { ...base, kind: "timestamp", ...(sourceSentAt ? { referenceTime: sourceSentAt } : {}), ...(relativeTimeOptions(sourceSentAt) ? { options: relativeTimeOptions(sourceSentAt) } : {}) };
  if (field === "hasPee" || field === "hasPoop" || field === "sameBottle" || field === "burpSuccess") {
    return { ...base, kind: "boolean", options: [{ label: "是", value: "true" }, { label: "否", value: "false" }], ...(field === "burpSuccess" ? { allowNotYet: true as const } : {}) };
  }
  const choices: Record<string, string[]> = {
    milkSource: ["BREAST_MILK", "FORMULA"], breastFirmness: ["SOFT", "ELASTIC", "HARD"],
    peeAmount: ["SMALL", "MEDIUM", "LARGE"], poopColor: ["YELLOW", "GREEN", "BROWN", "BLACK", "WHITE", "RED"],
    supplementType: ["AD", "D3", "PROBIOTICS", "PREBIOTICS"], spitUpType: ["NORMAL", "PROJECTILE"],
  };
  const values = choices[String(field)];
  if (!values) throw new Error(`Unsupported pending field: ${String(field)}`);
  return { ...base, kind: "enum", options: values.map(value => ({ label: enumLabels[value] || value, value })) };
}

/** One incomplete event is one form. Rule selection remains in records/MCP; this DTO only presents its selected fields. */
export function buildPendingForm(question: ChatPending & { kind: "fields" }, event?: CareEvent, preferences?: CarePreferencesView): PendingEventForm | undefined {
  if (!event) return undefined;
  const sourceSentAt = event.sources.map(source => source.sentAt).filter(value => Number.isFinite(Date.parse(value))).sort()[0];
  // A stale field can remain in a persisted question after the event already
  // learned it. Present only what still needs input; unknown future fields fall
  // back to conversation instead of failing the whole chat history.
  const controls = question.fields
    .filter(field => field !== "notes" && event.states[field] !== "known")
    .flatMap(field => {
      try {
        if (event.facts.type === "BOTTLE" && event.facts.milkItems?.length && (field === "milkAmount" || field === "milkSource")) {
          const state = field === "milkAmount" ? "milkAmountState" : "milkSourceState";
          return event.facts.milkItems.flatMap((item, index) => {
            if (item[state] !== "pending") return [];
            const label = item.milkDescription || (item.milkSource === "FORMULA" ? "奶粉" : item.milkSource === "BREAST_MILK" ? "母乳" : `第 ${index + 1} 项奶品`);
            return { ...control(field, event.facts.type, preferences, sourceSentAt), draftKey: `${field}:${item.id}`, milkItemId: item.id, milkItemLabel: label,
              label: field === "milkAmount" ? `${label}实际喝入奶量` : `${label}种类` };
          });
        }
        const result = control(field, event.facts.type, preferences, sourceSentAt);
        if (field === "type" && event.intent === "feeding" && result.options) result.options = result.options.filter(option => option.value === "BREASTFEED" || option.value === "BOTTLE");
        return [result];
      } catch { return []; }
    })
    .filter((item): item is ChatFormControl => !!item);
  // endTime and durationMinutes are equivalent answers to the authoritative
  // temporal question. Publish the baby's actual duration choices for the
  // alternate path instead of making the client invent generic examples.
  if (question.fields.includes("endTime") && !controls.some(item => item.field === "durationMinutes") && event.states.durationMinutes !== "known") {
    const alternate = control("durationMinutes", event.facts.type, preferences, sourceSentAt);
    if (alternate.options?.length) controls.push(alternate);
  }
  if (!controls.length && !question.conflicts.length && !question.duplicateCandidates.length) return undefined;
  return {
    eventId: event.id,
    eventVersion: question.eventVersion,
    questionId: question.id,
    questionVersion: question.version,
    title: event.facts.type ? activityLabels[event.facts.type] || "照护记录" : event.intent === "feeding" ? "喂奶" : "照护记录",
    activityType: event.facts.type,
    startedAt: event.facts.startTime,
    ...(sourceSentAt ? { sourceSentAt } : {}),
    knownSummary: factSummary(event),
    controls,
    ...(event.states.endTime !== "known" && controls.some(control => control.field === "endTime" || control.field === "durationMinutes") ? {
      progressControl: { field: "progress", kind: "progress", label: event.facts.type === "SLEEP" ? "睡眠状态" : "进行状态", options: [{ label: "仍在进行", value: "ongoing" }, { label: "已经结束", value: "ended" }, { label: "不确定", value: "unknown" }] },
    } : {}),
    conflictMessages: question.conflicts.map(issue => issue.message),
    duplicateCandidateIds: [...question.duplicateCandidates],
  };
}

/** Reject incomplete server-built presentations before they cross the HTTP boundary. */
export function validatePendingFormPresentation(questions: ChatPending[]): string[] {
  const issues: string[] = [];
  const kindByField: Partial<Record<keyof CareEvent["facts"], ChatFormControl["kind"]>> = {
    type: "enum", startTime: "timestamp", endTime: "timestamp", durationMinutes: "duration",
    milkAmount: "number", preparedMilkAmount: "number", remainingMilkAmount: "number", count: "number",
    milkSource: "enum", breastFirmness: "enum", peeAmount: "enum", poopColor: "enum", supplementType: "enum", spitUpType: "enum",
    hasPee: "boolean", hasPoop: "boolean", sameBottle: "boolean", burpSuccess: "boolean",
  };
  const choicesByField: Partial<Record<keyof CareEvent["facts"], readonly string[]>> = {
    type: activityTypes, milkSource: ["BREAST_MILK", "FORMULA"], breastFirmness: ["SOFT", "ELASTIC", "HARD"],
    peeAmount: ["SMALL", "MEDIUM", "LARGE"], poopColor: ["YELLOW", "GREEN", "BROWN", "BLACK", "WHITE", "RED"],
    supplementType: ["AD", "D3", "PROBIOTICS", "PREBIOTICS"], spitUpType: ["NORMAL", "PROJECTILE"],
    hasPee: ["true", "false"], hasPoop: ["true", "false"], sameBottle: ["true", "false"], burpSuccess: ["true", "false"],
  };
  const numericMax: Partial<Record<keyof CareEvent["facts"], number>> = { milkAmount: 100000, preparedMilkAmount: 100000, remainingMilkAmount: 100000, durationMinutes: 10080, count: 100000 };
  for (const question of questions) {
    if (question.kind !== "fields" || !question.form) continue;
    const form = question.form;
    if (form.questionId !== question.id || form.questionVersion !== question.version || form.eventVersion !== question.eventVersion) {
      issues.push(`待补表单 ${question.id} 的版本绑定不完整`);
    }
    if (form.eventId !== question.eventId) issues.push(`待补表单 ${question.id} 的事件绑定不一致`);
    const controlKeys = new Set<string>();
    const controlFields = new Set<string>();
    for (const item of form.controls) {
      const options = item.options || [];
      if (controlKeys.has(item.draftKey)) issues.push(`待补表单 ${question.id} 的 ${item.draftKey} 重复`);
      controlKeys.add(item.draftKey);
      controlFields.add(item.field);
      if (!item.draftKey.trim() || item.milkItemId && item.draftKey !== `${String(item.field)}:${item.milkItemId}`) issues.push(`待补表单 ${question.id} 的逐项绑定无效`);
      const allowed = question.fields.includes(item.field) || (item.field === "durationMinutes" && question.fields.includes("endTime")) || (item.field === "endTime" && question.fields.includes("durationMinutes"));
      if (!allowed) issues.push(`待补表单 ${question.id} 包含未授权字段 ${String(item.field)}`);
      if (kindByField[item.field] !== item.kind || !item.label.trim() || item.allowUnknown !== true) issues.push(`待补表单 ${question.id} 的 ${String(item.field)} 控件不受支持`);
      if ((item.kind === "enum" || item.kind === "boolean") && options.length < 2) issues.push(`待补表单 ${question.id} 的 ${String(item.field)} 缺少可选项`);
      if ((item.kind === "enum" || item.kind === "boolean") && options.some(option => !choicesByField[item.field]?.includes(option.value))) issues.push(`待补表单 ${question.id} 的 ${String(item.field)} 有不支持的选项`);
      if ((item.kind === "number" || item.kind === "duration") && options.length < 1) issues.push(`待补表单 ${question.id} 的 ${String(item.field)} 缺少服务端数值选项`);
      if (item.kind === "timestamp" && item.referenceTime && (!Number.isFinite(Date.parse(item.referenceTime)) || options.length < 1)) issues.push(`待补表单 ${question.id} 的 ${String(item.field)} 缺少有效原消息时间选项`);
      if (options.some(option => !option.label.trim() || !option.value.trim())) issues.push(`待补表单 ${question.id} 的 ${String(item.field)} 有空选项`);
      if (new Set(options.map(option => option.value)).size !== options.length || new Set(options.map(option => option.label)).size !== options.length) issues.push(`待补表单 ${question.id} 的 ${String(item.field)} 有重复选项`);
      if (item.kind === "timestamp" && options.some(option => !Number.isFinite(Date.parse(option.value)))) issues.push(`待补表单 ${question.id} 的 ${String(item.field)} 有无效时间选项`);
      if (item.kind === "number" || item.kind === "duration") {
        const values = options.map(option => option.value.trim()).map(Number);
        const max = numericMax[item.field];
        if (values.some((value, index) => !options[index]!.value.trim() || !Number.isFinite(value) || value < 0 || max === undefined || value > max || item.field === "count" && !Number.isSafeInteger(value))) {
          issues.push(`待补表单 ${question.id} 的 ${String(item.field)} 有无效数值选项`);
        }
        if (new Set(values).size !== values.length) issues.push(`待补表单 ${question.id} 的 ${String(item.field)} 有重复数值选项`);
        if (item.kind === "duration" && item.unit !== "minutes" || item.kind === "number" && !item.unit) issues.push(`待补表单 ${question.id} 的 ${String(item.field)} 单位无效`);
      }
    }
    if (question.fields.includes("endTime") && !controlFields.has("durationMinutes")) issues.push(`待补表单 ${question.id} 缺少时长替代选项`);
    if (form.progressControl) {
      const values = form.progressControl.options.map(option => option.value);
      if (!controlFields.has("endTime") && !controlFields.has("durationMinutes") || values.length !== 3 || new Set(values).size !== 3 || values.some(value => !["ongoing", "ended", "unknown"].includes(value))) {
        issues.push(`待补表单 ${question.id} 的进行状态控件无效`);
      }
    }
  }
  return issues;
}

/** Persist a server-derived utterance-like summary; structured facts are authority, arbitrary prose is not echoed as a claim. */
export function structuredAnswerText(answer: StructuredFormAnswer): string {
  const parts: string[] = [];
  if (answer.progress) parts.push(`状态：${answer.progress === "ongoing" ? "仍在进行" : answer.progress === "ended" ? "已经结束" : "不确定"}`);
  for (const [key, value] of Object.entries(answer.facts || {})) {
    const label = fieldLabels[key as keyof CareEvent["facts"]] || key;
    if (value === null) parts.push(`${label}：未提供`);
    else if (typeof value === "boolean") parts.push(`${label}：${value ? "是" : "否"}`);
    else if (typeof value === "number") parts.push(`${label}：${value}${key === "durationMinutes" ? "分钟" : key === "count" ? "次" : key.toLowerCase().endsWith("milkamount") ? "毫升" : ""}`);
    else if (typeof value === "string") parts.push(`${label}：${key === "startTime" || key === "endTime" ? readableShanghaiTime(value) : enumLabels[value] || value}`);
    else if (!Array.isArray(value) && "value" in value) parts.push(`${label}：${value.value}克（${value.originalText}）`);
  }
  for (const [key, state] of Object.entries(answer.states || {})) {
    if (state === "unknown") parts.push(`${fieldLabels[key as keyof CareEvent["facts"]] || key}：不知道`);
    if (state === "not_yet") parts.push(`${fieldLabels[key as keyof CareEvent["facts"]] || key}：尚未发生`);
  }
  for (const [index, item] of (answer.milkItemAnswers || []).entries()) {
    const label = answer.milkItemAnswers!.length > 1 ? `第 ${index + 1} 项奶品` : "这项奶品";
    if (typeof item.facts?.milkAmount === "number") parts.push(`${label}：${item.facts.milkAmount}毫升`);
    else if (item.states?.milkAmountState === "unknown") parts.push(`${label}：奶量不知道`);
    if (item.facts?.milkSource) parts.push(`${label}：${enumLabels[item.facts.milkSource]}`);
    else if (item.facts?.milkDescription) parts.push(`${label}：${item.facts.milkDescription}`);
    else if (item.states?.milkSourceState === "unknown") parts.push(`${label}：奶品不知道`);
  }
  return parts.length ? `表单提交：${parts.join("；")}。` : "表单提交：没有提供新字段。";
}

/** Success text is derived only from confirmed MCP receipts, never from provider prose. */
export function confirmedReply(receipts: ChatReceipt[], questions: ChatPending[]): string {
  const lines: string[] = [];
  const records = receipts.filter((item): item is Extract<ChatReceipt, { events: CareEvent[] }> => "events" in item);
  const latest = new Map(records.flatMap(item => item.events.map(event => [event.id, event] as const)));
  const hasOpenQuestion = (eventId: string) => questions.some(question =>
    question.state === "open" && (question.kind === "fields" ? question.eventId === eventId : question.eventIds.includes(eventId))
  );
  if (records.some(item => item.status === "pending_projection")) lines.push("已整理你的说明；记录或统计仍在确认，可从原请求继续恢复。");
  else if (records.some(item => item.status === "conflict")) lines.push("原记录已发生变化，尚未覆盖；更正目前处于待核对状态。");
  else if (records.length) {
    if ([...latest.values()].every(event => event.lifecycle === "retracted")) lines.push("已撤销所选记录，历史修订仍保留。");
    else for (const event of [...latest.values()].filter(event => event.lifecycle === "active").slice(0, 3)) {
      const summary = factSummary(event);
      if (event.projection === "candidate" || event.duplicateCandidates.length) lines.push(`已保留${summary}；待核对内容还没有计入正式统计。`);
      else if (!event.complete) lines.push(hasOpenQuestion(event.id)
        ? `已保留${summary}；还需补充。`
        : `已保留${summary}；不确定的信息已记下，不再重复追问。`);
      else lines.push(`已记录${summary}。`);
    }
  }
  for (const item of receipts) if ("kind" in item && item.kind === "media") lines.push(item.resolution === "unknown" ? "已记下无法提供这张照片，不再重复追问。" : "补充照片已确认关联到原记录。");
  for (const item of receipts) if ("kind" in item && item.kind === "care_preferences_changed") {
    const config = item as PreferenceMutationReceipt;
    const ordered = config.changedKeys.flatMap(key => {
      const option = config.preferences.options.find(value => value.key === key);
      if (!option) return [];
      const field = key.split(".")[1];
      const unit = field === "milkAmount" ? "ml" : field === "durationMinutes" ? "分钟" : "次";
      return [`${preferenceLabel(key)}：${option.configuredValues.map(value => `${value} ${unit}`).join("、") || "已清空"}`];
    });
    lines.push([config.text, ...ordered].join("\n"));
  }
  return [...new Set(lines)].join("\n");
}

const pendingOrigin = (question: ChatPending): ReplyQuestion["origin"] => question.kind === "media"
  ? { kind: "pending", mediaPendingId: question.id, ...(question.eventIds.length === 1 ? { selectedEventId: question.eventIds[0] } : {}) }
  : { kind: "pending", selectedEventId: question.eventId, question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion } };

/** Conflicts, duplicate review and media recovery are typed choices; ordinary missing fields remain in PendingFormStepper. */
const preferenceLabel = (key: PreferenceKey) => {
  const [type, field] = key.split(".");
  return `${activityLabels[type!] || "照护"}${field === "milkAmount" ? "奶量" : field === "durationMinutes" ? "时长" : "次数"}`;
};

export function pendingReplyQuestions(questions: ChatPending[], events: CareEvent[] = []): ReplyQuestion[] {
  const result: ReplyQuestion[] = [];
  for (const question of questions) {
    if (question.kind === "media") {
      result.push({
        id: `pending-${question.id}`, prompt: "这项待补照片要怎么处理？", origin: pendingOrigin(question),
        choices: [
          { id: "provide-photo", label: "补照片", action: { type: "attach", text: "我来补这张照片" } },
          { id: "cannot-provide", label: "无法提供", action: { type: "reply", text: "这张照片无法提供" } },
          { id: "handle-later", label: "稍后处理", action: { type: "reply", text: "这张照片稍后再处理" } },
        ],
      });
      continue;
    }
    if (question.duplicateCandidates.length) {
      const candidates = question.duplicateCandidates.map((candidateId, index) => {
        const candidate = events.find(event => event.id === candidateId);
        const description = candidate ? `${factSummary(candidate)}${candidate.facts.startTime ? ` · ${readableShanghaiTime(candidate.facts.startTime)}` : ""}` : `候选 ${index + 1}`;
        return { id: `same-event-${candidateId}`, label: `与${description}是同一件事`, action: { type: "reply" as const, text: `这条与候选记录 ${candidateId} 是同一件事，请核对后合并` } };
      });
      result.push({
        id: `pending-${question.id}-duplicate-v${question.version}`, prompt: question.duplicateCandidates.length > 1 ? "这条记录与哪一条候选记录是同一件事？" : "这条记录与候选记录是什么关系？", origin: pendingOrigin(question),
        choices: [
          ...candidates,
          { id: "different-events", label: "不同事件", action: { type: "reply", text: "这是不同事件，请分别保留" } },
        ],
      });
      // Resolving a duplicate can change which event remains authoritative. Any
      // independent conflict is deliberately presented on the next fresh pin.
      continue;
    }
    if (question.conflicts.length) {
      const event = events.find(candidate => candidate.id === question.eventId);
      const durationMismatch = question.conflicts.some(issue => issue.code === "DURATION_MISMATCH");
      const overlap = question.conflicts.find(issue => issue.code === "TIME_OVERLAP" && issue.relatedEventId);
      const endBeforeStart = question.conflicts.some(issue => issue.code === "END_BEFORE_START");
      const ongoingHasEnd = question.conflicts.some(issue => issue.code === "ONGOING_HAS_END");
      const choices: ReplyQuestion["choices"] = [];
      if (durationMismatch) {
        const start = event?.facts.startTime ? readableShanghaiTime(event.facts.startTime) : "现有开始时间";
        const end = event?.facts.endTime ? readableShanghaiTime(event.facts.endTime) : "现有结束时间";
        const duration = typeof event?.facts.durationMinutes === "number" ? `${event.facts.durationMinutes} 分钟` : "现有时长";
        choices.push(
          { id: "repair-time-use-start-end", label: `保留 ${start} 至 ${end}，重算时长`, action: { type: "reply", text: "以现有开始和结束时间为准，重新计算时长" } },
          { id: "repair-time-use-start-duration", label: `保留 ${start} 和 ${duration}，重算结束`, action: { type: "reply", text: "以现有开始时间和时长为准，重新计算结束时间" } },
          { id: "repair-time-use-end-duration", label: `保留 ${end} 和 ${duration}，重算开始`, action: { type: "reply", text: "以现有结束时间和时长为准，重新计算开始时间" } },
        );
      } else if (overlap) {
        choices.push(
          { id: `confirm-overlap-${overlap.relatedEventId}`, label: "两件事确实同时发生", action: { type: "reply", text: `确认当前记录与记录 ${overlap.relatedEventId} 确实同时发生` } },
          { id: "edit-conflict", label: "修改当前记录的时间", action: { type: "input", text: "填写当前记录正确的开始、结束或时长" } },
          { id: "defer-conflict", label: "暂不处理这项冲突", action: { type: "reply", text: "这项时间冲突暂不处理" } },
        );
      } else if (endBeforeStart) {
        choices.push(
          { id: "repair-time-end-next-day", label: "结束时间是次日", action: { type: "reply", text: "结束时间是第二天的这个时刻" } },
          { id: "edit-conflict", label: "修改开始或结束时间", action: { type: "input", text: "填写正确的开始或结束时间" } },
          { id: "defer-conflict", label: "暂不处理这项冲突", action: { type: "reply", text: "这项时间冲突暂不处理" } },
        );
      } else if (ongoingHasEnd) {
        choices.push(
          { id: "repair-time-mark-ended", label: "按已经结束记录", action: { type: "reply", text: "保留结束时间并按已经结束记录" } },
          { id: "repair-time-keep-ongoing", label: "保持进行中并移除结束时间", action: { type: "reply", text: "保持进行中，现有结束时间不采用" } },
        );
      } else {
        choices.push(
          { id: "edit-conflict", label: "更正冲突字段", action: { type: "input", text: "填写这项冲突对应的正确事实" } },
          { id: "defer-conflict", label: "暂不处理这项冲突", action: { type: "reply", text: "这项冲突暂不处理" } },
        );
      }
      choices.push({ id: "custom", label: "自定义说明", action: { type: "custom" } });
      result.push({
        id: `pending-${question.id}-conflict-v${question.version}`,
        prompt: durationMismatch ? "开始、结束和时长不一致，以哪两个现有值为准？" : "这条冲突按哪种情况处理？",
        origin: pendingOrigin(question),
        choices,
      });
    }
  }
  return result;
}
