import { createElement, type PropsWithChildren } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import {
  legacyArtifactsToA2ui,
  validateA2uiMessages,
  type Artifact,
} from "@cfp/base-chat-protocol";
import type { ArtifactTextProps, ArtifactUiConfig } from "./artifact-ui";

const native = vi.hoisted(() => ({
  keyboardListeners: [] as ((event: { height: number }) => void)[],
  scrollIntoViewRequests: [] as string[],
}));

function Textarea(props: PropsWithChildren<Record<string, unknown>>) {
  return createElement("textarea", props);
}

function ScrollView(props: PropsWithChildren<Record<string, unknown>>) {
  const target = props.scrollIntoView;
  if (typeof target === "string" && target) {
    native.scrollIntoViewRequests.push(target);
  }
  return createElement("scroll-view", props);
}

vi.mock("./taro-components", () => ({
  Button: "button",
  View: "view",
  Text: "text",
  Image: "image",
  Input: "input",
  Textarea,
  ScrollView,
}));

const { Artifacts } = await import("./artifacts");
const { NativeA2uiHost } = await import("./a2ui-host.native");
const { BottomSheet } = await import("./bottom-sheet");
const { ArtifactUiProvider } = await import("./artifact-ui");

const catalogId = "urn:example:consumer:catalog:keyboard";
const artifact: Artifact = {
  kind: "form",
  id: "inline_keyboard_form",
  title: "移动端内联表单",
  description: "第六项在键盘上方保持可见。",
  submitLabel: "提交",
  fields: Array.from({ length: 6 }, (_, index) => ({
    id: `field_${index + 1}`,
    label: `第 ${index + 1} 项`,
    type: "longText" as const,
    required: index === 0,
  })),
};

const adapter = {
  catalogId,
  validate: (messages: Parameters<typeof validateA2uiMessages>[0]) =>
    validateA2uiMessages(messages, { catalogIds: [catalogId] }),
  compile: (scope: string, blocks: Artifact[]) =>
    legacyArtifactsToA2ui(blocks, {
      catalogId,
      presentationId: `urn:example:presentation:${scope}`,
      revision: 1,
      surfaceId: (block) => `surface_${block.id}`,
      resourceUrl: ({ kind, block }) =>
        `/tenant-assets/keyboard-regression/${kind}/${block.id}`,
    }),
};

const controlsArtifact: Artifact = {
  kind: "form",
  id: "inline_keyboard_controls",
  title: "移动端输入控件",
  description: "内联输入使用原生键盘避让。",
  submitLabel: "提交",
  fields: [
    { id: "short", label: "短文本", type: "text", required: false },
    { id: "amount", label: "数字", type: "number", required: false },
    {
      id: "choice",
      label: "选项补充",
      type: "select",
      required: false,
      options: [{ id: "other", label: "其他" }],
      allowOther: true,
    },
  ],
};

const TextAdapter = ({ aiGenerated, external, ...props }: ArtifactTextProps) =>
  createElement("text", {
    ...props,
    "data-ai-generated": String(!!aiGenerated),
    "data-ai-external": String(!!external),
  });

const config: ArtifactUiConfig = {
  Text: TextAdapter,
  Portal: ({ children }: PropsWithChildren) => <>{children}</>,
  resolveResource: async (url) => url,
  previewImage: vi.fn(),
  openPage: vi.fn(),
  copyText: vi.fn(async () => undefined),
  notify: vi.fn(),
  renderIcon: (name) => name,
  nativeSheet: {
    getWindowHeight: () => 800,
    onKeyboardHeightChange: (listener) => {
      native.keyboardListeners.push(listener);
    },
    offKeyboardHeightChange: vi.fn(),
    onWindowResize: vi.fn(),
    offWindowResize: vi.fn(),
  },
};

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  native.keyboardListeners.length = 0;
  native.scrollIntoViewRequests.length = 0;
  vi.unstubAllEnvs();
});

it("inline mobile focus requests active-field visibility while preserving input", async () => {
  vi.stubEnv("TARO_ENV", "weapp");
  await act(async () => {
    renderer = create(
      <Artifacts
        config={config}
        Host={NativeA2uiHost}
        adapter={adapter}
        identity="keyboard-regression"
        artifacts={[artifact]}
        responses={{}}
      />,
    );
  });

  const fields = renderer!.root.findAllByType(Textarea);
  expect(renderer!.root.findAllByType(BottomSheet)).toHaveLength(0);
  expect(fields).toHaveLength(6);
  const sixth = fields[5]!;

  act(() => sixth.props.onFocus());
  await act(async () => {
    for (const listener of [...native.keyboardListeners])
      listener({ height: 300 });
  });
  act(() =>
    sixth.props.onInput({ detail: { value: "键盘打开时仍保留输入" } }),
  );

  const currentSixth = renderer!.root.findAllByType(Textarea)[5]!;
  expect(currentSixth.props.value).toBe("键盘打开时仍保留输入");
  expect(currentSixth.props.adjustPosition).toBe(true);
  expect(currentSixth.props.cursorSpacing).toBe(24);
});

it("lets inline short text, number, and choice-other inputs use native lift", async () => {
  vi.stubEnv("TARO_ENV", "weapp");
  await act(async () => {
    renderer = create(
      <Artifacts
        config={config}
        Host={NativeA2uiHost}
        adapter={adapter}
        identity="keyboard-regression-controls"
        artifacts={[controlsArtifact]}
        responses={{}}
      />,
    );
  });

  const inputs = renderer!.root.findAllByType("input");
  expect(inputs.map((input) => input.props.type ?? null)).toEqual([
    "text",
    "digit",
    null,
  ]);
  expect(inputs[2]!.props.className).toContain("artifact-other-input");
  for (const input of inputs) {
    expect(input.props.adjustPosition).toBe(true);
    expect(input.props.cursorSpacing).toBe(24);
  }
});

it("delegates sheet focus without native double lift", async () => {
  vi.stubEnv("TARO_ENV", "weapp");
  await act(async () => {
    renderer = create(
      <ArtifactUiProvider config={config}>
        <BottomSheet title="表单详情" onClose={() => undefined}>
          <Artifacts
            config={config}
            Host={NativeA2uiHost}
            adapter={adapter}
            identity="keyboard-regression-sheet"
            artifacts={[artifact]}
            responses={{}}
          />
        </BottomSheet>
      </ArtifactUiProvider>,
    );
  });

  const sixth = renderer!.root.findAllByType(Textarea)[5]!;
  const target = "artifact_field_field_6";
  expect(renderer!.root.findAllByType(BottomSheet)).toHaveLength(1);
  expect(sixth.props.adjustPosition).toBe(false);
  expect(sixth.props.cursorSpacing).toBe(24);

  act(() => sixth.props.onFocus());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(native.scrollIntoViewRequests).toContain(target);
});
