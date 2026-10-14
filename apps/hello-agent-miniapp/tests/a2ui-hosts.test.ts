import { createElement, type ComponentType } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  A2UI_VERSION,
  toA2ui,
  validateA2uiMessages,
  type A2uiMessage,
  type FormValues,
  type ClientEvent,
} from "@cfp/hello-agent-protocol";
import { artifacts } from "../../../packages/hello-agent-protocol/test/fixtures";
import type { HostProps } from "../src/chat/a2ui-feed";
vi.mock("@tarojs/taro", () => ({ default: { previewImage: vi.fn() } }));
vi.mock("@tarojs/components", () => ({
  Button: "button",
  View: "view",
  Text: "text",
  Image: "image",
  Input: "input",
  Textarea: "textarea",
  ScrollView: "scroll-view",
}));
vi.mock("../src/chat/api", () => ({
  privateImageSource: vi.fn().mockResolvedValue("/private/fixture.png"),
}));
import { A2uiHost as NativeHost } from "../src/chat/a2ui-host";
import { A2uiHost as WebHost } from "../src/chat/a2ui-host.h5";
import { ArtifactState } from "../src/chat/artifact-components";

let renderer: ReactTestRenderer | undefined;
afterEach(() => {
  if (renderer) act(() => renderer!.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const formMessages = () =>
  toA2ui(
    1,
    artifacts.filter((artifact) => artifact.kind === "form"),
  );
const formId = "turn_1_thought_record";
const text = () => JSON.stringify(renderer!.toJSON());
const fields = () =>
  renderer!.root.findAll((node) =>
    ["input", "textarea"].includes(String(node.type)),
  );
const submit = () =>
  renderer!.root
    .findAllByType("button")
    .find((node) => node.props.className?.includes("artifact-submit"))!;
function view(
  Host: ComponentType<HostProps>,
  messages: A2uiMessage[],
  onAction?: (event: ClientEvent) => Promise<void>,
  answers?: FormValues,
) {
  return createElement(Host, {
    messages: validateA2uiMessages(messages),
    renderSurface: (surface, content) =>
      createElement(ArtifactState, {
        key: surface.id,
        surface,
        onAction,
        initialValues: answers,
        submitted: !!answers,
        children: content,
      }),
  });
}
for (const [platform, Host] of [
  ["weapp", NativeHost],
  ["h5", WebHost],
] as const) {
  describe(`${platform} 官方 A2UI 集成`, () => {
    it("五种作品使用真实核心渲染；小程序无需 DOM 和动态函数", async () => {
      vi.stubEnv("TARO_ENV", platform);
      if (platform === "weapp") {
        vi.stubGlobal("Function", function DisabledFunction() {
          throw new Error("小程序禁止动态函数");
        });
        vi.stubGlobal("document", undefined);
        vi.stubGlobal("window", undefined);
      }
      await act(async () => {
        renderer = create(view(Host, toA2ui(1, artifacts)));
      });
      for (const artifact of artifacts)
        expect(text()).toContain(artifact.title);
      expect(renderer!.root.findAllByType("image")[0]!.props.src).toBe(
        "/private/fixture.png",
      );
      expect(fields()).toHaveLength(4);
      if (platform === "weapp") {
        const types = new Set(
          renderer!.root
            .findAll((node) => typeof node.type === "string")
            .map((node) => node.type),
        );
        expect(
          [...types].every((type) =>
            [
              "view",
              "text",
              "image",
              "scroll-view",
              "input",
              "textarea",
              "button",
            ].includes(String(type)),
          ),
        ).toBe(true);
      } else
        expect(
          renderer!.root.findAll((node) => node.props["data-surface-id"])
            .length,
        ).toBe(5);
    });
    it("逐条消息、零值与删除由真实数据模型处理，组件原位更新", async () => {
      let messages: A2uiMessage[] = [];
      await act(async () => {
        renderer = create(view(Host, messages));
      });
      for (const message of formMessages()) {
        messages = [...messages, message];
        await act(async () => {
          renderer!.update(view(Host, messages));
        });
      }
      const update: A2uiMessage = {
        version: A2UI_VERSION,
        updateDataModel: {
          surfaceId: formId,
          path: "/values/intensity",
          value: 0,
        },
      };
      messages = [
        ...messages,
        update,
        {
          version: A2UI_VERSION,
          updateComponents: {
            surfaceId: formId,
            components: [
              { id: "title", component: "Text", text: "更新后的练习" },
            ],
          },
        },
      ];
      await act(async () => {
        renderer!.update(view(Host, messages));
      });
      expect(
        fields().find((node) => node.props.type === "digit")!.props.value,
      ).toBe("0");
      expect(text()).toContain("更新后的练习");
      messages = [
        ...messages,
        {
          version: A2UI_VERSION,
          updateDataModel: { surfaceId: formId, path: "/values/intensity" },
        },
      ];
      await act(async () => {
        renderer!.update(view(Host, messages));
      });
      expect(
        fields().find((node) => node.props.type === "digit")!.props.value,
      ).toBe("");
      messages = [
        ...messages,
        { version: A2UI_VERSION, deleteSurface: { surfaceId: formId } },
      ];
      await act(async () => {
        renderer!.update(view(Host, messages));
      });
      expect(fields()).toHaveLength(0);
    });
    it("原生动作回传准确 ID，失败可见且刷新保留答案，重试后恢复并锁定", async () => {
      const onAction = vi
        .fn()
        .mockRejectedValueOnce(new Error("网络暂时不可用"))
        .mockResolvedValue(undefined);
      await act(async () => {
        renderer = create(view(Host, formMessages(), onAction));
      });
      for (const field of fields())
        act(() =>
          field.props.onInput({
            detail: {
              value: field.props.type === "digit" ? "0" : "会议说错数字",
            },
          }),
        );
      expect(onAction).not.toHaveBeenCalled();
      await act(async () => {
        submit().props.onClick();
      });
      expect(text()).toContain("网络暂时不可用");
      expect(onAction).toHaveBeenCalledTimes(1);
      expect(onAction.mock.calls[0]![0]).toMatchObject({
        version: A2UI_VERSION,
        action: {
          name: "submit_form",
          surfaceId: formId,
          sourceComponentId: "submit",
          context: { values: { intensity: 0, situation: "会议说错数字" } },
        },
      });
      await act(async () => {
        renderer!.update(view(Host, formMessages(), onAction));
      });
      expect(fields().map((node) => node.props.value)).toEqual([
        "会议说错数字",
        "会议说错数字",
        "会议说错数字",
        "0",
      ]);
      await act(async () => {
        submit().props.onClick();
        submit().props.onClick();
      });
      expect(onAction).toHaveBeenCalledTimes(2);
      const answers = onAction.mock.calls[1]![0].action.context.values;
      await act(async () => {
        renderer!.update(view(Host, formMessages(), onAction, answers));
      });
      expect(submit().props.disabled).toBe(true);
      expect(fields().every((node) => node.props.disabled)).toBe(true);
    });
    it("提交中更换回调不会重复派发，下一次提交使用最新回调", async () => {
      let finish!: () => void;
      const pending = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const firstAction = vi.fn().mockReturnValue(pending);
      const nextAction = vi.fn().mockResolvedValue(undefined);
      await act(async () => {
        renderer = create(view(Host, formMessages(), firstAction));
      });
      for (const field of fields())
        act(() =>
          field.props.onInput({
            detail: {
              value: field.props.type === "digit" ? "0" : "会议说错数字",
            },
          }),
        );
      await act(async () => {
        submit().props.onClick();
      });
      expect(firstAction).toHaveBeenCalledTimes(1);
      await act(async () => {
        renderer!.update(view(Host, formMessages(), nextAction));
      });
      await act(async () => {
        finish();
        await pending;
      });
      expect(nextAction).not.toHaveBeenCalled();
      await act(async () => {
        await submit().props.onClick();
      });
      expect(nextAction).toHaveBeenCalledTimes(1);
    });
    it("切换会话替换旧 surface，不串用上一个表单草稿", async () => {
      const onAction = vi.fn().mockResolvedValue(undefined);
      await act(async () => {
        renderer = create(view(Host, formMessages(), onAction));
      });
      act(() =>
        fields()[0]!.props.onInput({ detail: { value: "上一段私有草稿" } }),
      );
      await act(async () => {
        renderer!.update(view(Host, toA2ui(2, [artifacts[4]!]), onAction));
      });
      expect(fields()[0]!.props.value).toBe("");
      expect(text()).not.toContain("上一段私有草稿");
    });
  });
}
