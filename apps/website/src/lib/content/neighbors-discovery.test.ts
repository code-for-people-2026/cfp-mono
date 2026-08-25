import { describe, expect, it } from "vitest";
import {
  neighborsDiscoveryQuestion,
  neighborsIdentity,
  neighborsPage,
} from "@/content/neighbors";
import {
  buildNeighborsDiscovery,
  withNeighborsDiscoveryQuestion,
} from "./neighbors-discovery";

describe("neighbors homepage discovery contract", () => {
  it("fixes the neighbors question first and keeps three secondary paths", () => {
    const suggestions = [
      { label: "旧首页问题", value: "旧首页问题？" },
      { label: "为什么做", value: "为什么做？" },
      { label: "如何选题", value: "如何选题？" },
      { label: "如何约束", value: "如何约束？" },
    ];

    expect(withNeighborsDiscoveryQuestion(suggestions)).toEqual([
      neighborsDiscoveryQuestion,
      ...suggestions.slice(-3),
    ]);
  });

  it("removes duplicate product questions before restoring the fixed first item", () => {
    expect(
      withNeighborsDiscoveryQuestion([
        neighborsDiscoveryQuestion,
        { label: "重复标签", value: neighborsDiscoveryQuestion.value },
        { label: "为什么做", value: "为什么做？" },
        { label: "如何选题", value: "如何选题？" },
        { label: "如何约束", value: "如何约束？" },
      ]),
    ).toEqual([
      neighborsDiscoveryQuestion,
      { label: "为什么做", value: "为什么做？" },
      { label: "如何选题", value: "如何选题？" },
      { label: "如何约束", value: "如何约束？" },
    ]);
  });

  it("builds stable actions without replacing the AI answer", () => {
    const discovery = buildNeighborsDiscovery(neighborsPage);

    expect(discovery.primaryAction).toEqual({
      ...neighborsPage.cta,
      href: neighborsIdentity.prototypeUrl,
    });
    expect(discovery.secondaryAction.href).toBe("/neighbors");
  });
});
