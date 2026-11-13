import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import serverSchema from "../spec/server_to_client.json";
import clientSchema from "../spec/client_to_server.json";
import commonSchema from "../spec/common_types.json";
import { artifacts } from "../test/fixtures";
import {
  A2UI_VERSION,
  DEFAULT_CATALOG_ID,
  clientEventSchema,
  formAnswerFromClientEvent,
  legacyArtifactsToA2ui,
  presentationToA2ui,
  validateA2uiMessages,
} from "./a2ui";
import { a2uiCatalog } from "./catalog";
import {
  artifactsSchema,
  codeSchema,
  formSchema,
  legacyArtifactsSchema,
  presentationFromLegacyArtifacts,
  tableSchema,
  validateForm,
  type A2uiMessage,
} from "./index";
import { createRunReader, type RunProgress } from "./stream";

const compile = (values: unknown) =>
  legacyArtifactsToA2ui(values, {
    catalogId: DEFAULT_CATALOG_ID,
    presentationId: "urn:test:conversation:opaque-id",
    revision: 3,
    surfaceId: (block) => `surface:${block.kind}:${block.id}`,
    resourceUrl: ({ kind, block }) => `/test-resource/${kind}/${block.id}`,
  });

const selectionForm = {
  kind: "form",
  id: "choices",
  title: "选择练习",
  description: "只选愿意回答的。",
  submitLabel: "提交",
  fields: [
    {
      id: "mood",
      label: "现在的主要感受",
      type: "select",
      required: true,
      options: [
        { id: "tired", label: "有点累" },
        { id: "calm", label: "还算平静" },
      ],
      allowOther: true,
    },
    {
      id: "support",
      label: "可用支持",
      type: "multiSelect",
      required: true,
      options: [
        { id: "friend", label: "朋友" },
        { id: "walk", label: "散步" },
        { id: "rest", label: "休息" },
      ],
      allowOther: true,
      minChoices: 1,
      maxChoices: 2,
    },
    {
      id: "score",
      label: "分数",
      type: "number",
      required: true,
      min: 0,
      max: 10,
    },
    {
      id: "note",
      label: "补充",
      type: "text",
      required: false,
    },
  ],
} as const;

