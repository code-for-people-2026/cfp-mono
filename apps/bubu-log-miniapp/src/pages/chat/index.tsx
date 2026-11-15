import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import Taro, { useDidShow } from "@tarojs/taro";
import { api, ApiError, identityEnabled } from "../../api";
import { DiaryChat, type ChatSelection } from "../../chat/Chat";
import { clearAllChatSelections, takeChatSelection } from "../../chat/handoff";
import { chatRefreshedEvent, identityUpdatedEvent, sessionExpiredEvent } from "../../navigation/events";
import { todayKey, type AuthContext, type Baby } from "../../model";

type ScopedChat = { context: AuthContext; identityId: string; baby: Baby };
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "暂时无法连接，请稍后重试";
const home = () => {
  void Taro.reLaunch({ url: "/pages/index/index" }).catch(() => {});
};

export default function ChatPage() {
  const params = useMemo(() => Taro.getCurrentInstance().router?.params ?? {}, []);
  const viewedDate = datePattern.test(String(params.date)) ? String(params.date) : todayKey();
  const routeEventId = idPattern.test(String(params.eventId ?? "")) ? String(params.eventId) : undefined;
  const hasRouteBabyId = params.babyId !== undefined;
  const routeBabyId = idPattern.test(String(params.babyId ?? "")) ? String(params.babyId) : undefined;
  const [scope, setScope] = useState<ScopedChat | null>(null);
  const [selection, setSelection] = useState<ChatSelection>();
  const [loading, setLoading] = useState(true);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState("");
  const [chatRevision, setChatRevision] = useState(0);
  const generation = useRef(0);
  const mounted = useRef(false);
  const scopeRef = useRef<ScopedChat | null>(null);
  const started = useRef(false);
  const consumedHandoff = useRef("");

  const clearScope = useCallback(() => {
    scopeRef.current = null;
    consumedHandoff.current = "";
    setScope(null);
    setSelection(undefined);
  }, []);

  const validate = useCallback(async () => {
    const version = ++generation.current;
    if (hasRouteBabyId && !routeBabyId) {
      clearScope();
      setLoading(false); setRechecking(false);
      setError("记录入口缺少有效宝宝，请返回首页重新打开。");
      return;
    }
    if (scopeRef.current) setRechecking(true);
    try {
      const context = await api.getContext(routeBabyId);
      if (version !== generation.current || !mounted.current) return;
      if (!identityEnabled || !context.authenticated || !context.identityId) {
        clearScope();
        setError("登录已过期，请返回首页重新登录。");
        return;
      }
      if (!context.hasBaby || !context.baby) {
        clearScope();
        setError("暂时没有可记录的宝宝，请返回首页确认。");
        return;
      }
      if (routeBabyId && context.baby.id !== routeBabyId) {
        clearScope();
        setError("记录入口与授权宝宝不一致，请返回首页重新打开。");
        return;
      }
      const status = await api.privacyStatus(context.baby.id).catch(privacyError => {
        if (privacyError instanceof ApiError && [401, 403].includes(privacyError.status)) throw privacyError;
        throw new Error("授权状态暂时无法确认，为避免误写先不打开记录。");
      });
      if (version !== generation.current || !mounted.current) return;
      if (!status.consentCurrent || !status.guardianCurrent) {
        clearScope();
        setError("当前宝宝或监护授权尚未完成，请返回首页完成授权。");
        return;
      }
      const previous = scopeRef.current;
      const next = { context, identityId: context.identityId, baby: context.baby };
      if (previous && (previous.identityId !== next.identityId || previous.baby.id !== next.baby.id)) clearScope();
      scopeRef.current = next;
      setScope(next);
      setError("");
      setChatRevision(value => value + 1);
    } catch (validateError) {
      if (version !== generation.current || !mounted.current) return;
      clearScope();
      if (validateError instanceof ApiError && validateError.status === 401) {
        Taro.eventCenter.trigger(sessionExpiredEvent);
        setError("登录已过期，请返回首页重新登录。");
      } else if (validateError instanceof ApiError && validateError.status === 403) {
        setError("当前宝宝授权已变化，请返回首页重新选择。");
      } else setError(errorMessage(validateError));
    } finally {
      if (version === generation.current && mounted.current) {
        setLoading(false);
        setRechecking(false);
      }
    }
  }, [clearScope, hasRouteBabyId, routeBabyId]);

  useEffect(() => {
    mounted.current = true;
    started.current = true;
    void validate();
    const expire = () => {
      generation.current++;
      clearAllChatSelections();
      clearScope();
      setLoading(false); setRechecking(false); setError("登录已过期，请返回首页重新登录。");
    };
    const identityUpdated = (next?: AuthContext) => {
      clearAllChatSelections();
      const current = scopeRef.current;
      if (!current) return;
      if (next?.identityId === current.identityId && next.baby?.id === current.baby.id) return;
      generation.current++;
      clearScope();
      setLoading(false); setRechecking(false);
      setError("身份或宝宝已变化，请返回首页重新打开。");
    };
    Taro.eventCenter.on(sessionExpiredEvent, expire);
    Taro.eventCenter.on(identityUpdatedEvent, identityUpdated);
    return () => {
      mounted.current = false;
      generation.current++;
      Taro.eventCenter.off(sessionExpiredEvent, expire);
      Taro.eventCenter.off(identityUpdatedEvent, identityUpdated);
    };
  }, [clearScope, validate]);
  useDidShow(() => {
    if (started.current) void validate();
  });
  useEffect(() => {
    if (!routeEventId) clearAllChatSelections();
  }, [routeEventId]);
  useEffect(() => {
    if (!scope) return;
    const handoffKey = `${scope.identityId}:${scope.baby.id}:${routeEventId ?? ""}`;
    if (consumedHandoff.current === handoffKey) return;
    consumedHandoff.current = handoffKey;
    setSelection(takeChatSelection({ identityId: scope.identityId, babyId: scope.baby.id }, routeEventId));
  }, [routeEventId, scope]);

  const back = useCallback(() => {
    const pages = Taro.getCurrentPages();
    if (pages.length > 1) void Taro.navigateBack().catch(home);
    else home();
  }, []);
  const refreshCalendar = useCallback(() => {
    Taro.eventCenter.trigger(chatRefreshedEvent);
  }, []);
  const revoked = useCallback((failure: ApiError) => {
    generation.current++;
    clearScope();
    setLoading(false); setRechecking(false);
    if (failure.status === 401) {
      Taro.eventCenter.trigger(sessionExpiredEvent);
      setError("登录已过期，请返回首页重新登录。");
    } else setError(failure.message);
  }, [clearScope]);

  return <View className={`chat-route${rechecking ? " rechecking" : ""}`}>
    {loading && <View className="chat-route-state"><Text>正在确认记录授权…</Text></View>}
    {!loading && !scope && <View className="chat-route-state">
      <Text className="chat-route-error">{error || "暂时不能打开记录。"}</Text>
      <Button className="chat-route-secondary" onClick={back}>返回首页</Button>
      <Button className="chat-route-secondary" onClick={() => { setLoading(true); void validate(); }}>重新检查</Button>
    </View>}
    {scope && <DiaryChat
      key={`${scope.identityId}:${scope.baby.id}`}
      identityId={scope.identityId}
      babyId={scope.baby.id}
      babyName={scope.baby.name}
      viewedDate={viewedDate}
      revision={chatRevision}
      selection={selection}
      onBack={back}
      onRefresh={refreshCalendar}
      onRevoked={revoked}
    />}
    {scope && rechecking && <View className="chat-recheck-veil" catchMove><Text>正在确认授权…</Text></View>}
  </View>;
}
