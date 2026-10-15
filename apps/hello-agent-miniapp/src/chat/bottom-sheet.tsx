import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, ScrollView, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { ChatIcon } from "./icon";
import { SheetPortal } from "./sheet-portal";
import { MessageText } from "./message-text";

const FocusField = createContext<(id: string) => void>(() => {});
export const useSheetFieldFocus = () => useContext(FocusField);

// The sheet is an application shell around the official A2UI renderer, not a
// model-supplied modal. Closing it never owns or clears the form draft.
export function BottomSheet({
  title,
  onClose,
  children,
  generatedTitle = false,
  external = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  generatedTitle?: boolean;
  external?: boolean;
}) {
  const id = `detail_${useId().replace(/:/g, "")}`;
  const close = useRef(onClose);
  close.current = onClose;
  const [geometry, setGeometry] = useState({ bottom: 0, height: "78vh" });
  const [focused, setFocused] = useState("");
  const [target, setTarget] = useState("");
  useEffect(() => {
    if (process.env.TARO_ENV === "h5") {
      const viewport = window.visualViewport;
      const resize = () =>
        setGeometry({
          bottom: Math.max(
            0,
            window.innerHeight -
              (viewport?.height ?? window.innerHeight) -
              (viewport?.offsetTop ?? 0),
          ),
          height: `${Math.min(720, (viewport?.height ?? window.innerHeight) * 0.84)}px`,
        });
      resize();
      viewport?.addEventListener("resize", resize);
      viewport?.addEventListener("scroll", resize);
      window.addEventListener("resize", resize);
      const previous = document.body.style.overflow;
      const trigger =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : undefined;
      const dialog = document.getElementById(id);
      document.body.style.overflow = "hidden";
      dialog
        ?.querySelectorAll<HTMLElement>("taro-button-core")
        .forEach((button) => {
          button.tabIndex = 0;
        });
      dialog?.querySelector<HTMLElement>("[data-sheet-close]")?.focus();
      const keydown = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close.current();
        }
        if (event.key !== "Tab" || !dialog) return;
        const items = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]:not([disabled])',
          ),
        ).filter((item) => item.getClientRects().length > 0);
        const first = items[0];
        const last = items.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !dialog.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      };
      // Taro's input elements stop some bubbling keyboard events.
      document.addEventListener("keydown", keydown, true);
      return () => {
        document.body.style.overflow = previous;
        document.removeEventListener("keydown", keydown, true);
        viewport?.removeEventListener("resize", resize);
        viewport?.removeEventListener("scroll", resize);
        window.removeEventListener("resize", resize);
        if (trigger?.isConnected) trigger.focus({ preventScroll: true });
      };
    }
    let keyboard = 0;
    const resize = () => {
      try {
        const available = Math.max(
          0,
          Taro.getWindowInfo().windowHeight - keyboard,
        );
        setGeometry({
          bottom: keyboard,
          height: `${Math.min(720, available * 0.84)}px`,
        });
      } catch {
        /* Safe CSS height until WeChat provides window metrics. */
      }
    };
    const onKeyboard = ({ height }: { height: number }) => {
      keyboard = height;
      resize();
    };
    resize();
    Taro.onKeyboardHeightChange?.(onKeyboard);
    Taro.onWindowResize?.(resize);
    return () => {
      Taro.offKeyboardHeightChange?.(onKeyboard);
      Taro.offWindowResize?.(resize);
    };
  }, [id]);
  useEffect(() => {
    setTarget("");
    // Reapply after the keyboard resizes the scroll area, including the last field.
    const timer = setTimeout(() => {
      if (process.env.TARO_ENV === "h5") {
        const field = document.getElementById(focused);
        const scroller = field?.closest<HTMLElement>(".detail-scroll");
        if (field && scroller)
          scroller.scrollTop +=
            field.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top -
            14;
      } else setTarget(focused);
    }, 16);
    return () => clearTimeout(timer);
  }, [focused, geometry.height]);
  return (
    <SheetPortal>
      <View
        className="sheet-overlay detail-overlay"
        style={{ bottom: `${geometry.bottom}px` }}
        catchMove
      >
        <View className="sheet-backdrop" onClick={onClose} />
        <View
          id={id}
          className="detail-sheet"
          style={{ height: geometry.height }}
          role="dialog"
          aria-modal="true"
          ariaLabel={title}
        >
          <View className="sheet-handle" />
          <View className="detail-heading">
            <MessageText
              aiGenerated={generatedTitle}
              external={external}
              className="detail-title"
            >
              {title}
            </MessageText>
            <Button
              className="control detail-close"
              ariaLabel="关闭详情"
              data-sheet-close
              onClick={onClose}
            >
              <ChatIcon name="x" />
            </Button>
          </View>
          <ScrollView
            scrollY
            scrollIntoView={process.env.TARO_ENV === "h5" ? undefined : target}
            className="detail-scroll"
          >
            <FocusField.Provider value={setFocused}>
              <View className="detail-body">{children}</View>
            </FocusField.Provider>
          </ScrollView>
        </View>
      </View>
    </SheetPortal>
  );
}
