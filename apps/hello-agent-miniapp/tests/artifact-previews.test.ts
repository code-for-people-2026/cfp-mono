import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { artifacts } from "../../../packages/hello-agent-protocol/test/fixtures";
const platform = vi.hoisted(() => ({
  previewImage: vi.fn(),
  getWindowInfo: vi.fn(() => ({ windowHeight: 800 })),
  onKeyboardHeightChange: vi.fn(),
  offKeyboardHeightChange: vi.fn(),
  onWindowResize: vi.fn(),
  offWindowResize: vi.fn(),
}));
vi.mock("@tarojs/taro", () => ({ default: platform }));
vi.mock("@tarojs/components", () => ({
  Button: "button",
  View: "view",
  Text: "text",
  Image: "image",
  Input: "input",
  Textarea: "textarea",
  ScrollView: "scroll-view",
  RootPortal: "root-portal",
}));
vi.mock("../src/chat/api", () => ({
  privateImageSource: vi.fn(async (url: string) => `${url}.png`),
}));
import { Artifacts } from "../src/chat/artifacts";
import { EvidenceCard } from "../src/chat/evidence-card";

let renderer: ReactTestRenderer;
afterEach(() => {
  act(() => renderer?.unmount());
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
const text = () => JSON.stringify(renderer.toJSON());
const byClass = (name: string) =>
  renderer.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      String(node.props.className).split(" ").includes(name),
  );
async function click(name: string) {
  await act(async () => {
    byClass(name)[0]!.props.onClick();
  });
}

it("多图只显示一张缩略图卡片，点开官方渲染的完整列表；关闭移除弹层", async () => {
  const image = artifacts.find((item) => item.kind === "image")!;
  await act(async () => {
    renderer = create(
      createElement(Artifacts, {
        turnId: 1,
        artifacts: [image, { ...image, id: "second", title: "第二张图片" }],
        responses: {},
      }),
    );
  });
  expect(byClass("artifact-preview")).toHaveLength(1);
  expect(byClass("artifact-thumbnail-image")).toHaveLength(2);
  expect(byClass("artifact-image")).toHaveLength(0);
  expect(text()).toContain("2 张图片");
  await click("artifact-preview");
  expect(
    renderer.root.findAll((node) => String(node.type) === "root-portal"),
  ).toHaveLength(1);
  expect(byClass("artifact-image")).toHaveLength(2);
  expect(text()).toContain("第二张图片");
  act(() => byClass("artifact-image")[1]!.props.onClick());
  expect(platform.previewImage).toHaveBeenCalledWith({
    urls: ["/api/hello/artifact-image/1/second.png"],
    current: "/api/hello/artifact-image/1/second.png",
  });
  await click("detail-close");
  expect(
    renderer.root.findAll((node) => String(node.type) === "root-portal"),
  ).toHaveLength(0);
  expect(byClass("artifact-image")).toHaveLength(0);
});
it("简单问答的键盘抬起时缩小面板，焦点字段滚动可见；关闭移除监听", async () => {
  vi.stubEnv("TARO_ENV", "weapp");
  const form = artifacts.find((item) => item.kind === "form")!;
  await act(async () => {
    renderer = create(
      createElement(Artifacts, {
        turnId: 1,
        artifacts: [{ ...form, fields: form.fields.slice(0, 1) }],
        responses: {},
        onAction: vi.fn(),
      }),
    );
  });
  expect(text()).toContain("简单问答");
  expect(renderer.root.findAllByType("textarea")).toHaveLength(0);
  await click("artifact-preview");
  await act(async () => {
    renderer.root.findByType("textarea").props.onFocus();
    platform.onKeyboardHeightChange.mock.lastCall![0]({ height: 320 });
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
  expect(byClass("detail-overlay")[0]!.props.style.bottom).toBe("320px");
  expect(
    parseFloat(byClass("detail-sheet")[0]!.props.style.height),
  ).toBeLessThan(480);
  expect(byClass("detail-scroll")[0]!.props.scrollIntoView).toBe(
    "artifact_field_situation",
  );
  const listener = platform.onKeyboardHeightChange.mock.lastCall![0];
  await click("sheet-backdrop");
  expect(platform.offKeyboardHeightChange).toHaveBeenCalledWith(listener);
  expect(byClass("detail-overlay")).toHaveLength(0);
});
it("回应依据默认仅显示摘要，完整内容放在底部面板", async () => {
  const association = "从日常里找一个可信的角度。".repeat(20);
  await act(async () => {
    renderer = create(
      createElement(EvidenceCard, {
        turn: {
          id: 1,
          input: { text: "测试", mediaIds: [] },
          greeting: "回应",
          status: "completed",
          mode: "platform",
          createdAt: "2026-10-14",
          association,
          approach: "cbt",
        },
      }),
    );
  });
  expect(text()).not.toContain(association);
  expect(text()).toContain("认知行为视角");
  await click("artifact-preview");
  expect(text()).toContain(association);
  await click("detail-close");
  expect(text()).not.toContain(association);
});
