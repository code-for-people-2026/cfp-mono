import type { UserProfile } from "@cfp/a-j-oker-contracts";
import { AccountProfile } from "./profile";
import { useEffect, useState } from "react";
import { Button, Input, ScrollView, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { ChatIcon } from "./icon";
import { readNavigationLayout } from "./navigation-layout";
import type { MemoryStatus, Session } from "./model";
import { MemoryMeter } from "./memory";

type Props = {
  profile?: UserProfile;
  avatarSource?: string;
  open: boolean;
  sessions: Session[];
  activeId?: number;
  disabled: boolean;
  settingsDisabled?: boolean;
  memoryFull: boolean;
  memory?: MemoryStatus;
  onOpen: () => void;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: number) => void;
  onMemory: () => void;
  onSettings: () => void;
};
export function ChatNavigation(props: Props) {
  const [query, setQuery] = useState("");
  const [layout, setLayout] = useState(readNavigationLayout);
  useEffect(() => {
    if (process.env.TARO_ENV !== "weapp") return;
    const update = () => setLayout(readNavigationLayout());
    Taro.nextTick(update);
    Taro.onWindowResize(update);
    return () => Taro.offWindowResize(update);
  }, []);
  useEffect(() => {
    if (!props.open) return;
    setQuery("");
    // 对话仍使用页面滚动，侧栏打开期间才锁住背景，关闭后恢复长截图能力。
    if (process.env.TARO_ENV !== "h5") return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", escape);
    };
  }, [props.open]);
  const rows = [...props.sessions]
    .sort(
      (a, b) =>
        (b.updatedAt || b.createdAt || "").localeCompare(
          a.updatedAt || a.createdAt || "",
        ) || b.id - a.id,
    )
    .filter((row) =>
      row.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
    );
  const button = (
    action: () => void,
    name: "menu" | "squarePen" | "heart",
    label: string,
    disabled = props.disabled,
  ) => (
    <Button
      className="control nav-icon"
      ariaLabel={label}
      disabled={disabled || undefined}
      onClick={action}
    >
      <ChatIcon name={name} />
    </Button>
  );
  return (
    <>
      <View
        className={`chat-header ${layout ? "custom-navigation" : ""}`}
        style={
          layout ? { paddingTop: `${layout.statusBarHeight}px` } : undefined
        }
      >
        <View
          className="navigation-row"
          style={layout ? { height: `${layout.height}px` } : undefined}
        >
          <View className="header-actions">
            {button(props.onOpen, "menu", "打开会话导航", false)}
            {button(props.onNew, "squarePen", "新建对话")}
          </View>
          <View
            className="nav-identity"
            style={
              layout
                ? {
                    left: `${layout.side}px`,
                    right: `${layout.side}px`,
                    transform: "none",
                  }
                : undefined
            }
          >
            <Text className="agent-name">阿 J 先生</Text>
            {!layout && (
              <Text className="agent-status">陪你换个角度，慢慢聊</Text>
            )}
          </View>
          {!layout && (
            <View
              className={`header-actions nav-right ${props.memoryFull ? "memory-alert" : ""}`}
            >
              {button(props.onMemory, "heart", "查看阿 J 先生的记忆")}
            </View>
          )}
        </View>
      </View>
      {props.open && (
        <View className="nav-overlay" catchMove>
          <View className="nav-backdrop" onClick={props.onClose} />
          <View
            className="session-drawer"
            role="dialog"
            ariaLabel="会话导航"
            style={
              layout
                ? {
                    paddingTop: `${layout.statusBarHeight + layout.height + 16}px`,
                  }
                : undefined
            }
          >
            <View className="drawer-heading">
              {props.profile ? <AccountProfile profile={props.profile} source={props.avatarSource} /> : <Text className="drawer-guest">请先登录</Text>}
              <Button
                className="control nav-icon"
                ariaLabel="关闭会话导航"
                onClick={props.onClose}
              >
                <ChatIcon name="x" />
              </Button>
            </View>
            <Button
              className="control drawer-new"
              disabled={props.disabled || undefined}
              onClick={props.onNew}
            >
              <ChatIcon name="squarePen" />
              <Text>新对话</Text>
              <Text className="drawer-plus">＋</Text>
            </Button>
            <View className="drawer-search">
              <ChatIcon name="search" />
              <Input
                value={query}
                onInput={(event) => setQuery(event.detail.value)}
                placeholder="搜索对话"
                ariaLabel="搜索历史对话"
              />
            </View>
            <Text className="drawer-section-label">最近对话</Text>
            <ScrollView scrollY className="drawer-history">
              {rows.map((row) => (
                <Button
                  key={row.id}
                  className={`control session-link ${row.id === props.activeId ? "session-selected" : ""}`}
                  disabled={props.disabled || undefined}
                  onClick={() => props.onSelect(row.id)}
                >
                  <ChatIcon name="messageCircle" />
                  <Text className="session-title">{row.title}</Text>
                  {row.id === props.activeId && (
                    <Text className="session-current">当前</Text>
                  )}
                </Button>
              ))}
              {!rows.length && (
                <Text className="drawer-empty">
                  {query
                    ? "没有找到这段对话"
                    : "从新对话开始，日常会留在这里。"}
                </Text>
              )}
            </ScrollView>
            <View className="drawer-footer">
              <MemoryMeter
                memory={props.memory}
                disabled={props.disabled}
                onOpen={props.onMemory}
              />
              <Button
                className="control drawer-footer-action"
                disabled={(props.settingsDisabled ?? props.disabled) || undefined}
                onClick={props.onSettings}
              >
                <ChatIcon name="settings" />
                <Text>设置</Text>
              </Button>
              <Text className="drawer-caption">
                新对话单独记忆，旧对话随时继续
              </Text>
            </View>
          </View>
        </View>
      )}
    </>
  );
}
