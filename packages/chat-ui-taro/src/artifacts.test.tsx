import { createElement, type PropsWithChildren } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import {
  formAnswerFromClientEvent,
  legacyArtifactsToA2ui,
  presentationFromLegacyArtifacts,
  validateA2uiMessages,
  type Artifact,
  type ClientEvent,
} from "@cfp/base-chat-protocol";
import { NativeA2uiHost } from "./a2ui-host.native";
import {
  Artifacts,
  LiveArtifacts,
  type ArtifactRendererAdapter,
} from "./artifacts";
import { H5A2uiHost } from "./a2ui-host.h5";
import type { ArtifactUiConfig, ArtifactTextProps } from "./artifact-ui";

vi.mock("@tarojs/taro", () => ({
  default: {
    getWindowInfo: () => ({ windowHeight: 800 }),
    onKeyboardHeightChange: vi.fn(),
    offKeyboardHeightChange: vi.fn(),
    onWindowResize: vi.fn(),
    offWindowResize: vi.fn(),
  },
}));
vi.mock("./taro-components", () => ({
  Button: "button",
  View: "view",
  Text: "text",
  Image: "image",
  Input: "input",
  Textarea: "textarea",
  ScrollView: "scroll-view",
}));

const catalogId = "urn:example:consumer:catalog:1";
const identity = "conversation-opaque-alpha";
const resources: string[] = [];
const adapter: ArtifactRendererAdapter<string> = {
  catalogId,
  validate: (messages) => validateA2uiMessages(messages, { catalogIds: [catalogId] }),
  compile: (scope, blocks) =>
    legacyArtifactsToA2ui(blocks, {
      catalogId,
      presentationId: `urn:example:presentation:${scope}`,
      revision: 4,
      surfaceId: (block) => `surface_${block.id}`,
      resourceUrl: ({ kind, block }) =>
        `/tenant-assets/${scope}/${kind}/${block.id}`,
    }),
};
const TextAdapter = ({ aiGenerated, external, ...props }: ArtifactTextProps) =>
  createElement("text", {
    ...props,
    "data-ai-generated": String(!!aiGenerated),
    "data-ai-external": String(!!external),
  });
const Portal = ({ children }: PropsWithChildren) => <>{children}</>;
const config: ArtifactUiConfig = {
  Text: TextAdapter,
  Portal,
  resolveResource: async (url) => {
    resources.push(url);
    return `resolved:${url}`;
  },
  previewImage: vi.fn(),
  openPage: vi.fn(),
  copyText: vi.fn(async () => undefined),
  notify: vi.fn(),
  renderIcon: (name) => name,
  nativeSheet: {
    getWindowHeight: () => 800,
    onKeyboardHeightChange: vi.fn(),
    offKeyboardHeightChange: vi.fn(),
    onWindowResize: vi.fn(),
    offWindowResize: vi.fn(),
  },
};

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  resources.length = 0;
  vi.unstubAllEnvs();
});

it("renders through an opaque identity and consumer-owned resource resolver", async () => {
  const blocks: Artifact[] = [
    {
      id: "private_picture",
      title: "私有图片",
      kind: "image",
      alt: "非阿 J 图片",
      source: { type: "media", mediaId: 41 },
    },
  ];
  await act(async () => {
    renderer = create(
      <Artifacts
        config={config}
        Host={NativeA2uiHost}
        adapter={adapter}
        identity={identity}
        artifacts={blocks}
        responses={{}}
      />,
    );
  });
  expect(resources).toEqual([
    "/tenant-assets/conversation-opaque-alpha/image/private_picture",
  ]);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("/api/hello/");
  expect(renderer!.root.findByType("image").props.src).toContain(
    "resolved:/tenant-assets/",
  );
});

