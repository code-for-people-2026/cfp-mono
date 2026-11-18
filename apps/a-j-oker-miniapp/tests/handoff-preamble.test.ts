import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { RunProgress } from "@cfp/base-chat-protocol";
import type { Turn } from "../src/chat/model";
import {
  HandoffPreamble,
  handoffPreambleId,
  interimHandoffPreamble,
} from "../src/chat/handoff-preamble";

vi.mock("@tarojs/components", () => ({ Text: "text" }));
vi.mock("../src/chat/message-text", () => ({ MessageText: "message-text" }));

const persisted = "我听见了这件事。接下来请这位 AI 专家一起把它说清楚。";

function row(id: number, text?: string) {
  return { id, handoffPreamble: text } as Turn;
}

function progress(id: string, text: string): RunProgress {
  return {
    text: "",
    messages: [],
    step: "AI 专家正在接着你刚才的话往下想",
    interimMessage: { id, text },
  };
}

describe("expert handoff preamble presentation", () => {
  it("keeps a persisted final or failed row authoritative over conflicting transient text", () => {
    for (const status of ["completed", "failed"] as const) {
      const history = [{ ...row(12, persisted), status } as Turn];
      expect(interimHandoffPreamble(
        history,
        progress(handoffPreambleId(12), "迟到的另一段前导说明。"),
      )).toBeUndefined();
    }
  });

  it("does not deduplicate identical text from a different turn", () => {
    const message = progress("handoff_preamble_14", persisted).interimMessage;
    expect(interimHandoffPreamble(
      [row(13, persisted)],
      progress("handoff_preamble_14", persisted),
    )).toEqual(message);
  });

  it("shows an uncommitted current-run preamble once by its stable ID", () => {
    const message = {
      id: handoffPreambleId(14),
      text: persisted,
    };
    expect(interimHandoffPreamble([row(15, "上一轮已经保存的前导。")], progress(message.id, message.text)))
      .toEqual(message);
    expect(interimHandoffPreamble([row(15)], undefined)).toBeUndefined();
  });

  it("renders AJ prose and independently gates successful handoff metadata outside the expert frame", () => {
    let renderer: TestRenderer.ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(createElement(
        HandoffPreamble,
        { text: persisted },
      ));
    });
    expect(JSON.stringify(renderer?.toJSON())).toContain(persisted);
    expect(JSON.stringify(renderer?.toJSON())).toContain('"aiGenerated":true');
    act(() => renderer?.unmount());

    const page = readFileSync("src/pages/chat/index.tsx", "utf8");
    const historyPreamble = page.indexOf("<HandoffPreamble text={row.handoffPreamble} />");
    const presentationFrame = page.indexOf("<PresentationFrame", historyPreamble);
    const pendingPreamble = page.indexOf("<HandoffPreamble text={interimPreamble.text} />");
    const loader = page.indexOf("<DancingLoader", pendingPreamble);
    expect(historyPreamble).toBeGreaterThan(-1);
    expect(presentationFrame).toBeGreaterThan(historyPreamble);
    expect(pendingPreamble).toBeGreaterThan(-1);
    expect(loader).toBeGreaterThan(pendingPreamble);
    expect(page).toMatch(
      /\{row\.handoffPreamble && \([\s\S]*?<HandoffPreamble text=\{row\.handoffPreamble\} \/>[\s\S]*?\)\}\s*\{firstHandoff && \([\s\S]*?specialist-handoff-notice[\s\S]*?\)\}\s*<PresentationFrame/,
    );
    expect(page).toMatch(
      /if \(!origin\) \{[\s\S]*?return row\.handoffPreamble[\s\S]*?: turnContent;[\s\S]*?\}\s*const firstHandoff = !history\s*\.slice\(0, history\.findIndex\(\(item\) => item\.id === row\.id\)\)\s*\.some\(\(previous\) => specialistPresentationForTurn\(previous\)\?\.id === origin\.id\)/,
    );
    expect(page).toMatch(/busy && !pending[\s\S]*?<HandoffPreamble text=\{interimPreamble\.text\}/);
    const pendingStage = page.slice(page.indexOf("{pending && ("), page.indexOf("{busy && !pending"));
    expect(pendingStage).toContain("<HandoffPreamble text={interimPreamble.text} />");
    expect(pendingStage).not.toContain("specialist-handoff-notice");
    expect(page).not.toContain("interimPreamble.text || progress.text");
  });
});