describe("A2UI 互操作与用户填写", () => {
  it("既有五类作品和 action 均符合上游 v0.9.1 JSON Schema 与声明的目录", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(commonSchema);
    ajv.addSchema(
      a2uiCatalog(),
      "https://a2ui.org/specification/v0_9/catalog.json",
    );
    const server = ajv.compile(serverSchema);
    const client = ajv.compile(clientSchema);
    const messages = compile(artifacts);
    messages.forEach((message: A2uiMessage) =>
      expect(server(message), JSON.stringify(server.errors)).toBe(true),
    );
    expect(
      validateA2uiMessages(messages).filter(
        (message) => "createSurface" in message,
      ),
    ).toHaveLength(5);
    const action = {
      version: A2UI_VERSION,
      action: {
        name: "submit_form",
        surfaceId: "surface:form:thought_record",
        sourceComponentId: "submit",
        timestamp: "2026-10-14T00:00:00.000Z",
        context: {
          values: { situation: "我说错了一个数字", intensity: 0 },
          submission: {
            requestId: "request-1",
            presentationId: "urn:test:conversation:opaque-id",
            revision: 3,
            formId: "thought_record",
          },
        },
      },
    };
    expect(client(action), JSON.stringify(client.errors)).toBe(true);
    expect(clientEventSchema.safeParse(action).success).toBe(true);
  });

  it("保留旧目录/动作线格式：无 submission 的 action 仍是合法 v0.9.1 输入", () => {
    const legacyAction = {
      version: A2UI_VERSION,
      action: {
        name: "submit_form",
        surfaceId: "surface:form:thought_record",
        sourceComponentId: "submit",
        timestamp: "2026-10-14T00:00:00.000Z",
        context: { values: { intensity: 0 } },
      },
    };
    expect(clientEventSchema.safeParse(legacyAction).success).toBe(true);
    const initialData = compile([artifacts[4]]).at(-1);
    if (!initialData || !("updateDataModel" in initialData))
      throw new Error("missing data model");
    expect(initialData.updateDataModel.value).toEqual({ values: {} });
  });

  it("共享编译器使用产品适配器提供的非数字 surface 和相对资源路径", () => {
    const messages = compile(artifacts);
    const create = messages[0];
    if (!create || !("createSurface" in create))
      throw new Error("missing surface");
    expect(create.createSurface).toMatchObject({
      surfaceId: "surface:card:one_step",
      catalogId: DEFAULT_CATALOG_ID,
    });
    const image = messages.find(
      (message): message is Extract<A2uiMessage, { updateComponents: unknown }> =>
        "updateComponents" in message &&
        message.updateComponents.components.some(
          (component) => component.component === "Image",
        ),
    );
    expect(image).toBeDefined();
    expect(JSON.stringify(messages)).not.toContain("/api/hello");
  });

  it("拒绝陌生目录、脚本组件、远程图片、重复 ID、不齐的表格与危险字段", () => {
    expect(() =>
      validateA2uiMessages([
        {
          version: A2UI_VERSION,
          createSurface: {
            surfaceId: "surface:card:one_step",
            catalogId: "urn:evil:catalog",
          },
        },
      ]),
    ).toThrow();
    const messages = compile([artifacts[0]]);
    for (const component of [
      { id: "bad", component: "Script", code: "alert(1)" },
      {
        id: "bad",
        component: "Image",
        url: "https://evil.test/track",
        alt: "bad",
      },
      {
        id: "bad",
        component: "Image",
        url: "//evil.test/track",
        alt: "bad",
      },
      {
        id: "bad",
        component: "Image",
        url: "/\\evil.test/track",
        alt: "bad",
      },
      {
        id: "bad",
        component: "Image",
        url: "/safe\n/track",
        alt: "bad",
      },
    ])
      expect(() =>
        validateA2uiMessages([
          ...messages,
          {
            version: A2UI_VERSION,
            updateComponents: {
              surfaceId: "surface:card:one_step",
              components: [component],
            },
          },
        ]),
      ).toThrow();
    expect(
      artifactsSchema.safeParse([artifacts[0], artifacts[0]]).success,
    ).toBe(false);
    expect(
      artifactsSchema.safeParse([
        {
          kind: "table",
          id: "table",
          title: "bad",
          columns: ["a", "b"],
          rows: [["one"]],
        },
      ]).success,
    ).toBe(false);
    expect(
      artifactsSchema.safeParse([{ ...artifacts[0], id: "constructor" }])
        .success,
    ).toBe(false);
  });

  it("选择字段使用稳定选项 ID、显式 other 文本并验证类型与数量", () => {
    const parsed = formSchema.parse(selectionForm);
    const valid = {
      mood: { optionIds: [], otherText: "说不上来" },
      support: { optionIds: ["friend", "walk"] },
      score: 0,
    };
    expect(validateForm(parsed, valid)).toBeUndefined();
    expect(validateForm(parsed, {})).toContain("主要感受");
    expect(validateForm(parsed, { ...valid, mood: "tired" })).toContain(
      "答案类型",
    );
    expect(
      validateForm(parsed, {
        ...valid,
        mood: { optionIds: ["forged"], otherText: "伪造" },
      }),
    ).toContain("无效选项");
    expect(
      validateForm(parsed, {
        ...valid,
        mood: { optionIds: ["tired", "tired"] },
      }),
    ).toContain("重复选择");
    expect(
      validateForm(parsed, {
        ...valid,
        support: { optionIds: ["friend", "walk", "rest"] },
      }),
    ).toContain("最多选择 2");
    expect(
      validateForm(parsed, {
        ...valid,
        support: { optionIds: [], otherText: "暂时没有" },
        score: 0,
        mood: { optionIds: [], otherText: "平稳" },
      }),
    ).toBeUndefined();
    expect(validateForm(parsed, { ...valid, score: 11 })).toContain(
      "不能大于 10",
    );
    expect(validateForm(parsed, { ...valid, score: "0" })).toContain(
      "需要填写数字",
    );
  });

  it("重复字段/选项、错误 other 和无效数量约束在内容 schema 阶段拒绝", () => {
    const duplicateOption = {
      ...selectionForm,
      fields: [
        {
          id: "mood",
          label: "选择",
          type: "select",
          required: true,
          options: [
            { id: "same", label: "一" },
            { id: "same", label: "二" },
          ],
          allowOther: false,
        },
      ],
    };
    expect(artifactsSchema.safeParse([duplicateOption]).success).toBe(false);
    const impossible = {
      ...selectionForm,
      fields: [
        {
          id: "support",
          label: "支持",
          type: "multiSelect",
          required: true,
          options: [
            { id: "friend", label: "朋友" },
            { id: "walk", label: "散步" },
          ],
          allowOther: false,
          minChoices: 3,
        },
      ],
    };
    expect(artifactsSchema.safeParse([impossible]).success).toBe(false);
    const duplicateFields = {
      ...selectionForm,
      fields: [selectionForm.fields[0], selectionForm.fields[0]],
    };
    expect(artifactsSchema.safeParse([duplicateFields]).success).toBe(false);
  });

  it("必选多选默认至少一项；选填空答案绕过最小值，开始填写后执行约束", () => {
    const requiredNoMinimum = formSchema.parse({
      ...selectionForm,
      fields: [
        {
          ...selectionForm.fields[1],
          minChoices: undefined,
          maxChoices: undefined,
        },
      ],
    });
    expect(
      artifactsSchema.safeParse([requiredNoMinimum]).success,
    ).toBe(true);
    expect(validateForm(requiredNoMinimum, {})).toContain("请填写");
    expect(
      validateForm(requiredNoMinimum, {
        support: { optionIds: ["friend"] },
      }),
    ).toBeUndefined();

    const optionalMinimum = formSchema.parse({
      ...selectionForm,
      fields: [
        { ...selectionForm.fields[1], required: false, minChoices: 2 },
      ],
    });
    expect(validateForm(optionalMinimum, {})).toBeUndefined();
    expect(
      validateForm(optionalMinimum, { support: { optionIds: [] } }),
    ).toBeUndefined();
    expect(
      validateForm(optionalMinimum, { support: { optionIds: ["friend"] } }),
    ).toContain("至少选择 2");
  });

  it("other 与未知答案保持显式、互斥且不能伪造选项", () => {
    const parsed = formSchema.parse(selectionForm);
    expect(
      validateForm(parsed, {
        mood: { optionIds: ["tired"], otherText: "both" },
        support: { optionIds: ["friend"] },
        score: 0,
      }),
    ).toContain("只能");
    expect(
      validateForm(parsed, {
        mood: { optionIds: [], otherText: "其他" },
        support: { unknown: true },
        score: 0,
      }),
    ).toContain("不支持未知答案");
    const allowsUnknown = formSchema.parse({
      ...selectionForm,
      fields: [
        { ...selectionForm.fields[1], allowUnknown: true },
        selectionForm.fields[3],
      ],
    });
    expect(
      validateForm(allowsUnknown, {
        support: { unknown: true },
      }),
    ).toBeUndefined();
  });

  it("表格保留字符串历史并新增数字、布尔和 null，零与空值不相等", () => {
    const table = {
      kind: "table",
      id: "table",
      title: "混合",
      columns: ["内容", "数字", "完成", "说明"],
      rows: [["旧字符串", 0, false, null]],
    };
    expect(tableSchema.parse(table).rows[0]).toEqual([
      "旧字符串",
      0,
      false,
      null,
    ]);
    expect(artifactsSchema.safeParse([{ ...table, rows: [["", NaN]] }])
      .success).toBe(false);
  });

  it("代码是受限只读文本，拒绝未知语言、空内容和超长内容", () => {
    const code = {
      kind: "code",
      id: "snippet",
      title: "示例",
      language: "typescript",
      code: "const score = 0;",
    };
    expect(codeSchema.parse(code).code).toEqual(code.code);
    expect(
      artifactsSchema.safeParse([{ ...code, language: "html-executor" }])
        .success,
    ).toBe(false);
    expect(artifactsSchema.safeParse([{ ...code, code: "" }]).success).toBe(
      false,
    );
    expect(
      artifactsSchema.safeParse([{ ...code, code: "0".repeat(4001) }]).success,
    ).toBe(false);
    const messages = compile([code]);
    const update = messages.find(
      (message): message is Extract<A2uiMessage, { updateComponents: unknown }> =>
        "updateComponents" in message &&
        message.updateComponents.components.some(
          (item) => item.component === "Code",
        ),
    );
    const component = update?.updateComponents.components.find(
      (item) => item.component === "Code",
    );
    expect(component).toMatchObject({
      code: { language: "typescript", code: "const score = 0;" },
    });
  });

  it("Presentation 以既有 artifacts 为唯一内容实现并携带版本/修订/请求 ID", () => {
    const presentation = presentationFromLegacyArtifacts({
      id: "opaque-presentation-id",
      revision: 7,
      blocks: artifacts,
    });
    expect(presentation).toEqual({
      version: 1,
      id: "opaque-presentation-id",
      revision: 7,
      blocks: artifacts,
    });
    const messages = presentationToA2ui(presentation, {
      catalogId: DEFAULT_CATALOG_ID,
      surfaceId: (block) => `p-${block.id}`,
      resourceUrl: ({ kind, block }) => `/resource/${kind}/${block.id}`,
    });
    const create = messages[0];
    if (!create || !("createSurface" in create))
      throw new Error("missing surface");
    expect(create.createSurface.surfaceId).toBe("p-one_step");
    const data = messages.at(-1);
    if (!data || !("updateDataModel" in data))
      throw new Error("missing data model");
    expect(data.updateDataModel.value).toEqual({ values: {} });
    const form = presentation.blocks.find((block) => block.kind === "form");
    if (!form) throw new Error("missing form");
    const button = presentationToA2ui(
      { ...presentation, blocks: [form] },
      {
        catalogId: DEFAULT_CATALOG_ID,
        surfaceId: (block) => `p-${block.id}`,
        resourceUrl: ({ kind, block }) => `/resource/${kind}/${block.id}`,
      },
    )
      .flatMap((message) =>
        "updateComponents" in message
          ? message.updateComponents.components
          : [],
      )
      .find((component) => component.component === "Button");
    expect(button).toMatchObject({
      action: {
        event: {
          context: {
            form: {
              presentationId: "opaque-presentation-id",
              revision: 7,
              formId: "thought_record",
            },
          },
        },
      },
    });
  });

  it("旧记录重放接受历史 text min/max 并规范化为当前严格内容", () => {
    const legacy = [
      {
        kind: "form",
        id: "legacy_form",
        title: "历史表单",
        description: "旧字段允许 text 携带未执行的数值限制。",
        submitLabel: "提交",
        fields: [
          {
            id: "note",
            label: "记录",
            type: "text",
            required: false,
            min: 1,
            max: 20,
          },
          {
            id: "score",
            label: "评分",
            type: "number",
            required: true,
            min: 1,
            max: 5,
          },
          {
            id: "zero_score",
            label: "可为零的评分",
            type: "number",
            required: true,
            min: 0,
            max: 5,
          },
        ],
      },
    ];
    const legacyForm = legacy[0]!;
    expect(artifactsSchema.safeParse(legacy).success).toBe(false);
    expect(
      legacyArtifactsSchema.safeParse([
        {
          ...legacyForm,
          fields: [legacyForm.fields[0]!, legacyForm.fields[0]!],
        },
      ]).success,
    ).toBe(false);
    expect(
      legacyArtifactsSchema.safeParse(
        Array.from({ length: 6 }, (_, index) => ({
          ...legacyForm,
          id: `legacy_form_${index}`,
        })),
      ).success,
    ).toBe(false);
    expect(
      legacyArtifactsSchema.safeParse([
        legacyForm,
        {
          kind: "table",
          id: "bad_rows",
          title: "行数不齐",
          columns: ["一", "二"],
          rows: [["只有一列"]],
        },
      ]).success,
    ).toBe(false);
    const largeBody = "大".repeat(1800);
    expect(
      legacyArtifactsSchema.safeParse([
        legacyForm,
        ...["large_one", "large_two"].map((id) => ({
          kind: "page" as const,
          id,
          title: "历史大页面",
          sections: Array.from({ length: 8 }, (_, index) => ({
            heading: `段落${index}`,
            body: largeBody,
          })),
        })),
      ]).success,
    ).toBe(false);
    const replay = presentationFromLegacyArtifacts({
      id: "urn:test:legacy:1",
      revision: 2,
      blocks: legacy,
    });
    expect(replay.blocks[0]).toEqual({
      kind: "form",
      id: "legacy_form",
      title: "历史表单",
      description: "旧字段允许 text 携带未执行的数值限制。",
      submitLabel: "提交",
      fields: [
        { id: "note", label: "记录", type: "text", required: false },
        {
          id: "score",
          label: "评分",
          type: "number",
          required: true,
          min: 1,
          max: 5,
        },
        {
          id: "zero_score",
          label: "可为零的评分",
          type: "number",
          required: true,
          min: 0,
          max: 5,
        },
      ],
    });
    expect(() =>
      formAnswerFromClientEvent(replay, {
        name: "submit_form",
        surfaceId: "legacy-surface",
        sourceComponentId: "submit",
        timestamp: "2026-11-13T00:00:00.000Z",
        context: {
          values: { note: "", score: 0, zero_score: 0 },
          submission: {
            requestId: "submit-invalid",
            presentationId: "urn:test:legacy:1",
            revision: 2,
            formId: "legacy_form",
          },
        },
      }),
    ).toThrow(/1/);
    expect(
      formAnswerFromClientEvent(replay, {
        name: "submit_form",
        surfaceId: "legacy-surface",
        sourceComponentId: "submit",
        timestamp: "2026-11-13T00:00:00.000Z",
        context: {
          values: { note: "", score: 1, zero_score: 0 },
          submission: {
            requestId: "submit-1",
            presentationId: "urn:test:legacy:1",
            revision: 2,
            formId: "legacy_form",
          },
        },
      }),
    ).toEqual({
      form: {
        presentationId: "urn:test:legacy:1",
        revision: 2,
        formId: "legacy_form",
      },
      requestId: "submit-1",
      answers: { note: "", score: 1, zero_score: 0 },
    });
    expect(() =>
      formAnswerFromClientEvent(
        { ...replay, revision: 3 },
        {
          name: "submit_form",
          surfaceId: "legacy-surface",
          sourceComponentId: "submit",
          timestamp: "2026-11-13T00:00:00.000Z",
          context: {
            values: { note: "", score: 1, zero_score: 0 },
            submission: {
              requestId: "submit-1",
              presentationId: "urn:test:legacy:1",
              revision: 2,
              formId: "legacy_form",
            },
          },
        },
      ),
    ).toThrow(/版本不匹配/);
  });

  it("允许受限数据更新与删除，拒绝乱序、原型路径和循环组件", () => {
    const messages = compile([artifacts[4]]);
    const update = {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId: "surface:form:thought_record",
        path: "/values/intensity",
        value: 0,
      },
    };
    expect(() => validateA2uiMessages([...messages, update])).not.toThrow();
    expect(() =>
      validateA2uiMessages([
        ...messages,
        {
          ...update,
          updateDataModel: {
            ...update.updateDataModel,
            value: { optionIds: ["intensity"] },
          },
        },
      ]),
    ).not.toThrow();
    expect(() => validateA2uiMessages([update])).toThrow();
    for (const path of [
      "/__proto__/polluted",
      "/values/constructor",
      "/values/prototype",
    ])
      expect(() =>
        validateA2uiMessages([
          ...messages,
          { ...update, updateDataModel: { ...update.updateDataModel, path } },
        ]),
      ).toThrow();
    expect(() =>
      validateA2uiMessages([
        ...messages,
        {
          ...update,
          updateDataModel: { ...update.updateDataModel, value: undefined },
        },
        {
          version: A2UI_VERSION,
          deleteSurface: { surfaceId: "surface:form:thought_record" },
        },
      ]),
    ).not.toThrow();
    expect(() =>
      validateA2uiMessages([
        ...messages,
        {
          version: A2UI_VERSION,
          updateComponents: {
            surfaceId: "surface:form:thought_record",
            components: [{ id: "root", component: "Card", child: "root" }],
          },
        },
      ]),
    ).toThrow(/循环/);
  });
});

