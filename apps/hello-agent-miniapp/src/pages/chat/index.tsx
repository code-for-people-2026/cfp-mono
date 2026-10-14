import { AgeGate } from "../../chat/age";
import type { AgeStatus } from "@cfp/hello-agent-protocol";
import { installAiCopyLabels } from "../../chat/ai-copy";
import { consentCurrent, type PrivacyStatus } from "../../chat/privacy";
import { openPrivacy, openHelp, privacyChangedEvent, type PrivacyChange } from "../../chat/settings-navigation";
import { useEffect, useRef, useState } from "react";
import {
  Button as TaroButton,
  type ButtonProps,
  Image,
  Input as TextInput,
  Text,
  View,
} from "@tarojs/components";
import Taro, { usePageScroll, useDidShow } from "@tarojs/taro";
import * as api from "../../chat/api";
import { ChatNavigation } from "../../chat/navigation";
import { useChatMode } from "../../chat/preferences";
import { MemoryPanel } from "../../chat/memory";
import { ChatComposer, type ImageSource } from "../../chat/composer";
import { Artifacts, LiveArtifacts } from "../../chat/artifacts";
import { EvidenceCard } from "../../chat/evidence-card";
import { CopyMessage, MessageText } from "../../chat/message-text";
import {
  type ClientEvent,
  type FormValues,
  type RunProgress,
} from "@cfp/hello-agent-protocol";
import mascot from "../../assets/aj-mascot.webp";
import {
  canSend,
  requestId,
  type Attachment,
  type Mode,
  type Settings,
  type Session,
  type Turn,
  type MemoryStatus,
  type Input,
} from "../../chat/model";

const selectionKey = `hello-active-session:${HELLO_API_ORIGIN}`;
type PendingSubmission = {
  sessionId: number;
  requestId: string;
  mode: Exclude<Mode, "external">;
  input: Input;
};
type Draft = {
  text: string;
  attachments: Attachment[];
  submission?: PendingSubmission;
};
const h5 = process.env.TARO_ENV === "h5";
function Button(props: ButtonProps) {
  return (
    <TaroButton
      {...props}
      // H5 的 disabled="false" 仍会命中组件库的禁用样式，未禁用时移除属性。
      disabled={props.disabled || undefined}
      className={`control ${props.disabled ? "is-disabled" : ""} ${props.className || ""}`}
    />
  );
}
const suggestions = [
  "窗台上的小番茄红了",
  "明天要开始一份新工作",
  "最近有些累，想慢一点",
];

