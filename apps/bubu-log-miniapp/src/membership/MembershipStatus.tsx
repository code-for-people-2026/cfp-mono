import { Button, Text, View } from "@tarojs/components";
import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { fullDateTimeLabel } from "../model/date";
import type { MembershipStatus as ServiceStatus } from "./contracts";

type State = { status: "loading" } | { status: "ready"; value: ServiceStatus } | { status: "unavailable" };

export function MembershipStatus({ babyId, onAccessRevoked }: { babyId: string; onAccessRevoked?: () => void }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void api.getMembership(babyId).then(value => {
      if (!cancelled) setState({ status: "ready", value });
    }).catch((error: unknown) => {
      if (cancelled) return;
      setState({ status: "unavailable" });
      if (error instanceof ApiError && error.status === 403) onAccessRevoked?.();
    });
    return () => { cancelled = true; };
  }, [babyId, revision, onAccessRevoked]);

  return <View className="diary-service-status">
    <Text className="diary-menu-caption">宝宝服务</Text>
    {state.status === "loading" && <Text className="diary-service-message">正在读取服务状态…</Text>}
    {state.status === "unavailable" && <>
      <Text className="diary-service-label">暂时无法读取服务状态</Text>
      <Text className="diary-service-message">请稍后重试。已保存记录仍可按原照护权限查看。</Text>
      <Button className="text-button diary-service-retry" onClick={() => setRevision(value => value + 1)}>重试读取</Button>
    </>}
    {state.status === "ready" && <>
      <Text className="diary-service-label">{state.value.label}</Text>
      {state.value.startsAt && <Text className="diary-service-date">开始时间：{fullDateTimeLabel(state.value.startsAt)}</Text>}
      {state.value.endsAt && <Text className="diary-service-date">截止时间：{fullDateTimeLabel(state.value.endsAt)}</Text>}
      <Text className="diary-service-message">{state.value.message}</Text>
      <Text className="diary-menu-caption">授权照护者共享服务，历史记录保留。</Text>
    </>}
  </View>;
}
