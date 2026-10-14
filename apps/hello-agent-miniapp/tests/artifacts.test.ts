import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import { artifacts } from "../../../packages/hello-agent-protocol/test/fixtures";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@tarojs/taro", () => ({ default: mocks }));
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
afterEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("微信禁用动态函数仍可经 AG-UI 接收五类作品，查询确认保存，并回传零分表单", async () => {
  vi.stubEnv("TARO_ENV", "weapp");
  vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
  const { generate } = await import("../src/chat/api");
  const { toA2ui } = await import("@cfp/hello-agent-protocol");
  vi.stubGlobal("Function", function WechatFunction() {});
  const id = "13b11c49-812c-4193-9b10-530d8ae94d09";
  const events = [
    { type: "RUN_STARTED", runId: id },
    ...toA2ui(1, artifacts).map((value) => ({
      type: "CUSTOM",
      name: "a2ui",
      value,
    })),
    { type: "RUN_FINISHED", runId: id },
  ];
  const input = {
    text: "提交练习表单",
    mediaIds: [],
    formResponse: {
      turnId: 1,
      artifactId: "thought_record",
      values: { situation: "会议", intensity: 0 },
    },
  };
  const turn = {
    id: 2,
    input,
    status: "completed",
    mode: "platform",
    greeting: "已接着回应",
    createdAt: "2026-10-11",
    artifacts,
  };
  mocks.request.mockImplementation(async ({ url }) => ({
    statusCode: 200,
    data: url.endsWith("/ag-ui")
      ? events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
      : { turn },
  }));
  const progress = vi.fn();
  await expect(
    generate(1, id, "platform", input, undefined, progress),
  ).resolves.toEqual(turn);
  expect(
    progress.mock.lastCall![0].messages.filter(
      (message: object) => "createSurface" in message,
    ),
  ).toHaveLength(5);
  const request = mocks.request.mock.calls[0][0];
  expect(request.dataType).toBe("text");
  expect(
    request.data.forwardedProps.clientEvent.action.context.values.intensity,
  ).toBe(0);
  expect(mocks.request.mock.lastCall![0].url).toContain(`/requests/${id}`);
});

it("真实表单组件保留零值，只在提交时发出 A2UI 动作，恢复后锁定已提交表单", async () => {
  vi.stubEnv("TARO_ENV", "weapp");
  vi.stubGlobal("HELLO_API_ORIGIN", "https://example.test");
  const { Artifacts } = await import("../src/chat/artifacts");
  const form = artifacts.filter((item) => item.kind === "form");
  const onAction = vi.fn().mockResolvedValue(undefined);
  let renderer: ReturnType<typeof create>;
  await act(async () => {
    renderer = create(
      createElement(Artifacts, {
        turnId: 1,
        artifacts: form,
        responses: {},
        onAction,
      }),
    );
  });
  try {
    await act(async () => {
      renderer!.root.findByType("button").props.onClick();
    });
    for (const field of renderer!.root.findAll((node) =>
      ["input", "textarea"].includes(String(node.type)),
    ))
      act(() =>
        field.props.onInput({
          detail: {
            value: field.props.type === "digit" ? "0" : "会议说错数字，已更正",
          },
        }),
      );
    expect(onAction).not.toHaveBeenCalled();
    await act(async () => {
      renderer!.root
        .findAllByType("button")
        .find((node) => node.props.className?.includes("artifact-submit"))!
        .props.onClick();
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].action.context.values.intensity).toBe(0);
    await act(async () => {
      renderer!.update(
        createElement(Artifacts, {
          turnId: 1,
          artifacts: form,
          responses: {
            turn_1_thought_record:
              onAction.mock.calls[0][0].action.context.values,
          },
          onAction,
        }),
      );
    });
    await act(async () => {
      renderer!.root.findByType("button").props.onClick();
    });
    expect(
      renderer!.root
        .findAllByType("button")
        .find((node) => node.props.className?.includes("artifact-submit"))!
        .props.disabled,
    ).toBe(true);
  } finally {
    act(() => renderer!.unmount());
  }
});
