export const metadata = {
  title: "阿 J 先生",
  description: "阿 J 先生陪你换个角度，往好处想一点，再讨一句好彩头。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
