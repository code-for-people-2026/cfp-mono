import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/deepseek/client", () => ({ callDeepSeek: vi.fn() }));

import { callDeepSeek } from "../../lib/deepseek/client";
import { parseOrderInput, type RawParsedOrderInput } from "./parse";

const mockCall = vi.mocked(callDeepSeek);
const REF = "2020-06-01";

const validSnapshot = (over: Partial<RawParsedOrderInput> = {}): RawParsedOrderInput => ({
  mode: "snapshot",
  scope: [{ date: "2020-06-08", occasion: "dinner", dateEvidence: "6.8号星期一" }],
  items: [{ customerName: "桃子", date: "2020-06-08", occasion: "dinner", quantity: 8 }],
  unknownSegments: [],
  ...over,
});

const injected = (rawText: string, output: RawParsedOrderInput, referenceDate = REF) =>
  parseOrderInput(rawText, { referenceDate, generate: vi.fn(async () => output) });

describe("parseOrderInput deterministic validation", () => {
  it("accepts a snapshot with exact date evidence and ignores menu text", async () => {
    const raw = `#接龙\n6.8号星期一晚餐预定接龙\n1.凉拌牛肉\n例 桃子 1份晚餐\n\n1. 桃子 8份晚餐`;
    const result = await injected(raw, validSnapshot());
    expect(result).toMatchObject({ mode: "snapshot", issues: [], items: [{ customerName: "桃子", date: "2020-06-08", occasion: "dinner", quantity: 8 }] });
  });

  it("fails closed when evidence was not present in the user's text", async () => {
    const result = await injected("桃子 8份晚餐", validSnapshot());
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "date-evidence-missing" }));
  });

  it("fails closed when the normalized date disagrees with its evidence", async () => {
    const result = await injected("6.8号星期一晚餐 桃子8份", validSnapshot({
      scope: [{ date: "2020-06-09", occasion: "dinner", dateEvidence: "6.8号星期一" }],
      items: [{ customerName: "桃子", date: "2020-06-09", occasion: "dinner", quantity: 8 }],
    }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "date-mismatch" }));
  });

  it("fails closed when the stated weekday contradicts the calendar", async () => {
    const result = await injected("6.13号星期五午餐 桃子1份", validSnapshot({
      scope: [{ date: "2020-06-13", occasion: "lunch", dateEvidence: "6.13号星期五" }],
      items: [{ customerName: "桃子", date: "2020-06-13", occasion: "lunch", quantity: 1 }],
    }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "weekday-mismatch" }));
  });

  it("resolves relative evidence against the explicit Shanghai reference date", async () => {
    const result = await injected("明天晚餐，加王阿姨2份", {
      mode: "increment",
      operation: "add",
      scope: [{ date: "2026-07-13", occasion: "dinner", dateEvidence: "明天晚餐" }],
      items: [{ customerName: "王阿姨", date: "2026-07-13", occasion: "dinner", quantity: 2 }],
      unknownSegments: [],
    }, "2026-07-12");
    expect(result.issues).toEqual([]);
    expect(result.operation).toBe("add");
  });

  it("requires increment to have exactly one item and an add/set operation", async () => {
    const result = await injected("6月8日晚餐 王阿姨2份", validSnapshot({
      mode: "increment",
      operation: undefined,
      scope: [{ date: "2020-06-08", occasion: "dinner", dateEvidence: "6月8日晚餐" }],
      items: [],
    }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "increment-shape" }));
  });

  it("blocks unknown suspected-order segments and an empty snapshot", async () => {
    const result = await injected("6.8号星期一晚餐\n1. 王阿姨？", validSnapshot({ items: [], unknownSegments: ["1. 王阿姨？"] }));
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["unknown-segment", "empty-snapshot"]));
  });

  it("blocks an item whose date/occasion is outside the declared scope", async () => {
    const result = await injected("6.8号星期一晚餐 桃子8份", validSnapshot({
      items: [{ customerName: "桃子", date: "2020-06-08", occasion: "lunch", quantity: 8 }],
    }));
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "item-outside-scope" }));
  });
});

describe("parseOrderInput default DeepSeek generation", () => {
  beforeEach(() => mockCall.mockReset());

  it("strips fenced JSON and injects the reference date into the prompt", async () => {
    mockCall.mockResolvedValueOnce(`结果：\n\`\`\`json\n${JSON.stringify(validSnapshot())}\n\`\`\``);
    const result = await parseOrderInput("6.8号星期一晚餐 桃子8份", { referenceDate: REF });
    expect(result.items).toHaveLength(1);
    expect(mockCall.mock.calls[0]?.[0].messages[0]?.content).toContain(REF);
  });

  it("retries once on invalid JSON then succeeds", async () => {
    mockCall.mockResolvedValueOnce("not json").mockResolvedValueOnce(JSON.stringify(validSnapshot()));
    expect((await parseOrderInput("6.8号星期一晚餐 桃子8份", { referenceDate: REF })).items).toHaveLength(1);
    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("throws after schema-invalid output exhausts its retry", async () => {
    mockCall.mockResolvedValue('{"mode":"snapshot","scope":[],"items":[],"unknownSegments":[]}');
    await expect(parseOrderInput("x", { referenceDate: REF })).rejects.toThrow(/解析失败/);
    expect(mockCall).toHaveBeenCalledTimes(2);
  });

  it("pins deepseek-chat unless an explicit model override is configured", async () => {
    const original = process.env.DEEPSEEK_MODEL;
    delete process.env.DEEPSEEK_MODEL;
    mockCall.mockResolvedValueOnce(JSON.stringify(validSnapshot()));
    await parseOrderInput("6.8号星期一晚餐 桃子8份", { referenceDate: REF });
    expect(mockCall.mock.calls[0]?.[0].model).toBe("deepseek-chat");

    process.env.DEEPSEEK_MODEL = "other-model";
    mockCall.mockResolvedValueOnce(JSON.stringify(validSnapshot()));
    await parseOrderInput("6.8号星期一晚餐 桃子8份", { referenceDate: REF });
    expect(mockCall.mock.calls[1]?.[0].model).toBe("other-model");
    if (original === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = original;
  });
});