export default function Chat() {
  const [age, setAge] = useState<AgeStatus>();
  const [ageOpen, setAgeOpen] = useState(true);
  const bootVersion = useRef(0);
  const [privacy, setPrivacy] = useState<PrivacyStatus>();
  const privacyDirty = useRef(false);
  const [settings, setSettings] = useState<Settings>();
  const [memory, setMemory] = useState<MemoryStatus>();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [sessionId, setSessionId] = useState<number>();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const activeSession = useRef<number>();
  const drafts = useRef(new Map<number, Draft>());
  const [history, setHistory] = useState<Turn[]>([]);
  const [images, setImages] = useState<Record<number, string | null>>({});
  const [text, setText] = useState("");
  const [inputMode, setInputMode] = useState<"voice" | "keyboard">("voice");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const mode = useChatMode();
  const settingsNavigation = useRef(false);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RunProgress>();
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [identityExpired, setIdentityExpired] = useState(false);
  const [pending, setPending] = useState<{
    text: string;
    images: Attachment[];
  }>();
  const followLatest = useRef(true);
  const pageTop = useRef(0);
  const scrollRevision = useRef(0);
  const historyVersion = useRef(0);
  const sendLock = useRef(false);
  // 只保留待确认提交的业务标识，不保留 BYOK 密钥。网络错误不代表服务端没有保存。
  const submission = useRef<PendingSubmission>();
  const disabled =
    busy || uploading || loading || memoryBusy || identityExpired || !age?.allowed || !age.expiresAt || Date.parse(age.expiresAt) <= Date.now();
  const ready = canSend(
    text,
    attachments,
    mode,
    apiKey,
    !!settings?.platformConfigured,
    disabled || historyFailed || !consentCurrent(privacy) || memory?.level === "empty",
  );
  const formReady = canSend(
    "表单",
    [],
    mode,
    apiKey,
    !!settings?.platformConfigured,
    disabled || historyFailed || !consentCurrent(privacy) || memory?.level === "empty",
  );

  usePageScroll(({ scrollTop }) => {
    // 用户向前翻页时立即暂停跟随，截图过程中收到回复也不抢回滚动位置。
    if (scrollTop < pageTop.current - 2) followLatest.current = false;
    pageTop.current = scrollTop;
    const revision = ++scrollRevision.current;
    const height = Taro.getWindowInfo().windowHeight;
    Taro.createSelectorQuery()
      .select("#chat-end")
      .boundingClientRect((rect) => {
        if (revision !== scrollRevision.current || !rect || Array.isArray(rect))
          return;
        // 手动回到末尾后恢复跟随；过期的布局查询不能覆盖新的滚动意图。
        followLatest.current = rect.bottom <= height + 40;
      })
      .exec();
  });

  function problem(value: unknown) {
    if (value instanceof api.IdentityExpiredError) setIdentityExpired(true);
    setError(
      value instanceof Error ? value.message : "暂时没有完成，请稍后重试",
    );
  }
  function recoveryFailed(value: unknown) {
    if (value instanceof api.IdentityExpiredError) setIdentityExpired(true);
    return undefined;
  }
  async function readHistory(id: number) {
    const version = ++historyVersion.current;
    const [rows, nextMemory] = await Promise.all([
      api.getHistory(id),
      api.getMemory(id),
    ]);
    if (version !== historyVersion.current) return;
    setHistory(rows);
    setMemory(nextMemory);
    // 文字与记忆先恢复；图片单独加载，失败只影响对应占位，不影响发送结果。
    const media = [...new Set(rows.flatMap((row) => row.input.mediaIds))];
    for (const mediaId of media) {
      const update = (source: string | null) => {
        if (version === historyVersion.current)
          setImages((current) => ({ ...current, [mediaId]: source }));
      };
      void api.imageSource(mediaId).then(update, (value) => {
        update(null);
        if (
          version === historyVersion.current &&
          value instanceof api.IdentityExpiredError
        )
          problem(value);
      });
    }
  }
  function rememberSelection(id: number | undefined) {
    activeSession.current = id;
    setSessionId(id);
    try {
      Taro.setStorageSync(selectionKey, id || 0);
    } catch {
      /* 存储不可用时仍可切换 */
    }
  }
  function stashDraft() {
    drafts.current.set(activeSession.current || 0, {
      text,
      attachments,
      submission: submission.current,
    });
  }
  async function switchSession(id: number, fresh = false) {
    stashDraft();
    historyVersion.current++;
    rememberSelection(id);
    const draft = drafts.current.get(id);
    setText(draft?.text || "");
    setAttachments(draft?.attachments || []);
    submission.current = draft?.submission;
    setHistory([]);
    setImages({});
    setMemory(undefined);
    setProgress(undefined);
    setPending(undefined);
    setMemoryOpen(false);
    setNavigationOpen(false);
    setError(
      draft?.submission
        ? "这段对话还有一次发送等待确认，可以先确认上次发送。"
        : "",
    );
    setHistoryFailed(false);
    setInputMode("keyboard");
    followLatest.current = true;
    scrollRevision.current++;
    if (fresh) {
      void Taro.pageScrollTo({ scrollTop: 0, duration: 0 }).catch(() => {});
      return;
    }
    setLoading(true);
    try {
      await readHistory(id);
    } catch (value) {
      setHistoryFailed(true);
      problem(value);
    } finally {
      setLoading(false);
    }
  }
  async function selectSession(id: number) {
    if (disabled || sendLock.current) return;
    if (id === activeSession.current) {
      setNavigationOpen(false);
      return;
    }
    sendLock.current = true;
    try {
      await switchSession(id);
    } finally {
      sendLock.current = false;
    }
  }
  async function startConversation() {
    if (disabled || sendLock.current) return;
    sendLock.current = true;
    setLoading(true);
    try {
      const session = await api.newSession();
      setSessions((rows) => [...rows, session]);
      if (!activeSession.current)
        drafts.current.set(session.id, {
          text,
          attachments,
          submission: submission.current,
        });
      await switchSession(session.id, true);
    } catch (value) {
      problem(value);
    } finally {
      setLoading(false);
      sendLock.current = false;
    }
  }
  async function refreshSessions() {
    try {
      setSessions(await api.getSessions());
    } catch {
      /* 不把已保存的回复误报成失败 */
    }
  }
  async function boot() {
    const version = ++bootVersion.current;
    setLoading(true);
    setError("");
    try {
      await api.establishIdentity();
      const [config, rows, nextPrivacy, nextAge] = await Promise.all([
        api.getSettings(),
        api.getSessions(),
        api.getPrivacy(),
        api.getAge(),
      ]);
      if (version !== bootVersion.current) return;
      setAge(nextAge);
      setAgeOpen(!nextAge.allowed || !consentCurrent(nextPrivacy));
      setPrivacy(nextPrivacy);
      setSettings(config);
      setSessions(rows);
      if (rows.length) {
        let remembered = activeSession.current;
        if (!remembered) {
          try {
            remembered = Number(Taro.getStorageSync(selectionKey)) || undefined;
          } catch {
            /* 无本地存储 */
          }
        }
        const selected =
          rows.find((row) => row.id === remembered) ||
          [...rows].sort(
            (a, b) =>
              (b.updatedAt || b.createdAt || "").localeCompare(
                a.updatedAt || a.createdAt || "",
              ) || b.id - a.id,
          )[0];
        rememberSelection(selected.id);
        await readHistory(selected.id);
      }
      if (version === bootVersion.current) setHistoryFailed(false);
    } catch (value) {
      if (version !== bootVersion.current) return;
      setHistoryFailed(true);
      problem(value);
    } finally {
      if (version === bootVersion.current) setLoading(false);
    }
  }
  function clearIdentityView() {
    bootVersion.current++;
    setAge(undefined);
    setAgeOpen(true);
    // 防止旧身份的图片异步结果混入新页面。
    historyVersion.current++;
    submission.current = undefined;
    rememberSelection(undefined);
    drafts.current.clear();
    setSessions([]);
    setSettings(undefined);
    setHistory([]);
    followLatest.current = true;
    scrollRevision.current++;
    setImages({});
    setText("");
    setInputMode("voice");
    setAttachments([]);
    setPending(undefined);
    setMemory(undefined);
    setMemoryOpen(false);
    setApiKey("");
    setIdentityExpired(false);
    setPrivacy(undefined);
  }
  async function restartIdentity() {
    if (loading || busy || uploading || memoryBusy || sendLock.current) return;
    sendLock.current = true;
    try {
      const decision = await Taro.showModal({
        title: "以新身份重新开始？",
        content:
          "旧聊天记录不会删除，但新身份无法访问旧记录。当前草稿和图片也会清空。这不是微信登录或账号找回。",
        confirmText: "重新开始",
        cancelText: "保留现状",
      });
      if (!decision.confirm) return;
      setLoading(true);
      await api.restartIdentity();
      clearIdentityView();
      await boot();
    } catch (value) {
      problem(value);
    } finally {
      setLoading(false);
      sendLock.current = false;
    }
  }
  async function checkSubmission() {
    const current = submission.current;
    if (!current || disabled || sendLock.current) return;
    sendLock.current = true;
    setBusy(true);
    try {
      const { turn } = await api.getSubmission(
        current.sessionId,
        current.requestId,
      );
      if (turn?.status === "completed") {
        submission.current = undefined;
        if (
          current.mode === mode &&
          JSON.stringify(current.input) ===
            JSON.stringify({
              text: text.trim(),
              mediaIds: attachments.map((item) => item.id),
            })
        ) {
          setText("");
          setAttachments([]);
        }
        setHistory((rows) => [
          ...rows.filter((row) => row.id !== turn.id),
          turn,
        ]);
        setError("已确认上次回复保存成功，无需再次发送。");
        await readHistory(current.sessionId);
        await refreshSessions();
      } else if (turn?.status === "failed") {
        submission.current = undefined;
        setError("上次生成已确认失败，草稿保留；可以重新发送。");
      } else {
        setError(
          turn
            ? "上次提交仍在处理，请稍后再确认；不会重复生成。"
            : "尚未找到上次提交，可用原请求重试发送。",
        );
      }
    } catch (value) {
      problem(value);
    } finally {
      setBusy(false);
      sendLock.current = false;
    }
  }
  useEffect(() => {
    void boot();
    return () => {
      bootVersion.current++;
      historyVersion.current++;
      scrollRevision.current++;
    };
  }, []);
  useEffect(() => {
    if (!history.length && !pending) return;
    Taro.nextTick(() => {
      if (followLatest.current)
        void Taro.pageScrollTo({ selector: "#chat-end", duration: 0 }).catch(
          () => {},
        );
    });
  }, [history, pending, attachments, progress]);

  useEffect(() => {
    const changed = (change: PrivacyChange) => {
      privacyDirty.current = true;
      if (change.status) setPrivacy(change.status);
      if (change.clearIdentity) clearIdentityView();
    };
    Taro.eventCenter.on(privacyChangedEvent, changed);
    const cleanupCopy = h5 ? installAiCopyLabels() : undefined;
    return () => { Taro.eventCenter.off(privacyChangedEvent, changed); cleanupCopy?.(); };
  }, []);
  useDidShow(() => {
    if (privacyDirty.current) { privacyDirty.current = false; void boot(); }
    else if (age?.expiresAt && Date.parse(age.expiresAt) <= Date.now()) { setAge({ ...age, allowed: false, state: "expired" }); setAgeOpen(true); }
  });

  async function chooseImage(source?: ImageSource) {
    if (disabled || attachments.length >= 3) return;
    if (!consentCurrent(privacy) || !privacy?.consent?.sensitive) { void openPrivacy("authorization"); return; }
    setUploading(true);
    setError("");
    try {
      const image = await api.addImage(source);
      setAttachments((items) => [...items, image]);
      setInputMode("keyboard");
    } catch (value) {
      // 用户关闭图片选择器不当成服务故障；其他失败明确显示。
      if (
        !(
          typeof value === "object" &&
          value &&
          "errMsg" in value &&
          String(value.errMsg).includes("cancel")
        )
      )
        problem(value);
    } finally {
      setUploading(false);
    }
  }
  async function send(formInput?: Input) {
    if (
      !(formInput ? formReady : ready) ||
      mode === "external" ||
      sendLock.current
    )
      return;
    sendLock.current = true;
    followLatest.current = true;
    scrollRevision.current++;
    const draft = { text: text.trim(), images: attachments };
    const input = formInput || {
      text: draft.text,
      mediaIds: draft.images.map((item) => item.id),
    };
    const key = apiKey;
    setApiKey("");
    setBusy(true);
    setPending(formInput ? { text: formInput.text, images: [] } : draft);
    setProgress(undefined);
    if (!formInput) {
      setText("");
      setAttachments([]);
    }
    setError("");
    let id = sessionId;
    let saved = false;
    let formFailure: Error | undefined;
    try {
      if (!id) {
        const session = await api.newSession();
        id = session.id;
        rememberSelection(id);
        setSessions((rows) => [...rows, session]);
      }
      const previous = submission.current;
      const retry =
        previous?.sessionId === id &&
        previous.mode === mode &&
        JSON.stringify(previous.input) === JSON.stringify(input);
      const current = retry
        ? previous
        : { sessionId: id, requestId: requestId(), mode, input };
      submission.current = current;
      let result: Turn | undefined;
      if (retry) {
        const status = await api.getSubmission(id, current.requestId);
        if (status.turn?.status === "completed") result = status.turn;
        if (status.turn?.status === "running")
          throw new Error("上次提交仍在处理，请稍后再确认；不会重复生成。");
        // 只有服务端明确失败才允许新的一轮；查询失败或暂未找到都不能随意换编号。
        if (status.turn?.status === "failed") current.requestId = requestId();
      }
      result ||= await api.generate(
        id,
        current.requestId,
        mode,
        input,
        key,
        setProgress,
      );
      saved = true;
      submission.current = undefined;
      // 保存成功与刷新成功是两件事，不能因随后读取失败诱导用户重复发送。
      setHistory((current) => [
        ...current.filter((row) => row.id !== result.id),
        result,
      ]);
      await readHistory(id);
    } catch (value) {
      if (value instanceof api.IdentityExpiredError) setIdentityExpired(true);
      if (saved) {
        setError(
          "回复已保存，记录暂时刷新失败，请稍后重新打开；无需再次发送。",
        );
      } else {
        const current = submission.current;
        const status =
          current &&
          (await api
            .getSubmission(current.sessionId, current.requestId)
            .catch(recoveryFailed));
        if (status?.turn?.status === "completed") {
          const turn = status.turn;
          submission.current = undefined;
          setHistory((rows) => [
            ...rows.filter((row) => row.id !== turn.id),
            turn,
          ]);
          setError("已确认上次回复保存成功，无需再次发送。");
        } else {
          if (status?.turn?.status === "failed") submission.current = undefined;
          problem(value);
          if (formInput)
            formFailure =
              value instanceof Error
                ? value
                : new Error("表单尚未确认提交，请稍后重试");
          if (!formInput) {
            setText(draft.text);
            setAttachments(draft.images);
          }
        }
        if (id) await readHistory(id).catch(recoveryFailed);
      }
    } finally {
      await refreshSessions();
      setPending(undefined);
      setProgress(undefined);
      setBusy(false);
      sendLock.current = false;
    }
    // A form's error must be visible inside its sheet, not behind the overlay.
    // Confirmed saves (including recovered responses) never become retry errors.
    if (formFailure) throw formFailure;
  }
  const formResponses = Object.fromEntries(
    history
      .filter((row) => row.status === "completed" && row.input.formResponse)
      .map((row) => {
        const response = row.input.formResponse!;
        return [
          `turn_${response.turnId}_${response.artifactId}`,
          response.values,
        ];
      }),
  ) as Record<string, FormValues>;
  async function submitForm(event: ClientEvent) {
    if (!consentCurrent(privacy) || !privacy?.consent?.sensitive) { void openPrivacy("authorization"); throw new Error("请先单独同意情绪练习的敏感信息处理"); }
    const match = event.action.surfaceId.match(/^turn_(\d+)_(.+)$/);
    if (!match) throw new Error("表单来源无效");
    await send({
      text: "提交练习表单",
      mediaIds: [],
      formResponse: {
        turnId: Number(match[1]),
        artifactId: match[2],
        values: event.action.context.values,
      },
    });
  }

  async function openSettings() {
    if (busy || uploading || memoryBusy || sendLock.current || settingsNavigation.current) return;
    settingsNavigation.current = true;
    setNavigationOpen(false);
    setApiKey("");
    try {
      await Taro.navigateTo({ url: "/pages/settings/index" });
    } catch (value) {
      problem(value);
    } finally {
      settingsNavigation.current = false;
    }
  }
  useEffect(() => {
    setApiKey("");
  }, [mode]);

  return (
    <View className={h5 ? "h5-shell" : "native-shell"}>
      <View className="chat-app">
        <ChatNavigation
          open={navigationOpen}
          sessions={sessions}
          activeId={sessionId}
          disabled={disabled}
          settingsDisabled={busy || uploading || memoryBusy}
          memoryFull={memory?.level === "empty"}
          memory={memory}
          onOpen={() => setNavigationOpen(true)}
          onClose={() => setNavigationOpen(false)}
          onNew={startConversation}
          onSelect={selectSession}
          onMemory={() => {
            setNavigationOpen(false);
            setMemoryOpen(true);
          }}
          onSettings={openSettings}
        />
        <View className="conversation">
          <View className="chat-content">
            {!history.length && !pending && !loading && !historyFailed && (
              <View className="welcome-home">
                <View className="mascot-halo">
                  <Image
                    className="welcome-mascot"
                    src={mascot}
                    mode="aspectFit"
                    ariaLabel="挥手打招呼的阿 J 先生"
                  />
                </View>
                <Text className="welcome-title">嗨，我是阿 J 先生。</Text>
                <View className="welcome-copy">
                  <Text>从鲁迅笔下的阿 Q 那儿，“蒸馏”来一点乐观。</Text>
                  <Text>
                    不自欺，不欺软怕硬，也不把委屈硬说成胜利。留下的，是跌一跤还能拍拍灰、继续往前走的劲儿。
                  </Text>
                  <Text className="welcome-invitation">
                    有什么烦心事，跟我说说吧。
                    <Text>咱们换个角度，再讨一句好彩头。</Text>
                  </Text>
                </View>
                {mode !== "external" && (
                  <View className="suggestions">
                    <Text className="suggestion-caption">不如从这里开始</Text>
                    {suggestions.map((item) => (
                      <Button
                        key={item}
                        className="suggestion"
                        disabled={disabled}
                        onClick={() => {
                          setText(item);
                          setInputMode("keyboard");
                        }}
                      >
                        <Text>{item}</Text>
                        <Text className="suggestion-arrow">↗</Text>
                      </Button>
                    ))}
                  </View>
                )}
              </View>
            )}
            {loading && (
              <Text className="loading-note">
                阿 J 先生正在翻看我们聊过的日常…
              </Text>
            )}
            {history.map((row) => (
              <View className="turn" key={row.id}>
                <View className="message user-message">
                  <View className="user-message-main">
                    <View className="bubble user-bubble">
                      {row.input.text && (
                        <MessageText>{row.input.text}</MessageText>
                      )}
                      {row.input.mediaIds.length > 0 && (
                        <View className="bubble-images">
                          {row.input.mediaIds.map((id) =>
                            images[id] ? (
                              <Image
                                key={id}
                                className="message-image"
                                src={images[id]!}
                                mode="aspectFill"
                                onError={() =>
                                  setImages((current) => ({
                                    ...current,
                                    [id]: null,
                                  }))
                                }
                                onClick={() =>
                                  Taro.previewImage({
                                    urls: row.input.mediaIds
                                      .map((value) => images[value])
                                      .filter(
                                        (source): source is string => !!source,
                                      ),
                                    current: images[id]!,
                                  })
                                }
                              />
                            ) : (
                              <Text key={id} className="image-placeholder">
                                {images[id] === null
                                  ? "图片暂不可用"
                                  : "图片加载中…"}
                              </Text>
                            ),
                          )}
                        </View>
                      )}
                    </View>
                  </View>
                </View>
                <View className="message assistant-message">
                  <Image
                    className="avatar small-avatar"
                    src={mascot}
                    mode="aspectFill"
                  />
                  <View className="message-main">
                    <View
                      data-ai-external={row.mode === "external" ? "true" : "false"}
                      className={`bubble assistant-bubble ${row.status === "failed" ? "failed-bubble" : ""}`}
                    >
                      <MessageText aiGenerated={row.status === "completed"} external={row.mode === "external"}>
                        {row.status === "completed"
                          ? row.greeting
                          : row.status === "failed"
                            ? "这一次没有生成成功。检查连接或密钥后，可以重新发给我。"
                            : "这一轮尚未完成，请先确认上次发送；若长时间未完成，请联系开发者。"}
                      </MessageText>
                      {row.status === "completed" && (
                        <Artifacts
                          external={row.mode === "external"}
                          turnId={row.id}
                          artifacts={row.artifacts}
                          responses={formResponses}
                          disabled={!formReady}
                          onAction={submitForm}
                        />
                      )}
                      {row.status === "completed" && row.association && (
                        <EvidenceCard turn={row} />
                      )}
                    </View>
                    <View className="message-footer">
                      <Button className="text-button" onClick={() => void openHelp(row.id)}>举报或反馈</Button>
                      <Text className="message-meta">
                        {row.status === "completed"
                          ? "AI 生成 · 已保存"
                          : "这一轮尚未完成"}
                      </Text>
                      {row.status === "completed" && row.greeting && (
                        <CopyMessage
                          external={row.mode === "external"}
                          value={row.greeting}
                          label="复制阿 J 先生的回复"
                        />
                      )}
                    </View>
                  </View>
                </View>
              </View>
            ))}
            {pending && (
              <View className="turn">
                <View className="message user-message">
                  <View className="bubble user-bubble">
                    {pending.text && <MessageText>{pending.text}</MessageText>}
                    <View className="bubble-images">
                      {pending.images.map((item) => (
                        <Image
                          key={item.id}
                          className="message-image"
                          src={item.src}
                          mode="aspectFill"
                        />
                      ))}
                    </View>
                  </View>
                </View>
                <View className="message assistant-message">
                  <Image
                    className="avatar small-avatar"
                    src={mascot}
                    mode="aspectFill"
                  />
                  <View className="message-main">
                    <View className="bubble assistant-bubble thinking">
                      <Text className="thinking-dots">● ● ●</Text>
                      <MessageText>
                        {progress?.text ||
                          progress?.step ||
                          "阿 J 先生正在换个角度想…"}
                      </MessageText>
                      {progress && (
                        <LiveArtifacts messages={progress.messages} />
                      )}
                    </View>
                  </View>
                </View>
              </View>
            )}
            <View id="chat-end" className="chat-end" />
          </View>
        </View>
        <View className="chat-dock">
          {error && (
            <View className="error-banner">
              <Text>
                {identityExpired ? api.IDENTITY_EXPIRED_MESSAGE : error}
              </Text>
              {!identityExpired && submission.current && (
                <Button
                  className="text-button check-submission"
                  disabled={disabled}
                  onClick={checkSubmission}
                >
                  确认上次发送
                </Button>
              )}
              {identityExpired ? (
                <Button
                  className="text-button restart-identity"
                  disabled={loading || busy || uploading || memoryBusy}
                  onClick={restartIdentity}
                >
                  重新开始
                </Button>
              ) : (
                (!settings || historyFailed) && (
                  <Button className="text-button" onClick={boot}>
                    重试
                  </Button>
                )
              )}
            </View>
          )}
          <View className="composer-area">
            {mode === "byok" && (
              <View className="key-row">
                <TextInput
                  className="key-input"
                  password
                  value={apiKey}
                  onInput={(event) => setApiKey(event.detail.value)}
                  placeholder="填写本次 DeepSeek API Key"
                  disabled={busy}
                />
                <Text className="key-hint">仅用于本次生成，发送后清空</Text>
              </View>
            )}
            {mode === "platform" &&
              settings &&
              !settings.platformConfigured && !age?.configuration.previewOnly && (
                <Text className="config-warning">
                  平台尚未配置模型账户，请切换到“我的密钥”。
                </Text>
              )}
            {mode === "external" ? (
              <View className="external-composer">
                <Text>让你自己的 Agent 生成，祝福仍留在这里。</Text>
                <View className="external-actions">
                  <Button
                    className="primary-button"
                    disabled={disabled}
                    onClick={openSettings}
                  >
                    连接我的 Agent ↗
                  </Button>
                  <Button
                    className="quiet-button"
                    disabled={disabled}
                    onClick={boot}
                  >
                    刷新对话
                  </Button>
                </View>
              </View>
            ) : (
              <ChatComposer
                inputMode={inputMode}
                text={text}
                attachments={attachments}
                disabled={disabled || historyFailed || navigationOpen}
                voiceDisabled={
                  disabled ||
                  !consentCurrent(privacy) ||
                  historyFailed ||
                  navigationOpen ||
                  memory?.level === "empty" ||
                  memoryOpen
                }
                ready={ready}
                busy={busy}
                uploading={uploading}
                onMode={setInputMode}
                onText={setText}
                onVoiceText={(value) => {
                  const combined = text ? `${text}\n${value}` : value;
                  setText(combined);
                  setInputMode("keyboard");
                  if (combined.length > 4000)
                    setError("文字超过 4000 字，请编辑后再发送。");
                }}
                onImage={chooseImage}
                onRemoveImage={(id) =>
                  setAttachments((items) =>
                    items.filter((item) => item.id !== id),
                  )
                }
                onSend={() => send()}
              />
            )}
            {!loading && !age?.allowed && <Button className="age-resume" onClick={() => setAgeOpen(true)}>{age?.configuration.previewOnly ? "继续体验" : "继续登录与年龄确认"}</Button>}
            <Text className="composer-footnote">
              {age?.configuration.previewOnly ? "本次预览只体验登录与生日" : !loading && !consentCurrent(privacy) ? "使用前请在设置 → 隐私与数据中确认授权" : mode === "external"
                ? "对话仍留在这里 · 支持撤销连接"
                : "阿 J 先生是 AI，好意不是对未来的保证"}
            </Text>
          </View>
        </View>
        {memoryOpen && (
          <MemoryPanel
            platformConfigured={!!settings?.platformConfigured}
            sessionId={sessionId}
            memory={memory}
            mode={mode}
            apiKey={apiKey}
            onKeyUsed={() => setApiKey("")}
            onChange={setMemory}
            onClose={() => {
              setMemoryOpen(false);
              setMemoryBusy(false);
            }}
            onBusy={setMemoryBusy}
            onError={problem}
          />
        )}
      </View>
      {ageOpen && !identityExpired && <AgeGate status={age} loadingError={error} privacyReady={consentCurrent(privacy)} onChange={setAge}
        onRefresh={boot} onLogin={async () => { clearIdentityView(); await boot(); }}
        onPrivacy={() => void openPrivacy(age?.allowed && !consentCurrent(privacy) ? "authorization" : undefined)}
        onHelp={() => void openHelp()} onClose={() => setAgeOpen(false)} />}
    </View>
  );
}
