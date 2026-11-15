import { Fragment, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Image, ScrollView, Text, Textarea, View } from "@tarojs/components";
import Taro, { useDidHide, useDidShow } from "@tarojs/taro";
import { api, ApiError } from "../api";
import { ChatSession } from "./session";
import { chatDrafts } from "./storage";
import { attachmentUrl, pendingLabel, receiptLabels, type AutomaticActivityMessage, type ChatPending, type ChatTurn, type FirstWeekNotice, type ReplyChoice, type ReplyQuestion } from "./contracts";
import { groupPendingEvents, pendingFormKey } from "./form";
import { PendingFormStepper, shanghaiTime } from "./PendingFormStepper";
import { OriginalMessages } from "./OriginalMessages";
import { chooseChatImage } from "./images";
import { VoiceInput } from "./voice-input";
import { ChoiceQuestions } from "./ChoiceQuestions";
import { readNavigationLayout } from "../navigation/layout";
import "./chat.css";

export interface ChatSelection { eventId: string; label: string; nonce: number }
export interface DiaryChatProps {
  identityId: string;
  babyId: string;
  babyName: string;
  viewedDate: string;
  revision: number;
  selection?: ChatSelection;
  onBack(): void;
  onRefresh(): void;
  onRevoked(error: ApiError): void;
}

function PrivateImage({ babyId, id, refreshGeneration, onRevoked }: { babyId: string; id: string; refreshGeneration: number; onRevoked(error: ApiError): void }) {
  const [source, setSource] = useState("");
  const [error, setError] = useState(false);
  const revoked = useRef(onRevoked); revoked.current = onRevoked;
  useEffect(() => {
    let active = true;
    let path = "";
    setSource(""); setError(false);
    void api.resolvePhotoUrl(attachmentUrl(babyId, id), babyId).then(result => {
      path = result;
      if (active) setSource(result); else api.releasePhotoUrl(result);
    }).catch(imageError => {
      if (!active) return;
      setError(true);
      if (imageError instanceof ApiError && [401, 403].includes(imageError.status)) revoked.current(imageError);
    });
    return () => { active = false; if (path) api.releasePhotoUrl(path); };
  }, [babyId, id, refreshGeneration]);
  return source && !error
    ? <Image className="bubu-chat-image" src={source} mode="aspectFill" onError={() => setError(true)} onClick={() => { void Taro.previewImage({ urls: [source], current: source }); }} />
    : <Text className="bubu-chat-image-failed">{error ? "照片暂不可用" : "读取照片…"}</Text>;
}

function Turn({ turn, babyId, refreshGeneration, onRevoked, onRecover, recoveryDisabled }: {
  turn: ChatTurn; babyId: string; refreshGeneration: number; onRevoked(error: ApiError): void; onRecover(): void; recoveryDisabled: boolean;
}) {
  const labels = receiptLabels(turn);
  const safety = turn.replySource === "safety";
  const confirmedBatchItems = turn.input.formBatch?.filter(item => turn.receipts.some(receipt => !("kind" in receipt)
    && (receipt.status === "saved" || receipt.status === "needs_information")
    && receipt.events?.some(event => event.id === item.eventId && event.version > item.question.eventVersion))).length;
  const incompleteBatch = turn.status === "completed" && turn.input.formBatch && confirmedBatchItems !== turn.input.formBatch.length;
  const reply = incompleteBatch
    ? confirmedBatchItems
      ? `已保存 ${confirmedBatchItems} 项，其余答案已保留，请重新核对。`
      : "这批内容没有全部确认，原答案已保留，请重新核对。"
    : turn.assistantText || (turn.status === "processing" ? "正在理解并确认记录…" : turn.error?.message || "这次对话暂未完成。");
  return <View className="bubu-chat-turn">
    <View className="bubu-chat-user">
      <Text selectable>{turn.input.text || (turn.input.formBatch ? `补充 ${turn.input.formBatch.length} 项` : turn.input.formAnswer ? "补充信息" : turn.input.choiceAnswer ? "已选择回答" : "")}</Text>
      <View className="bubu-chat-images">{turn.input.attachmentIds.map(id => <PrivateImage key={id} id={id} babyId={babyId} refreshGeneration={refreshGeneration} onRevoked={onRevoked} />)}</View>
    </View>
    <View className={`bubu-chat-reply${safety ? " safety" : ""}`}>
      <Text className={`bubu-chat-author${safety ? " safety" : ""}`}>{safety ? "系统安全提示" : "卜卜 · AI"}</Text>
      <Text className="bubu-chat-copy" selectable>{reply}</Text>
      {!!labels.length && <Text className="bubu-chat-receipt">{labels.join(" · ")}</Text>}
      {turn.status === "failed" && <Text className="bubu-chat-failure">未完成 · {turn.error?.message || "请重试"}</Text>}
      {turn.status === "needs_recovery" && <Text className="bubu-chat-failure">保存尚未确认，请继续确认上次发送</Text>}
      {turn.status === "failed" && turn.error?.retryable && <Button className="text-button small" disabled={recoveryDisabled || undefined} onClick={onRecover}>重试这次发送</Button>}
    </View>
  </View>;
}

