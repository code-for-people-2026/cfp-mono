export const metadata = {
  title: "好人阿 J · a jOKer",
  description: "阿J陪你换个角度，往好处想一点，再讨一句好彩头。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
