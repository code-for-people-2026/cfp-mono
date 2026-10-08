import { useEffect, useRef, useState } from "react";
import {
  Button as TaroButton,
  type ButtonProps,
  Image,
  Input as TextInput,
  ScrollView,
  Text,
  View,
} from "@tarojs/components";
import Taro from "@tarojs/taro";
import * as api from "../../chat/api";
import { MemoryMeter, MemoryPanel } from "../../chat/memory";
import { ChatComposer, type ImageSource } from "../../chat/composer";
import mascot from "../../assets/aj-mascot.png";
import {
  canSend,
  modes,
  requestId,
  type Attachment,
  type Mode,
  type Settings,
  type Turn,
  type MemoryStatus,
  type Input,
} from "../../chat/model";

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
type Panel = "modes" | "connection" | null;
const suggestions = [
  "窗台上的小番茄红了",
  "明天要开始一份新工作",
  "最近有些累，想慢一点",
];

export default function Chat() {
  const [settings, setSettings] = useState<Settings>();
  const [memory, setMemory] = useState<MemoryStatus>();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [sessionId, setSessionId] = useState<number>();
  const [history, setHistory] = useState<Turn[]>([]);
  const [images, setImages] = useState<Record<number, string | null>>({});
  const [text, setText] = useState("");
  const [inputMode, setInputMode] = useState<"voice" | "keyboard">("voice");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mode, setMode] = useState<Mode>("platform");
  const [apiKey, setApiKey] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [identityExpired, setIdentityExpired] = useState(false);
  const [pending, setPending] = useState<{
    text: string;
    images: Attachment[];
  }>();
  const [expanded, setExpanded] = useState<number[]>([]);
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [anchor, setAnchor] = useState(0);
  const historyVersion = useRef(0);
  const sendLock = useRef(false);
  // 只保留待确认提交的业务标识，不保留 BYOK 密钥。网络错误不代表服务端没有保存。
  const submission = useRef<{
    sessionId: number;
    requestId: string;
    mode: Exclude<Mode, "external">;
    input: Input;
  }>();
  const disabled =
    busy || uploading || loading || memoryBusy || identityExpired;
  const ready = canSend(
    text,
    attachments,
    mode,
    apiKey,
    !!settings?.platformConfigured,
    disabled || memory?.level === "empty",
  );
  const endpoint = `${settings?.origin || HELLO_API_ORIGIN}/api/mcp`;

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
  async function boot() {
    setLoading(true);
    setError("");
    try {
      await api.establishIdentity();
      const [config, rows] = await Promise.all([
        api.getSettings(),
        api.getSessions(),
      ]);
      setSettings(config);
      if (rows.length) {
        const latest = rows[rows.length - 1];
        setSessionId(latest.id);
        await readHistory(latest.id);
      }
    } catch (value) {
      problem(value);
    } finally {
      setLoading(false);
    }
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
      // 防止旧身份的图片异步结果混入新页面。
      historyVersion.current++;
      submission.current = undefined;
      setSessionId(undefined);
      setSettings(undefined);
      setHistory([]);
      setImages({});
      setText("");
      setInputMode("voice");
      setAttachments([]);
      setPending(undefined);
      setMemory(undefined);
      setMemoryOpen(false);
      setPanel(null);
      setToken("");
      setApiKey("");
      setIdentityExpired(false);
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
      historyVersion.current++;
    };
  }, []);
  useEffect(() => {
    // 消息和输入区先完成布局，再更新滚动锚点，避免末条回复被输入框遮住。
    Taro.nextTick(() => setAnchor((value) => value + 1));
  }, [history, pending, attachments]);

  async function chooseImage(source?: ImageSource) {
    if (disabled || attachments.length >= 3) return;
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
  async function send() {
    if (!ready || mode === "external" || sendLock.current) return;
    sendLock.current = true;
    const draft = { text: text.trim(), images: attachments };
    const input = {
      text: draft.text,
      mediaIds: draft.images.map((item) => item.id),
    };
    const key = apiKey;
    setApiKey("");
    setBusy(true);
    setPending(draft);
    setText("");
    setAttachments([]);
    setError("");
    let id = sessionId;
    let saved = false;
    try {
      if (!id) {
        const session = await api.newSession();
        id = session.id;
        setSessionId(id);
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
      result ||= await api.generate(id, current.requestId, mode, input, key);
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
          setText(draft.text);
          setAttachments(draft.images);
        }
        if (id) await readHistory(id).catch(recoveryFailed);
      }
    } finally {
      setPending(undefined);
      setBusy(false);
      sendLock.current = false;
      setAnchor((value) => value + 1);
    }
  }
  function closePanel() {
    if (!tokenBusy) {
      setPanel(null);
      setToken("");
    }
  }
  function selectMode(value: Mode) {
    setMode(value);
    setApiKey("");
    setError("");
    setToken("");
    setPanel(value === "external" ? "connection" : null);
  }
  async function connectAgent() {
    setTokenBusy(true);
    try {
      setToken((await api.mintMcpToken()).token);
    } catch (value) {
      problem(value);
    } finally {
      setTokenBusy(false);
    }
  }
  async function revoke() {
    setTokenBusy(true);
    try {
      await api.revokeMcpTokens();
      setToken("");
      await Taro.showToast({ title: "连接令牌已撤销", icon: "none" });
    } catch (value) {
      problem(value);
    } finally {
      setTokenBusy(false);
    }
  }

  return (
    <View className={h5 ? "h5-shell" : "native-shell"}>
      <View className="chat-app">
        <View className="chat-header">
          <View className="identity">
            <Image
              className="avatar hero-avatar"
              src={mascot}
              mode="aspectFill"
            />
            <View>
              <Text className="agent-name">好人阿 J</Text>
              <Text className="agent-status">AI 乐观搭子</Text>
            </View>
          </View>
          <View className="header-actions">
            <Button
              className={`icon-button memory-shortcut ${memory?.level === "empty" ? "memory-alert" : ""}`}
              ariaLabel="查看阿 J 的记忆"
              disabled={disabled}
              onClick={() => setMemoryOpen(true)}
            >
              ♥{memory?.level === "empty" ? " 满了" : ""}
            </Button>
            <Button
              className="icon-button"
              disabled={disabled}
              onClick={() => setPanel("modes")}
            >
              设置
            </Button>
          </View>
        </View>
        <ScrollView
          className="conversation"
          scrollY
          scrollWithAnimation
          scrollIntoViewAlignment="end"
          scrollIntoView={
            history.length || pending ? `chat-end-${anchor}` : undefined
          }
        >
          <View className="chat-content">
            {!history.length && !pending && (
              <View className="welcome-home">
                <View className="mascot-halo">
                  <Image
                    className="welcome-mascot"
                    src={mascot}
                    mode="aspectFit"
                    ariaLabel="挥手打招呼的阿 J"
                  />
                </View>
                <Text className="welcome-title">嗨，我是阿 J。</Text>
                <View className="welcome-copy">
                  <Text>从鲁迅笔下的阿 Q 先生那儿，“蒸馏”来一点乐观。</Text>
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
              <Text className="loading-note">阿 J 正在翻看我们聊过的日常…</Text>
            )}
            {history.map((row) => (
              <View className="turn" key={row.id}>
                <View className="message user-message">
                  <View className="bubble user-bubble">
                    {row.input.text && <Text>{row.input.text}</Text>}
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
                <View className="message assistant-message">
                  <Image
                    className="avatar small-avatar"
                    src={mascot}
                    mode="aspectFill"
                  />
                  <View className="message-main">
                    <View
                      className={`bubble assistant-bubble ${row.status === "failed" ? "failed-bubble" : ""}`}
                    >
                      <Text>
                        {row.status === "completed"
                          ? row.greeting
                          : row.status === "failed"
                            ? "这一次没有生成成功。检查连接或密钥后，可以重新发给我。"
                            : "这一轮尚未完成，请先确认上次发送；若长时间未完成，请联系开发者。"}
                      </Text>
                      {row.status === "completed" && row.association && (
                        <View className="association">
                          <Button
                            className="association-toggle"
                            onClick={() =>
                              setExpanded((ids) =>
                                ids.includes(row.id)
                                  ? ids.filter((id) => id !== row.id)
                                  : [...ids, row.id],
                              )
                            }
                          >
                            {expanded.includes(row.id)
                              ? "收起联想依据 −"
                              : "看看为什么这样说 ＋"}
                          </Button>
                          {expanded.includes(row.id) && (
                            <Text className="association-text">
                              {row.association}
                              {"\n"}
                              {
                                modes.find((item) => item.id === row.mode)
                                  ?.label
                              }
                              {row.mode === "external"
                                ? " · 来源由客户端声明"
                                : ` · ${row.model}`}
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                    <Text className="message-meta">
                      {row.status === "completed"
                        ? "AI 生成 · 已保存"
                        : "这一轮尚未完成"}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
            {pending && (
              <View className="turn">
                <View className="message user-message">
                  <View className="bubble user-bubble">
                    {pending.text && <Text>{pending.text}</Text>}
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
                      <Text>阿 J 正在换个角度想…</Text>
                    </View>
                  </View>
                </View>
              </View>
            )}
            <View id={`chat-end-${anchor}`} className="chat-end" />
          </View>
        </ScrollView>
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
              !settings && (
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
          {mode === "platform" && settings && !settings.platformConfigured && (
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
                  onClick={() => setPanel("connection")}
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
              disabled={disabled}
              voiceDisabled={
                disabled || memory?.level === "empty" || !!panel || memoryOpen
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
              onSend={send}
            />
          )}
          <Text className="composer-footnote">
            {mode === "external"
              ? "对话仍留在这里 · 支持撤销连接"
              : "阿 J 是 AI，好意不是对未来的保证"}
          </Text>
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
        {panel && (
          <View className="sheet-overlay">
            <View className="sheet-backdrop" onClick={closePanel} />
            <View className="sheet">
              <View className="sheet-handle" />
              <View className="sheet-heading">
                <Text>
                  {panel === "modes" ? "阿 J 的设置" : "连接你自己的 Agent"}
                </Text>
                <Button
                  className="icon-button"
                  disabled={tokenBusy}
                  onClick={closePanel}
                >
                  关闭
                </Button>
              </View>
              {panel === "modes" && (
                <>
                  <MemoryMeter
                    memory={memory}
                    disabled={disabled}
                    onOpen={() => {
                      setPanel(null);
                      setMemoryOpen(true);
                    }}
                  />
                  <Text className="sheet-description">
                    a jOKer · 换一种连接方式，接着聊，不用重新开始。
                  </Text>
                  <Text className="sheet-note">
                    当前模型：
                    {mode === "external"
                      ? "由你自己的 Agent 选择"
                      : settings?.model || "连接中"}
                  </Text>
                  {modes.map((item) => (
                    <Button
                      key={item.id}
                      className={`mode-option ${mode === item.id ? "selected" : ""}`}
                      onClick={() => selectMode(item.id)}
                    >
                      <View className="option-icon">{item.icon}</View>
                      <View className="option-copy">
                        <Text className="option-label">{item.label}</Text>
                        <Text className="option-detail">{item.detail}</Text>
                      </View>
                      <Text>{mode === item.id ? "✓" : ""}</Text>
                    </Button>
                  ))}
                  <Text className="sheet-note">
                    当前内置 BYOK 接入 DeepSeek；其他平台尚未开放。外部 Agent
                    可使用自己的模型。
                  </Text>
                  <Text className="sheet-note">
                    {h5
                      ? "此浏览器以访客 Cookie 保存身份。清除 Cookie 会失去访问，不是正式账号。"
                      : "当前为本机访客身份，不是微信登录。清除小程序缓存或凭证过期后，不能自动找回。"}
                  </Text>
                  <Button className="quiet-button" onClick={api.openCms}>
                    {h5 ? "打开 Payload 管理后台 ↗" : "复制管理后台地址"}
                  </Button>
                </>
              )}
              {panel === "connection" && (
                <>
                  <Text className="sheet-description">
                    你的客户端运行 Agent、支付模型费用，通过 MCP
                    将回复保存到这里。让它先读取 hello_greeting
                    指引，自动接着最近的记录聊。
                  </Text>
                  <Text className="endpoint-label">MCP 地址</Text>
                  <Text className="endpoint" selectable>
                    {endpoint}
                  </Text>
                  {token ? (
                    <>
                      <Text className="token-ready">
                        ✓ 令牌已生成 · 七天有效，仅此刻可复制
                      </Text>
                      <Button
                        className="primary-button full-button"
                        onClick={() =>
                          api.copy(
                            JSON.stringify(
                              {
                                mcpServers: {
                                  "hello-agent": {
                                    url: endpoint,
                                    headers: {
                                      Authorization: `Bearer ${token}`,
                                    },
                                  },
                                },
                              },
                              null,
                              2,
                            ),
                          )
                        }
                      >
                        复制 MCP 连接配置
                      </Button>
                    </>
                  ) : (
                    <Button
                      className="primary-button full-button"
                      disabled={tokenBusy}
                      onClick={connectAgent}
                    >
                      {tokenBusy ? "正在处理…" : "生成专用连接令牌"}
                    </Button>
                  )}
                  <Button
                    className="quiet-button full-button"
                    disabled={tokenBusy}
                    onClick={revoke}
                  >
                    撤销我的全部 MCP 令牌
                  </Button>
                  <Text className="sheet-note">
                    本机地址只能由能访问此电脑的客户端连接。关闭面板会清除页面中的令牌；不会自动撤销已授权连接。
                  </Text>
                </>
              )}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
