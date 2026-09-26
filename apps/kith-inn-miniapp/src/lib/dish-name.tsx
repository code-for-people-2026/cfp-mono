import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type PropsWithChildren } from "react";
import Taro, { useDidHide } from "@tarojs/taro";
import { Button as TaroButton, ScrollView, Text, View } from "@tarojs/components";
import { Button } from "./button";

function measure(selector: string, receive: (rect: { left: number; top: number; bottom: number; width: number; height: number }) => void) {
  if (process.env.TARO_ENV === "h5") {
    const rect = document.querySelector(selector)?.getBoundingClientRect();
    if (rect) receive(rect);
  } else {
    Taro.createSelectorQuery().select(selector).boundingClientRect((rect) => {
      if (rect && !Array.isArray(rect)) receive(rect);
    }).exec();
  }
}

type Popover = { id: string; name: string; left: number; top?: number; bottom?: number; width: number; maxHeight: number };
const DishNameContext = createContext<{ activeId?: string; show: (id: string, name: string) => void; close: (id?: string) => void } | null>(null);
const ChoiceOverflowContext = createContext<{ extraWidth: number; report: (overflow: boolean) => void } | null>(null);

export function DishChoiceRow({ name, children }: PropsWithChildren<{ name: string }>) {
  const [overflow, setOverflow] = useState(false);
  return <ChoiceOverflowContext.Provider value={{ extraWidth: overflow ? 44 : 0, report: setOverflow }}>
    <View className={`dish-choice-row ${overflow ? "has-overflow" : ""}`}>{children}{overflow && <DishName name={name} icon />}</View>
  </ChoiceOverflowContext.Provider>;
}

// Render once at the page root so a scroll-view cannot clip the bubble.
export function DishNameProvider({ children }: PropsWithChildren) {
  const [popover, setPopover] = useState<Popover | null>(null);
  const [contentHeight, setContentHeight] = useState<number>();
  const request = useRef(0);
  const close = useCallback((id?: string) => { request.current++; setPopover((current) => !id || current?.id === id ? null : current); }, []);
  useDidHide(() => close());
  const show = useCallback((id: string, name: string) => {
    const current = ++request.current;
    measure(`#${id}`, (rect) => {
      if (current !== request.current) return;
      const { windowWidth, windowHeight } = Taro.getWindowInfo();
      const width = Math.min(320, windowWidth - 24);
      const below = windowHeight - rect.bottom >= rect.top;
      setContentHeight(undefined);
      setPopover({ id, name, width, left: Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, windowWidth - width - 12)),
        ...(below ? { top: rect.bottom + 8 } : { bottom: windowHeight - rect.top + 8 }),
        maxHeight: Math.max(48, Math.min(260, (below ? windowHeight - rect.bottom : rect.top) - 48)) });
    });
  }, []);
  useEffect(() => {
    if (!popover) return;
    measure(".dish-name-popover-text", (rect) => setContentHeight(Math.min(rect.height, popover.maxHeight)));
    if (process.env.TARO_ENV !== "h5") return;
    const trigger = document.getElementById(popover.id);
    const panel = document.querySelector<HTMLElement>(".dish-name-popover");
    const focusFrame = requestAnimationFrame(() => panel?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }));
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        const targets = panel?.querySelectorAll<HTMLElement>('[tabindex="0"], button');
        if (!targets?.length) return;
        const next = event.shiftKey ? targets[targets.length - 1]! : targets[0]!;
        const edge = event.shiftKey ? targets[0]! : targets[targets.length - 1]!;
        if (document.activeElement === edge || !panel?.contains(document.activeElement)) { event.preventDefault(); next.focus(); }
      }
    };
    const anchor = trigger?.getBoundingClientRect();
    const reposition = (event: Event) => {
      if (panel?.contains(event.target as Node)) return;
      const current = trigger?.getBoundingClientRect();
      if (event.type === "resize" || !anchor || !current || Math.abs(current.top - anchor.top) > 1 || Math.abs(current.left - anchor.left) > 1) close();
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [popover, close]);
  const style = popover ? { left: `${popover.left}px`, width: `${popover.width}px`, ...(popover.top === undefined ? { bottom: `${popover.bottom}px` } : { top: `${popover.top}px` }) } : {};
  return <DishNameContext.Provider value={{ activeId: popover?.id, show, close }}>{children}
    {popover && <View className="dish-name-popover-layer">
      <View className="dish-name-popover-backdrop" catchMove onClick={() => close()} />
      <View className="dish-name-popover" style={style} role="dialog" ariaLabel="完整菜名" {...(process.env.TARO_ENV === "h5" ? { "aria-modal": true } : { ariaRole: "dialog" })}>
        <ScrollView scrollY showScrollbar={false} className="dish-name-popover-scroll" style={{ height: `${contentHeight ?? popover.maxHeight}px` }} {...(process.env.TARO_ENV === "h5" ? { tabIndex: 0 } : {})}>
          <View className="dish-name-popover-text"><Text selectable>{popover.name}</Text></View>
        </ScrollView>
        <Button className="dish-name-popover-close" ariaLabel="关闭完整菜名" onClick={() => close()}>×</Button>
      </View>
    </View>}
  </DishNameContext.Provider>;
}

