import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { artifacts } from "../../../packages/base-chat-protocol/test/fixtures";
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

it("AJ 多图只选择一个输出且不改写原作品；点开、预览和关闭仍可用", async () => {
  const image = artifacts.find((item) => item.kind === "image")!;
  const inputs = [image, { ...image, id: "second", title: "第二张图片" }];
  const before = structuredClone(inputs);
  await act(async () => {
    renderer = create(
      createElement(Artifacts, {
        turnId: 1,
        artifacts: inputs,
        responses: {},
      }),
    );
  });
  expect(inputs).toEqual(before);
  expect(byClass("artifact-preview")).toHaveLength(1);
  expect(byClass("artifact-thumbnail-image")).toHaveLength(1);
  expect(byClass("artifact-thumbnail-image")[0]!.props.mode).toBe("aspectFit");
  expect(byClass("artifact-image")).toHaveLength(0);
  expect(text()).toContain(image.title);
  expect(text()).not.toContain("第二张图片");
  await click("artifact-preview");
  expect(
    renderer.root.findAll((node) => String(node.type) === "root-portal"),
  ).toHaveLength(1);
  expect(byClass("artifact-image")).toHaveLength(1);
  expect(byClass("artifact-image")[0]!.props.mode).toBe("widthFix");
  expect(byClass("artifact-image")[0]!.props.src).toBe(
    byClass("artifact-thumbnail-image")[0]!.props.src,
  );
  act(() => byClass("artifact-image")[0]!.props.onClick());
  expect(platform.previewImage).toHaveBeenCalledWith({
    urls: ["/api/hello/artifact-image/1/sun.png"],
    current: "/api/hello/artifact-image/1/sun.png",
  });
  await click("detail-close");
  expect(
    renderer.root.findAll((node) => String(node.type) === "root-portal"),
  ).toHaveLength(0);
  expect(byClass("artifact-image")).toHaveLength(0);
});
it("表单控件原位显示，不创建弹层或键盘监听", async () => {
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
  expect(text()).toContain(form.title);
  expect(renderer.root.findAllByType("textarea")).toHaveLength(1);
  expect(byClass("artifact-preview")).toHaveLength(0);
  expect(byClass("detail-overlay")).toHaveLength(0);
  expect(
    renderer.root.findAll((node) => String(node.type) === "root-portal"),
  ).toHaveLength(0);
  expect(platform.onKeyboardHeightChange).not.toHaveBeenCalled();
});
it("普通作品底部面板响应键盘几何变化，关闭时移除监听", async () => {
  vi.stubEnv("TARO_ENV", "weapp");
  const page = artifacts.find((item) => item.kind === "page")!;
  await act(async () => {
    renderer = create(
      createElement(Artifacts, {
        turnId: 1,
        artifacts: [page],
        responses: {},
      }),
    );
  });
  await click("artifact-preview");
  await act(async () => {
    platform.onKeyboardHeightChange.mock.lastCall![0]({ height: 320 });
  });
  expect(byClass("detail-overlay")[0]!.props.style.bottom).toBe("320px");
  expect(
    parseFloat(byClass("detail-sheet")[0]!.props.style.height),
  ).toBeLessThan(480);
  const listener = platform.onKeyboardHeightChange.mock.lastCall![0];
  await click("sheet-backdrop");
  expect(platform.offKeyboardHeightChange).toHaveBeenCalledWith(listener);
  expect(byClass("detail-overlay")).toHaveLength(0);
});
it("回应依据默认是一行入口，完整内容和心理视角放在底部面板", async () => {
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
  expect(text()).not.toContain("认知行为视角");
  expect(text()).toContain("看看为什么这样说 ＋");
  await click("evidence-toggle");
  expect(text()).toContain(association);
  expect(text()).toContain("认知行为视角");
  await click("detail-close");
  expect(text()).not.toContain(association);
});
