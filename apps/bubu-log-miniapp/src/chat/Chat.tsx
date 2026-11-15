import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button, Image, ScrollView, Text, Textarea, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import { api, ApiError } from "../api";
import { ChatSession } from "./session";
import { chatDrafts } from "./storage";
import { attachmentUrl, pendingLabel, receiptLabels, type ChatPending, type ChatTurn } from "./contracts";
import { chooseChatImage } from "./images";
import { ChatSheet } from "./sheet";
import { VoiceInput } from "./voice-input";
import "./chat.css";
export interface ChatSelection { eventId: string; label: string; nonce: number }
export interface DiaryChatProps { identityId: string; babyId: string; babyName: string; viewedDate: string; revision: number; selection?: ChatSelection; onRefresh(): void; onRevoked(error: ApiError): void }
function PrivateImage({ babyId, id, onRevoked }: { babyId: string; id: string; onRevoked(error: ApiError): void }) {
  const [source, setSource] = useState(""); const [error, setError] = useState(false);
  const revoked = useRef(onRevoked); revoked.current = onRevoked;
  useEffect(() => {
    let active = true, path = ""; setSource(""); setError(false);
    void api.resolvePhotoUrl(attachmentUrl(babyId, id), babyId).then(result => { path = result; if (active) setSource(result); else api.releasePhotoUrl(result); }).catch(error => {
      if (!active) return; setError(true); if (error instanceof ApiError && [401, 403].includes(error.status)) revoked.current(error);
    });
    return () => { active = false; if (path) api.releasePhotoUrl(path); };
  }, [babyId, id]);
  return source && !error ? <Image className="bubu-chat-image" src={source} mode="aspectFill" onError={() => setError(true)} onClick={() => { void Taro.previewImage({ urls: [source], current: source }); }} /> : <Text className="bubu-chat-image-failed">{error ? "照片暂不可用" : "读取照片…"}</Text>;
}
function Turn({ turn, babyId, onRevoked, onRecover, recoveryDisabled }: { turn: ChatTurn; babyId: string; onRevoked(error: ApiError): void; onRecover(): void; recoveryDisabled: boolean }) {
  const labels = receiptLabels(turn);
  return <View className="bubu-chat-turn">
    <View className="bubu-chat-user"><Text selectable>{turn.input.text}</Text><View className="bubu-chat-images">{turn.input.attachmentIds.map(id => <PrivateImage key={id} id={id} babyId={babyId} onRevoked={onRevoked} />)}</View></View>
    <View className="bubu-chat-reply"><Text selectable>{`${turn.replySource === "safety" ? "【系统安全提示】" : "【AI 助手回复】"}\n`}{turn.assistantText || (turn.status === "processing" ? "正在理解并确认记录…" : turn.error?.message || "这次对话暂未完成。")}</Text>
      {!!labels.length && <Text className="bubu-chat-receipt">{labels.join(" · ")}</Text>}
      {turn.status === "failed" && <Text className="bubu-chat-failure">未完成 · {turn.error?.message || "请重试"}</Text>}
      {turn.status === "needs_recovery" && <Text className="bubu-chat-failure">保存尚未确认，请继续确认上次发送</Text>}
      {turn.status === "failed" && turn.error?.retryable && <Button className="text-button small" disabled={recoveryDisabled || undefined} onClick={onRecover}>重试这次发送</Button>}
    </View>
  </View>;
}
export function DiaryChat(props: DiaryChatProps) {
  const callbacks = useRef(props); callbacks.current = props;
  const session = useMemo(() => new ChatSession(api, chatDrafts, props.identityId, props.babyId, {
    refresh: () => callbacks.current.onRefresh(), revoked: error => callbacks.current.onRevoked(error),
  }), [props.identityId, props.babyId]);
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [open, setOpen] = useState(false), [voice, setVoice] = useState(false), [uploading, setUploading] = useState(false), [imageError, setImageError] = useState("");
  const [recording, setRecording] = useState(false), [scrollTarget, setScrollTarget] = useState("");
  const alive = useRef(true); const following = useRef(true);
  useEffect(() => { alive.current = true; void session.load(); return () => { alive.current = false; session.dispose(); }; }, [session]);
  const lastRevision = useRef(props.revision);
  useEffect(() => { if (lastRevision.current !== props.revision) { lastRevision.current = props.revision; void session.load(); } }, [props.revision, session]);
  useDidShow(() => { void session.load(); });
  useEffect(() => {
    if (props.selection) { session.selectTarget({ selectedEventId: props.selection.eventId, selectedLabel: props.selection.label }); setVoice(false); setOpen(true); }
  }, [props.selection, session]);
  useEffect(() => {
    if (!open || !following.current) return;
    setScrollTarget(""); const timer = setTimeout(() => setScrollTarget("bubu-chat-end"), 30); return () => clearTimeout(timer);
  }, [open, state.history, state.busy, state.pending]);
  const locked = !!state.draft.pending || state.busy || state.loading || uploading;
  const currentTurn = state.history.find(turn => turn.requestId === state.draft.pending?.requestId);
  const selectPending = (item: ChatPending) => {
    session.selectTarget(item.kind === "media" ? { mediaPendingId: item.id, selectedEventId: item.eventIds.length === 1 ? item.eventIds[0] : undefined, selectedLabel: pendingLabel(item) } : { question: { id: item.id, questionVersion: item.version, eventVersion: item.eventVersion }, selectedEventId: item.eventId, selectedLabel: pendingLabel(item) });
    setVoice(false);
  };
  const chooseImage = async (source?: "camera" | "album") => {
    if (locked || recording || state.draft.attachmentIds.length >= 3) return;
    setUploading(true); setImageError("");
    try {
      const image = await chooseChatImage(props.babyId, source, () => alive.current);
      if (!alive.current) return;
      session.edit({ attachmentIds: [...new Set([...session.getSnapshot().draft.attachmentIds, image.id])] }); setVoice(false);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && [401, 403].includes(error.status)) props.onRevoked(error);
      else if (!(error && typeof error === "object" && "errMsg" in error && String(error.errMsg).includes("cancel"))) setImageError(error instanceof Error ? error.message : "照片添加失败，请重试。");
    } finally { if (alive.current) setUploading(false); }
  };
  return <>
    <Button className="bubu-chat-launcher" ariaLabel={state.pending.length ? `打开对话，${state.pending.length} 项待补充` : "打开对话"} onClick={() => { following.current = true; setOpen(true); void session.load(); }}>
      <Text className="bubu-chat-symbol">聊</Text>{state.pending.length > 0 && <Text className="bubu-chat-badge">{state.pending.length > 99 ? "99+" : state.pending.length}</Text>}
      {state.error && !open && <Text className="bubu-chat-alert">!</Text>}
    </Button>
    {open && <ChatSheet title={`${props.babyName}的日常`} onClose={() => { setOpen(false); setVoice(false); }}>
      <Text className="bubu-chat-muted">AI 助手 · 可能出错。急症请立即寻求现实帮助；中国大陆拨打 120。</Text>
      <Text className="bubu-chat-context">正在浏览 {props.viewedDate} · “现在、刚才”按本次说话时间理解</Text>
      <ScrollView className="bubu-chat-scroll" scrollY scrollIntoView={scrollTarget} onTouchMove={() => { following.current = false; }} onScrollToLower={() => { following.current = true; }}>
        <View className="bubu-chat-history">
          {!state.history.length && !state.loading && <Text className="bubu-chat-welcome">说说宝宝刚才的日常，也可以发尿布或大便照片。信息不清楚时可以直接说“不知道”。</Text>}
          {state.loading && <Text className="bubu-chat-muted">正在恢复对话和待补事项…</Text>}
          {state.history.map(turn => <Turn key={turn.id} turn={turn} babyId={props.babyId} onRevoked={props.onRevoked} recoveryDisabled={locked} onRecover={() => { void session.recoverTurn(turn.id); }} />)}
          {state.draft.pending && !currentTurn && <View className="bubu-chat-turn"><View className="bubu-chat-user"><Text>{state.draft.pending.text}</Text></View><Text className="bubu-chat-muted">消息已保留，等待确认发送结果</Text></View>}
          {state.pending.length > 0 && <View className="bubu-chat-pending"><Text className="bubu-chat-pending-title">待补充 · {state.pending.length}</Text>{state.pending.map(item => <Button key={item.id} className="bubu-chat-question" disabled={locked || undefined} onClick={() => selectPending(item)}><Text className="bubu-chat-question-copy">{pendingLabel(item)}</Text><Text className="bubu-chat-question-action">回答 ›</Text></Button>)}</View>}
          <View id="bubu-chat-end" />
        </View>
      </ScrollView>
      <View className="bubu-chat-composer">
        {(state.draft.selectedLabel || state.draft.question || state.draft.mediaPendingId) && <View className="bubu-chat-target"><Text>关于：{state.draft.selectedLabel || "选中的记录"}</Text><Button className="text-button small" disabled={locked || undefined} onClick={() => session.selectTarget({})}>取消选择</Button></View>}
        {(state.error || imageError) && <Text className="bubu-chat-failure">{imageError || state.error}</Text>}
        {state.draft.pending && <View className="bubu-chat-recovery"><Text>{state.busy ? "正在确认，收起后仍保留进度" : "上次发送尚待确认"}</Text><Button className="text-button small" disabled={state.busy || undefined} onClick={() => { void session.recover(true); }}>确认 / 继续</Button>{currentTurn?.status === "failed" && currentTurn.error?.retryable === false && <Button className="text-button small" onClick={() => { session.releaseRejected(); void session.load(); }}>修改后重发</Button>}</View>}
        {state.draft.attachmentIds.length > 0 && <View className="bubu-chat-images">{state.draft.attachmentIds.map(id => <View className="bubu-chat-attachment" key={id}><PrivateImage babyId={props.babyId} id={id} onRevoked={props.onRevoked} /><Button className="bubu-chat-remove" ariaLabel="移除照片" disabled={locked || undefined} onClick={() => session.edit({ attachmentIds: state.draft.attachmentIds.filter(item => item !== id) })}>×</Button></View>)}</View>}
        {voice ? <VoiceInput disabled={locked} onActiveChange={setRecording} onText={text => { const previous = session.getSnapshot().draft.text; session.edit({ text: previous ? `${previous}\n${text}` : text }); setVoice(false); }} /> : <Textarea className="bubu-chat-text" value={state.draft.text} placeholder={state.draft.question || state.draft.mediaPendingId ? "补充信息，不清楚也可以说不知道" : "记下刚才发生的事…"} maxlength={-1} autoHeight disabled={locked} adjustPosition={false} onInput={event => session.edit({ text: event.detail.value })} />}
        {state.draft.text.length > 6000 && <Text className="bubu-chat-failure">文字超过 6000 字，请编辑后发送；没有截断你的草稿。</Text>}
        <View className="bubu-chat-tools"><Button className="text-button" ariaLabel="添加照片" disabled={locked || recording || state.draft.attachmentIds.length >= 3 || undefined} onClick={() => { void chooseImage(); }}>{uploading ? "添加中…" : "照片"}</Button><Button className="text-button" ariaLabel={voice ? "切换键盘" : "切换语音"} disabled={locked || undefined} onClick={() => setVoice(value => !value)}>{voice ? "键盘" : "语音"}</Button>{!voice && <Button className="bubu-chat-send" ariaLabel="发送消息" disabled={locked || (!state.draft.text.trim() && !state.draft.attachmentIds.length) || state.draft.text.length > 6000 || undefined} onClick={() => { following.current = true; void session.send(props.viewedDate); }}>发送</Button>}</View>
        <Text className="bubu-chat-muted bubu-chat-footnote">{voice ? "语音转成文字，校对后再发送" : "照片最多 3 张 · AI 不能诊断疾病"}</Text>
      </View>
    </ChatSheet>}
  </>;
}