it("lets a host override dynamic artifact preview and collection copy", async () => {
  const blocks: Artifact[] = [
    {
      id: "first",
      title: "第一张",
      kind: "image",
      alt: "第一张",
      source: { type: "media", mediaId: 1 },
    },
    {
      id: "second",
      title: "第二张",
      kind: "image",
      alt: "第二张",
      source: { type: "media", mediaId: 2 },
    },
    {
      id: "notes",
      title: "补充",
      kind: "form",
      description: "补充",
      submitLabel: "提交",
      fields: [{
        id: "note",
        label: "笔记",
        type: "multiSelect",
        required: true,
        allowOther: false,
        maxChoices: 1,
        options: [{ id: "saved", label: "已保存" }],
      }],
    },
  ];
  await act(async () => {
    renderer = create(
      <Artifacts
        config={{
          ...config,
          copy: {
            generated: "HOST GENERATED",
            previewCardAriaLabel: (title) => `OPEN ${title}`,
            previewFormSubmitted: () => "SUBMITTED FORM",
            imageCollectionTitle: () => "HOST IMAGE GROUP",
            imageCollectionSummary: (count) => `HOST IMAGES ${count}`,
            imageCollectionDialogTitle: (count) => `HOST DIALOG ${count}`,
          },
        }}
        Host={NativeA2uiHost}
        adapter={adapter}
        identity={identity}
        artifacts={blocks}
        responses={{ surface_notes: { note: { optionIds: ["saved"] } } }}
      />,
    );
  });
  const output = JSON.stringify(renderer!.toJSON());
  expect(output).toContain("已保存");
  expect(output).not.toContain("SUBMITTED FORM");
  expect(output).toContain("HOST IMAGE GROUP");
  expect(output).toContain("HOST IMAGES 2");
  expect(output).toContain("HOST GENERATED");
  expect(renderer!.root
    .findAllByType("button")
    .some((node) => node.props.ariaLabel === "OPEN HOST IMAGE GROUP")).toBe(true);

  await act(async () => {
    renderer!.root
      .findAllByType("button")
      .find((node) => node.props.ariaLabel === "OPEN HOST IMAGE GROUP")!
      .props.onClick();
  });
  expect(JSON.stringify(renderer!.toJSON())).toContain("HOST DIALOG 2");
});

it("renders conversational form surfaces inline and preserves zero through retry", async () => {
  const form: Artifact = {
    id: "reason",
    title: "先挑一个最像的",
    kind: "form",
    description: "帮阿 J 先生接着了解你。",
    submitLabel: "就选这个",
    fields: [
      {
        id: "reason",
        label: "烦躁更靠近哪一个？",
        type: "select",
        required: true,
        allowOther: false,
        options: [
          { id: "sleep", label: "没睡够" },
          { id: "work", label: "事情太多" },
        ],
      },
      {
        id: "others",
        label: "还有哪些？",
        type: "multiSelect",
        required: false,
        allowOther: false,
        options: [{ id: "people", label: "人际消耗" }],
        maxChoices: 1,
      },
      {
        id: "intensity",
        label: "强度",
        type: "number",
        required: false,
        min: 0,
        max: 10,
      },
    ],
  };
  let fail = true;
  const onAction = vi.fn(async (_event: ClientEvent) => {
    if (fail) {
      fail = false;
      throw new Error("网络暂时断开");
    }
  });
  await act(async () => {
    renderer = create(
      <Artifacts
        config={config}
        Host={NativeA2uiHost}
        adapter={adapter}
        identity={identity}
        artifacts={[form]}
        responses={{}}
        onAction={onAction}
      />,
    );
  });

  expect(
    renderer!.root.findAllByType("button").some((node) =>
      String(node.props.className).includes("artifact-preview"),
    ),
  ).toBe(false);
  expect(JSON.stringify(renderer!.toJSON())).not.toContain("detail-overlay");
  const choices = renderer!.root
    .findAllByType("button")
    .filter((node) => String(node.props.className).includes("artifact-choice"));
  expect(choices.map((node) => node.children.join())).toEqual([
    "没睡够",
    "事情太多",
    "人际消耗",
  ]);
  const submit = () =>
    renderer!.root
      .findAllByType("button")
      .find((node) => String(node.props.className).includes("artifact-submit"))!;
  expect(submit().props.disabled).toBeUndefined();

  await act(async () => choices[0]!.props.onClick());
  await act(async () =>
    renderer!.root
      .findAllByType("button")
      .find((node) => node.children.join() === "人际消耗")!
      .props.onClick(),
  );
  const number = renderer!.root.findByProps({ type: "digit" });
  await act(async () => {
    number.props.onInput({ detail: { value: "0" } });
  });
  expect(number.props.value).toBe("0");
  await act(async () => {
    submit().props.onClick();
  });
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onAction.mock.lastCall![0]!.action.context.values).toEqual({
    reason: { optionIds: ["sleep"] },
    others: { optionIds: ["people"] },
    intensity: 0,
  });
  expect(renderer!.root.findAllByType("text").some((node) => node.children.join("").includes("网络暂时断开"))).toBe(true);
  expect(submit().props.disabled).toBeUndefined();
  await act(async () => {
    submit().props.onClick();
  });
  expect(onAction).toHaveBeenCalledTimes(2);
  expect(onAction.mock.lastCall![0]!.action.context.values.intensity).toBe(0);
});

