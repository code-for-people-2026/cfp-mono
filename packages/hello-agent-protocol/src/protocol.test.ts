import { describe, it, expect } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import serverSchema from "../spec/server_to_client.json";
import clientSchema from "../spec/client_to_server.json";
import commonSchema from "../spec/common_types.json";
import { artifacts } from "../test/fixtures";
import {
  A2UI_VERSION,
  applyA2ui,
  toA2ui,
  formAction,
  type Surfaces,
} from "./a2ui";
import { a2uiCatalog } from "./catalog";
import { artifactsSchema, clientEventSchema, validateForm } from "./artifacts";
import { createRunReader } from "./stream";

describe("A2UI 互操作与用户填写", () => {
  it("五类作品和 action 均符合上游 v0.9.1 JSON Schema 与声明的目录", () => {
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    addFormats(ajv);
    ajv.addSchema(commonSchema);
    ajv.addSchema(
      a2uiCatalog(),
      "https://a2ui.org/specification/v0_9/catalog.json",
    );
    const server = ajv.compile(serverSchema);
    const client = ajv.compile(clientSchema);
    const messages = toA2ui(7, artifacts);
    messages.forEach((message) =>
      expect(server(message), JSON.stringify(server.errors)).toBe(true),
    );
    const surfaces = messages.reduce<Surfaces>(applyA2ui, {});
    expect(Object.keys(surfaces)).toHaveLength(5);
    const action = formAction(surfaces.turn_7_thought_record!, {
      situation: "我说错了一个数字",
      intensity: 0,
    });
    expect(client(action), JSON.stringify(client.errors)).toBe(true);
    expect(clientEventSchema.safeParse(action).success).toBe(true);
  });
  it("拒绝陌生目录、脚本组件、远程图片、重复 ID、不齐的表格与危险字段", () => {
    expect(() =>
      applyA2ui(
        {},
        {
          version: A2UI_VERSION,
          createSurface: { surfaceId: "turn_1_card", catalogId: "evil" },
        },
      ),
    ).toThrow();
    const state = toA2ui(1, [artifacts[0]]).reduce<Surfaces>(applyA2ui, {});
    for (const component of [
      { id: "bad", component: "Script", code: "alert(1)" },
      {
        id: "bad",
        component: "Image",
        url: "https://evil.test/track",
        alt: "bad",
      },
    ])
      expect(() =>
        applyA2ui(state, {
          version: A2UI_VERSION,
          updateComponents: {
            surfaceId: "turn_1_one_step",
            components: [component],
          },
        }),
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
  it("表单保留数字 0、校验必填和范围，不接受伪造的字段", () => {
    const form = artifacts.find((item) => item.kind === "form")!;
    if (form.kind !== "form") throw new Error("missing form");
    expect(
      validateForm(form, { situation: "事情", intensity: 0 }),
    ).toBeUndefined();
    expect(validateForm(form, { intensity: 20 })).toContain("发生了什么");
    expect(validateForm(form, { situation: "事情", intensity: 101 })).toContain(
      "100",
    );
    expect(
      validateForm(form, { situation: "事情", injected: "admin" }),
    ).toContain("未知字段");
  });
  it("支持数据更新与删除，拒绝原型路径和乱序更新", () => {
    const messages = toA2ui(8, [artifacts[4]]);
    let state = messages.reduce<Surfaces>(applyA2ui, {});
    const update = {
      version: A2UI_VERSION,
      updateDataModel: {
        surfaceId: "turn_8_thought_record",
        path: "/values/intensity",
        value: 0,
      },
    };
    state = applyA2ui(state, update);
    expect(state.turn_8_thought_record?.values.intensity).toBe(0);
    expect(() => applyA2ui({}, update)).toThrow();
    expect(() =>
      applyA2ui(state, {
        ...update,
        updateDataModel: {
          ...update.updateDataModel,
          path: "/__proto__/polluted",
        },
      }),
    ).toThrow();
    state = applyA2ui(state, {
      ...update,
      updateDataModel: { ...update.updateDataModel, value: undefined },
    });
    expect(state.turn_8_thought_record?.values.intensity).toBeUndefined();
    expect(
      applyA2ui(state, {
        version: A2UI_VERSION,
        deleteSurface: { surfaceId: "turn_8_thought_record" },
      }),
    ).toEqual({});
  });
});

describe("AG-UI 传输恢复", () => {
  const events = [
    { type: "RUN_STARTED", runId: "run", threadId: "1" },
    { type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" },
    { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "且慢，先看眼前。" },
    { type: "TEXT_MESSAGE_END", messageId: "m" },
    ...toA2ui(1, [artifacts[0]]).map((value) => ({
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
      expect(Object.keys(reader.finish().surfaces)).toHaveLength(1);
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
});