const friendlyCodes: Record<string, string> = { BREASTFEED: "亲喂", BOTTLE: "瓶喂", PUMP: "吸奶", SLEEP: "睡眠", DIAPER: "换尿布", HEAD_LIFT: "抬头", PASSIVE_EXERCISE: "被动操", GAS_EXERCISE: "排气操", BATH: "洗澡", OUTDOOR: "户外活动", EARLY_EDUCATION: "早教", ROLL_OVER: "翻身", PULL_TO_SIT: "拉坐", SUPPLEMENT: "补剂", SPIT_UP: "吐奶", BREAST_MILK: "母乳", FORMULA: "配方奶", SOFT: "偏软", ELASTIC: "有弹性", HARD: "偏硬", SMALL: "少量", MEDIUM: "中等", LARGE: "大量", NORMAL: "普通溢奶", PROJECTILE: "喷射状" };
const everydayWords = (value: string): string => value.replace(/\b[A-Z][A-Z_]+\b/g, word => friendlyCodes[word] ?? word);
const scrollId = (prefix: string, value: string) => `${prefix}-${value.replace(/[^A-Za-z0-9_-]/g, "")}`;

function AutomaticTurn({ message, babyId, onRevoked }: { message: AutomaticActivityMessage; babyId: string; onRevoked(error: ApiError): void }) {
  const outcome = { saved: "已保存", needs_information: "已有内容已保留", pending_projection: "保存待确认", conflict: "待核对" }[message.outcome];
  return <View className="bubu-chat-automatic" id={scrollId("bubu-chat-activity", message.id)}>
    <Text className="bubu-chat-automatic-label">微信群记录 · {outcome} · {shanghaiTime(message.occurredAt)}</Text>
    <Text className="bubu-chat-automatic-copy" selectable>{everydayWords(message.text)}</Text>
    {message.events.map(event => <OriginalMessages
      key={event.id} babyId={babyId} eventId={event.id} onRevoked={onRevoked}
      label={everydayWords(event.title)} containerClassName="bubu-chat-automatic-event-row"
    />)}
  </View>;
}

function SharedFirstWeekNotice({ notice }: { notice: FirstWeekNotice }) {
  return <View className="bubu-chat-shared-notice" id={scrollId("bubu-chat-first-week", notice.id)}>
    <Text className="bubu-chat-shared-notice-label">宝宝共享 · 自动规律总结 · {shanghaiTime(notice.timestamp)}</Text>
    <Text className="bubu-chat-shared-notice-copy" selectable>{notice.text}</Text>
  </View>;
}

