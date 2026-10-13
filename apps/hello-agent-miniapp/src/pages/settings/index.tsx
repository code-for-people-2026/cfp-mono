import { useEffect, useRef, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import Taro, { useDidHide, useDidShow } from "@tarojs/taro";
import * as api from "../../chat/api";
import { modes, type Mode, type Settings } from "../../chat/model";
import { selectChatMode, useChatMode } from "../../chat/preferences";
import { ChatIcon } from "../../chat/icon";

const h5 = process.env.TARO_ENV === "h5";
export default function SettingsPage() {
  const mode = useChatMode();
  const [settings, setSettings] = useState<Settings>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [token, setToken] = useState("");
  const [tokenBusy, setTokenBusy] = useState(false);
  const visible = useRef(true);
  const tokenVersion = useRef(0);
  const tokenLock = useRef(false);
  const endpoint = `${settings?.origin || HELLO_API_ORIGIN}/api/mcp`;
  const clearToken = () => {
    visible.current = false;
    tokenVersion.current++;
    setToken("");
  };
  useDidHide(clearToken);
  useDidShow(() => {
    visible.current = true;
  });
  useEffect(() => {
    let active = true;
    void api
      .establishIdentity()
      .then(api.getSettings)
      .then((config) => {
        if (active) setSettings(config);
      })
      .catch((value) => {
        if (active) problem(value);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      visible.current = false;
      tokenVersion.current++;
    };
  }, []);
  function problem(value: unknown) {
    setError(
      value instanceof Error ? value.message : "暂时没有完成，请稍后重试",
    );
  }
  function selectMode(value: Mode) {
    if (loading || tokenLock.current) return;
    selectChatMode(value);
    tokenVersion.current++;
    setToken("");
    setError("");
  }
  async function connectAgent() {
    if (loading || tokenLock.current) return;
    tokenLock.current = true;
    setTokenBusy(true);
    setError("");
    const version = ++tokenVersion.current;
    try {
      const result = await api.mintMcpToken();
      if (visible.current && version === tokenVersion.current)
        setToken(result.token);
    } catch (value) {
      if (visible.current && version === tokenVersion.current) problem(value);
    } finally {
      tokenLock.current = false;
      setTokenBusy(false);
    }
  }
  async function revoke() {
    if (loading || tokenLock.current) return;
    tokenLock.current = true;
    setTokenBusy(true);
    setError("");
    try {
      await api.revokeMcpTokens();
      setToken("");
      if (visible.current)
        await Taro.showToast({ title: "连接令牌已撤销", icon: "none" });
    } catch (value) {
      if (visible.current) problem(value);
    } finally {
      tokenLock.current = false;
      setTokenBusy(false);
    }
  }
  async function copyConfiguration(value: string) {
    try {
      await api.copy(value);
    } catch (error) {
      problem(error);
    }
  }
  async function back() {
    try {
      if (Taro.getCurrentPages().length > 1) await Taro.navigateBack();
      else await Taro.reLaunch({ url: "/pages/chat/index" });
    } catch (value) {
      problem(value);
    }
  }
  return (
    <View className={h5 ? "h5-shell" : "native-shell"}>
      <View className="settings-page">
        {h5 && (
          <View className="settings-header">
            <Button
              className="control nav-icon"
              ariaLabel="返回聊天"
              onClick={back}
            >
              <ChatIcon name="chevronLeft" />
            </Button>
            <Text>设置</Text>
            <View className="settings-header-spacer" />
          </View>
        )}
        <View className="settings-content">
          <View className="settings-intro">
            <Text className="settings-title">聊得自在，用得安心</Text>
            <Text className="settings-description">
              选择适合你的连接方式，回到原来的对话继续聊。
            </Text>
          </View>
          {error && <Text className="error settings-error">{error}</Text>}
          <View className="settings-section">
            <Text className="settings-section-title">对话方式</Text>
            <Text className="sheet-description">
              阿 Q 先生 · 换一种连接方式，接着聊，不用重新开始。
            </Text>
            <Text className="sheet-note">
              测试版{" "}
              {typeof HELLO_BUILD_LABEL === "string"
                ? HELLO_BUILD_LABEL
                : "开发版"}
            </Text>
            <Text className="sheet-note">
              当前模型：
              {mode === "external"
                ? "由你自己的 Agent 选择"
                : settings?.model || (loading ? "连接中" : "暂不可用")}
            </Text>
            {modes.map((item) => (
              <Button
                key={item.id}
                className={`control mode-option ${mode === item.id ? "selected" : ""}`}
                disabled={loading || tokenBusy || undefined}
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
            <Button className="control quiet-button" onClick={api.openCms}>
              {h5 ? "打开 Payload 管理后台 ↗" : "复制管理后台地址"}
            </Button>
          </View>
          {mode === "external" && (
            <View className="settings-section">
              <Text className="settings-section-title">连接你自己的 Agent</Text>
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
                    className="control primary-button full-button"
                    onClick={() =>
                      copyConfiguration(
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
                  className="control primary-button full-button"
                  disabled={loading || tokenBusy || undefined}
                  onClick={connectAgent}
                >
                  {tokenBusy ? "正在处理…" : "生成专用连接令牌"}
                </Button>
              )}
              <Button
                className="control quiet-button full-button"
                disabled={loading || tokenBusy || undefined}
                onClick={revoke}
              >
                撤销我的全部 MCP 令牌
              </Button>
              <Text className="sheet-note">
                本机地址只能由能访问此电脑的客户端连接。离开设置页会清除页面中的令牌；不会自动撤销已授权连接。
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}
