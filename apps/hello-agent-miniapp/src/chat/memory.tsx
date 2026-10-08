import { useEffect, useRef, useState } from "react";
import { Button, Text, View } from "@tarojs/components";
import * as api from "./api";
import type { AdTicket, MemoryStatus, Mode } from "./model";
import { requestId } from "./model";
import { watchWechatAd } from "./rewarded-ad";

export function MemoryMeter({
  memory,
  onOpen,
  disabled,
}: {
  memory?: MemoryStatus;
  onOpen: () => void;
  disabled: boolean;
}) {
  const percent = memory?.remainingPercent ?? 100;
  return (
    <Button
      className={`control memory-meter memory-${memory?.level || "healthy"}`}
      onClick={onOpen}
      disabled={disabled || undefined}
    >
      <View className="memory-caption">
        <Text>♥ 阿 J 的记忆</Text>
        <Text>
          {percent}% <Text className="memory-estimate">估算</Text>
        </Text>
      </View>
      <View className="memory-track">
        {Array.from({ length: 12 }, (_, i) => (
          <View
            key={i}
            className={`memory-segment ${i < Math.ceil((percent * 12) / 100) ? "filled" : ""}`}
          />
        ))}
      </View>
      <Text className="memory-action">
        {memory?.recoveryMode === "preview"
          ? "测试版免费整理记忆 ↗"
          : percent === 0
            ? "记忆满了 · 看广告回血"
            : percent <= 25
              ? "有点满了 · 整理一下 ↗"
              : "看广告，整理记忆 ↗"}
      </Text>
    </Button>
  );
}

