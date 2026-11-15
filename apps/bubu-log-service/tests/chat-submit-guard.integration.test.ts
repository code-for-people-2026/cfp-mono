import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createHandler } from "../src/http";
import type { ChatInput, ChatProvider, ChatTurn, ProviderInput, ProviderOutput } from "../src/chat/contracts";
import { chatCollections } from "../src/chat/persistence";
import { ChatService } from "../src/chat/service";
import type { PendingQuestion, RecordReceipt } from "../src/records/types";
import { chatFixture, type ChatFixture } from "./fixtures/chat";

type Step = ProviderOutput | ((input: ProviderInput) => ProviderOutput | Promise<ProviderOutput>);

class ScriptedProvider implements ChatProvider {
  private readonly steps: Step[] = [];
  enqueue(...steps: Step[]) { this.steps.push(...steps); }
  async complete(input: ProviderInput): Promise<ProviderOutput> {
    if (input.responseFormat?.name === "bubu_reply_verdict") {
      return { text: JSON.stringify({ verdict: "pass", issues: [] }), calls: [] };
    }
    const step = this.steps.shift();
    if (!step) throw new Error("Unexpected model invocation: guard fixture exhausted");
    const output = typeof step === "function" ? await step(input) : step;
    if (!output.calls.length && input.responseFormat?.name === "bubu_chat_reply" && !output.text.trim().startsWith("{")) {
      return { ...output, text: JSON.stringify({ text: output.text, questions: [] }) };
    }
    return output;
  }
  tool(id: string, name: string, arguments_: Record<string, unknown>) {
    this.enqueue({ text: "", calls: [{ id, name, arguments: arguments_ }] });
  }
}

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function setup() {
  const fixture = await chatFixture(chatCollections);
  cleanup.push(() => fixture.close());
  const provider = new ScriptedProvider();
  let chat!: ChatService;
  const install = async () => {
    await fixture.listen();
    chat = new ChatService(fixture.identity, fixture.attachments, { mcpUrl: `${fixture.origin}/api/mcp`, provider });
    fixture.setHandler(createHandler(fixture.identity, fixture.origin, { allowedOrigins: [] }, {
      records: fixture.records, attachments: fixture.attachments, collector: fixture.collector, chat,
    }));
  };
  await install();
  return {
    fixture, provider, get chat() { return chat; },
    async restart() { await fixture.restart(); await install(); },
  };
}

async function call<T>(client: Client, name: string, arguments_: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: arguments_ });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  const content = result.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content[0]!.text!) as T;
}

const questionInput = (question: PendingQuestion) => ({ id: question.id, questionVersion: question.version, eventVersion: question.eventVersion });
const input = (requestId: string, question: PendingQuestion, extra: Partial<ChatInput> = {}): ChatInput => ({
  babyId: "baby-a", requestId, text: "补充这条待确认记录", attachmentIds: [],
  context: { viewedDate: "2026-10-23", selectedEventId: question.eventId }, question: questionInput(question), ...extra,
});

async function seedPending(fixture: ChatFixture) {
  const client = await fixture.connect();
  const pending = await call<RecordReceipt>(client, "bubu_record_events", {
    babyId: "baby-a", requestId: "guard-seed-pending", events: [{ facts: {
      type: "BOTTLE", startTime: "2026-10-23T11:00:00+08:00", durationMinutes: 10,
      milkItems: [{ id: "guard-milk", milkSource: "BREAST_MILK" }], burpSuccess: false,
    } }],
  });
  const other = await call<RecordReceipt>(client, "bubu_record_events", {
    babyId: "baby-a", requestId: "guard-seed-other", events: [{ facts: {
      type: "SLEEP", startTime: "2026-10-23T12:00:00+08:00", durationMinutes: 20,
    } }],
  });
  return { question: pending.questions[0]!, event: pending.events[0]!, other: other.events[0]! };
}

