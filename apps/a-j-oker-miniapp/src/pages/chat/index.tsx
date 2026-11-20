import { InteractionGuard } from "../../chat/interaction";
import {
  imageGenerationBlocksRetry,
  supersededRetryTurnIds,
  type UserProfile,
} from "@cfp/a-j-oker-contracts";
import { AgeGate } from "../../chat/age";
import type { AgeStatus } from "@cfp/a-j-oker-contracts";
import { installAiCopyLabels } from "../../chat/ai-copy";
import { consentCurrent, type PrivacyStatus } from "../../chat/privacy";
import { openPrivacy, openHelp, privacyChangedEvent, type PrivacyChange } from "../../chat/settings-navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button as TaroButton,
  type ButtonProps,
  Image,
  Text,
  View,
} from "@tarojs/components";
import Taro, { usePageScroll, useDidShow, useDidHide } from "@tarojs/taro";
import * as api from "../../chat/api";
import { ChatNavigation } from "../../chat/navigation";
import { useChatMode } from "../../chat/preferences";
import { MemoryPanel } from "../../chat/memory";
import { ChatComposer, type ImageSource } from "../../chat/composer";
import { ChatDock } from "../../chat/dock";
import { Artifacts, LiveArtifacts } from "../../chat/artifacts";
import { EvidenceCard } from "../../chat/evidence-card";
import { DancingLoader } from "../../chat/dancing-loader";
import { retryUserMessageVisible } from "../../chat/retry-history";
import { resolveExpertAvatarSource } from "../../chat/expert-avatars";
import { LoadingCarousel } from "../../chat/loading-carousel";
import {
  formSubmissionStates,
  isFormOnlyInput,
} from "../../chat/form-history";
import {
  HandoffPreamble,
  interimHandoffPreamble,
} from "../../chat/handoff-preamble";
import {
  activeSpecialistTurn,
  specialistFormStateForTurn,
  specialistPresentationForTurn,
} from "../../chat/specialist-card";
import {
  clearSubmissionFailure,
  readSubmissionFailure,
  rememberSubmissionFailure,
} from "../../chat/submission-failures";
import {
  InlineFormKeyboardContext,
  PresentationFrame,
} from "@cfp/chat-ui-taro/artifacts";
import { CopyMessage, MessageText } from "../../chat/message-text";
import { ChatIcon } from "../../chat/icon";
import { useInlineFormKeyboard } from "../../chat/inline-form-keyboard";
import {
  type ClientEvent,
  type RunProgress,
} from "@cfp/base-chat-protocol";
import {
  createRecoverableSubmitController,
  type RecoverableSubmission,
  type RecoverableSubmitController,
} from "@cfp/chat-ui-taro/recoverable-submit";
import mascot from "../../assets/aj-mascot.png";
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
type SubmitRequest = {
  mode: Exclude<Mode, "external">;
  input: Input;
};
type PendingSubmission = RecoverableSubmission<number, SubmitRequest>;
type SubmissionController = RecoverableSubmitController<
  number,
  SubmitRequest,
  Turn
