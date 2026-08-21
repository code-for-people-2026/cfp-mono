export const siteNavigation = [
  {
    area: "neighbors",
    label: "近邻互助组",
    href: "https://www.codeforpeople.cn/neighbors",
  },
  { area: "why", label: "为什么做", href: "/manifesto" },
  { area: "topics", label: "如何选题", href: "/wam" },
  { area: "constraints", label: "如何约束", href: "/license" },
] as const;

export type SiteNavigationArea = (typeof siteNavigation)[number]["area"];

const areaPathnames: ReadonlyArray<readonly [pathname: string, area: SiteNavigationArea]> = [
  ["/neighbors", "neighbors"],
  ["/manifesto", "why"],
  ["/wam", "topics"],
  ["/license", "constraints"],
];

function toPathname(href: string) {
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return new URL(href).pathname;
  }

  return href.split(/[?#]/, 1)[0] || "/";
}

export function getSiteNavigationArea(href: string): SiteNavigationArea | undefined {
  const pathname = toPathname(href).replace(/\/+$/, "") || "/";

  return areaPathnames.find(
    ([areaPathname]) => pathname === areaPathname || pathname.startsWith(`${areaPathname}/`),
  )?.[1];
}

export type SiteShellDensity = "full" | "compact";

export function getSiteShellDensity(href: string): SiteShellDensity {
  const pathname = toPathname(href).replace(/\/+$/, "") || "/";
  const usesCompactShell = ["/neighbors", "/chat", "/wam"].some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  return usesCompactShell ? "compact" : "full";
}
