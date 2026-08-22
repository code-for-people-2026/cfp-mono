import type { Metadata, Viewport } from "next";
import { getSiteSettings } from "@/lib/content";
import "../globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const { shareTitle, shareDescription } = await getSiteSettings();
  const canonicalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://www.codeforpeople.cn";
  return {
    metadataBase: new URL(canonicalSiteUrl),
    title: shareTitle,
    description: shareDescription,
    openGraph: {
      title: shareTitle,
      description: shareDescription,
      siteName: "工友敲键盘",
      locale: "zh_CN",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: shareTitle,
      description: shareDescription,
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
