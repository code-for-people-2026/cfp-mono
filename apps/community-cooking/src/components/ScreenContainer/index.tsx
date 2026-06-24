import { View } from "@tarojs/components";
import "./index.css";

type ScreenContainerProps = {
  children: React.ReactNode;
};

// 布局原语：给每个页面统一的外边距和背景。无业务含义，最适合将来抽到共享包。
export default function ScreenContainer({ children }: ScreenContainerProps) {
  return <View className="screen">{children}</View>;
}
