import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "码成工",
  description: "Code for People / 码成工"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

