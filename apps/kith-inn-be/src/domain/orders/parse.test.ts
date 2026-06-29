import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/deepseek/client", () => ({ callDeepSeek: vi.fn() }));

import { callDeepSeek } from "../../lib/deepseek/client";
import { parseJielong } from "./parse";

const mockCall = vi.mocked(callDeepSeek);

describe("parseJielong (default generate)", () => {
  beforeEach(() => mockCall.mockReset());

  it("parses a clean JSON response into items", async () => {
    mockCall.mockResolvedValueOnce(
      '{"items":[{"customerName":"桃子","quantity":8,"occasion":"dinner"}],"unknownSegments":[]}',
    );
    const r = await parseJielong("接龙…");
    expect(r.items).toEqual([{ customerName: "桃子", quantity: 8, occasion: "dinner" }]);
    expect(r.unknownSegments).toEqual([]);
  });

  it("strips ```json code fences + surrounding prose", async () => {
    mockCall.mockResolvedValueOnce('好的，结果如下：\n```json\n{"items":[],"unknownSegments":["某行"]}\n```\n');
    const r = await parseJielong("x");
    expect(r.unknownSegments).toEqual(["某行"]);
  });

  it("retries once on a non-JSON response then succeeds", async () => {
    mockCall.mockResolvedValueOnce("抱歉，我没看懂").mockResolvedValueOnce('{"items":[],"unknownSegments":[]}');
    expect((await parseJielong("x")).items).toEqual([]);
    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("throws after retry exhaustion", async () => {
    mockCall.mockResolvedValue("still not json");
    await expect(parseJielong("x")).rejects.toThrow(/解析失败/);
    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("rejects schema-invalid output (bad occasion) and retries", async () => {
    mockCall.mockResolvedValueOnce('{"items":[{"customerName":"x","quantity":1,"occasion":"supper"}],"unknownSegments":[]}');
    mockCall.mockResolvedValueOnce('{"items":[{"customerName":"x","quantity":1,"occasion":"dinner"}],"unknownSegments":[]}');
    expect((await parseJielong("x")).items[0]?.occasion).toBe("dinner");
  });

  it("pins the model to deepseek-chat when DEEPSEEK_MODEL is unset OR empty (Codex)", async () => {
    const orig = process.env.DEEPSEEK_MODEL;
    for (const v of [undefined, ""]) {
      if (v === undefined) delete process.env.DEEPSEEK_MODEL;
      else process.env.DEEPSEEK_MODEL = v;
      mockCall.mockResolvedValueOnce('{"items":[],"unknownSegments":[]}');
      await parseJielong("x");
      expect(mockCall.mock.calls.at(-1)?.[0].model).toBe("deepseek-chat");
    }
    process.env.DEEPSEEK_MODEL = orig;
  });

  it("respects an explicit DEEPSEEK_MODEL override", async () => {
    const orig = process.env.DEEPSEEK_MODEL;
    process.env.DEEPSEEK_MODEL = "some-other-model";
    mockCall.mockResolvedValueOnce('{"items":[],"unknownSegments":[]}');
    await parseJielong("x");
    expect(mockCall.mock.calls.at(-1)?.[0].model).toBe("some-other-model");
    process.env.DEEPSEEK_MODEL = orig;
  });
});

describe("parseJielong (injected generate — pure pass-through)", () => {
  it("delegates to the injected generate", async () => {
    const generate = vi.fn(async () => ({ items: [{ customerName: "lily", quantity: 1, occasion: "lunch" as const }], unknownSegments: [] }));
    const r = await parseJielong("x", generate);
    expect(generate).toHaveBeenCalledOnce();
    expect(r.items[0]?.customerName).toBe("lily");
  });
});
