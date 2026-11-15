import { useEffect, useRef, useState } from "react";
import { Button, Image, Text, View } from "@tarojs/components";
import { api, ApiError } from "../api";
import type { EventSources, OriginalMessage } from "./contracts";

export interface OriginalMessagesProps {
  babyId: string;
  eventId: string;
  label?: string;
  containerClassName?: string;
  onRevoked(error: ApiError): void;
}

function sourceTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace("T", " ");
}

function senderName(message: OriginalMessage): string {
  const name = message.senderName?.trim();
  const internal = !!name && (/^wxid_/i.test(name) || /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(name));
  return name && !internal ? name : "发送人";
}

function senderInitial(name: string): string {
  return Array.from(name)[0] ?? "发";
}

function SenderAvatar({ babyId, message, onRevoked }: { babyId: string; message: OriginalMessage; onRevoked(error: ApiError): void }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  const url = message.senderAvatarUrl;
  useEffect(() => {
    let active = true;
    let resolved = "";
    setSource(""); setFailed(false);
    if (!url) return () => { active = false; };
    if (url.startsWith("https://")) {
      setSource(url);
      return () => { active = false; };
    }
    void api.resolvePhotoUrl(url, babyId).then(value => {
      resolved = value;
      if (active) setSource(value); else api.releasePhotoUrl(value);
    }).catch(error => {
      if (!active) return;
      setFailed(true);
      if (error instanceof ApiError && [401, 403].includes(error.status)) onRevoked(error);
    });
    return () => { active = false; if (resolved) api.releasePhotoUrl(resolved); };
  }, [babyId, onRevoked, url]);
  const name = senderName(message);
  return source && !failed
    ? <Image className="bubu-chat-original-avatar" src={source} mode="aspectFill" onError={() => setFailed(true)} />
    : <View className="bubu-chat-original-avatar-fallback" ariaLabel={`${name}头像`}><Text>{senderInitial(name)}</Text></View>;
}

export function OriginalMessages({ babyId, eventId, label, containerClassName, onRevoked }: OriginalMessagesProps) {
  const requestedIdentity = `${encodeURIComponent(babyId)}:${encodeURIComponent(eventId)}`;
  const [stateIdentity, setStateIdentity] = useState(requestedIdentity);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<EventSources | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const revoked = useRef(onRevoked);
  revoked.current = onRevoked;

  // A props identity change must never expose the previous baby/event during the
  // render before effect cleanup. Collapse immediately and clear the ephemeral
  // response; callers that remount by key get the same behavior at the boundary.
  if (stateIdentity !== requestedIdentity) {
    setStateIdentity(requestedIdentity);
    setOpen(false);
    setLoading(false);
    setSources(null);
    setError("");
  }
  const currentSources = sources && sources.babyId === babyId && sources.eventId === eventId
    ? sources
    : null;

  useEffect(() => {
    if (!open) {
      setLoading(false);
      setSources(null);
      setError("");
      return;
    }
    let active = true;
    setLoading(true);
    setSources(null);
    setError("");
    void api.getEventSources(babyId, eventId).then(result => {
      if (!active) return;
      setSources(result);
      setLoading(false);
    }).catch(sourceError => {
      if (!active) return;
      if (sourceError instanceof ApiError && [401, 403].includes(sourceError.status)) revoked.current(sourceError);
      setError(sourceError instanceof Error ? sourceError.message : "原消息暂不可用，请重试。");
      setLoading(false);
    });
    return () => { active = false; };
  }, [babyId, eventId, open, attempt]);

  return <View className={containerClassName ? `${containerClassName} bubu-chat-original` : "bubu-chat-original"}>
    <View className="bubu-chat-original-header">
      {!!label && <Text className="bubu-chat-automatic-event">{label}</Text>}
      <Button className="bubu-chat-original-toggle" ariaLabel={open ? "收起原消息" : "查看原消息"}
        onClick={() => setOpen(value => !value)}><Text>{open ? "收起原消息" : "查看原消息"}</Text></Button>
    </View>
    {open && <View className="bubu-chat-original-body" ariaLabel="原消息">
      {loading && <Text className="bubu-chat-original-status">正在读取原消息…</Text>}
      {!loading && !!error && <Text className="bubu-chat-original-error">{error}</Text>}
      {!loading && !error && !!currentSources && <>
        {currentSources.messages.length ? currentSources.messages.map((message, index) => {
          const sender = senderName(message);
          return <View className="bubu-chat-original-message" key={`${message.kind}:${message.id}:${index}`}>
            <SenderAvatar babyId={babyId} message={message} onRevoked={revoked.current} />
            <View className="bubu-chat-original-content">
              <Text className="bubu-chat-original-meta">{message.label ? `${message.label} · ` : ""}{sender} · {sourceTime(message.sentAt)}</Text>
              <Text className="bubu-chat-original-text" selectable>{message.text === null ? "未保存这条消息的原文" : message.text}</Text>
            </View>
          </View>;
        }) : <Text className="bubu-chat-original-status">这条记录暂无可展示的原消息。</Text>}
        {!!currentSources.unavailableCount && <Text className="bubu-chat-original-status">{currentSources.unavailableCount} 条原消息未保存原文。</Text>}
      </>}
      {open && !loading && !!error && <Button className="bubu-chat-original-retry" disabled={loading || undefined}
        onClick={() => setAttempt(value => value + 1)}><Text>重试</Text></Button>}
    </View>}
  </View>;
}
