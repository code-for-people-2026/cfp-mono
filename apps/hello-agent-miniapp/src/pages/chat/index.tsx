import { useEffect, useRef, useState } from "react";
import {
  Button as TaroButton,
  type ButtonProps,
  Image,
  Input as TextInput,
  ScrollView,
  Text,
  Textarea,
  View,
} from "@tarojs/components";
import Taro from "@tarojs/taro";
import * as api from "../../chat/api";
import { MemoryMeter, MemoryPanel } from "../../chat/memory";
import {
  canSend,
  modes,
  requestId,
  type Attachment,
  type Mode,
  type Settings,
  type Turn,
  type MemoryStatus,
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
const suggestions = [
  "窗台上的小番茄红了",
  "明天要开始一份新工作",
  "最近有些累，想慢一点",
];
type Panel = "modes" | "connection" | null;

export default function Chat() {
  const [settings, setSettings] = useState<Settings>();
  const [memory, setMemory] = useState<MemoryStatus>();
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [sessionId, setSessionId] = useState<number>();
  const [history, setHistory] = useState<Turn[]>([]);
  const [images, setImages] = useState<Record<number, string>>({});
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [mode, setMode] = useState<Mode>("platform");
  const [apiKey, setApiKey] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{
    text: string;
    images: Attachment[];
  }>();
  const [expanded, setExpanded] = useState<number[]>([]);
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const [anchor, setAnchor] = useState(0);
  const historyVersion = useRef(0);
  const currentMode = modes.find((entry) => entry.id === mode)!;
  const disabled = busy || uploading || loading || memoryBusy;
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
    setError(
      value instanceof Error ? value.message : "暂时没有完成，请稍后重试",
    );
  }
  async function readHistory(id: number) {
    const version = ++historyVersion.current;
    const [rows, nextMemory] = await Promise.all([
      api.getHistory(id),
      api.getMemory(id),
    ]);
    const media = [...new Set(rows.flatMap((row) => row.input.mediaIds))];
    const entries = await Promise.all(
      media.map(
        async (mediaId) => [mediaId, await api.imageSource(mediaId)] as const,
      ),
    );
    if (version !== historyVersion.current) return;
    setHistory(rows);
    setMemory(nextMemory);
    setImages(Object.fromEntries(entries));
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
  useEffect(() => {
    void boot();
  }, []);
  useEffect(() => {
    // 消息和输入区先完成布局，再更新滚动锚点，避免末条回复被输入框遮住。
    Taro.nextTick(() => setAnchor((value) => value + 1));
  }, [history, pending, attachments]);

  async function chooseImage() {
    if (attachments.length >= 3) return;
    setUploading(true);
    setError("");
    try {
      const image = await api.addImage();
      setAttachments((items) => [...items, image]);
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
    if (!ready) return;
    const draft = { text: text.trim(), images: attachments };
    const key = apiKey;
    setApiKey("");
    setBusy(true);
    setPending(draft);
    setText("");
    setAttachments([]);
    setError("");
    let id = sessionId;
    try {
      if (!id) {
        const session = await api.newSession();
        id = session.id;
        setSessionId(id);
      }
      await api.generate(
        id,
        requestId(),
        mode,
        { text: draft.text, mediaIds: draft.images.map((item) => item.id) },
        key,
      );
      await readHistory(id);
    } catch (value) {
      problem(value);
      setText(draft.text);
      setAttachments(draft.images);
      if (id) await readHistory(id).catch(() => undefined);
    } finally {
      setPending(undefined);
      setBusy(false);
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
            <View className="avatar hero-avatar">J</View>
            <View>
              <Text className="agent-name">好人阿 J</Text>
              <Text className="agent-status">
                <Text className="online-dot">●</Text> a jOKer · 往好处想一点
              </Text>
            </View>
          </View>
          <View className="header-actions">
            <Button
              className="icon-button"
              disabled={disabled}
              onClick={() => setPanel("modes")}
            >
              设置
            </Button>
          </View>
        </View>
        <MemoryMeter
          memory={memory}
          disabled={disabled}
          onOpen={() => setMemoryOpen(true)}
        />
        <ScrollView
          className="conversation"
          scrollY
          scrollWithAnimation
          scrollIntoViewAlignment="end"
          scrollIntoView={`chat-end-${anchor}`}
        >
          <View className="chat-content">
            <Text className="date-divider">
              不必事事顺利，也能给自己一点好意
            </Text>
            <View className="message assistant-message">
              <View className="avatar small-avatar">✦</View>
              <View className="message-main">
                <View className="bubble assistant-bubble">
                  <Text className="welcome-title">
                    我是阿J，你的 AI 乐观搭子。
                  </Text>
                  <Text>
                    顺心的事，咱们乐一乐；不顺的事，也不急着硬夸。发句话或一张照片，我陪你换个角度，再讨一句好彩头。
                  </Text>
                </View>
                <Text className="message-meta">好意，不是对未来的保证</Text>
              </View>
            </View>
            {!history.length && !pending && (
              <View className="suggestions">
                <Text className="suggestion-caption">不如从这里开始</Text>
                {suggestions.map((item, index) => (
                  <Button
                    key={item}
                    className="suggestion"
                    disabled={disabled}
                    onClick={() => setText(item)}
                  >
                    <Text>
                      {["🌱", "☀", "☕"][index]} {item}
                    </Text>
                    <Text className="suggestion-arrow">↗</Text>
                  </Button>
                ))}
              </View>
            )}
            {loading && (
              <Text className="loading-note">阿J正在翻看我们聊过的日常…</Text>
            )}
            {history.map((row) => (
              <View className="turn" key={row.id}>
                <View className="message user-message">
                  <View className="bubble user-bubble">
                    {row.input.text && <Text>{row.input.text}</Text>}
                    {row.input.mediaIds.length > 0 && (
                      <View className="bubble-images">
                        {row.input.mediaIds.map(
                          (id) =>
                            images[id] && (
                              <Image
                                key={id}
                                className="message-image"
                                src={images[id]}
                                mode="aspectFill"
                                onClick={() =>
                                  Taro.previewImage({
                                    urls: row.input.mediaIds
                                      .map((value) => images[value])
                                      .filter(Boolean),
                                    current: images[id],
                                  })
                                }
                              />
                            ),
                        )}
                      </View>
                    )}
                  </View>
                </View>
                <View className="message assistant-message">
                  <View className="avatar small-avatar">✦</View>
                  <View className="message-main">
                    <View
                      className={`bubble assistant-bubble ${row.status === "failed" ? "failed-bubble" : ""}`}
                    >
                      <Text>
                        {row.status === "completed"
                          ? row.greeting
                          : row.status === "failed"
                            ? "这一次没有生成成功。检查连接或密钥后，可以重新发给我。"
                            : "这一轮还没有完成；若服务曾中断，请重新发送。"}
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
                            </Text>
                          )}
                        </View>
                      )}
                    </View>
                    <Text className="message-meta">
                      {row.status === "completed"
                        ? "✓ 已保存到 CMS"
                        : "未生成产物"}{" "}
                      · {modes.find((item) => item.id === row.mode)?.label}
                      {row.mode === "external"
                        ? " · 来源由客户端声明"
                        : ` · ${row.model}`}
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
                  <View className="avatar small-avatar">✦</View>
                  <View className="message-main">
                    <View className="bubble assistant-bubble thinking">
                      <Text className="thinking-dots">● ● ●</Text>
                      <Text>阿J正在换个角度想…</Text>
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
            <Text>{error}</Text>
            {!settings && (
              <Button className="text-button" onClick={boot}>
                重试
              </Button>
            )}
          </View>
        )}
        <View className="composer-area">
          <View className="composer-toolbar">
            <Button
              className="mode-chip"
              disabled={disabled}
              onClick={() => setPanel("modes")}
            >
              <Text>
                {currentMode.icon} {currentMode.label} ⌄
              </Text>
            </Button>
            <Text className="model-note">
              {mode === "external"
                ? "模型由你选择"
                : settings?.model || "连接中"}
            </Text>
          </View>
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
            <>
              {attachments.length > 0 && (
                <View className="attachments">
                  {attachments.map((item) => (
                    <View className="attachment" key={item.id}>
                      <Image
                        src={item.src}
                        className="attachment-image"
                        mode="aspectFill"
                      />
                      <Button
                        className="remove-image"
                        disabled={busy}
                        onClick={() =>
                          setAttachments((items) =>
                            items.filter((image) => image.id !== item.id),
                          )
                        }
                      >
                        ×
                      </Button>
                    </View>
                  ))}
                </View>
              )}
              <View className="composer">
                <Button
                  className="attach-button"
                  disabled={disabled || attachments.length >= 3}
                  onClick={chooseImage}
                >
                  {uploading ? "…" : "＋"}
                </Button>
                <Textarea
                  className="text-input"
                  value={text}
                  onInput={(event) => setText(event.detail.value)}
                  placeholder="说点什么，或发一张照片…"
                  maxlength={4000}
                  autoHeight
                  disabled={disabled}
                />
                <Button
                  className="send-button"
                  disabled={!ready}
                  onClick={send}
                >
                  {busy ? "…" : "发送 ↑"}
                </Button>
              </View>
            </>
          )}
          <Text className="composer-footnote">
            {mode === "external"
              ? "对话仍留在这里 · 支持撤销连接"
              : "文字 / 图片 · 最多 3 张 · 真实模型生成"}
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
          />
        )}
        {panel && (
          <View className="sheet-overlay">
            <View className="sheet-backdrop" onClick={closePanel} />
            <View className="sheet">
              <View className="sheet-handle" />
              <View className="sheet-heading">
                <Text>
                  {panel === "modes" ? "阿J的设置" : "连接你自己的 Agent"}
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
                  <Text className="sheet-description">
                    换一种连接方式，接着聊，不用重新开始。
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