export function DiaryChat(props: DiaryChatProps) {
  const callbacks = useRef(props); callbacks.current = props;
  const session = useMemo(() => new ChatSession(api, chatDrafts, props.identityId, props.babyId, {
    refresh: () => callbacks.current.onRefresh(),
    revoked: error => callbacks.current.onRevoked(error),
  }), [props.identityId, props.babyId]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [voice, setVoice] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageError, setImageError] = useState("");
  const [recording, setRecording] = useState(false);
  const [scrollTarget, setScrollTarget] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [visible, setVisible] = useState(true);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const [keyboardLayoutRevision, setKeyboardLayoutRevision] = useState(0);
  const [layout, setLayout] = useState(readNavigationLayout);
  const alive = useRef(true);
  const following = useRef(true);
  const lastScrollTop = useRef(0);
  const initialOpenScroll = useRef(true);
  const savedPendingScroll = useRef(false);
  const focusedFormAnchor = useRef("");
  const updateKeyboardInset = useCallback((next: number) => {
    setKeyboardInset(next);
    setKeyboardLayoutRevision(value => value + 1);
  }, []);
  const clearFocusedFormAnchor = useCallback(() => { focusedFormAnchor.current = ""; }, []);
  const focusFormAnchor = useCallback((anchor: string) => { focusedFormAnchor.current = anchor; }, []);
  const blurFormAnchor = useCallback((anchor?: string) => {
    if (!anchor || focusedFormAnchor.current === anchor) focusedFormAnchor.current = "";
  }, []);

  useEffect(() => {
    alive.current = true;
    void session.load();
    return () => { alive.current = false; session.dispose(); };
  }, [session]);
  useEffect(() => {
    if (process.env.TARO_ENV !== "weapp") return;
    const update = () => setLayout(readNavigationLayout());
    Taro.nextTick(update);
    Taro.onWindowResize(update);
    return () => Taro.offWindowResize(update);
  }, []);
  useEffect(() => {
    if (process.env.TARO_ENV !== "h5" || typeof window === "undefined") return;
    const viewport = window.visualViewport;
    const update = () => {
      const next = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      updateKeyboardInset(next);
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [updateKeyboardInset]);
  useEffect(() => {
    if (process.env.TARO_ENV !== "weapp") return;
    const update = (event: { height: number }) => updateKeyboardInset(Math.max(0, Number(event.height) || 0));
    Taro.onKeyboardHeightChange(update);
    return () => {
      setKeyboardInset(0);
      Taro.offKeyboardHeightChange(update);
    };
  }, [updateKeyboardInset]);
  useEffect(() => {
    const anchor = focusedFormAnchor.current;
    if (!keyboardInset || !anchor) return;
    setScrollTarget("");
    Taro.nextTick(() => {
      if (alive.current && focusedFormAnchor.current === anchor) setScrollTarget(anchor);
    });
  }, [keyboardInset, keyboardLayoutRevision]);
  useDidShow(() => { setVisible(true); });
  useDidHide(() => { setVisible(false); setVoice(false); });
  const lastRevision = useRef(props.revision);
  useEffect(() => {
    if (lastRevision.current === props.revision) return;
    lastRevision.current = props.revision;
    void session.load();
  }, [props.revision, session]);

  const locked = !!state.draft.pending || state.busy || state.loading || uploading;
  const currentTurn = state.history.find(turn => turn.requestId === state.draft.pending?.requestId);
  const batchTotal = state.draft.pending?.formBatch?.length;
  const batchStatus = batchTotal ? state.busy
    ? state.confirming
      ? `正在确认保存结果${currentTurn?.batchProgress ? `（${currentTurn.batchProgress.completed}/${currentTurn.batchProgress.total}）` : ""}`
      : `正在保存 ${batchTotal} 项`
    : `${batchTotal} 项保存结果尚未确认`
    : undefined;
  const pendingGroups = useMemo(() => groupPendingEvents(state.pending), [state.pending]);
  const eventReplyQuestions = useMemo(() => state.replyQuestions.filter(question => question.origin.selectedEventId || question.origin.mediaPendingId), [state.replyQuestions]);
  const currentReplyQuestions = useMemo(() => state.replyQuestions.filter(question => !question.origin.selectedEventId && !question.origin.mediaPendingId), [state.replyQuestions]);
  const timeline = useMemo(() => [
    ...state.history.map(turn => ({ kind: "turn" as const, at: turn.createdAt, turn })),
    ...state.automaticMessages.map(message => ({ kind: "automatic" as const, at: message.occurredAt, message })),
    ...(state.firstWeekNotice ? [{ kind: "first-week" as const, at: state.firstWeekNotice.timestamp, notice: state.firstWeekNotice }] : []),
  ].sort((a, b) => a.at.localeCompare(b.at)), [state.automaticMessages, state.firstWeekNotice, state.history]);
  const latestAutomatic = useMemo(() => [...timeline].reverse().find(item => item.kind === "automatic")?.message, [timeline]);

  useEffect(() => {
    if (!props.selection) return;
    session.selectTarget({ selectedEventId: props.selection.eventId, selectedLabel: props.selection.label });
    setVoice(false);
    initialOpenScroll.current = true;
    following.current = true;
  }, [props.selection, session]);
  useEffect(() => {
    const pendingAnchor = pendingGroups[0] ? scrollId("bubu-chat-pending", pendingGroups[0].key) : "";
    let target = "bubu-chat-end";
    if (initialOpenScroll.current && pendingAnchor) target = latestAutomatic ? scrollId("bubu-chat-activity", latestAutomatic.id) : pendingAnchor;
    if (initialOpenScroll.current && !state.loading) initialOpenScroll.current = false;
    else if (savedPendingScroll.current && pendingAnchor) target = pendingAnchor;
    if (savedPendingScroll.current && !state.busy) savedPendingScroll.current = false;
    if (!following.current) return;
    setScrollTarget("");
    const timer = setTimeout(() => setScrollTarget(target), 30);
    return () => clearTimeout(timer);
  }, [state.history, state.busy, state.loading, state.pending, pendingGroups, latestAutomatic]);

  const selectPending = (item: ChatPending) => {
    session.selectTarget(item.kind === "media"
      ? { mediaPendingId: item.id, selectedEventId: item.eventIds.length === 1 ? item.eventIds[0] : undefined, selectedLabel: pendingLabel(item) }
      : { question: { id: item.id, questionVersion: item.version, eventVersion: item.eventVersion }, selectedEventId: item.eventId, selectedLabel: pendingLabel(item) });
    setVoice(false);
  };
  const chooseImage = async (source?: "camera" | "album") => {
    if (locked || recording || state.draft.attachmentIds.length >= 3) return;
    setUploading(true); setImageError("");
    try {
      const image = await chooseChatImage(props.babyId, source, () => alive.current && visible);
      if (!alive.current || !visible) return;
      session.edit({ attachmentIds: [...new Set([...session.getSnapshot().draft.attachmentIds, image.id])] });
      setVoice(false);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) props.onRevoked(error);
      else if (!(error && typeof error === "object" && "errMsg" in error && String(error.errMsg).includes("cancel"))) setImageError(error instanceof Error ? error.message : "照片添加失败，请重试。");
    } finally {
      if (alive.current && visible) setUploading(false);
    }
  };
  const submitChoice = (question: ReplyQuestion, choice: ReplyChoice) => {
    following.current = true;
    void session.submitChoice(props.viewedDate, question, choice);
  };
  const attachChoice = async (question: ReplyQuestion, choice: ReplyChoice) => {
    if (locked || recording) return;
    setUploading(true); setImageError("");
    try {
      const image = await chooseChatImage(props.babyId, undefined, () => alive.current && visible);
      if (!alive.current || !visible) return;
      following.current = true;
      await session.submitChoice(props.viewedDate, question, choice, [image.id]);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) props.onRevoked(error);
      else if (!(error && typeof error === "object" && "errMsg" in error && String(error.errMsg).includes("cancel"))) setImageError(error instanceof Error ? error.message : "照片添加失败，请重试。");
    } finally { if (alive.current && visible) setUploading(false); }
  };

  return <View
    className={`bubu-chat-page${keyboardInset ? " keyboard-open" : ""}`}
    style={keyboardInset ? { bottom: `${keyboardInset}px` } : undefined}
  >
    <View className="bubu-chat-header" style={layout ? { paddingTop: `${layout.statusBarHeight}px` } : undefined}>
      <View className="bubu-chat-header-row" style={layout ? { height: `${layout.height}px` } : undefined}>
        <Button className="bubu-chat-back" ariaLabel="返回" disabled={locked || undefined} onClick={props.onBack}><View className="bubu-chat-back-glyph" /></Button>
        <View className="bubu-chat-title-block" style={layout ? { right: `${layout.side + 44}px` } : undefined}>
          <Text className="bubu-chat-title">开始记录</Text>
          <Text className="bubu-chat-baby">{props.babyName}</Text>
        </View>
        <Button className="bubu-chat-info" style={layout ? { right: `${layout.side}px` } : undefined} ariaLabel="AI使用说明" disabled={locked || undefined} onClick={() => setInfoOpen(value => !value)}><View className="bubu-chat-info-icon" /></Button>
      </View>
    </View>
    <ScrollView className="bubu-chat-scroll" scrollY scrollIntoView={scrollTarget}
      onTouchMove={() => { following.current = false; }}
      onScroll={event => {
        const scrollTop = Number(event.detail.scrollTop ?? 0);
        if (scrollTop < lastScrollTop.current - 2) following.current = false;
        lastScrollTop.current = scrollTop;
      }}
      onScrollToLower={() => { following.current = true; }}>
      <View className="bubu-chat-history">
        {infoOpen && <View className="bubu-chat-info-panel">
          <Text>AI 可能出错，不能替代医生或急救服务；急症请立即寻求现实帮助，中国大陆可拨打 120。照片最多 3 张。</Text>
          <Text>正在浏览 {props.viewedDate} · “现在、刚才”按本次说话时间理解</Text>
        </View>}
        {!state.history.length && !state.automaticMessages.length && !state.firstWeekNotice && !state.loading && <View className="bubu-chat-empty">
          <Text className="bubu-chat-empty-title">今天想记下什么？</Text>
          <Text className="bubu-chat-empty-example">例如：刚喝完奶，瓶喂 120 ml，剩 20 ml。</Text>
        </View>}
        {state.loading && <Text className="bubu-chat-muted">正在恢复对话和待补事项…</Text>}
        {!!state.notice && <Text className="bubu-chat-muted">{state.notice}</Text>}
        {timeline.map(item => item.kind === "turn"
          ? <Fragment key={item.turn.id}>
            <Turn turn={item.turn} babyId={props.babyId} refreshGeneration={props.revision} onRevoked={props.onRevoked} recoveryDisabled={locked} onRecover={() => { void session.recoverTurn(item.turn.id); }} />
            <ChoiceQuestions questions={item.turn.replyQuestions ?? []} selected={state.draft.selectedChoice} drafts={state.draft.choiceDrafts ?? {}} busy={locked}
              onSelect={value => session.selectChoice(value)} onDraft={(value, text) => session.editChoice(value, text)} onSubmit={submitChoice} onAttach={(question, choice) => { void attachChoice(question, choice); }} />
          </Fragment>
          : item.kind === "automatic"
            ? <AutomaticTurn key={item.message.id} message={item.message} babyId={props.babyId} onRevoked={props.onRevoked} />
            : <SharedFirstWeekNotice key={item.notice.id} notice={item.notice} />)}
        {state.draft.pending && !currentTurn && <View className="bubu-chat-turn">
          <View className="bubu-chat-user"><Text>{state.draft.pending.formBatch ? `补充 ${state.draft.pending.formBatch.length} 项` : state.draft.pending.formAnswer ? "补充信息" : state.draft.pending.text}</Text></View>
          <Text className="bubu-chat-muted">消息已保留，等待确认发送结果</Text>
        </View>}
        {pendingGroups.length > 0 && <View className="bubu-chat-pending-form">
          <PendingFormStepper pending={state.pending} drafts={state.draft.formDrafts ?? {}} busy={locked}
            onDraft={(form, draft) => session.editForm(pendingFormKey(form), draft, { eventId: form.eventId, questionId: form.questionId, questionVersion: form.questionVersion, eventVersion: form.eventVersion, fields: form.controls.map(control => control.field) })}
            onSubmit={items => { following.current = true; savedPendingScroll.current = true; void session.submitFormBatch(props.viewedDate, items); }}
            textDrafts={state.draft.formTextDrafts ?? {}}
            onTextDraft={(form, context, text) => session.editFormText(pendingFormKey(form), context, text, { eventId: form.eventId, questionId: form.questionId, questionVersion: form.questionVersion, eventVersion: form.eventVersion, fields: form.controls.map(control => control.field) })}
            onConversation={question => selectPending(question)}
            onMedia={question => selectPending(question)}
            onFieldFocus={focusFormAnchor}
            onFieldBlur={blurFormAnchor}
            onFormChange={clearFocusedFormAnchor}
            questions={eventReplyQuestions}
            selectedChoices={state.draft.batchChoices ?? {}}
            choiceDrafts={state.draft.choiceDrafts ?? {}}
            onSelectChoice={(form, value) => { session.selectFormChoice(pendingFormKey(form), value, { eventId: form.eventId, questionId: form.questionId, questionVersion: form.questionVersion, eventVersion: form.eventVersion, fields: form.controls.map(control => control.field) }); }}
            onChoiceDraft={(value, text) => session.editFormChoice(value, text)}
            onSubmitChoice={submitChoice}
            onAttachChoice={(question, choice) => { void attachChoice(question, choice); }}
            source={{ babyId: props.babyId, onRevoked: props.onRevoked }} />
        </View>}
        <ChoiceQuestions questions={currentReplyQuestions} selected={state.draft.selectedChoice} drafts={state.draft.choiceDrafts ?? {}} busy={locked}
          onSelect={value => session.selectChoice(value)} onDraft={(value, text) => session.editChoice(value, text)} onSubmit={submitChoice} onAttach={(question, choice) => { void attachChoice(question, choice); }} />
        <View id="bubu-chat-end" />
      </View>
    </ScrollView>
    <View className="bubu-chat-composer">
      {(state.draft.selectedLabel || state.draft.question || state.draft.mediaPendingId) && <View className="bubu-chat-target">
        <Text className="bubu-chat-target-text">{state.draft.selectedLabel || "选中的记录"}</Text>
        <Button className="bubu-chat-target-clear" ariaLabel="取消选择记录" disabled={locked || undefined} onClick={() => session.selectTarget({})}><View className="bubu-chat-clear-icon">×</View></Button>
      </View>}
      {(state.error || imageError) && <Text className="bubu-chat-failure">{imageError || state.error}</Text>}
      {state.draft.pending && <View className={`bubu-chat-recovery${batchTotal ? " batch" : ""}`} ariaLabel={batchStatus ?? "上次发送尚待确认"}>
        <Text>{batchStatus ?? (state.busy ? "正在确认，返回后仍保留进度" : "上次发送尚待确认")}</Text>
        <Button className="text-button small" disabled={state.busy || undefined} onClick={() => { void session.recover(true); }}>查询 / 继续原请求</Button>
        {currentTurn?.status === "failed" && currentTurn.error?.retryable === false && <Button className="text-button small" onClick={() => { session.releaseRejected(); void session.load(); }}>修改后重发</Button>}
      </View>}
      {state.draft.attachmentIds.length > 0 && <View className="bubu-chat-attachments">
        {state.draft.attachmentIds.map(id => <View className="bubu-chat-attachment" key={id}>
          <PrivateImage babyId={props.babyId} id={id} refreshGeneration={props.revision} onRevoked={props.onRevoked} />
          <Button className="bubu-chat-remove" ariaLabel="移除照片" disabled={locked || undefined} onClick={() => session.edit({ attachmentIds: state.draft.attachmentIds.filter(item => item !== id) })}><View className="bubu-chat-remove-icon">×</View></Button>
        </View>)}
      </View>}
      {voice
        ? <View className="bubu-chat-voice-row">
          <VoiceInput disabled={locked} onActiveChange={setRecording} onText={text => {
            const previous = session.getSnapshot().draft.text;
            session.edit({ text: previous ? `${previous}\n${text}` : text });
            setVoice(false);
          }} />
          <Button className="bubu-chat-tool" ariaLabel="切换键盘" disabled={locked || undefined} onClick={() => setVoice(false)}>
            <View className="bubu-chat-keyboard-icon"><View className="bubu-chat-mic-head" /><View className="bubu-chat-mic-stand" /><View className="bubu-chat-keyboard-return" /></View>
          </Button>
        </View>
        : <View className="bubu-chat-input-tray">
          <Button className="bubu-chat-tool" ariaLabel="添加照片" disabled={locked || recording || state.draft.attachmentIds.length >= 3 || undefined} onClick={() => { void chooseImage(); }}>
            <View className="bubu-chat-plus"><View className="bubu-chat-plus-v" /><View className="bubu-chat-plus-h" /></View>
          </Button>
          <Textarea className="bubu-chat-text" value={state.draft.text} placeholder={state.draft.question || state.draft.mediaPendingId ? "补充信息，不清楚也可以说不知道" : "记下刚才发生的事…"} maxlength={-1} autoHeight disabled={locked} adjustPosition={false} onFocus={clearFocusedFormAnchor} onInput={event => session.edit({ text: event.detail.value })} />
          <Button className="bubu-chat-tool" ariaLabel={voice ? "切换键盘" : "切换语音"} disabled={locked || undefined} onClick={() => setVoice(value => !value)}>
            <View className={voice ? "bubu-chat-keyboard-icon" : "bubu-chat-mic-icon"}><View className="bubu-chat-mic-head" /><View className="bubu-chat-mic-stand" /><View className={voice ? "bubu-chat-keyboard-return" : "bubu-chat-mic-base"} /></View>
          </Button>
          {!voice && <Button className="bubu-chat-send" ariaLabel="发送消息" disabled={locked || (!state.draft.text.trim() && !state.draft.attachmentIds.length) || state.draft.text.length > 6000 || undefined} onClick={() => { following.current = true; void session.send(props.viewedDate); }}>
            <View className="bubu-chat-send-icon">
              <View className="bubu-chat-send-stem" />
              <View className="bubu-chat-send-head" />
            </View>
          </Button>}
        </View>}
      {state.draft.text.length > 6000 && <Text className="bubu-chat-failure">文字超过 6000 字，请编辑后发送；没有截断你的草稿。</Text>}
      {voice && <Text className="bubu-chat-footnote">语音转成文字，校对后再发送</Text>}
    </View>
  </View>;
}
