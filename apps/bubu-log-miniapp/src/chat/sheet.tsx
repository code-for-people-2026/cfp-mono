import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, View, Text } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { SheetPortal } from "./sheet-portal";

export function ChatSheet({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const id = `chat_${useId().replace(/:/g, "")}`;
  const close = useRef(onClose); close.current = onClose;
  const [geometry, setGeometry] = useState({ bottom: 0, height: "82vh" });
  useEffect(() => {
    if (process.env.TARO_ENV === "h5") {
      const viewport = window.visualViewport;
      const resize = () => setGeometry({ bottom: Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0)), height: `${Math.min(760, (viewport?.height ?? window.innerHeight) * .88)}px` });
      resize(); viewport?.addEventListener("resize", resize); viewport?.addEventListener("scroll", resize); window.addEventListener("resize", resize);
      const previous = document.body.style.overflow;
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      document.body.style.overflow = "hidden";
      const dialog = document.getElementById(id);
      dialog?.querySelectorAll<HTMLElement>("taro-button-core").forEach(button => { button.tabIndex = 0; });
      dialog?.querySelector<HTMLElement>("[data-chat-close]")?.focus();
      const keydown = (event: KeyboardEvent) => {
        if (event.key === "Escape") { event.preventDefault(); close.current(); }
        if (event.key !== "Tab" || !dialog) return;
        const items = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),textarea:not([disabled]),input:not([disabled]),[tabindex="0"]:not([disabled])')).filter(item => item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      };
      document.addEventListener("keydown", keydown, true);
      return () => { document.body.style.overflow = previous; document.removeEventListener("keydown", keydown, true); viewport?.removeEventListener("resize", resize); viewport?.removeEventListener("scroll", resize); window.removeEventListener("resize", resize); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
    }
    let keyboard = 0;
    const resize = () => { try { setGeometry({ bottom: keyboard, height: `${Math.min(760, (Taro.getWindowInfo().windowHeight - keyboard) * .88)}px` }); } catch { /* CSS fallback before native metrics arrive. */ } };
    const onKeyboard = ({ height }: { height: number }) => { keyboard = height; resize(); };
    resize(); Taro.onKeyboardHeightChange?.(onKeyboard); Taro.onWindowResize?.(resize);
    return () => { Taro.offKeyboardHeightChange?.(onKeyboard); Taro.offWindowResize?.(resize); };
  }, [id]);
  return <SheetPortal><View className="bubu-chat-overlay" style={{ bottom: `${geometry.bottom}px` }} catchMove>
    <View className="bubu-chat-backdrop" onClick={onClose} />
    <View className="bubu-chat-sheet" id={id} style={{ height: geometry.height }} role="dialog" aria-modal="true" ariaLabel={title}>
      <View className="bubu-chat-handle" />
      <View className="bubu-chat-heading"><Text>{title}</Text><Button className="text-button" data-chat-close onClick={onClose} ariaLabel="收起对话">收起</Button></View>
      {children}
    </View>
  </View></SheetPortal>;
}
