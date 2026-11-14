import { describe, expect, it, vi } from "vitest";
import * as base from "@cfp/base-chat-protocol";
import {
  AJ_CATALOG_ID,
  AJ_PRESENTATION_REVISION,
  LEGACY_AJ_CATALOG_ID,
  ajClientEvent,
  ajFormResponseFromClientEvent,
  ajPresentationId,
  ajSurfaceName,
  approachSchema,
  formResponseSchema,
  greetingSchema,
  legacyAjA2uiMessageSchema,
  projectAjTurnForClient,
  selectAjArtifactsForPresentation,
  toLegacyAjA2uiForClient,
  toAjA2ui,
  validateAjA2uiMessages,
} from "./index";

const legacyArtifacts = [
  {
    kind: "form",
    id: "thought_record",
    title: "旧表单",
    description: "历史记录不改写。",
    submitLabel: "提交",
    fields: [
      { id: "intensity", label: "强度", type: "number", required: false },
    ],
  },
] as const;

describe("AJ 展示契约所有权", () => {
  it("微信禁用动态函数时仍可转换展示并往返新表单引用", () => {
    vi.stubGlobal("Function", function WechatFunction() {
      throw new Error("微信环境不允许动态函数");
    });
    try {
      const currentMessages = toAjA2ui(3, legacyArtifacts);
      const legacyMessages = toLegacyAjA2uiForClient(3, legacyArtifacts);
      expect(validateAjA2uiMessages(currentMessages)).toEqual(currentMessages);
      expect(validateAjA2uiMessages(legacyMessages)).toEqual(legacyMessages);

      const event = ajClientEvent({
        turnId: 3,
        artifactId: "thought_record",
        values: { intensity: 0 },
        requestId: "request-3",
        presentation: {
          presentationId: ajPresentationId(3),
          revision: AJ_PRESENTATION_REVISION,
          formId: "thought_record",
        },
      });
      expect(ajFormResponseFromClientEvent(event.action)).toEqual({
        turnId: 3,
        artifactId: "thought_record",
        values: { intensity: 0 },
        presentation: {
          presentationId: ajPresentationId(3),
          revision: AJ_PRESENTATION_REVISION,
          formId: "thought_record",
        },
      });

      const projected = projectAjTurnForClient(
        {
          artifacts: legacyArtifacts,
          input: {
            formResponse: {
              turnId: 3,
              artifactId: "thought_record",
              values: { intensity: 0 },
            },
          },
        },
        LEGACY_AJ_CATALOG_ID,
      );
      expect(projected.artifacts).toEqual(legacyArtifacts);
      expect(projected.input.formResponse.values).toEqual({ intensity: 0 });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("base 只保留展示协议；AJ 回应视角与数值轮次留在业务契约", () => {
    expect(base).not.toHaveProperty("approachSchema");
    expect(base).not.toHaveProperty("replySchema");
    expect(base).not.toHaveProperty("formResponseSchema");
    expect(approachSchema.parse("cbt")).toBe("cbt");
    expect(
      greetingSchema.safeParse({
        greeting: "先休息一下。",
        association: "工作压力",
        approach: "behavioral",
        artifacts: legacyArtifacts,
      }).success,
    ).toBe(true);
    expect(
      formResponseSchema.safeParse({
        turnId: 3,
        artifactId: "thought_record",
        values: { intensity: 0 },
      }).success,
    ).toBe(true);
  });

  it("AJ 新生成和展示协议都限制一轮一件，并优先保留对话表单", () => {
    const card = {
      kind: "card" as const,
      id: "comfort",
      title: "安慰卡",
      body: "先照顾自己。",
    };
    const form = {
      kind: "form" as const,
      id: "reason",
      title: "辨认烦躁",
      description: "选一个最像的。",
      submitLabel: "继续",
      fields: [
        {
          id: "reason",
          label: "原因",
          type: "select" as const,
          required: true,
          allowOther: false,
          options: [{ id: "sleep", label: "没睡够" }],
        },
      ],
    };
    expect(
      greetingSchema.safeParse({
        greeting: "先一起看一个原因。",
        association: "情绪支持",
        artifacts: [card, form],
      }).success,
    ).toBe(false);
    expect(selectAjArtifactsForPresentation([card, form])).toEqual([form]);
    const messages = toAjA2ui(7, [card, form]);
    expect(
      messages.filter((message) => "createSurface" in message),
    ).toHaveLength(1);
    expect(JSON.stringify(messages)).toContain("turn_7_reason");
    expect(JSON.stringify(messages)).not.toContain("turn_7_comfort");
  });

  it("畸形历史作品原样交给共享安全解析，严格转换仍拒绝", () => {
    const malformed = [
      {
        kind: "card",
        id: "bad_card",
        title: "标题",
        body: { invalid: true },
      },
    ];
    expect(selectAjArtifactsForPresentation(malformed)).toBe(malformed);
    expect(() => toAjA2ui(7, malformed)).toThrow();
  });

  it("AJ 适配器保留旧目录、surface、资源路径和历史 wire 动作", () => {
    expect(AJ_CATALOG_ID).toBe("urn:cfp:hello-agent:catalog:2");
    expect(LEGACY_AJ_CATALOG_ID).toBe("urn:cfp:hello-agent:catalog:1");
    expect(ajPresentationId(3)).toBe("urn:cfp:a-j-oker:turn:3");
    const withoutRequest = toAjA2ui(3, legacyArtifacts);
    const create = withoutRequest[0];
    if (!create || !("createSurface" in create))
      throw new Error("missing surface");
    expect(create.createSurface).toMatchObject({
      catalogId: AJ_CATALOG_ID,
      surfaceId: "turn_3_thought_record",
    });
    expect(JSON.stringify(withoutRequest)).not.toContain("/api/hello/artifact-form");
    const update = withoutRequest.at(-1);
    if (!update || !("updateDataModel" in update))
      throw new Error("missing data model");
    expect(update.updateDataModel.value).toEqual({ values: {} });
    expect(validateAjA2uiMessages(withoutRequest)).toEqual(withoutRequest);
    const replay = base.legacyArtifactsSchema.parse(legacyArtifacts);
    const legacyClientMessages = toLegacyAjA2uiForClient(3, replay);
    expect(legacyClientMessages[0]).toMatchObject({
      createSurface: { catalogId: LEGACY_AJ_CATALOG_ID },
    });
    expect(() => validateAjA2uiMessages(legacyClientMessages)).not.toThrow();
    for (const message of legacyClientMessages)
      expect(legacyAjA2uiMessageSchema.safeParse(message).success).toBe(true);
    const legacyButton = legacyClientMessages
      .flatMap((message) =>
        "updateComponents" in message
          ? message.updateComponents.components
          : [],
      )
      .find((component) => component.component === "Button");
    expect(legacyButton).toEqual({
      id: "submit",
      component: "Button",
      child: "submit_label",
      action: {
        event: {
          name: "submit_form",
          context: { values: { path: "/values" } },
        },
      },
    });
    const legacyAction = {
      version: "v0.9.1",
      action: {
        name: "submit_form",
        surfaceId: ajSurfaceName(3, "thought_record"),
        sourceComponentId: "submit",
        timestamp: "2026-11-13T00:00:00.000Z",
        context: { values: { intensity: 0 } },
      },
    } as const;
    expect(ajFormResponseFromClientEvent(legacyAction.action)).toEqual({
      turnId: 3,
      artifactId: "thought_record",
      values: { intensity: 0 },
    });
  });

  it("新 submission 带请求 ID 并拒绝伪造 presentation/form 标识", () => {
    const presentation = {
      presentationId: ajPresentationId(3),
      revision: AJ_PRESENTATION_REVISION,
      formId: "thought_record",
    };
    const event = ajClientEvent({
      turnId: 3,
      artifactId: "thought_record",
      values: {
        intensity: 0,
        mood: { optionIds: [], otherText: "说不上来" },
      },
      requestId: "request-3",
      presentation,
    });
    expect(event.action.context.submission).toEqual({
      requestId: "request-3",
      ...presentation,
    });
    expect(ajFormResponseFromClientEvent(event.action)).toMatchObject({
      turnId: 3,
      artifactId: "thought_record",
      presentation: {
        presentationId: ajPresentationId(3),
        revision: AJ_PRESENTATION_REVISION,
        formId: "thought_record",
      },
    });
    const currentSubmission = event.action.context.submission;
    if (!currentSubmission) throw new Error("missing submission");
    const forged = {
      ...event.action,
      context: {
        ...event.action.context,
        submission: {
          ...currentSubmission,
          presentationId: "urn:cfp:a-j-oker:turn:4",
        },
      },
    };
    expect(() => ajFormResponseFromClientEvent(forged)).toThrow(/不匹配/);
    const stale = {
      ...event.action,
      context: {
        ...event.action.context,
        submission: {
          ...currentSubmission,
          revision: currentSubmission.revision + 1,
        },
      },
    };
    expect(() => ajFormResponseFromClientEvent(stale)).toThrow(/版本不匹配/);
  });

  it.each([
    [
      "presentation",
      {
        presentationId: ajPresentationId(4),
        revision: AJ_PRESENTATION_REVISION,
        formId: "thought_record",
      },
    ],
    [
      "revision",
      {
        presentationId: ajPresentationId(3),
        revision: AJ_PRESENTATION_REVISION + 1,
        formId: "thought_record",
      },
    ],
    [
      "form",
      {
        presentationId: ajPresentationId(3),
        revision: AJ_PRESENTATION_REVISION,
        formId: "other_form",
      },
    ],
  ])("新客户的 %s 引用与来源不匹配时拒绝而不是改写", (_part, presentation) => {
    expect(() =>
      ajClientEvent({
        turnId: 3,
        artifactId: "thought_record",
        values: { intensity: 0 },
        requestId: "request-3",
        presentation,
      }),
    ).toThrow(/版本不匹配/);
  });

  it("旧客户未带引用时仍生成 AJ 默认引用", () => {
    const event = ajClientEvent({
      turnId: 3,
      artifactId: "thought_record",
      values: { intensity: 0 },
      requestId: "legacy-request",
    });
    expect(event.action.context.submission).toEqual({
      requestId: "legacy-request",
      presentationId: ajPresentationId(3),
      revision: AJ_PRESENTATION_REVISION,
      formId: "thought_record",
    });
  });

  it("旧数值 turn 合同不新增 32 位上限，旧目录客户端读取会拒绝新增能力", () => {
    const largeTurnId = 2_147_483_648;
    expect(ajSurfaceName(largeTurnId, "form")).toBe(
      `turn_${largeTurnId}_form`,
    );
    expect(
      formResponseSchema.safeParse({
        turnId: largeTurnId,
        artifactId: "form",
        values: { answer: 0 },
      }).success,
    ).toBe(true);
    expect(
      toLegacyAjA2uiForClient(largeTurnId, [
        {
          kind: "code",
          id: "snippet",
          title: "新能力",
          language: "text",
          code: "hello",
        },
      ]),
    ).toEqual([]);
    expect(() => ajSurfaceName(Number.MAX_SAFE_INTEGER + 1, "form")).toThrow();
  });

  it("旧 REST 读者只获得兼容子集，新读者仍获得完整保存内容", () => {
    const turn = {
      id: 9,
      input: {
        text: "已转换为可读文字",
        mediaIds: [],
        formResponse: {
          turnId: 8,
          artifactId: "choices",
          values: { mood: { optionIds: ["calm"] } },
          presentation: {
            presentationId: ajPresentationId(8),
            revision: AJ_PRESENTATION_REVISION,
            formId: "choices",
          },
        },
      },
      artifacts: [
        {
          kind: "card" as const,
          id: "safe",
          title: "旧客户可读",
          body: "保留正文。",
        },
        {
          kind: "table" as const,
          id: "scalar_table",
          title: "标量表格",
          columns: ["数值"],
          rows: [[0]],
        },
        {
          kind: "code" as const,
          id: "snippet",
          title: "代码",
          language: "text" as const,
          code: "hello",
        },
      ],
    };
    const legacy = projectAjTurnForClient(turn, LEGACY_AJ_CATALOG_ID);
    expect(legacy.artifacts).toEqual([turn.artifacts[0]]);
    expect(legacy.input).not.toHaveProperty("formResponse");
    expect(turn.artifacts).toHaveLength(3);
    expect(projectAjTurnForClient(turn, AJ_CATALOG_ID)).toBe(turn);
  });
});
