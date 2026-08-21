"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { neighborsProduct } from "@/content/neighbors";
import { getSiteNavigationArea, getSiteShellDensity } from "./navigation";
import { CompactSiteShell, FullSiteShell } from "./site-shell";
import type { SiteLink, SiteObject } from "./types";

function getCurrentObject(pathname: string): SiteObject {
  if (pathname === "/manifesto") {
    return { label: "数据平权宣言", href: "/manifesto" };
  }
  if (pathname === "/license") {
    return { label: "牛马互助协议", href: "/license" };
  }
  if (pathname === "/chat") {
    return { label: "问答对话", href: "/chat" };
  }
  if (pathname === "/neighbors" || pathname.startsWith("/neighbors/")) {
    return { label: "近邻互助组", href: "/neighbors" };
  }
  if (pathname === "/wam" || pathname.startsWith("/wam/")) {
    return { label: "牛马能力剥夺矩阵", href: "/wam" };
  }
  return { label: "公共官网", href: "/" };
}

function getCompactReturnLink(pathname: string): SiteLink {
  if (pathname === "/chat") {
    return { label: "返回问答首页", href: "/" };
  }
  if (pathname.startsWith("/wam/")) {
    return { label: "返回矩阵", href: "/wam" };
  }
  return { label: "返回官网首页", href: "/" };
}

function getContextAction(pathname: string): SiteLink | undefined {
  if (pathname === "/neighbors" || pathname.startsWith("/neighbors/")) {
    return { label: "体验原型", href: neighborsProduct.primaryAction.href };
  }
  if (pathname === "/wam") {
    return { label: "矩阵说明", href: "/wam/guide" };
  }
  return undefined;
}

export function RouteSiteShell({
  children,
  fullFooter,
}: {
  children: ReactNode;
  fullFooter?: ReactNode;
}) {
  const pathname = usePathname();
  const currentArea = getSiteNavigationArea(pathname);
  const currentObject = getCurrentObject(pathname);

  if (getSiteShellDensity(pathname) === "compact") {
    return (
      <CompactSiteShell
        currentArea={currentArea}
        currentObject={currentObject}
        returnLink={getCompactReturnLink(pathname)}
        contextAction={getContextAction(pathname)}
      >
        {children}
      </CompactSiteShell>
    );
  }

  return (
    <FullSiteShell
      currentArea={currentArea}
      currentObject={currentObject}
      footerSlot={fullFooter}
    >
      {children}
    </FullSiteShell>
  );
}
