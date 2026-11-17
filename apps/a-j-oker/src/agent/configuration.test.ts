import { describe, expect, it } from "vitest";
import { validatePresentationPreferences } from "../cms/agent-collections";
import {
  DEFAULT_AGENT_CONFIGS,
  defaultAgentConfig,
} from "./default-prompts";
import { resolveExpertPresentation } from "./configuration";

describe("专家展示配置", () => {
  it("默认值由专家方法拥有，并且首选作品始终属于允许范围", () => {
    for (const config of DEFAULT_AGENT_CONFIGS) {
      expect(defaultAgentConfig(config.key)).toBe(config);
      if (config.key !== "coordinator")
        expect(config.avatarReference).toBe(`aj-expert:${config.key}`);
      expect(
        config.preferredComponents.every((kind) =>
          config.allowedComponents.includes(kind),
        ),
      ).toBe(true);
    }
    expect(defaultAgentConfig("supportive")?.allowedComponents).toEqual([
      "form",
      "card",
      "page",
    ]);
    expect(defaultAgentConfig("supportive")?.preferredComponents).toEqual([]);
    expect(defaultAgentConfig("self_compassion")?.allowedComponents).toEqual([
      "form",
      "card",
      "page",
    ]);
    expect(defaultAgentConfig("self_compassion")?.preferredComponents).toEqual([]);
    expect(defaultAgentConfig("cbt")?.preferredComponents).toEqual(["form"]);
    expect(defaultAgentConfig("behavioral")?.preferredLayout).toBe("action_plan");
  });

  it("只为缺失值加载方法默认值，显式空数组保留纯文字/禁用作品语义", () => {
    expect(
      resolveExpertPresentation("cbt", { subtitle: "  " }).subtitle,
    ).toBe("把发生的事，和心里的推测分开看");
    expect(
      resolveExpertPresentation("cbt", { subtitle: null }).subtitle,
    ).toBe("把发生的事，和心里的推测分开看");
    expect(
      resolveExpertPresentation("cbt", { subtitle: "配置的副标题" }).subtitle,
    ).toBe("配置的副标题");
    expect(
      resolveExpertPresentation("cbt", {
        allowedComponents: [],
        preferredComponents: [],
      }),
    ).toMatchObject({
      theme: "blue",
      preferredLayout: "step_by_step",
      avatarReference: "aj-expert:cbt",
      allowedComponents: ["form", "card", "table", "page"],
      preferredComponents: ["form"],
    });
    expect(
      resolveExpertPresentation("cbt", {
        theme: "blue",
        preferredLayout: "step_by_step",
        avatarReference: "aj-expert:act",
        allowedComponents: [],
        preferredComponents: [],
      }),
    ).toMatchObject({ allowedComponents: [], preferredComponents: [] });
    expect(
      resolveExpertPresentation("cbt", {
        theme: "amber",
        preferredLayout: "reflection",
        allowedComponents: ["card"],
        preferredComponents: ["form", "card"],
      }).preferredComponents,
    ).toEqual(["card"]);
  });

  it("后台拒绝不在允许范围内的首选作品", () => {
    expect(() => validatePresentationPreferences(["card"], ["card"]))
      .not.toThrow();
    expect(() => validatePresentationPreferences([], [])).not.toThrow();
    expect(() => validatePresentationPreferences(["card"], ["form"]))
      .toThrow(/必须同时被允许/);
  });
});