it.each([
  ["native", NativeA2uiHost],
  ["h5", H5A2uiHost],
] as const)(
  "summarizes confirmed %s forms in reachable render order using binding paths",
  async (platform, Host) => {
    vi.stubEnv("TARO_ENV", platform === "h5" ? "h5" : "weapp");
    const form: Artifact = {
      id: "check_in",
      title: "编译输入不会决定摘要",
      kind: "form",
      description: "自定义消息覆盖这份定义。",
      submitLabel: "保存",
      fields: [{ id: "unused", label: "仅用于输入校验", type: "text", required: false }],
    };
    const customAdapter: ArtifactRendererAdapter<string> = {
      ...adapter,
      compile: () => [
        {
          version: "v0.9.1",
          createSurface: { surfaceId: "surface_check_in", catalogId },
        },
        {
          version: "v0.9.1",
          updateComponents: {
            surfaceId: "surface_check_in",
            // Definition order deliberately disagrees with content.children.
            components: [
              { id: "orphan_title", component: "Text", text: "孤立标题", variant: "h3" },
              {
                id: "orphan_field",
                component: "FormField",
                field: { id: "orphan_definition", label: "孤立问题", type: "text", required: false },
                value: { path: "/values/orphan_answer" },
              },
              { id: "submit_label", component: "Text", text: "按钮里的伪标题", variant: "h3" },
              {
                id: "submit",
                component: "Button",
                child: "submit_label",
                action: { event: { name: "submit_form", context: { values: { path: "/values" } } } },
              },
              {
                id: "field_note",
                component: "FormField",
                field: { id: "note_definition", label: "一句话记录", type: "text", required: false },
                value: { path: "/values/note_answer" },
              },
              {
                id: "field_support",
                component: "FormField",
                field: {
                  id: "support_definition",
                  label: "哪些支持有帮助？",
                  type: "multiSelect",
                  required: false,
                  allowOther: true,
                  options: [
                    { id: "friend", label: "找朋友聊聊" },
                    { id: "rest", label: "休息一下" },
                  ],
                },
                value: { path: "/values/help_choice" },
              },
              {
                id: "field_intensity",
                component: "FormField",
                field: { id: "intensity_definition", label: "强度", type: "number", required: false, min: 0, max: 10 },
                value: { path: "/values/score" },
              },
              { id: "visible_title", component: "Text", text: "可达的小结", variant: "h3" },
              {
                id: "content",
                component: "Column",
                children: ["visible_title", "field_intensity", "field_support", "field_note", "submit"],
              },
              { id: "root", component: "Card", child: "content" },
            ],
          },
        },
        {
          version: "v0.9.1",
          updateDataModel: {
            surfaceId: "surface_check_in",
            path: "/",
            value: { values: {} },
          },
        },
      ],
    };
    const response = {
      note_answer: "先照顾好自己",
      score: 0,
      help_choice: {
        optionIds: ["rest", "retired_option"],
        otherText: "出去走走",
      },
      orphan_answer: "绝不能显示",
    };
    const render = () => (
      <Artifacts
        config={config}
        Host={Host}
        adapter={customAdapter}
        identity={identity}
        artifacts={[form]}
        responses={{ surface_check_in: response }}
        onAction={vi.fn(async () => undefined)}
      />
    );

    await act(async () => {
      renderer = create(render());
    });
    const summary = renderer!.root.findByProps({
      className: "artifact-form-summary",
    });
    const rows = summary.findAllByProps({ className: "artifact-summary-row" });
    const textIn = (row: (typeof rows)[number], className: string) =>
      row.findAllByType("text").find((node) => node.props.className === className)!;
    expect(rows.map((row) => textIn(row, "artifact-summary-question").children.join("")))
      .toEqual(["强度", "哪些支持有帮助？", "一句话记录"]);
    expect(rows.map((row) => textIn(row, "artifact-summary-answer").children.join("")))
      .toEqual([
      "0",
      "休息一下、另有 1 个已选择项、出去走走",
      "先照顾好自己",
    ]);
    expect(textIn(summary, "artifact-summary-title").children.join(""))
      .toBe("可达的小结");
    for (const row of rows) {
      expect(textIn(row, "artifact-summary-question").props["data-ai-generated"])
        .toBe("true");
      expect(textIn(row, "artifact-summary-answer").props["data-ai-generated"])
        .toBe("false");
    }
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    expect(renderer!.root.findAllByType("textarea")).toHaveLength(0);
    expect(renderer!.root.findAllByType("button")).toHaveLength(0);
    const output = JSON.stringify(renderer!.toJSON());
    expect(output).not.toContain("retired_option");
    expect(output).not.toContain("孤立问题");
    expect(output).not.toContain("绝不能显示");
    expect(output).not.toContain("孤立标题");
    expect(output).not.toContain("按钮里的伪标题");

    act(() => renderer!.unmount());
    renderer = undefined;
    await act(async () => {
      renderer = create(render());
    });
    expect(renderer!.root.findAllByProps({ className: "artifact-summary-row" }))
      .toHaveLength(3);
  },
);