export function DishName({ name, className = "", interactive = true, icon = false }: { name: string; className?: string; interactive?: boolean; icon?: boolean }) {
  const context = useContext(DishNameContext);
  const choice = useContext(ChoiceOverflowContext);
  const [overflow, setOverflow] = useState(false);
  const id = `dish-name-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const close = context?.close;
  useEffect(() => () => close?.(id), [close, id, name]);
  const extraWidth = choice?.extraWidth ?? 0, report = choice?.report;
  useEffect(() => {
    if (icon) return;
    let disposed = false;
    const update = (full: number, available: number) => {
      if (disposed) return;
      const clipped = full > available + extraWidth + 0.5;
      setOverflow(clipped);
      report?.(clipped);
      if (!clipped && overflow) close?.(id);
    };
    const check = () => {
      if (process.env.TARO_ENV === "h5") {
        const element = document.getElementById(id);
        if (element) update(element.querySelector(".dish-name-text")!.getBoundingClientRect().width, element.clientWidth);
      } else {
        Taro.createSelectorQuery().select(`#${id}`).boundingClientRect().select(`#${id} .dish-name-text`).boundingClientRect().exec((rects) => {
          if (rects[0] && rects[1]) update(rects[1].width, rects[0].width);
        });
      }
    };
    check();
    if (process.env.TARO_ENV === "h5") {
      const element = document.getElementById(id);
      const observer = new ResizeObserver(check);
      if (element) { observer.observe(element); observer.observe(element.querySelector(".dish-name-text")!); }
      return () => { disposed = true; observer.disconnect(); };
    }
    Taro.onWindowResize(check);
    return () => { disposed = true; Taro.offWindowResize(check); };
  }, [id, name, icon, extraWidth, report, close, overflow]);
  const classes = `${icon ? "dish-name-info" : "dish-label"} ${className}`;
  const content = <Text className="dish-name-text">{name}</Text>;
  if (!interactive || !name || !icon && !overflow) return process.env.TARO_ENV === "h5"
    ? <span id={id} className={classes} title={overflow ? name : undefined}>{content}</span> : <Text id={id} className={classes}>{content}</Text>;
  const onClick = () => context?.show(id, name);
  const label = `查看完整菜名：${name}`, expanded = context?.activeId === id;
  return process.env.TARO_ENV === "h5"
    ? <button type="button" id={id} className={classes} title={name} aria-label={label} aria-haspopup="dialog" aria-expanded={expanded} onClick={onClick}>{icon ? "ⓘ" : content}</button>
    : <TaroButton id={id} className={classes} ariaLabel={label} onClick={onClick}>{icon ? "ⓘ" : content}</TaroButton>;
}
