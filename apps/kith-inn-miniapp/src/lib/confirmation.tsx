import { useEffect, useRef, useState } from "react";
import Taro, { useDidHide } from "@tarojs/taro";
import { Text, View } from "@tarojs/components";
import { Button } from "./button";

type Options = Pick<Taro.showModal.Option, "title" | "content" | "confirmText" | "confirmColor" | "cancelText">;
type Answer = { confirm: boolean; cancel: boolean };

// Keep H5's Taro dialog as the visual reference. Match it on WeChat instead of
// depending on the device's differently sized system dialog.
export function useConfirmation() {
  const [options, setOptions] = useState<Options | null>(null);
  const [offset] = useState(() => {
    if (process.env.TARO_ENV !== "weapp") return 0;
    const { statusBarHeight = 0, screenHeight, safeArea } = Taro.getWindowInfo();
    return (statusBarHeight - (screenHeight - (safeArea?.bottom ?? screenHeight))) / 2;
  });
  const pending = useRef<((answer: Answer) => void) | null>(null);
  function finish(confirm: boolean) {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.({ confirm, cancel: !confirm });
  }
  useDidHide(() => finish(false));
  useEffect(() => () => { pending.current?.({ confirm: false, cancel: true }); pending.current = null; }, []);
  function confirm(next: Options): Promise<Answer> {
    if (process.env.TARO_ENV === "h5") return Taro.showModal(next);
    if (pending.current) return Promise.resolve({ confirm: false, cancel: true });
    return new Promise((resolve) => { pending.current = resolve; setOptions(next); });
  }
  const dialog = options && <View className="confirmation-layer" catchMove>
    <View className="confirmation-mask" />
    <View className="confirmation-dialog" style={{ marginTop: `${offset}px` }} ariaRole="alertdialog" ariaLabel={options.title}>
      <View className="confirmation-title"><Text>{options.title}</Text></View>
      <View className="confirmation-content"><Text>{options.content}</Text></View>
      <View className="confirmation-actions">
        <Button onClick={() => finish(false)}>{options.cancelText ?? "取消"}</Button>
        <Button onClick={() => finish(true)}><Text style={{ color: options.confirmColor ?? "#3cc51f" }}>{options.confirmText ?? "确定"}</Text></Button>
      </View>
    </View>
  </View>;
  return [confirm, dialog] as const;
}