describe("AG-UI 传输恢复", () => {
  const events = [
    { type: "RUN_STARTED", runId: "run", threadId: "1" },
    { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "且慢，先看眼前。" },
    { type: "TEXT_MESSAGE_END", messageId: "m" },
    ...compile([artifacts[0]]).map((value: A2uiMessage) => ({
      type: "CUSTOM",
      name: "a2ui",
      value,
    })),
    { type: "RUN_FINISHED", runId: "run", threadId: "1" },
  ];
  it("网络任意分块、CRLF 和中文都能恢复为同一份文字与作品", () => {
    const wire = events
      .map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`)
      .join("");
    for (const size of [1, 7, 57, wire.length]) {
      const reader = createRunReader("run");
      for (let offset = 0; offset < wire.length; offset += size)
        reader.push(wire.slice(offset, offset + size));
      expect(reader.finish().text).toBe("且慢，先看眼前。");
      expect(
        reader
          .finish()
          .messages.filter((message) => "createSurface" in message),
      ).toHaveLength(1);
    }
  });
  it("错误与中断不得伪装成完成，不接受另一个 run 的结果", () => {
    const reader = createRunReader("run");
    reader.push(`data: ${JSON.stringify(events[0])}\n\n`);
    expect(() => reader.finish()).toThrow(/中断/);
    expect(() =>
      reader.push('data: {"type":"RUN_ERROR","message":"模型未完成"}\n\n'),
    ).toThrow("模型未完成");
    expect(() =>
      createRunReader("other").push(`data: ${JSON.stringify(events[0])}\n\n`),
    ).toThrow(/不匹配/);
  });

  it("默认使用产品中立进度文案，宿主可注入初始步骤", () => {
    const neutral: RunProgress[] = [];
    const neutralReader = createRunReader("run", (progress) => {
      neutral.push({ ...progress });
    });
    neutralReader.push(`data: ${JSON.stringify(events[0])}\n\n`);
    expect(neutral.at(-1)?.step).toBe("Working…");

    const branded: RunProgress[] = [];
    const brandedReader = createRunReader(
      "run",
      (progress) => {
        branded.push({ ...progress });
      },
      { initialStep: "阿 J 先生正在想一想…" },
    );
    brandedReader.push(`data: ${JSON.stringify(events[0])}\n\n`);
    expect(branded.at(-1)?.step).toBe("阿 J 先生正在想一想…");
  });
});
