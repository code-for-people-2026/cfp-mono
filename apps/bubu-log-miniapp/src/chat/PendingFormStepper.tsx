import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Picker, Text, Textarea, View } from "@tarojs/components";
import type { ApiError } from "../api";
import type { ChatFormControl, ChatPending, FieldPending, MediaPending, PendingEventForm, ReplyChoice, ReplyQuestion } from "./contracts";
import { replyChoiceKey, type ChoiceAnswerRef, type FormBatchItem } from "./drafts";
import {
  buildPendingFormAnswer,
  clearPendingFieldValue,
  clearPendingFormProgress,
  emptyPendingFormDraft,
  groupPendingEvents,
  pendingFormKey,
  setPendingFieldValue,
  setPendingFormProgress,
  type PendingFormDraft,
  type PendingFieldValue,
} from "./form";
import { OriginalMessages } from "./OriginalMessages";
import { ChoiceQuestions } from "./ChoiceQuestions";

export function shanghaiTime(value: string): string {
  const date = new Date(value); if (!Number.isFinite(date.getTime())) return value;
  return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

interface Props {
  pending: ChatPending[]; drafts: Record<string, PendingFormDraft>; busy: boolean;
  onDraft(form: PendingEventForm, draft: PendingFormDraft): void;
  onSubmit(items: FormBatchItem[]): void;
  onConversation(question: FieldPending): void;
  textDrafts?: Record<string, Record<string, string>>;
  onTextDraft?(form: PendingEventForm, context: string, text: string): void;
  onMedia(question: MediaPending): void;
  onFieldFocus?(anchor: string): void;
  onFieldBlur?(anchor: string): void;
  onFormChange?(): void;
  source?: { babyId: string; onRevoked(error: ApiError): void };
  questions?: ReplyQuestion[];
  selectedChoices?: Record<string, ChoiceAnswerRef>;
  choiceDrafts?: Record<string, string>;
  onSelectChoice?(form: PendingEventForm, value?: ChoiceAnswerRef): void;
  onChoiceDraft?(value: ChoiceAnswerRef, text: string): void;
  onSubmitChoice?(question: ReplyQuestion, choice: ReplyChoice): void;
  onAttachChoice?(question: ReplyQuestion, choice: ReplyChoice): void;
}

interface Choice { label: string; value: string | number | boolean }

const selectedValue = (draft: PendingFormDraft, field: string): PendingFieldValue | undefined => draft.fields[field];
const scalar = (value: PendingFieldValue | undefined): string => value?.kind === "value" ? String(value.value) : "";
const activityTitles: Record<string, string> = { BREASTFEED: "亲喂", BOTTLE: "瓶喂", PUMP: "吸奶", SLEEP: "睡眠", DIAPER: "换尿布", HEAD_LIFT: "抬头", PASSIVE_EXERCISE: "被动操", GAS_EXERCISE: "排气操", BATH: "洗澡", OUTDOOR: "户外活动", EARLY_EDUCATION: "早教", ROLL_OVER: "翻身", PULL_TO_SIT: "拉坐", SUPPLEMENT: "补剂", SPIT_UP: "吐奶" };
const durationExamples: Record<string, number[]> = {
  BREASTFEED: [5, 10, 15, 20, 30],
  SLEEP: [30, 60, 90, 120],
  HEAD_LIFT: [1, 3, 5, 10],
  OUTDOOR: [15, 30, 45, 60],
};
const genericDurationExamples = [5, 10, 15, 30];
const milkExamples = [90, 120, 150, 180, 210];
const countExamples = [1, 3, 5, 10];
const fieldAnchor = (formKey: string, field: string) => `bubu-chat-form-${`${formKey}-${field}`.replace(/[^A-Za-z0-9_-]/g, character => `_${character.charCodeAt(0).toString(16)}_`)}`;
const unitLabel = (unit: "ml" | "minutes" | "times") => unit === "minutes" ? "分钟" : unit === "times" ? "次" : "ml";
const displayTitle = (form: PendingEventForm) => activityTitles[form.title] ?? activityTitles[form.activityType ?? ""] ?? form.title;

function resolvedActivity(form: PendingEventForm): string | undefined {
  if (form.activityType && activityTitles[form.activityType]) return form.activityType;
  if (activityTitles[form.title]) return form.title;
  return Object.entries(activityTitles).find(([, title]) => title === form.title)?.[0];
}

function serverNumberChoices(control: ChatFormControl): Choice[] {
  if (!control.options?.length) return [];
  return control.options.flatMap(option => {
    const value = Number(option.value);
    if (!Number.isFinite(value) || value < 0 || (control.unit === "times" && !Number.isSafeInteger(value))) return [];
    return [{ label: option.label, value }];
  });
}

function numberChoices(control: ChatFormControl): { choices: Choice[]; fallback: boolean } {
  const server = serverNumberChoices(control);
  if (server.length) return { choices: server, fallback: false };
  const values = control.unit === "times" ? countExamples : milkExamples;
  return { choices: values.map(value => ({ label: `${value} ${unitLabel(control.unit ?? "ml")}`, value })), fallback: true };
}

function durationChoices(control: ChatFormControl | undefined, form: PendingEventForm): { choices: Choice[]; fallback: boolean } {
  if (control) {
    const server = serverNumberChoices(control);
    if (server.length) return { choices: server, fallback: false };
  }
  const values = durationExamples[resolvedActivity(form) ?? ""] ?? genericDurationExamples;
  return { choices: values.map(value => ({ label: `${value} 分钟`, value })), fallback: true };
}

function shanghaiTimestampDraft(value: string): Extract<PendingFieldValue, { kind: "timestamp" }> | undefined {
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return undefined;
  const local = new Date(instant.getTime() + 8 * 3600_000).toISOString();
  return { kind: "timestamp", date: local.slice(0, 10), time: local.slice(11, 16) };
}

function timeChoices(control: ChatFormControl, form: PendingEventForm): Array<{ label: string; value: Extract<PendingFieldValue, { kind: "timestamp" }> }> {
  const server = (control.options ?? []).flatMap(option => {
    const value = shanghaiTimestampDraft(option.value);
    return value ? [{ label: option.label, value }] : [];
  });
  if (server.length) return server;
  const reference = control.referenceTime ?? form.sourceSentAt;
  const value = reference ? shanghaiTimestampDraft(reference) : undefined;
  return value ? [{ label: "按原消息时间", value }] : [];
}

const sameScalar = (value: PendingFieldValue | undefined, choice: Choice): boolean => value?.kind === "value"
  && (typeof choice.value === "number" ? Number(value.value) === choice.value : value.value === choice.value);
const sameTimestamp = (value: PendingFieldValue | undefined, choice: Extract<PendingFieldValue, { kind: "timestamp" }>): boolean => value?.kind === "timestamp"
  && value.date === choice.date && value.time === choice.time;

function formValueText(form: PendingEventForm, field: string, value: PendingFieldValue): string | undefined {
  const control = form.controls.find(item => (item.draftKey ?? item.field) === field);
  const label = control?.label ?? (field === "durationMinutes" ? "时长" : field === "endTime" ? "结束时间" : field);
  if (value.kind === "unknown") return `${label}：不知道`;
  if (value.kind === "notYet") return `${label}：尚未发生`;
  if (value.kind === "timestamp") {
    if (!value.date && !value.time) return undefined;
    return `${label}：${[value.date, value.time].filter(Boolean).join(" ")}`;
  }
  const option = control?.options?.find(item => control.kind === "boolean" ? (item.value === "true") === value.value : item.value === String(value.value));
  if (option) return `${label}：${option.label}`;
  const unit = control?.unit ? ` ${unitLabel(control.unit)}` : "";
  return `${label}：${String(value.value)}${unit}`;
}

export function buildPendingTextAnswer(form: PendingEventForm, draft: PendingFormDraft, texts: Record<string, string>): string {
  const structured = Object.entries(draft.fields).flatMap(([field, value]) => value ? [formValueText(form, field, value)].filter((item): item is string => !!item) : []);
  if (draft.progress) structured.push(`进行状态：${draft.progress === "ongoing" ? "仍在进行" : draft.progress === "ended" ? "已经结束" : "不知道"}`);
  const orderedContexts = [...form.controls.map(control => control.draftKey ?? control.field), "supplement"];
  const custom = [...new Set([...orderedContexts, ...Object.keys(texts)])].flatMap(context => {
    const text = texts[context]?.trim();
    if (!text) return [];
    const label = context === "supplement" ? "补充说明" : form.controls.find(control => (control.draftKey ?? control.field) === context)?.label ?? context;
    return [`${label}：${text}`];
  });
  return [...structured, ...custom].join("\n");
}

function buildPendingCustomTextAnswer(form: PendingEventForm, texts: Record<string, string>): string {
  const orderedContexts = [...form.controls.map(control => control.draftKey ?? control.field), "supplement"];
  return [...new Set([...orderedContexts, ...Object.keys(texts)])].flatMap(context => {
    const text = texts[context]?.trim();
    if (!text) return [];
    const control = form.controls.find(item => (item.draftKey ?? item.field) === context);
    // A custom bottle item source is already a typed, item-ID-bound answer.
    if (control?.milkItemId && control.field === "milkSource") return [];
    const label = context === "supplement" ? "补充说明" : control?.label ?? context;
    return [`${label}：${text}`];
  }).join("\n");
}

export function PendingFormStepper({ pending, drafts, busy, onDraft, onSubmit, onConversation, onMedia, onFieldFocus, onFieldBlur, onFormChange, source,
  textDrafts = {}, onTextDraft, questions = [], selectedChoices = {}, choiceDrafts = {}, onSelectChoice, onChoiceDraft, onSubmitChoice, onAttachChoice }: Props) {
  const groups = useMemo(() => groupPendingEvents(pending), [pending]);
  const [currentKey, setCurrentKey] = useState(groups[0]?.key);
  const [customFields, setCustomFields] = useState<Record<string, boolean>>({});
  const [textEditors, setTextEditors] = useState<Record<string, string | undefined>>({});
  const [validation, setValidation] = useState<{ key: string; message: string }>();
  const displayedIndex = useRef(0);
  const exactIndex = groups.findIndex(group => group.key === currentKey);
  const currentIndex = exactIndex >= 0 ? exactIndex : Math.min(displayedIndex.current, Math.max(0, groups.length - 1));
  useEffect(() => {
    if (!groups.length) return;
    if (exactIndex >= 0) displayedIndex.current = exactIndex;
    else {
      // Removing the displayed event moves to the item that now occupies its old position.
      const next = Math.min(displayedIndex.current, groups.length - 1);
      displayedIndex.current = next; setCurrentKey(groups[next]!.key);
    }
  }, [currentKey, exactIndex, groups]);
  const group = groups[currentIndex], question = group?.field, form = question?.form;
  const key = form ? pendingFormKey(form) : "";
  useEffect(() => { onFormChange?.(); }, [key, onFormChange]);
  if (!groups.length) return null;
  const draft = (key && drafts[key]) || emptyPendingFormDraft();
  const change = (next: PendingFormDraft) => { if (form && !busy) { setValidation(undefined); onDraft(form, next); } };
  const customKey = (field: string) => `${key}:${field}`;
  const setCustom = (field: string, open: boolean) => setCustomFields(current => ({ ...current, [customKey(field)]: open }));
  const textEditor = textEditors[key];
  const formTexts = textDrafts[key] ?? {};
  const setTextEditor = (context: string | undefined) => setTextEditors(current => ({ ...current, [key]: context }));
  const navigate = (offset: -1 | 1) => {
    onFormChange?.();
    const next = Math.max(0, Math.min(groups.length - 1, currentIndex + offset));
    displayedIndex.current = next; setCurrentKey(groups[next]!.key);
  };

  const selectConcrete = (field: string, value: PendingFieldValue): PendingFormDraft => {
    const next = setPendingFieldValue(draft, field, value);
    return form?.progressControl && (field === "endTime" || field === "durationMinutes") ? setPendingFormProgress(next, "ended") : next;
  };

  const renderTextEditor = (context: string, label: string) => {
    if (textEditor !== context || !form || !question || !onTextDraft) return null;
    const text = formTexts[context] ?? "";
    const anchor = fieldAnchor(key, `text-${context}`);
    return <View className="bubu-chat-inline-text" id={anchor}>
      <Textarea className="bubu-chat-inline-textarea" ariaLabel={`${label}自定义内容`} value={text} maxlength={6000} autoHeight focus disabled={busy}
        adjustPosition={false} placeholder={`填写${label}，也可以输入“不知道”`}
        onFocus={() => onFieldFocus?.(anchor)} onBlur={() => onFieldBlur?.(anchor)} onInput={event => { setValidation(undefined); onTextDraft(form, context, event.detail.value); }} />
    </View>;
  };
  const clearFieldText = (field: string) => {
    if (form && formTexts[field] !== undefined) onTextDraft?.(form, field, "");
  };

  const renderPills = (choices: Choice[], value: PendingFieldValue | undefined, onSelect: (choice: Choice) => void) => choices.map(choice => {
    const selected = sameScalar(value, choice);
    return <Button key={`${typeof choice.value}:${String(choice.value)}`} className={`bubu-chat-choice${selected ? " selected" : ""}`}
      ariaLabel={choice.label} disabled={busy || undefined} onClick={() => onSelect(choice)}>{choice.label}</Button>;
  });

  const renderScalarControl = (control: ChatFormControl) => {
    const draftKey = control.draftKey ?? control.field, value = selectedValue(draft, draftKey);
    const anchor = fieldAnchor(key, draftKey), { choices, fallback } = numberChoices(control);
    const examples = fallback || control.optionsSource === "default";
    const inferredCustom = value?.kind === "value" && !choices.some(choice => sameScalar(value, choice));
    const custom = !!customFields[customKey(draftKey)] || inferredCustom;
    return <View className="bubu-chat-form-field" id={anchor} key={draftKey}>
      <Text className="bubu-chat-form-label">{control.label}{examples ? "（示例选项）" : ""}</Text>
      <View className="bubu-chat-choice-row">
        {renderPills(choices, value, choice => { clearFieldText(draftKey); setTextEditor(undefined); setCustom(draftKey, false); change(selectConcrete(draftKey, { kind: "value", value: choice.value })); })}
        <Button className={`bubu-chat-choice${custom ? " selected" : ""}`} ariaLabel={`${control.label}自定义`} disabled={busy || undefined} onClick={() => {
          clearFieldText(draftKey); setTextEditor(undefined); setCustom(draftKey, true); change(clearPendingFieldValue(draft, draftKey)); onFieldFocus?.(anchor);
        }}>自定义</Button>
      </View>
      {custom && <View className="bubu-chat-number-field bubu-chat-custom-field">
        <Input className="bubu-chat-number" ariaLabel={control.label} type={control.unit === "times" ? "number" : "digit"} value={scalar(value)} focus disabled={busy || undefined} adjustPosition={false}
          onFocus={() => onFieldFocus?.(anchor)} onBlur={() => onFieldBlur?.(anchor)}
          onInput={event => { const text = String(event.detail.value ?? ""); change(text.trim() ? selectConcrete(draftKey, { kind: "value", value: text }) : clearPendingFieldValue(draft, draftKey)); }} />
        <Text className="bubu-chat-unit">{unitLabel(control.unit ?? "ml")}</Text>
      </View>}
    </View>;
  };

  const renderTimePicker = (field: string, label: string, value: PendingFieldValue | undefined) => {
    const current = value?.kind === "timestamp" ? value : { date: "", time: "" };
    const anchor = fieldAnchor(key, field);
    return <View className="bubu-chat-time-row">
      <Picker className="bubu-chat-time-slot" mode="date" value={current.date} onChange={event => { if (!busy) change(selectConcrete(field, { kind: "timestamp", date: String(event.detail.value), time: current.time })); }}>
        <Button className="bubu-chat-time-picker" ariaLabel={`${label}日期`} disabled={busy || undefined} onClick={() => onFieldFocus?.(anchor)}><Text className="bubu-chat-time-text">{current.date || "选择日期"}</Text><View className="bubu-chat-picker-chevron" /></Button>
      </Picker>
      <Picker className="bubu-chat-time-slot" mode="time" value={current.time} onChange={event => { if (!busy) change(selectConcrete(field, { kind: "timestamp", date: current.date, time: String(event.detail.value) })); }}>
        <Button className="bubu-chat-time-picker" ariaLabel={`${label}时间`} disabled={busy || undefined} onClick={() => onFieldFocus?.(anchor)}><Text className="bubu-chat-time-text">{current.time || "选择时间"}</Text><View className="bubu-chat-picker-chevron" /></Button>
      </Picker>
    </View>;
  };

  const renderTimeControl = (control: ChatFormControl) => {
    const value = selectedValue(draft, control.field), choices = timeChoices(control, form!);
    const inferredCustom = value?.kind === "timestamp" && !choices.some(choice => sameTimestamp(value, choice.value));
    const custom = !!customFields[customKey(control.field)] || inferredCustom;
    const anchor = fieldAnchor(key, control.field);
    return <View className="bubu-chat-form-field" id={anchor} key={control.field}>
      <Text className="bubu-chat-form-label">{control.label}</Text>
      <View className="bubu-chat-choice-row">
        {choices.map(choice => <Button key={`${choice.value.date}T${choice.value.time}`} className={`bubu-chat-choice${sameTimestamp(value, choice.value) ? " selected" : ""}`}
          disabled={busy || undefined} onClick={() => { clearFieldText(control.field); setTextEditor(undefined); setCustom(control.field, false); change(selectConcrete(control.field, choice.value)); }}>{choice.label}</Button>)}
        <Button className={`bubu-chat-choice${custom ? " selected" : ""}`} disabled={busy || undefined} onClick={() => {
          clearFieldText(control.field); setTextEditor(undefined); setCustom(control.field, true); change(clearPendingFieldValue(draft, control.field)); onFieldFocus?.(anchor);
        }}>自定义</Button>
      </View>
      {custom && renderTimePicker(control.field, control.label, value)}
      {control.allowNotYet && <View className="bubu-chat-quiet-actions">
        <Button className={`bubu-chat-quiet-action${value?.kind === "notYet" ? " selected" : ""}`} disabled={busy || undefined} onClick={() => { clearFieldText(control.field); setCustom(control.field, false); change(setPendingFieldValue(draft, control.field, { kind: "notYet" })); }}>尚未发生</Button>
      </View>}
    </View>;
  };

  const renderDurationControl = (currentForm: PendingEventForm) => {
    const durationControl = currentForm.controls.find(control => control.field === "durationMinutes");
    const endControl = currentForm.controls.find(control => control.field === "endTime");
    if (!durationControl && !endControl) return null;
    const duration = selectedValue(draft, "durationMinutes"), endTime = selectedValue(draft, "endTime");
    const { choices, fallback } = durationChoices(durationControl, currentForm);
    const examples = fallback || durationControl?.optionsSource === "default";
    const inferredDurationCustom = duration?.kind === "value" && !choices.some(choice => sameScalar(duration, choice));
    const customDuration = !!customFields[customKey("durationMinutes")] || inferredDurationCustom;
    const exactChoices = endControl ? timeChoices(endControl, currentForm) : [];
    const inferredTimeCustom = endTime?.kind === "timestamp" && !exactChoices.some(choice => sameTimestamp(endTime, choice.value));
    const customTime = !!customFields[customKey("endTime")] || inferredTimeCustom;
    const durationAnchor = fieldAnchor(key, "durationMinutes"), endAnchor = fieldAnchor(key, "endTime");
    const concrete = duration?.kind === "value" || endTime?.kind === "timestamp";
    const ongoing = draft.progress === "ongoing" && !concrete;
    const clearTemporal = (nextDraft: PendingFormDraft) => clearPendingFieldValue(clearPendingFieldValue(nextDraft, "endTime"), "durationMinutes");
    return <View className="bubu-chat-form-field" id={durationAnchor}>
      <Text className="bubu-chat-form-label">时长{examples ? "（示例选项）" : ""}</Text>
      <View className="bubu-chat-choice-row">
        {renderPills(choices, duration, choice => {
          clearFieldText("durationMinutes"); setTextEditor(undefined); setCustom("durationMinutes", false); setCustom("endTime", false);
          change(selectConcrete("durationMinutes", { kind: "value", value: choice.value }));
        })}
        <Button className={`bubu-chat-choice${customDuration ? " selected" : ""}`} ariaLabel="时长自定义" disabled={busy || undefined} onClick={() => {
          clearFieldText("durationMinutes"); setTextEditor(undefined); setCustom("durationMinutes", true); setCustom("endTime", false);
          change(clearPendingFormProgress(clearTemporal(draft))); onFieldFocus?.(durationAnchor);
        }}>自定义</Button>
      </View>
      {customDuration && <View className="bubu-chat-number-field bubu-chat-custom-field">
        <Input className="bubu-chat-number" ariaLabel="时长分钟" type="digit" value={scalar(duration)} focus disabled={busy || undefined} adjustPosition={false}
          onFocus={() => onFieldFocus?.(durationAnchor)} onBlur={() => onFieldBlur?.(durationAnchor)}
          onInput={event => { const text = String(event.detail.value ?? ""); change(text.trim() ? selectConcrete("durationMinutes", { kind: "value", value: text }) : clearPendingFieldValue(draft, "durationMinutes")); }} />
        <Text className="bubu-chat-unit">分钟</Text>
      </View>}
      {endControl && <>
        <Text className="bubu-chat-form-sub-label">也可以回答{endControl.label}</Text>
        <View className="bubu-chat-choice-row" id={endAnchor}>
          {exactChoices.map(choice => <Button key={`${choice.value.date}T${choice.value.time}`} className={`bubu-chat-choice${sameTimestamp(endTime, choice.value) ? " selected" : ""}`}
            disabled={busy || undefined} onClick={() => { clearFieldText("endTime"); setTextEditor(undefined); setCustom("durationMinutes", false); setCustom("endTime", false); change(selectConcrete("endTime", choice.value)); }}>{choice.label}</Button>)}
          <Button className={`bubu-chat-choice${customTime ? " selected" : ""}`} disabled={busy || undefined} onClick={() => {
            clearFieldText("endTime"); setTextEditor(undefined); setCustom("durationMinutes", false); setCustom("endTime", true);
            change(clearPendingFormProgress(clearTemporal(draft))); onFieldFocus?.(endAnchor);
          }}>自定义时间</Button>
        </View>
        {customTime && renderTimePicker("endTime", endControl.label, endTime)}
      </>}
      <View className="bubu-chat-quiet-actions">
        {!!currentForm.progressControl && <Button className={`bubu-chat-quiet-action${ongoing ? " selected" : ""}`} disabled={busy || undefined} onClick={() => {
          setCustom("durationMinutes", false); setCustom("endTime", false);
          change(setPendingFormProgress(clearTemporal(draft), "ongoing"));
        }}>仍在进行</Button>}
      </View>
    </View>;
  };

  const renderChoiceControl = (control: ChatFormControl) => {
    const draftKey = control.draftKey ?? control.field, value = selectedValue(draft, draftKey), custom = textEditor === draftKey || !!formTexts[draftKey]?.trim();
    const anchor = fieldAnchor(key, `text-${draftKey}`);
    return <View className="bubu-chat-form-field" key={draftKey}>
      <Text className="bubu-chat-form-label">{control.label}</Text>
      <View className="bubu-chat-choice-row">
        {control.options?.map(option => {
          const optionValue = control.kind === "boolean" ? option.value === "true" : option.value;
          const selected = value?.kind === "value" && value.value === optionValue;
          return <Button key={option.value} className={`bubu-chat-choice${selected ? " selected" : ""}`} ariaLabel={`${control.label}：${option.label}`} disabled={busy || undefined}
            onClick={() => { clearFieldText(draftKey); setTextEditor(undefined); change(setPendingFieldValue(draft, draftKey, { kind: "value", value: optionValue })); }}>{option.label}</Button>;
        })}
        <Button className={`bubu-chat-choice${custom ? " selected" : ""}`} ariaLabel={`${control.label}自定义`} disabled={busy || undefined} onClick={() => {
          setTextEditor(draftKey); change(clearPendingFieldValue(draft, draftKey)); onFieldFocus?.(anchor);
        }}>自定义</Button>
      </View>
      {renderTextEditor(draftKey, control.label)}
      {control.allowNotYet && <View className="bubu-chat-quiet-actions">
        {control.allowNotYet && <Button className={`bubu-chat-quiet-action${value?.kind === "notYet" ? " selected" : ""}`} disabled={busy || undefined} onClick={() => { clearFieldText(draftKey); setTextEditor(undefined); change(setPendingFieldValue(draft, draftKey, { kind: "notYet" })); }}>尚未发生</Button>}
      </View>}
    </View>;
  };

  const knownActivity = form ? resolvedActivity(form) : undefined;
  const questionsForGroup = (target: typeof group) => questions.filter(item => item.origin.selectedEventId === target.eventId
    || !!item.origin.mediaPendingId && target.media.some(media => media.id === item.origin.mediaPendingId));
  const groupQuestions = questionsForGroup(group);
  const selectedChoice = key ? selectedChoices[key] : undefined;
  const sameChoice = (left: ChoiceAnswerRef | undefined, right: ChoiceAnswerRef) => !!left && left.questionId === right.questionId
    && left.choiceId === right.choiceId && left.originTurnId === right.originTurnId;
  const renderGroupQuestions = () => form && onSelectChoice && onChoiceDraft && onSubmitChoice && onAttachChoice
    ? <ChoiceQuestions questions={groupQuestions} selected={selectedChoice} drafts={choiceDrafts} busy={busy} deferSubmit
      onSelect={value => { setValidation(undefined); onSelectChoice(form, sameChoice(selectedChoice, value) ? undefined : value); }} onDraft={onChoiceDraft} onSubmit={onSubmitChoice} onAttach={onAttachChoice} /> : null;
  const formGroups = groups.filter(item => item.field?.form);
  const lastFormKey = formGroups.at(-1)?.key;
  const buildItem = (target: (typeof groups)[number]): { item?: FormBatchItem; error?: string } => {
    const field = target.field, targetForm = field?.form;
    if (!field || !targetForm) return { error: "这项暂时不能用表单提交，请先单独核对。" };
    if (target.fields.length !== 1) return { error: "这条记录有多项待核对内容，暂时不能一起保存。请刷新后逐项核对。" };
    const targetKey = pendingFormKey(targetForm), targetDraft = drafts[targetKey] ?? emptyPendingFormDraft();
    const texts = textDrafts[targetKey] ?? {}, hasText = Object.values(texts).some(value => !!value.trim());
    const hasFieldInput = !!targetDraft.progress || Object.keys(targetDraft.fields).length > 0 || hasText;
    const chosen = selectedChoices[targetKey];
    const pin = { id: field.id, questionVersion: field.version, eventVersion: field.eventVersion };
    let selectedOption: ReplyChoice | undefined;
    if (chosen) {
      const selectedQuestion = questionsForGroup(target).find(item => item.id === chosen.questionId && item.origin.turnId === chosen.originTurnId);
      selectedOption = selectedQuestion?.choices.find(item => item.id === chosen.choiceId);
      if (!selectedOption) return { error: "所选冲突答案已更新，请重新选择。" };
      if (selectedOption.action.type === "attach") return { error: "照片答案不能放入这次批量提交，请先单独处理照片。" };
      if (chosen.originTurnId) {
        return { error: "这个选项需要单独核对，暂时不能和其他待补事项一起保存。" };
      }
      if (chosen.choiceId.startsWith("same-event-") && hasFieldInput) return { error: "合并为同一事件时，额外事实应写入哪条记录并不明确。请先单独核对合并目标，已填草稿不会丢失。" };
      if (chosen.choiceId === "defer-conflict" && hasFieldInput) return { error: "选择暂不处理时不能同时修改字段；请改选明确处理方式，或保留草稿稍后再处理。" };
    }
    if ((field.conflicts.length || field.duplicateCandidates.length) && !chosen) return { error: "请先选择这条冲突或重复记录的处理方式。" };
    const itemScopedText = Object.entries(texts).some(([context, value]) => !!value.trim() && !!targetForm.controls.find(control =>
      (control.draftKey ?? control.field) === context && control.milkItemId && control.field === "milkSource"));
    const hasStructuredInput = !!targetDraft.progress || Object.keys(targetDraft.fields).length > 0 || itemScopedText;
    const builtAnswer = hasStructuredInput ? buildPendingFormAnswer(targetForm, targetDraft, texts) : {};
    if (hasStructuredInput && !builtAnswer.answer) return { error: builtAnswer.error ?? "请完成这一项。" };
    const textParts = [buildPendingCustomTextAnswer(targetForm, texts)];
    if (selectedOption?.action.type === "custom" || selectedOption?.action.type === "input") {
      const custom = choiceDrafts[replyChoiceKey(chosen!)]?.trim();
      if (!custom) return { error: "请填写自定义回答。" };
      textParts.push(`${selectedOption.action.type === "input" ? selectedOption.action.text : "自定义说明"}：${custom}`);
    }
    const text = textParts.filter(Boolean).join("\n");
    if (text.length > 6000) return { error: "这项补充文字不能超过 6000 字。" };
    if (!builtAnswer.answer && !text && !chosen) return { error: builtAnswer.error ?? "请完成这一项。" };
    return { item: { eventId: field.eventId, question: pin,
      ...(builtAnswer.answer ? { formAnswer: builtAnswer.answer } : {}), ...(text ? { text } : {}),
      ...(chosen ? { choiceAnswer: { ...chosen, eventVersion: field.eventVersion } } : {}) } };
  };
  const submitOrAdvance = () => {
    if (busy || !form || !question) return;
    const current = buildItem(group);
    if (!current.item) { setValidation({ key, message: current.error ?? "请完成这一项。" }); return; }
    if (group.key !== lastFormKey) { navigate(1); return; }
    const items: FormBatchItem[] = [];
    for (const target of formGroups) {
      const result = buildItem(target);
      if (!result.item) {
        const targetKey = pendingFormKey(target.field!.form!);
        setValidation({ key: targetKey, message: result.error ?? "请完成这一项。" });
        displayedIndex.current = groups.indexOf(target); setCurrentKey(target.key); onFormChange?.();
        return;
      }
      items.push(result.item);
    }
    if (items.reduce((sum, item) => sum + (item.text?.length ?? 0), 0) > 12000) {
      setValidation({ key, message: "这批补充文字合计超过 12000 字，请精简后再提交。" }); return;
    }
    setValidation(undefined); onSubmit(items);
  };
  return <View className="bubu-chat-pending" ariaLabel="待补充事件">
    {question && form ? <View className="bubu-chat-step">
      <View className="bubu-chat-step-head">
        <Text className="bubu-chat-step-count">待补充 · {currentIndex + 1} / {groups.length}</Text>
        <View className="bubu-chat-step-nav">
          <Button className="bubu-chat-step-nav-button" ariaLabel="上一个待补充事件" disabled={busy || currentIndex === 0 || undefined} onClick={() => navigate(-1)}><View className="bubu-chat-chevron prev" /></Button>
          <Button className="bubu-chat-step-nav-button" ariaLabel="下一个待补充事件" disabled={busy || currentIndex === groups.length - 1 || undefined} onClick={() => navigate(1)}><View className="bubu-chat-chevron next" /></Button>
        </View>
      </View>
      <Text className="bubu-chat-step-title">{displayTitle(form)}</Text>
      {!!form.startedAt && <Text className="bubu-chat-step-meta">{shanghaiTime(form.startedAt)}</Text>}
      {!!form.knownSummary.trim() && form.knownSummary.trim() !== displayTitle(form).trim() && <Text className="bubu-chat-step-meta">{form.knownSummary}</Text>}
      {source && <OriginalMessages
        key={`${encodeURIComponent(source.babyId)}:${encodeURIComponent(form.eventId)}`}
        babyId={source.babyId} eventId={form.eventId} onRevoked={source.onRevoked}
      />}
      {form.controls.filter(control => (control.kind === "boolean" || control.kind === "enum") && !(control.field === "type" && knownActivity)).map(renderChoiceControl)}
      {form.controls.filter(control => control.kind === "timestamp" && control.field !== "endTime").map(renderTimeControl)}
      {renderDurationControl(form)}
      {form.controls.filter(control => control.kind === "number").map(renderScalarControl)}
      {!!form.conflictMessages.length && <Text className="bubu-chat-form-warning">{form.conflictMessages.join("；")}</Text>}
      {!!form.duplicateCandidateIds.length && <Text className="bubu-chat-form-warning">这条可能与已有记录重复，请先核对。</Text>}
      {renderGroupQuestions()}
      <View className="bubu-chat-form-footer">
        <View className="bubu-chat-footer-actions">
          {!!onTextDraft && !!form.controls.length && <Button className={`bubu-chat-text-action${textEditor === "supplement" || !!formTexts.supplement?.trim() ? " selected" : ""}`} disabled={busy || undefined} onClick={() => {
            const next = textEditor === "supplement" ? undefined : "supplement";
            setTextEditor(next); if (next) onFieldFocus?.(fieldAnchor(key, "text-supplement"));
          }}>补充说明</Button>}
          {!!group.media.length && <Button className="bubu-chat-text-action" disabled={busy || undefined} onClick={() => onMedia(group.media[0]!)}>补照片或说明找不到</Button>}
        </View>
        {renderTextEditor("supplement", "补充说明")}
        {validation?.key === key && <Text className="bubu-chat-form-error">{validation.message}</Text>}
        <View className="bubu-chat-footer-row">
          <Button className="bubu-chat-skip" disabled={busy || currentIndex === 0 || undefined} onClick={() => navigate(-1)}>上一步</Button>
          <Button className="bubu-chat-form-submit" disabled={busy || undefined} onClick={submitOrAdvance}>{group.key === lastFormKey ? `提交 ${formGroups.length} 项` : "下一步"}</Button>
        </View>
      </View>
    </View> : <View className="bubu-chat-step">
      <View className="bubu-chat-step-head">
        <Text className="bubu-chat-step-count">待补充 · {currentIndex + 1} / {groups.length}</Text>
        <View className="bubu-chat-step-nav">
          <Button className="bubu-chat-step-nav-button" ariaLabel="上一个待补充事件" disabled={busy || currentIndex === 0 || undefined} onClick={() => navigate(-1)}><View className="bubu-chat-chevron prev" /></Button>
          <Button className="bubu-chat-step-nav-button" ariaLabel="下一个待补充事件" disabled={busy || currentIndex === groups.length - 1 || undefined} onClick={() => navigate(1)}><View className="bubu-chat-chevron next" /></Button>
        </View>
      </View>
      <Text className="bubu-chat-step-title">{group.media.length ? "照片待补充" : "待核对记录"}</Text>
      {renderGroupQuestions()}
      <View className="bubu-chat-footer-actions">
        {group.media.map(item => <Button key={item.id} className="bubu-chat-text-action" disabled={busy || undefined} onClick={() => onMedia(item)}>补照片或说明找不到</Button>)}
        {question && <Button className="bubu-chat-text-action" disabled={busy || undefined} onClick={() => onConversation(question)}>对话核对</Button>}
      </View>
    </View>}
  </View>;
}
