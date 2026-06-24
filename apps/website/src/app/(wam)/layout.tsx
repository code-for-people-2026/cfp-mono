import type { Metadata, Viewport } from "next";
import "./wam.css";

// 互动版「牛马能力剥夺矩阵」(WAM) 自带整屏体验，用独立 route group 隔离它的纯 CSS 调色板，
// 不与 (site) 的 Tailwind 主题互相污染，因此这里渲染自己的 <html>/<body> 根布局。
export const metadata: Metadata = {
  title: "牛马能力剥夺矩阵 · 互动矩阵",
  description: "为 7×7 矩阵补充你的痛点、观察和实践点子。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#fbfaf6",
};

export default function WamLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
