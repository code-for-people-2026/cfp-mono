import { describe, expect, it } from "vitest";
import { getSiteNavigationArea, getSiteShellDensity, siteNavigation } from "./navigation";

describe("public site navigation", () => {
  it("keeps the four canonical destinations in their decided order", () => {
    expect(siteNavigation.map(({ label, href }) => ({ label, href }))).toEqual([
      { label: "近邻互助组", href: "/neighbors" },
      { label: "为什么做", href: "/manifesto" },
      { label: "如何选题", href: "/wam" },
      { label: "如何约束", href: "/license" },
    ]);
  });

  it("maps representative routes to the same current area as their parent", () => {
    expect([
      getSiteNavigationArea("/neighbors"),
      getSiteNavigationArea("/manifesto"),
      getSiteNavigationArea("/wam"),
      getSiteNavigationArea("/wam/guide"),
      getSiteNavigationArea("/wam/cell/A1"),
      getSiteNavigationArea("/license"),
      getSiteNavigationArea("/chat"),
    ]).toEqual(["neighbors", "why", "topics", "topics", "topics", "constraints", undefined]);
  });

  it("keeps document routes full and product, dialogue, and tool routes compact", () => {
    expect([
      getSiteShellDensity("/"),
      getSiteShellDensity("/manifesto"),
      getSiteShellDensity("/license"),
      getSiteShellDensity("/neighbors"),
      getSiteShellDensity("/chat"),
      getSiteShellDensity("/wam/guide"),
      getSiteShellDensity("/wam/cell/A1"),
    ]).toEqual(["full", "full", "full", "compact", "compact", "compact", "compact"]);
  });
});