async function post(fixture: ChatFixture, body: ChatInput) {
  return fetch(`${fixture.origin}/api/app/chat`, {
    method: "POST",
    headers: { Authorization: `Bearer ${fixture.aliceToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function request(fixture: ChatFixture, requestId: string): Promise<ChatTurn | null> {
  const response = await fetch(`${fixture.origin}/api/app/chat/request?babyId=baby-a&requestId=${encodeURIComponent(requestId)}`, {
    headers: { Authorization: `Bearer ${fixture.aliceToken}` },
  });
  expect(response.status).toBe(200);
  return (await response.json() as { turn: ChatTurn | null }).turn;
}

describe("pending chat submit guard over real HTTP, MCP and Payload", () => {
  it("refuses a provider plan that creates or retargets a pinned pending answer", async () => {
    const setupResult = await setup();
    const { fixture, provider } = setupResult;
    const seeded = await seedPending(fixture);
    const writesBefore = fixture.legacy.committedWrites;
    const eventCountBefore = fixture.legacy.activities.size;

    provider.tool("guard-create", "bubu_record_events", { events: [{ facts: {
      type: "BOTTLE", startTime: "2026-10-23T11:00:00+08:00", milkItems: [{ id: "malicious-milk", milkSource: "FORMULA", milkAmount: 88 }],
    } }] });
    const created = await setupResult.chat.send(fixture.alice, input("guard-create-request", seeded.question));
    expect(created).toMatchObject({ status: "failed", error: { code: "CHAT_ANSWER_REQUIRED" } });

    provider.tool("guard-retarget", "bubu_update_event", { eventId: seeded.other.id, patch: { facts: { durationMinutes: 30 } } });
    const retargeted = await setupResult.chat.send(fixture.alice, input("guard-retarget-request", seeded.question));
    expect(retargeted).toMatchObject({ status: "failed", error: { code: "CHAT_SELECTION_MISMATCH" } });

    const missingPins = await fetch(`${fixture.origin}/api/app/chat`, {
      method: "POST", headers: { Authorization: `Bearer ${fixture.aliceToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ babyId: "baby-a", requestId: "guard-batch-missing-pins", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" },
        formBatch: [{ eventId: seeded.event.id, question: { id: seeded.question.id, questionVersion: seeded.question.version }, formAnswer: { facts: {}, milkItemAnswers: [{ milkItemId: "guard-milk", facts: { milkAmount: 88 } }] } }] }),
    });
    expect(missingPins.status).toBe(400);

    expect(fixture.legacy.activities.size).toBe(eventCountBefore);
    expect(fixture.legacy.committedWrites).toBe(writesBefore);
  }, 30_000);

  it("allows only one update when different request IDs race, then rejects a stale replay after restart", async () => {
    const setupResult = await setup();
    const { fixture, provider } = setupResult;
    const seeded = await seedPending(fixture);
    const writesBefore = fixture.legacy.committedWrites;
    let entered!: () => void, release!: () => void;
    const providerEntered = new Promise<void>(resolve => { entered = resolve; });
    const providerRelease = new Promise<void>(resolve => { release = resolve; });
    provider.enqueue(async () => {
      entered();
      await providerRelease;
      return { text: "", calls: [{ id: "guard-first-answer", name: "bubu_answer_pending", arguments: {
        questionId: seeded.question.id, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "guard-milk", facts: { milkAmount: 100 } }] },
      } }] };
    }, { text: "已补充原记录。", calls: [] });

    const firstInput = input("guard-race-first", seeded.question);
    const firstResponse = await post(fixture, firstInput);
    expect(firstResponse.status).toBe(200);
    expect((await firstResponse.json() as { turn: ChatTurn }).turn.status).toBe("processing");
    await providerEntered;

    const secondResponse = await post(fixture, input("guard-race-second", seeded.question));
    expect(secondResponse.status).toBe(409);
    release();
    await expect.poll(async () => (await request(fixture, firstInput.requestId))?.status).toBe("completed");
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 1);

    await setupResult.restart();
    provider.tool("guard-stale-replay", "bubu_answer_pending", {
      questionId: seeded.question.id, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "guard-milk", facts: { milkAmount: 120 } }] },
    });
    const replayInput = input("guard-restart-replay", seeded.question);
    const replayResponse = await post(fixture, replayInput);
    expect(replayResponse.status).toBe(200);
    await expect.poll(async () => (await request(fixture, replayInput.requestId))?.status).toBe("failed");
    expect(await request(fixture, replayInput.requestId)).toMatchObject({ error: { code: "QUESTION_STALE" } });
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 1);
    expect(fixture.legacy.activities.size).toBe(2);
  }, 30_000);
});
