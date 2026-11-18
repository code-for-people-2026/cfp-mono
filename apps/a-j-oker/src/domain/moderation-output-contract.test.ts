import { afterEach, describe, expect, it, vi } from "vitest";
import { completeDeepSeek } from "../models/deepseek";
import { evaluateText, moderateText, ModerationPendingReviewError, ModerationRejectionError } from "./moderation";
import { defaultRule } from "../operations/policy";

vi.mock("../models/deepseek", async (importOriginal) => ({
  ...await importOriginal<typeof import("../models/deepseek")>(),
  DEFAULT_MODEL: "deepseek-flash",
  completeDeepSeek: vi.fn(),
}));

const complete = vi.mocked(completeDeepSeek);
const fullInteraction = {
  minor: false,
  crisis: false,
  dependency: false,
  overuse: false,
  exit: false,
  forget_context: false,
  image_requested: false,
  single_choice_only: false,
  single_open_question_only: false,
};
const inputRequest = {
  stage: "input" as const,
  serviceScope: true,
  interaction: true,
  texts: ["synthetic input"],
  requestId: "output-contract-input",
  apiKey: "synthetic-key",
};

function answer(content: unknown) {
  complete.mockResolvedValue({
    model: "deepseek-flash",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
  });
}

afterEach(() => complete.mockReset());

describe("moderation output contract", () => {
  it.each(["block", "uncertain"] as const)("captures the %s input contract and preserves validated protection flags", async decision => {
    const interaction = { ...fullInteraction, minor: true, crisis: true };
    answer({ decision, service_scope: "support", interaction });
    const rejection = await moderateText(inputRequest).then(() => {
      throw new Error("blocked moderation must reject");
    }, (error: unknown) => error);

    expect(rejection).toBeInstanceOf(decision === "block" ? ModerationRejectionError : ModerationPendingReviewError);
    expect((rejection as ModerationRejectionError).semanticVerdict).toEqual({
      serviceScope: "support",
      interaction,
    });
    const system = String(complete.mock.calls[0]?.[0]?.messages[0]?.content);
    expect(system).toContain("本请求最终输出契约（stage=input）");
    expect(system).toContain("无论 decision=allow、block 还是 uncertain");
    expect(complete).toHaveBeenCalledOnce();
  });

  it("emits one unambiguous final contract for allow and block interaction requests", async () => {
    answer({ decision: "allow", service_scope: "support", interaction: fullInteraction });
    await expect(evaluateText(inputRequest, defaultRule)).resolves.toMatchObject({
      decision: "allow",
      serviceScope: "support",
      interaction: fullInteraction,
    });

    const request = complete.mock.calls[0]?.[0];
    expect(request).toMatchObject({
      temperature: 0,
      response_format: { type: "json_object" },
      max_tokens: 512,
    });
    const system = String(request?.messages[0]?.content);
    expect(system).toContain("本请求最终输出契约（stage=input）");
    expect(system).toContain("无论 decision=allow、block 还是 uncertain，都必须包含恰好九个布尔字段");
    expect(system).toContain('"single_open_question_only":"<boolean>"');
    expect(system).toContain("结构形状不是答案示例");
    expect(system).toContain("不能默认 false");
    expect(system).not.toContain('{"decision":"allow"}');
    expect(system).not.toContain("补充输出字段（优先于上方字段限制）");
    expect(complete).toHaveBeenCalledOnce();
  });

  it("keeps the output-stage contract free of input-only interaction fields", async () => {
    answer({ decision: "allow", service_scope: "outside" });
    const verdict = await evaluateText({
      ...inputRequest,
      stage: "output",
      texts: ["synthetic output"],
      context: "synthetic original request",
    }, defaultRule);

    expect(verdict).toMatchObject({ decision: "allow", serviceScope: "outside" });
    const request = complete.mock.calls[0]?.[0];
    const system = String(request?.messages[0]?.content);
    expect(system).toContain("本请求最终输出契约（stage=output）");
    expect(system).toContain("本次 stage=output，不输出 interaction 字段");
    expect(system).not.toContain("texts[0] 是当前最新输入");
    expect(JSON.parse(String(request?.messages[1]?.content))).toMatchObject({
      stage: "output",
      interaction: false,
    });
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each([
    ["incomplete", (({ crisis: _crisis, ...interaction }) => interaction)(fullInteraction)],
    ["invalid", { ...fullInteraction, minor: "yes" }],
  ])("fails closed after one %s interaction response", async (_kind, interaction) => {
    answer({ decision: "block", service_scope: "support", interaction });
    await expect(evaluateText(inputRequest, defaultRule)).resolves.toMatchObject({
      decision: "unavailable",
      failure: "provider",
    });
    expect(complete).toHaveBeenCalledOnce();
  });

  it("accepts a legacy eight-field interaction assessment without injecting a default", async () => {
    const { single_open_question_only: _singleOpenQuestionOnly, ...legacyInteraction } = fullInteraction;
    answer({ decision: "allow", service_scope: "support", interaction: legacyInteraction });

    const verdict = await evaluateText(inputRequest, defaultRule);

    expect(verdict).toMatchObject({
      decision: "allow",
      serviceScope: "support",
      interaction: legacyInteraction,
    });
    expect("single_open_question_only" in (verdict.interaction ?? {})).toBe(false);
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each(["block", "uncertain"] as const)("does not accept an absent %s interaction object", async decision => {
    answer({ decision, service_scope: "support" });
    await expect(evaluateText(inputRequest, defaultRule)).resolves.toMatchObject({
      decision: "unavailable",
      failure: "provider",
      diagnostic: { phase: "missing_field", reason: "interaction" },
    });
    expect(complete).toHaveBeenCalledOnce();
  });
});
