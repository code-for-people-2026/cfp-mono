import { useEffect, useRef } from "react";
import Taro from "@tarojs/taro";
import { interactionAction } from "./api";

// Read-only screens do not count as chatting. Use the page lifecycle and browser
// visibility; the server owns time, notices and acknowledgement across sessions.
export function InteractionGuard({ enabled, revision, onUnavailable }: { enabled: boolean; revision: number; onUnavailable: () => void }) {
  const unavailable = useRef(onUnavailable); unavailable.current = onUnavailable;
  const modal = useRef(false);
  const seen = useRef<string>();
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, pending = false;
    async function poll() {
      if (stopped || pending || (typeof document !== "undefined" && document.visibilityState === "hidden")) return;
      pending = true;
      try {
        const s = await interactionAction("heartbeat");
        if (stopped || modal.current || !s.notice || seen.current === s.notice.id) return;
        const notice = s.notice;
        modal.current = true;
        try {
          const answer = await Taro.showModal({ title: notice.kind === "crisis" ? "先保障现实安全" : "休息与现实联系", content: notice.text, confirmText: notice.kind === "crisis" ? "人工支持" : "先暂停", cancelText: "已知晓" });
          if (stopped) return;
          await interactionAction("acknowledge", { id: notice.id });
          seen.current = notice.id;
          if (answer.confirm) await Taro.navigateTo({ url: "/pages/safety/index" });
        } finally { modal.current = false; }
      } catch { if (!stopped) unavailable.current(); }
      finally { pending = false; }
    }
    void poll();
    const timer = setInterval(() => void poll(), 30_000);
    return () => { stopped = true; clearInterval(timer); };
  }, [enabled, revision]);
  return null;
}