it.each([
  ["native", NativeA2uiHost],
  ["h5", H5A2uiHost],
] as const)(
  "keeps %s form controls through pending and failure, then collapses on confirmed rerender",
  async (platform, Host) => {
    vi.stubEnv("TARO_ENV", platform === "h5" ? "h5" : "weapp");
    const form: Artifact = {
      id: "pending_form",
      title: "确认问题",
      kind: "form",
      description: "提交测试",
      submitLabel: "确认",
      fields: [{
        id: "answer",
        label: "你的回答",
        type: "text",
        required: true,
      }],
    };
    let rejectFirstSubmission!: (cause: Error) => void;
    let resolveSecondSubmission!: () => void;
    const firstSubmission = new Promise<void>((_resolve, reject) => {
      rejectFirstSubmission = reject;
    });
    const secondSubmission = new Promise<void>((resolve) => {
      resolveSecondSubmission = resolve;
    });
    const onAction = vi.fn()
      .mockImplementationOnce(() => firstSubmission)
      .mockImplementationOnce(() => secondSubmission);
    const render = (responses = {}) => (
      <Artifacts
        config={config}
        Host={Host}
        adapter={adapter}
        identity={identity}
        artifacts={[form]}
        responses={responses}
        onAction={onAction}
      />
    );
    await act(async () => {
      renderer = create(render());
    });
    const input = renderer!.root.findByType("input");
    act(() => input.props.onInput({ detail: { value: "保留这次回答" } }));
    const submit = () => renderer!.root.findByProps({
      className: "control artifact-submit",
    });
    await act(async () => {
      submit().props.onClick();
      submit().props.onClick();
      await Promise.resolve();
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(renderer!.root.findAllByType("input")).toHaveLength(1);
    expect(renderer!.root.findByType("input").props.disabled).toBe(true);
    expect(submit().props.disabled).toBe(true);
    expect(renderer!.root.findAllByProps({ className: "artifact-form-summary" }))
      .toHaveLength(0);

    await act(async () => rejectFirstSubmission(new Error("提交没有确认")));
    expect(renderer!.root.findByType("input").props.disabled).toBe(false);
    expect(renderer!.root.findAllByProps({ className: "artifact-form-summary" }))
      .toHaveLength(0);

    await act(async () => {
      submit().props.onClick();
      submit().props.onClick();
      await Promise.resolve();
    });
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findAllByType("input")).toHaveLength(1);
    await act(async () => resolveSecondSubmission());
    expect(renderer!.root.findByType("input").props.disabled).toBe(false);
    expect(renderer!.root.findAllByProps({ className: "artifact-form-summary" }))
      .toHaveLength(0);

    await act(async () => {
      renderer!.update(render({
        surface_pending_form: { answer: "保留这次回答" },
      }));
    });
    expect(renderer!.root.findAllByType("input")).toHaveLength(0);
    expect(renderer!.root.findAllByType("text").find((node) =>
      node.props.className === "artifact-summary-answer")!.children.join(""))
      .toBe("保留这次回答");
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain("detail-overlay");
  },
);

it.each(["native", "h5"] as const)(
  "keeps live %s choice surfaces inline and read-only",
  async (platform) => {
    vi.stubEnv("TARO_ENV", platform === "h5" ? "h5" : "weapp");
    const form: Artifact = {
      id: "live_reason",
      title: "此刻更像是",
      kind: "form",
      description: "选择后接着说。",
      submitLabel: "继续",
      fields: [
        {
          id: "reason",
          label: "烦躁原因",
          type: "select",
          required: true,
          allowOther: false,
          options: [{ id: "sleep", label: "没睡够" }],
        },
      ],
    };
    await act(async () => {
      renderer = create(
        <LiveArtifacts
          config={config}
          Host={platform === "h5" ? H5A2uiHost : NativeA2uiHost}
          adapter={adapter}
          messages={adapter.compile(identity, [form])}
        />,
      );
    });
    const choice = renderer!.root
      .findAllByType("button")
      .find((node) => String(node.props.className).includes("artifact-choice"));
    expect(choice?.children.join()).toBe("没睡够");
    expect(choice?.props.disabled).toBe(true);
    expect(
      renderer!.root.findAllByType("button").some((node) =>
        String(node.props.className).includes("artifact-preview"),
      ),
    ).toBe(false);
  },
);

it("keeps malformed artifact input as a graceful non-generated error surface", async () => {
  await act(async () => {
    renderer = create(
      <Artifacts
        config={config}
        Host={NativeA2uiHost}
        adapter={adapter}
        identity={identity}
        artifacts={[{ kind: "card", id: "bad", title: "标题", body: 7 }]}
        responses={{}}
      />,
    );
  });
  expect(
    renderer!.root
      .findAllByType("text")
      .some((node) => node.children.join("").includes("作品格式暂不支持")),
  ).toBe(true);
});

it("lets a host override the artifact source detail boundary", async () => {
  await act(async () => {
    renderer = create(
      <Artifacts
        config={{
          ...config,
          copy: {
            generated: "HOST GENERATED",
            external: " HOST SOURCE",
            detailNonGeneratedContent: () => "HOST NON-GENERATED",
          },
        }}
        Host={NativeA2uiHost}
        adapter={adapter}
        identity={identity}
        artifacts={[{
          id: "snippet",
          title: "代码",
          kind: "code",
          language: "text",
          code: "ok",
        }]}
        responses={{}}
        compact={false}
        external
      />,
    );
  });
  const caption = renderer!.root
    .findAllByType("text")
    .find((node) => node.props.className?.includes("artifact-caption"));
  expect(caption?.children?.join("")).toBe(
    "HOST GENERATED HOST SOURCE · HOST NON-GENERATED",
  );
});

it("renders code, typed table cells and bounded choices without app CSS contracts", async () => {
  const blocks: Artifact[] = [
    {
      id: "snippet",
      title: "保留空格",
      kind: "code",
      language: "text",
      code: "first  line\n  second",
    },
    {
      id: "typed_table",
      title: "类型表格",
      kind: "table",
      columns: ["零", "否", "空"],
      rows: [[0, false, null]],
    },
    {
      id: "choice_form",
      title: "选择",
      kind: "form",
      description: "最多一项",
      submitLabel: "提交",
      fields: [
        {
          id: "mood",
          label: "此刻感受",
          type: "multiSelect",
          required: true,
          options: [
            { id: "calm", label: "平静" },
            { id: "tired", label: "疲惫" },
          ],
          allowOther: true,
          allowUnknown: true,
          maxChoices: 1,
        },
      ],
    },
  ];
  await act(async () => {
    renderer = create(
      <Artifacts
        config={config}
        Host={NativeA2uiHost}
        adapter={adapter}
        identity={identity}
        artifacts={blocks}
        responses={{}}
        compact={false}
        onAction={vi.fn(async () => undefined)}
      />,
    );
  });
  const output = JSON.stringify(renderer!.toJSON());
  expect(output).toContain("first  line\\n  second");
  expect(output).toContain("0");
  expect(output).toContain("否");
  expect(output).toContain("—");
  const choices = renderer!.root
    .findAllByType("button")
    .filter((node) => node.props.className?.includes("artifact-choice"));
  act(() => choices[0]!.props.onClick());
  act(() => choices[1]!.props.onClick());
  expect(
    renderer!.root
      .findAllByType("text")
      .some((node) => node.children.join("").includes("最多选择 1 项")),
  ).toBe(true);
});

it("preserves the compiled presentation reference until the host supplies a request ID", async () => {
  const form: Artifact = {
    id: "reflection",
    title: "回顾",
    kind: "form",
    description: "写下此刻的感受",
    submitLabel: "提交",
    fields: [
      {
        id: "note",
        label: "补充",
        type: "text",
        required: false,
      },
    ],
  };
  const presentationId = "opaque-consumer-presentation";
  const revision = 7;
  const revisionSevenAdapter: ArtifactRendererAdapter<string> = {
    catalogId,
    validate: adapter.validate,
    compile: (_scope, blocks) =>
      legacyArtifactsToA2ui(blocks, {
        catalogId,
        presentationId,
        revision,
        surfaceId: (block) => `surface_${block.id}`,
        resourceUrl: ({ block }) => `/assets/${block.id}`,
      }),
  };
  let emitted: ClientEvent | undefined;
  await act(async () => {
    renderer = create(
      <Artifacts
        config={config}
        Host={NativeA2uiHost}
        adapter={revisionSevenAdapter}
        identity="unrelated-host-identity"
        artifacts={[form]}
        responses={{}}
        compact={false}
        onAction={async (event) => {
          emitted = event;
        }}
      />,
    );
  });
  const submit = renderer!.root
    .findAllByType("button")
    .find((node) => node.props.className?.includes("artifact-submit"));
  expect(submit).toBeDefined();
  await act(async () => {
    submit!.props.onClick();
  });
  expect(emitted?.action.context.form).toEqual({
    presentationId,
    revision,
    formId: "reflection",
  });
  expect(emitted?.action.context.submission).toBeUndefined();

  const requestId = "host-request-42";
  const answer = formAnswerFromClientEvent(
    presentationFromLegacyArtifacts({
      id: presentationId,
      revision,
      blocks: [form],
    }),
    {
      ...emitted!.action,
      context: {
        ...emitted!.action.context,
        submission: { ...emitted!.action.context.form!, requestId },
      },
    },
  );
  expect(answer).toEqual({
    form: { presentationId, revision, formId: "reflection" },
    requestId,
    answers: {},
  });
});