export function MemoryPanel(props: {
  sessionId?: number;
  memory?: MemoryStatus;
  mode: Mode;
  apiKey: string;
  platformConfigured: boolean;
  onKeyUsed: () => void;
  onChange: (memory: MemoryStatus) => void;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onError?: (error: unknown) => void;
}) {
  const [phase, setPhase] = useState<
    "idle" | "loading" | "watching" | "compacting"
  >("idle");
  const [ticket, setTicket] = useState<AdTicket>();
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const startLock = useRef(false);
  const finishLock = useRef(false);
  const previewRequest = useRef<{ id: string; revision: number }>();
  const preview = props.memory?.recoveryMode === "preview";
  useEffect(() => {
    props.onBusy(phase !== "idle");
  }, [phase]);
  useEffect(() => {
    if (phase !== "watching") return;
    const timer = setInterval(
      () => setSeconds((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [phase]);
  async function failed(value: unknown) {
    if (value instanceof api.IdentityExpiredError) props.onError?.(value);
    setError(value instanceof Error ? value.message : "整理未完成，请重试");
    setPhase("idle");
    if (props.sessionId)
      await api
        .getMemory(props.sessionId)
        .then(props.onChange)
        .catch(() => undefined);
  }
  async function compact(ad?: AdTicket) {
    if (!props.sessionId) return;
    setPhase("compacting");
    const key = props.apiKey;
    props.onKeyUsed();
    try {
      if (!ad)
        previewRequest.current ||= {
          id: requestId(),
          revision: props.memory?.revision ?? 0,
        };
      const next = ad
        ? await api.compactMemory(props.sessionId, ad.rewardId, props.mode, key)
        : await api.compactPreview(
            props.sessionId,
            previewRequest.current!.id,
            previewRequest.current!.revision,
            props.mode,
            key,
          );
      props.onChange(next);
      setTicket(undefined);
      previewRequest.current = undefined;
      setMessage(
        `记忆已整理，可用空间 ${next.remainingPercent}%。原聊天记录都还在。`,
      );
      setPhase("idle");
    } catch (value) {
      await failed(value);
    }
  }
  async function finish(ad: AdTicket) {
    if (!props.sessionId || finishLock.current) return;
    finishLock.current = true;
    setPhase("loading");
    try {
      await api.completeAd(props.sessionId, ad.rewardId);
      await compact(ad);
    } catch (value) {
      await failed(value);
    } finally {
      finishLock.current = false;
    }
  }
  async function start() {
    if (!props.sessionId || phase !== "idle" || startLock.current) return;
    if (props.mode !== "byok" && !props.platformConfigured) {
      setError("平台尚未配置整理记忆的模型，暂时无需看广告");
      return;
    }
    if (props.mode === "byok" && props.apiKey.trim().length < 10) {
      setError("请先关闭面板，填写本次 DeepSeek 密钥，再来整理记忆");
      return;
    }
    setPhase("loading");
    startLock.current = true;
    setError("");
    setMessage("");
    try {
      if (preview) return await compact();
      const ad = await api.startAd(props.sessionId);
      setTicket(ad);
      if (ad.completed) return await compact(ad);
      if (ad.mode === "demo") {
        setSeconds(ad.demoSeconds);
        setPhase("watching");
      } else {
        await watchWechatAd(ad.adUnitId);
        await finish(ad);
      }
    } catch (value) {
      await failed(value);
    } finally {
      startLock.current = false;
    }
  }
  const active = phase !== "idle";
  const canRecover =
    !!props.memory?.canCompact &&
    (preview || props.memory.advertisement.mode !== "disabled");
  return (
    <View className="sheet-overlay memory-overlay">
      <View
        className="sheet-backdrop"
        onClick={() => {
          if (!active) props.onClose();
        }}
      />
      <View className="sheet memory-sheet">
        <View className="sheet-handle" />
        <View className="sheet-heading">
          <Text>给记忆回回血</Text>
          <Button
            className="control icon-button"
            disabled={active || undefined}
            onClick={props.onClose}
          >
            关闭
          </Button>
        </View>
        <Text className="sheet-description">
          把较早的聊天整理成摘要，保留最近两轮原文。不会删除聊天记录，也不会把阿
          J 变成另一个人；摘要可能遗漏细节。
        </Text>
        <View className="memory-stats">
          <Text className="memory-percent">
            {props.memory?.remainingPercent ?? 100}%
          </Text>
          <View>
            <Text>可用记忆空间</Text>
            <Text className="memory-detail">
              估算 {props.memory?.usedTokens ?? 0} /{" "}
              {props.memory?.budgetTokens ?? 18000} tokens
            </Text>
          </View>
        </View>
        {phase === "watching" && (
          <View className="demo-ad">
            <Text className="demo-label">开发演示 · 非真实商业广告</Text>
            <Text className="demo-title">阿 J 补给站</Text>
            <Text className="demo-copy">
              让脑袋伸个懒腰，给下一句好话留点地方。
            </Text>
            <Text className="demo-countdown">
              {seconds > 0 ? `${seconds} 秒后可以完成观看` : "演示已播放完毕"}
            </Text>
            <Button
              className="control primary-button full-button demo-finish"
              disabled={seconds > 0 || undefined}
              onClick={() => ticket && void finish(ticket)}
            >
              看完了，整理记忆
            </Button>
            <Button
              className="control quiet-button demo-cancel"
              onClick={() => {
                setTicket(undefined);
                setPhase("idle");
                setError(
                  "已提前关闭，未压缩、未消耗记忆。重新观看将从头开始。",
                );
              }}
            >
              提前关闭，暂不整理
            </Button>
          </View>
        )}
        {phase === "compacting" && (
          <Text className="memory-progress">
            阿 J 正在收拾记忆… 原记录安全保留，请稍等。
          </Text>
        )}
        {phase === "loading" && (
          <Text className="memory-progress">
            {preview ? "正在准备测试版整理…" : "正在准备广告或确认观看…"}
          </Text>
        )}
        {error && <Text className="memory-error">{error}</Text>}
        {message && <Text className="memory-success">{message}</Text>}
        {phase === "idle" && (
          <>
            <Button
              className="control primary-button full-button memory-recover"
              disabled={!canRecover || undefined}
              onClick={start}
            >
              {preview
                ? "测试版免费整理"
                : props.memory?.rewardReady
                  ? "重试整理，不用重看广告"
                  : "看广告，整理一次记忆"}
            </Button>
            {!props.memory?.canCompact && (
              <Text className="sheet-note">
                再聊几句才需要整理；最近两轮始终保留原文。
              </Text>
            )}
            {preview && (
              <Text className="sheet-note">
                测试版免费整理，无需观看广告，不产生广告奖励。原聊天记录完整保留。
              </Text>
            )}
            {!preview && props.memory?.advertisement.mode === "disabled" && (
              <Text className="sheet-note">
                广告尚未配置，暂时不能整理；已有聊天仍可查看。
              </Text>
            )}
            {!preview && props.memory?.advertisement.mode === "demo" && (
              <Text className="sheet-note">
                当前是本地演示广告，没有接入广告平台、不产生广告收入。正式小程序需配置激励视频广告位并完成验证。
              </Text>
            )}
            <Text className="sheet-note">
              {preview
                ? "整理失败可以重试，不会丢失历史。"
                : "每次成功压缩需完整观看一次。压缩失败可在观看后 15 分钟有效期内重试，不必重复看广告。"}
              {props.mode === "byok"
                ? "本次摘要使用你填写的密钥，完成请求后清空。"
                : "摘要由平台模型生成。"}
            </Text>
          </>
        )}
      </View>
    </View>
  );
}
