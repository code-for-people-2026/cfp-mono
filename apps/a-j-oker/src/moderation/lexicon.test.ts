import { describe, expect, it, vi, afterEach } from "vitest";
import { createHash } from "node:crypto";
import base from "./lexicon.json";
import project from "./project-lexicon.json";
import lexicon from "./lexicon";
import { createKeywordMatcher, normalizeKeywordText } from "../domain/keyword-matcher";
import { activeRule, builtinLexicon, defaultRule } from "../operations/policy";
import { evaluateText } from "../domain/moderation";
import { completeDeepSeek } from "../models/deepseek";
import type { Payload } from "payload";

vi.mock("../models/deepseek", async original => ({ ...await original<typeof import("../models/deepseek")>(), completeDeepSeek: vi.fn() }));
afterEach(() => vi.resetAllMocks());
describe("project lexicon integration", () => {
  it("preserves public ordering and recalls every project phrase including normalized input", () => {
    expect(lexicon.words.slice(0, base.words.length)).toEqual(base.words);
    expect(new Set(lexicon.words).size).toBe(lexicon.words.length);
    const find = createKeywordMatcher(lexicon.words);
    for (const entry of project.entries) {
      expect(find(`请帮我${entry.word}。`, Infinity)).toContain(normalizeKeywordText(entry.word));
      expect(find(`请解释为什么不能${entry.word}。`, Infinity)).toContain(normalizeKeywordText(entry.word));
    }
    expect(builtinLexicon.sha256).toBe(createHash("sha256").update(JSON.stringify(lexicon.words)).digest("hex"));
    expect(defaultRule.lexiconVersion).toBe(lexicon.version);
  });
  it("allows a harmless quotation after semantic review despite a new phrase match", async () => {
    vi.mocked(completeDeepSeek).mockResolvedValue({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: '{"decision":"allow"}' } }] });
    const phrase = project.entries[0].word;
    const result = await evaluateText({ stage: "input", texts: [`请解释为什么要反对${phrase}。`], apiKey: "test-key", requestId: "test" }, defaultRule);
    expect(result.decision).toBe("allow");
    expect(result.keywordCount).toBeGreaterThan(0);
    expect(completeDeepSeek).toHaveBeenCalledOnce();
  });
  it("requires re-publication of an old released rule after the effective dictionary changes", async () => {
    const payload = { find: vi.fn().mockResolvedValue({ docs: [{ ruleId: 1 }] }), findByID: vi.fn().mockResolvedValue({ ...defaultRule, lexiconHash: createHash("sha256").update(JSON.stringify(base.words)).digest("hex") }) } as unknown as Payload;
    await expect(activeRule(payload)).rejects.toMatchObject({ status: 503 });
  });
});
