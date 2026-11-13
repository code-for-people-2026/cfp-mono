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
import { Artifacts, type ArtifactRendererAdapter } from "./artifacts";
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