>;
type Draft = {
  text: string;
  attachments: Attachment[];
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

export function visibleRetryLineage(rows: Turn[]) {
  const superseded = supersededRetryTurnIds(rows);
  return rows.filter((row) => !superseded.has(row.id));
}

export default function Chat() {
  const [visible, setVisible] = useState(true);
  const pageHidden = useRef(false);
  const [profile, setProfile] = useState<UserProfile>();
  const [avatarSource, setAvatarSource] = useState<string>();
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
  const [composerKeyboardActive, setComposerKeyboardActive] = useState(false);
  const [composerKeyboardHeight, setComposerKeyboardHeight] = useState(0);
  const [composerFloating, setComposerFloating] = useState(false);
  const {
    handlers: inlineFormKeyboardHandlers,
    overlay: inlineFormKeyboardOverlay,
    active: inlineFormKeyboardActive,
  } = useInlineFormKeyboard();
  const inlineFormKeyboardActiveRef = useRef(false);
  const handleComposerKeyboardFocus = useCallback((
    focused: boolean,
    event: { height: number },
  ) => {
    setComposerKeyboardActive(focused);
    setComposerKeyboardHeight(event.height);
  }, []);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const mode = useChatMode();
  const settingsNavigation = useRef(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<RunProgress>();
  const [loadingRun, setLoadingRun] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [identityExpired, setIdentityExpired] = useState(false);
  const [pending, setPending] = useState<{
    text: string;
    images: Attachment[];
  }>();
  const [retryingTurnId, setRetryingTurnId] = useState<number>();
  const followLatest = useRef(true);
  const pageTop = useRef(0);
  const scrollRevision = useRef(0);
  const historyVersion = useRef(0);
  const scopeVersion = useRef(0);
  const pageAlive = useRef(true);
  const sendLock = useRef(false);
  // The page keeps only this in-memory controller state; no keys are retained.
  const submissions = useRef<SubmissionController>();
  if (!submissions.current) {
    submissions.current = createRecoverableSubmitController<
      number,
      SubmitRequest,
      Turn
    >({
      createRequestId: requestId,
      fingerprint: (request) => JSON.stringify(request),
      lookup: async (submission: PendingSubmission) =>
        (await api.getSubmission(submission.scope, submission.requestId)).turn ??
        undefined,
      classify: (turn) =>
        turn === undefined
          ? "missing"
          : turn.status === "completed"
            ? "completed"
            : turn.status,
      send: async (submission) => {
        const version = scopeVersion.current;
        return api.generate(
          submission.scope,
          submission.requestId,
          submission.request.mode,
          submission.request.input,
          undefined,
          (next) => {
            if (
              pageAlive.current &&
              version === scopeVersion.current &&
              activeSession.current === submission.scope
            )
              setProgress(next);
          },
        );
      },
    });
  }
  const disabled =
    busy || uploading || loading || memoryBusy || identityExpired || !age?.allowed || !age.expiresAt || Date.parse(age.expiresAt) <= Date.now();
  const ready = canSend(
    text,
    attachments,
    mode,
    "",
    !!settings?.platformConfigured,
    disabled || historyFailed || !consentCurrent(privacy) || memory?.level === "empty",
  );
  const formReady = canSend(
    "表单",
    [],
    mode,
    "",
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
  function failureMessage(value: unknown, fallback: string) {
    return value instanceof Error ? value.message : fallback;
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
    });
  }
  async function switchSession(id: number, fresh = false) {
    stashDraft();
    scopeVersion.current++;
    historyVersion.current++;
    rememberSelection(id);
    const draft = drafts.current.get(id);
    setText(draft?.text || "");
    setAttachments(draft?.attachments || []);
    const pendingSubmission = submissions.current?.pendingFor(id);
    setHistory([]);
    setImages({});
    setMemory(undefined);
    setProgress(undefined);
    setPending(undefined);
    setRetryingTurnId(undefined);
    setMemoryOpen(false);
    setNavigationOpen(false);
    const previousFailure = submissions.current?.failureFor(id);
    const recalledFailure = readSubmissionFailure(id);
    setError(
      previousFailure?.error instanceof Error
        ? previousFailure.error.message
        : pendingSubmission
          ? "这段对话还有一次发送等待确认，可以先确认上次发送。"
        : recalledFailure
          ? recalledFailure.message
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
        });
      await switchSession(session.id, true);
    } catch (value) {
      problem(value);
    } finally {
      setLoading(false);
      sendLock.current = false;
    }
  }
  async function refreshSessions(version = scopeVersion.current) {
    if (!pageAlive.current || version !== scopeVersion.current) return;
    try {
      const next = await api.getSessions();
      if (pageAlive.current && version === scopeVersion.current)
        setSessions(next);
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
      // Recover a revoked WeChat login before issuing other authenticated reads.
      const nextAge = await api.getAge();
      if (version !== bootVersion.current) return;
      if (!nextAge.loggedIn) clearIdentityView(false);
      const [config, nextPrivacy] = await Promise.all([
        api.getSettings(),
        api.getPrivacy(),
      ]);
      if (version !== bootVersion.current) return;
      setAge(nextAge);
      setAgeOpen(!nextAge.allowed || !consentCurrent(nextPrivacy));
      setPrivacy(nextPrivacy);
      setSettings(config);
      const [rows, nextProfile] = nextAge.loggedIn ? await Promise.all([api.getSessions(), api.getProfile()]) : [[], undefined];
      if (version !== bootVersion.current) return;
      setProfile(nextProfile); setAvatarSource(undefined);
      if (nextProfile?.avatar.image) void api.profileAvatarSource().then((source) => { if (version === bootVersion.current) setAvatarSource(source); }).catch(() => { /* Generated avatar remains visible when the photo cannot load. */ });
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
        const recalledFailure = readSubmissionFailure(selected.id);
        if (
          version === bootVersion.current &&
          recalledFailure &&
          !submissions.current?.pendingFor(selected.id)
        )
          setError(recalledFailure.message);
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
  function clearIdentityView(invalidateBoot = true) {
    if (invalidateBoot) bootVersion.current++;
    setAge(undefined);
    setProfile(undefined); setAvatarSource(undefined);
    setAgeOpen(true);
    // 防止旧身份的图片异步结果混入新页面。
    historyVersion.current++;
    scopeVersion.current++;
    submissions.current?.reset();
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
    setRetryingTurnId(undefined);
    setProgress(undefined);
    setBusy(false);
    sendLock.current = false;
    setMemory(undefined);
    setMemoryOpen(false);
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
    const current =
      sessionId === undefined
        ? undefined
        : submissions.current?.pendingFor(sessionId);
    if (!current || disabled || sendLock.current) return;
    sendLock.current = true;
    setBusy(true);
    setLoadingRun((current) => current + 1);
    const version = scopeVersion.current;
    const previousFailure = submissions.current?.failureFor(current.scope);
    try {
      const outcome = await submissions.current!.check(current.scope);
      if (
        !pageAlive.current ||
        version !== scopeVersion.current ||
        activeSession.current !== current.scope
      )
        return;
      if (outcome.type === "completed") {
        const turn = outcome.result;
        if (
          current.request.mode === mode &&
          JSON.stringify(current.request.input) ===
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
        await readHistory(current.scope);
        await refreshSessions(version);
        clearSubmissionFailure(current.scope);
      } else if (outcome.type === "failed") {
        setError("上次生成已确认失败，草稿保留；可以重新发送。");
      } else if (outcome.type === "running") {
        setError(
          "上次提交仍在处理，请稍后再确认；不会重复生成。",
        );
      } else if (outcome.type === "missing") {
        setError(
          failureMessage(
            outcome.error,
            "尚未找到上次提交，可用原请求重试发送。",
          ),
        );
      } else if (outcome.type === "error") {
        if (previousFailure?.error instanceof Error)
          setError(previousFailure.error.message);
        else problem(outcome.error);
      }
    } catch (value) {
      problem(value);
    } finally {
      if (pageAlive.current && version === scopeVersion.current) {
        setBusy(false);
        sendLock.current = false;
      }
    }
  }
  useEffect(() => {
    pageAlive.current = true;
    void boot();
    return () => {
      pageAlive.current = false;
      bootVersion.current++;
      historyVersion.current++;
      scopeVersion.current++;
      submissions.current?.reset();
      scrollRevision.current++;
    };
  }, []);

  useEffect(() => {
    inlineFormKeyboardActiveRef.current = inlineFormKeyboardActive;
  }, [inlineFormKeyboardActive]);

  useEffect(() => {
    if (!history.length && !pending) return;
    if (inlineFormKeyboardActiveRef.current) return;
    Taro.nextTick(() => {
      if (followLatest.current && !inlineFormKeyboardActiveRef.current)
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
  useDidHide(() => { pageHidden.current = true; setVisible(false); });
  useDidShow(() => {
    setVisible(true);
    if (pageHidden.current && !privacyDirty.current && age?.loggedIn && !age.allowed) {
      pageHidden.current = false;
      void api.getAge().then((nextAge) => { setAge(nextAge); setAgeOpen(!nextAge.allowed || !consentCurrent(privacy)); }, problem);
    } else pageHidden.current = false;
    if (privacyDirty.current) { privacyDirty.current = false; void boot(); }
    else if (age?.expiresAt && Date.parse(age.expiresAt) <= Date.now()) { setAge({ ...age, allowed: false, state: "expired" }); setAgeOpen(true); }
  });

  async function chooseImage(source?: ImageSource) {
    if (disabled || attachments.length >= 3) return;
    if (!consentCurrent(privacy) || !privacy?.consent?.sensitive) { void openPrivacy("authorization", "image-upload"); return; }
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
    ) {
      // ArtifactState treats a resolved callback as accepted. A form can race
      // with an age/privacy change or another send after its button rendered,
      // so unavailable form callbacks must reject instead of silently no-oping.
      if (formInput)
        throw new Error("表单当前无法提交，请确认页面仍可用后重试");
      return;
    }
    sendLock.current = true;
    followLatest.current = true;
    scrollRevision.current++;
    const draft = { text: text.trim(), images: attachments };
    const input = formInput || {
      text: draft.text,
      mediaIds: draft.images.map((item) => item.id),
    };
    setBusy(true);
    // A form submission is represented by its original expert card. Showing a
    // transient user bubble would repeat the server-generated summary before
    // acceptance is known.
    setPending(formInput ? undefined : draft);
    setProgress(undefined);
    if (!formInput) {
      setText("");
      setAttachments([]);
    }
    setError("");
    let id = sessionId;
    const operationVersion = scopeVersion.current;
    let savedMessage: string | undefined;
    let formFailure: Error | undefined;
    try {
      if (!id) {
        const session = await api.newSession();
        // Creating a session crosses the identity/page boundary. Never attach
        // the result to a reset identity (or an unmounted page), and never
        // start generation for that stale operation.
        if (!pageAlive.current || operationVersion !== scopeVersion.current) {
          if (formInput)
            throw new Error("表单提交已失效，请重新打开后确认");
          return;
        }
        id = session.id;
        rememberSelection(id);
        setSessions((rows) => [...rows, session]);
      }
      const outcome = await submissions.current!.submit(id, { mode, input });
      if (
        !pageAlive.current ||
        operationVersion !== scopeVersion.current ||
        activeSession.current !== id
      ) {
        if (formInput) {
          formFailure = new Error("表单提交已失效，请重新打开后确认");
          throw formFailure;
        }
        return;
      }
      if (outcome.type === "completed") {
        const result = outcome.result;
        savedMessage = outcome.recovered
          ? "已确认上次回复保存成功，无需再次发送。"
          : "回复已保存，记录暂时刷新失败，请稍后重新打开；无需再次发送。";
        // The controller has confirmed persistence; a later history-read
        // failure must not put the submitted draft back or suggest resending.
        setHistory((current) => [
          ...current.filter((row) => row.id !== result.id),
          result,
        ]);
        await readHistory(id);
        clearSubmissionFailure(id);
      } else if (outcome.type === "failed") {
        if (outcome.running)
          setError("上次提交仍在处理，请稍后再确认；不会重复生成。");
        else {
          problem(outcome.error);
          const failedSubmission = submissions.current?.pendingFor(id);
          if (failedSubmission && outcome.error !== undefined)
            rememberSubmissionFailure(
              id,
              failedSubmission.requestId,
              outcome.error,
            );
        }
        if (formInput)
          formFailure =
            outcome.running
              ? new Error("上次提交仍在处理，请稍后再确认；不会重复生成。")
              : outcome.error instanceof Error
                ? outcome.error
                : new Error("表单尚未确认提交，请稍后重试");
        if (!formInput) {
          setText(draft.text);
          setAttachments(draft.images);
        }
        if (id) await readHistory(id).catch(recoveryFailed);
      } else {
        const message =
          outcome.type === "busy"
            ? "已有提交正在处理，请稍后确认"
            : outcome.type === "stale"
              ? "提交作用域已变化，请重新打开后确认"
              : "尚未确认表单已保存，请稍后重试";
        setError(message);
        if (formInput) formFailure = new Error(message);
        if (!formInput) {
          setText(draft.text);
          setAttachments(draft.images);
        }
      }
    } catch (value) {
      const staleScope =
        !pageAlive.current ||
        operationVersion !== scopeVersion.current ||
        (id !== undefined && activeSession.current !== id);
      if (staleScope) {
        if (formInput)
          formFailure =
            value instanceof Error
              ? value
              : new Error("表单提交已失效，请重新打开后确认");
      } else {
        if (value instanceof api.IdentityExpiredError)
          setIdentityExpired(true);
        if (savedMessage) {
          setError(savedMessage);
        } else {
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
          if (id) await readHistory(id).catch(recoveryFailed);
        }
      }
    } finally {
      if (pageAlive.current && operationVersion === scopeVersion.current)
        await refreshSessions(operationVersion);
      if (pageAlive.current && operationVersion === scopeVersion.current) {
        setPending(undefined);
        setProgress(undefined);
        setBusy(false);
        sendLock.current = false;
      }
    }
    // A form's error must be visible inside its sheet, not behind the overlay.
    // Confirmed saves (including recovered responses) never become retry errors.
    if (formFailure) throw formFailure;
  }
  const { responses: formResponses, draftResponses } =
    formSubmissionStates(history);
  const activeSpecialist = activeSpecialistTurn(history);
  const interimPreamble = interimHandoffPreamble(history, progress);
  const historyById = new Map(history.map((row) => [row.id, row]));
  const visibleHistory = visibleRetryLineage(history);
  const visibleHistoryIds = new Set(visibleHistory.map((row) => row.id));
  const pendingAssistantMessage = (
    <View className="message assistant-message">
      <View className="message-main">
        <View className="bubble assistant-bubble thinking">
          {busy && interimPreamble && (
            <HandoffPreamble text={interimPreamble.text} />
          )}
          <DancingLoader />
          <LoadingCarousel
            progress={progress}
            resetKey={loadingRun}
          />
          {progress && (
            <LiveArtifacts messages={progress.messages} />
          )}
        </View>
      </View>
    </View>
  );
  const returnToAj = async (taskId: string) => {
    try {
      await send({
        text: "",
        mediaIds: [],
        action: { type: "return_to_coordinator", taskId },
      });
    } catch (value) {
      problem(value);
    }
  };
  async function resumeImage(row: Turn) {
    if (disabled || !sessionId) return;
    if (row.mode !== "platform") {
      setError("当前仅支持继续生成平台模式的图片，原有记录仍可查看"); return;
    }
    const version = scopeVersion.current;
    const scope = sessionId;
    setBusy(true); setError("");
    setLoadingRun((current) => current + 1);
    setProgress({ text: "", messages: [], step: "正在继续取图…" });
    try {
      await api.resumeImage(row.id, requestId(), undefined, (next) => {
        if (
          pageAlive.current &&
          version === scopeVersion.current &&
          activeSession.current === scope
        )
          setProgress(next);
      });
      if (
        pageAlive.current &&
        version === scopeVersion.current &&
        activeSession.current === scope
      )
        await readHistory(scope);
    } catch (value) {
      if (pageAlive.current && version === scopeVersion.current) {
        problem(value);
        await readHistory(scope).catch(() => undefined);
      }
    } finally {
      if (pageAlive.current && version === scopeVersion.current) {
        setProgress(undefined);
        setBusy(false);
      }
    }
  }
  async function retryFailedTurn(row: Turn) {
    const exhaustedHandoff = row.status === "completed" &&
      row.specialist?.handoff?.status === "failed";
    if (
      disabled ||
      historyFailed ||
      sendLock.current ||
      (row.status !== "failed" && !exhaustedHandoff) ||
      row.mode !== "platform" ||
      row.input.action ||
      (exhaustedHandoff && !!row.input.formResponse) ||
      imageGenerationBlocksRetry(row.imageGeneration) ||
      activeSession.current !== sessionId
    ) return;
    const version = scopeVersion.current;
    const scope = sessionId;
    if (!scope) return;
    sendLock.current = true;
    setRetryingTurnId(row.id);
    setBusy(true);
    setError("");
    setLoadingRun((current) => current + 1);
    try {
      const result = await api.retryTurn(row.id);
      if (
        !pageAlive.current ||
        version !== scopeVersion.current ||
        activeSession.current !== scope
      ) return;
      setHistory((current) => [
        ...current.filter((item) => item.id !== result.id),
        result,
      ]);
      await readHistory(scope);
      await refreshSessions(version);
    } catch (value) {
      if (
        pageAlive.current &&
        version === scopeVersion.current &&
        activeSession.current === scope
      ) {
        problem(value);
        await readHistory(scope).catch(recoveryFailed);
      }
    } finally {
      if (pageAlive.current && version === scopeVersion.current) {
        setRetryingTurnId(undefined);
        setBusy(false);
        sendLock.current = false;
      }
    }
  }
  async function submitForm(event: ClientEvent) {
    if (!consentCurrent(privacy) || !privacy?.consent?.sensitive) { void openPrivacy("authorization"); throw new Error("请先单独同意情绪练习的敏感信息处理"); }
    const match = event.action.surfaceId.match(/^turn_(\d+)_(.+)$/);
    if (!match) throw new Error("表单来源无效");
    const source = history.find((row) => row.id === Number(match[1]));
    const specialistFormState = source
      ? specialistFormStateForTurn(history, source)
      : undefined;
    if (specialistFormState === "replaced")
      throw new Error("专家已发送更新的表单，请填写最新一份");
    if (specialistFormState === "expired")
      throw new Error("专家任务已结束，该表单不能再提交");
    await send({
      text: "提交练习表单",
      mediaIds: [],
      formResponse: {
        turnId: Number(match[1]),
        artifactId: match[2],
        values: event.action.context.values,
        presentation: event.action.context.form,
      },
    });
  }

  async function openSettings() {
    if (busy || uploading || memoryBusy || sendLock.current || settingsNavigation.current) return;
    settingsNavigation.current = true;
    setNavigationOpen(false);
    try {
      await Taro.navigateTo({ url: "/pages/settings/index" });
    } catch (value) {
      problem(value);
    } finally {
      settingsNavigation.current = false;
    }
  }
  return (
    <View
      className={h5 ? "h5-shell" : `native-shell${inlineFormKeyboardActive ? " is-form-keyboard-open" : ""}`}
    >
      <InteractionGuard enabled={visible && !loading && !!age?.allowed && consentCurrent(privacy)} revision={history.length} onUnavailable={() => { void api.getAge().then((s) => { setAge(s); if (!s.allowed) setAgeOpen(true); }).catch(() => {}); }} />
      <InlineFormKeyboardContext.Provider
        value={h5 ? null : inlineFormKeyboardHandlers}
      >
        <View className="chat-app">
        <ChatNavigation
          profile={profile}
          avatarSource={avatarSource}
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
            {visibleHistory.map((row) => (
              <View className="turn" key={row.id}>
                {!isFormOnlyInput(row.input) &&
                  retryUserMessageVisible(row, historyById, visibleHistoryIds) && (
                  <View className="message user-message">
                    <View className="user-message-main">
                      <View className="bubble user-bubble">
                        {(row.input.text || row.input.action) && (
                          <MessageText>{row.input.action ? "回到阿 J" : row.input.text}</MessageText>
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
                )}
                {row.status === "running" && row.retryOfTurnId !== undefined ? (
                  pendingAssistantMessage
                ) : retryingTurnId === row.id && row.status === "failed" ? (
                  pendingAssistantMessage
                ) : (
                  <>
                {row.specialist?.handoff?.status === "failed" && (
                  <View className="handoff-failure-notice" role="status">
                    <Text>{row.status === "completed"
                      ? `与${row.specialist.name}的本轮交接未完成，这条回复由阿 J 继续回应。`
                      : `与${row.specialist.name}的本轮交接未完成，本轮没有生成回复。`}</Text>
                  </View>
                )}
                <View className="message assistant-message">
                  <View className="message-main">
                    <View
                      data-ai-external={row.mode === "external" ? "true" : "false"}
                      className={`bubble assistant-bubble ${row.status === "failed" ? "failed-bubble" : ""}`}
                    >
                      {(() => {
                        const origin = specialistPresentationForTurn(row);
                        const specialistFormState = specialistFormStateForTurn(history, row);
                        const specialistFormStatus =
                          specialistFormState === "replaced"
                            ? "已有更新的表单，请填写最新一份"
                            : specialistFormState === "expired"
                              ? "专家任务已结束，此表单已失效"
                              : undefined;
                        const turnContent = (
                          <>
                            {!(row.status === "failed" && row.specialist?.handoff?.status === "failed") && <MessageText aiGenerated={row.status === "completed"} external={row.mode === "external"}>
                              {row.status === "completed"
                                ? row.aJoker
                                : row.status === "failed"
                                  ? row.error || "这一次没有完成，请查看下方提示。"
                                  : "这一轮尚未完成，请先确认上次发送；若长时间未完成，请联系开发者。"}
                            </MessageText>}
                            {row.status === "completed" && (
                              <Artifacts
                                external={row.mode === "external"}
                                turnId={row.id}
                                artifacts={row.artifacts}
                                origin={origin}
                                showOrigin={false}
                                responses={formResponses}
                                draftResponses={draftResponses}
                                disabled={
                                  !formReady ||
                                  (specialistFormState !== undefined &&
                                    specialistFormState !== "current")
                                }
                                disabledStatus={specialistFormStatus}
                                onAction={submitForm}
                              />
                            )}
                            {row.status === "completed" &&
                              (row.association || origin) && (
                                <EvidenceCard turn={row} origin={origin} />
                              )}
                          </>
                        );
                        const canReturn = activeSpecialist?.id === row.id;
                        if (!origin) {
                          return row.handoffPreamble
                            ? (
                              <>
                                <HandoffPreamble text={row.handoffPreamble} />
                                {turnContent}
                              </>
                            )
                            : turnContent;
                        }
                        const firstHandoff = !history
                          .slice(0, history.findIndex((item) => item.id === row.id))
                          .some((previous) => specialistPresentationForTurn(previous)?.id === origin.id);
                        return (
                          <>
                            {row.handoffPreamble && (
                              <HandoffPreamble text={row.handoffPreamble} />
                            )}
                            {firstHandoff && (
                              <Text className="specialist-handoff-notice">
                                阿 J 已把这段对话交给这位 AI 专家，以下是 AI
                                专家的直接回复
                              </Text>
                            )}
                            <PresentationFrame
                              origin={origin}
                              avatarSource={resolveExpertAvatarSource(
                                origin.avatar?.reference,
                              )}
                              exitLabel={canReturn ? "回到阿 J" : undefined}
                              exitDisabled={!formReady || busy}
                              onExit={
                                canReturn
                                  ? () => void returnToAj(origin.id)
                                  : undefined
                              }
                              showSources={false}
                            >
                              {turnContent}
                            </PresentationFrame>
                          </>
                        );
                      })()}
                    </View>
                    <View className="message-footer">
                      <View className="message-actions">
                        {(row.status === "failed" ||
                          (row.status === "completed" && row.specialist?.handoff?.status === "failed" && !row.input.formResponse)) &&
                          row.mode === "platform" &&
                          !row.input.action &&
                          !imageGenerationBlocksRetry(row.imageGeneration) &&
                          retryingTurnId !== row.id &&
                          !history.some((candidate) =>
                            candidate.retryOfTurnId === row.id
                          ) && (
                            <Button
                              className="control message-action"
                              aria-label="重试这一轮"
                              onLongPress={() => void Taro.showToast({ title: "重试这一轮", icon: "none" })}
                              disabled={disabled || historyFailed}
                              onClick={() => void retryFailedTurn(row)}
                            >
                              <ChatIcon name="rotateCw" />
                            </Button>
                          )}
                        {row.imageGeneration?.canResume && <Button className="control message-action" disabled={disabled} onClick={() => void resumeImage(row)}>继续取图</Button>}
                        {row.status === "completed" && row.aJoker && (
                          <CopyMessage
                            external={row.mode === "external"}
                            value={row.aJoker}
                            label={specialistPresentationForTurn(row) ? "复制 AI 专家的回复" : "复制阿 J 先生的回复"}
                          />
                        )}
                        <Button
                          className="control message-action"
                          aria-label="举报或反馈这条回复"
                          onLongPress={() => void Taro.showToast({ title: "举报或反馈", icon: "none" })}
                          onClick={() => void openHelp(row.id)}
                        >
                          <ChatIcon name="flag" />
                        </Button>
                      </View>
                      <Text className="message-meta">
                        {row.status === "completed"
                          ? "AI 生成 · 已保存"
                          : "这一轮尚未完成"}
                      </Text>
                    </View>
                  </View>
                </View>
                  </>
                )}
                {retryingTurnId === row.id &&
                  row.status === "completed" &&
                  !history.some((candidate) =>
                    candidate.retryOfTurnId === row.id
                  )
                  ? pendingAssistantMessage
                  : null}
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
                {pendingAssistantMessage}
              </View>
            )}
            {busy && !pending && progress && (
              <View className="message assistant-message">
                <View className="message-main">
                  <View className="bubble assistant-bubble thinking">
                    {interimPreamble && (
                      <HandoffPreamble text={interimPreamble.text} />
                    )}
                    <LoadingCarousel progress={progress} resetKey={loadingRun} />
                  </View>
                </View>
              </View>
            )}
            <View id="chat-end" className="chat-end" />
          </View>
        </View>
        <ChatDock
          active={inputMode === "keyboard" && composerKeyboardActive}
          keyboardHeight={composerKeyboardHeight}
          onOverlayChange={setComposerFloating}
        >
          {error && (
            <View className="error-banner">
              <Text>
                {identityExpired ? api.IDENTITY_EXPIRED_MESSAGE : error}
              </Text>
              {!identityExpired &&
                sessionId !== undefined &&
                submissions.current?.hasPending(sessionId) && (
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
            {mode === "platform" &&
              settings &&
              !settings.platformConfigured && !age?.configuration.previewOnly && (
                <Text className="config-warning">
                  对话服务暂不可用，请稍后重试。
                </Text>
              )}
              <ChatComposer
                inputMode={inputMode}
                text={text}
                attachments={attachments}
                disabled={disabled || historyFailed || navigationOpen}
                inputFixed={composerFloating}
                onKeyboardFocusChange={handleComposerKeyboardFocus}
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
            {!loading && !age?.allowed && <Button className="age-resume" onClick={() => setAgeOpen(true)}>{age?.configuration.previewOnly ? "继续体验" : "继续登录与年龄确认"}</Button>}
            {(age?.configuration.previewOnly || (!loading && !consentCurrent(privacy))) && (
              <Text className="composer-footnote">
                {age?.configuration.previewOnly
                  ? "本次预览体验登录与年龄确认，暂不开放聊天"
                  : "使用前请在设置 → 隐私与数据中确认授权"}
              </Text>
            )}
          </View>
        </ChatDock>
        <View
          aria-hidden
          className="form-keyboard-space"
          style={{
            height: inlineFormKeyboardActive
              ? `${inlineFormKeyboardOverlay + 24}px`
              : "0px",
          }}
        />
        {memoryOpen && (
          <MemoryPanel
            platformConfigured={!!settings?.platformConfigured}
            sessionId={sessionId}
            memory={memory}
            mode={mode}
            apiKey=""
            onKeyUsed={() => {}}
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
      </InlineFormKeyboardContext.Provider>
      {(ageOpen || !age?.loggedIn) && !identityExpired && <AgeGate profile={profile} avatarSource={avatarSource} status={age} loadingError={error} privacyReady={consentCurrent(privacy)} onChange={setAge}
        onRefresh={boot} onLogin={async () => { clearIdentityView(); await boot(); }}
        onPrivacy={() => void openPrivacy(age?.allowed && !consentCurrent(privacy) ? "authorization" : undefined)}
        onHelp={() => void openHelp(undefined, "age_verification")} onClose={() => setAgeOpen(false)} />}
    </View>
  );
}
