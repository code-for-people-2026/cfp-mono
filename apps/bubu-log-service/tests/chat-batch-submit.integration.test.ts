import { afterEach, describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { createHandler } from "../src/http";
import type { ChatInput, ChatProvider, ChatTurn, ProviderInput, ProviderOutput } from "../src/chat/contracts";
import { chatCollections } from "../src/chat/persistence";
import { ChatService } from "../src/chat/service";
import type { CareEvent, PendingQuestion, RecordReceipt } from "../src/records/types";
import { chatFixture, type ChatFixture } from "./fixtures/chat";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function call<T>(client: Client, name: string, arguments_: Record<string, unknown>): Promise<T> {
  const result = await client.callTool({ name, arguments: arguments_ });
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  const content = result.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content[0]!.text!) as T;
}

async function setup(provider?: ChatProvider) {
  const fixture = await chatFixture(chatCollections);
  cleanup.push(() => fixture.close());
  let chat!: ChatService;
  const install = async () => {
    await fixture.listen();
    chat = new ChatService(fixture.identity, fixture.attachments, { mcpUrl: `${fixture.origin}/api/mcp`, provider });
    fixture.setHandler(createHandler(fixture.identity, fixture.origin, { allowedOrigins: [] }, {
      records: fixture.records, attachments: fixture.attachments, collector: fixture.collector, chat,
    }));
  };
  await install();
  return { fixture, get chat() { return chat; }, async restart() { await fixture.restart(); await install(); } };
}

async function seed(fixture: ChatFixture, count: number, prefix: string) {
  const client = await fixture.connect();
  const receipt = await call<RecordReceipt>(client, "bubu_record_events", {
    babyId: "baby-a", requestId: `${prefix}-seed`,
    events: Array.from({ length: count }, (_, index) => ({ facts: {
      type: "BOTTLE", startTime: `2026-10-23T${String(index + 1).padStart(2, "0")}:00:00+08:00`, milkItems: [{ id: "milk-1", milkSource: "BREAST_MILK" }],
    } })),
  });
  expect(receipt.questions).toHaveLength(count);
  const queried = await call<{ events: CareEvent[] }>(client, "bubu_query_events", { babyId: "baby-a", includeRetracted: true });
  for (const question of receipt.questions) {
    expect(queried.events.find(event => event.id === question.eventId)?.facts.milkItems?.[0]?.id).toBe("milk-1");
  }
  return receipt.questions;
}

const batchInput = (requestId: string, questions: PendingQuestion[]): ChatInput => ({
  babyId: "baby-a", requestId, text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" },
  formBatch: questions.map((question, index) => ({
    eventId: question.eventId,
    question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion },
    formAnswer: { facts: {}, milkItemAnswers: [{ milkItemId: "milk-1", facts: { milkAmount: 60 + index * 10 } }] },
  })),
});

async function post(fixture: ChatFixture, body: unknown, token = fixture.aliceToken) {
  return fetch(`${fixture.origin}/api/app/chat`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

async function request(fixture: ChatFixture, requestId: string, token = fixture.aliceToken): Promise<ChatTurn | null> {
  const response = await fetch(`${fixture.origin}/api/app/chat/request?babyId=baby-a&requestId=${encodeURIComponent(requestId)}`, { headers: { Authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  return (await response.json() as { turn: ChatTurn | null }).turn;
}

describe("durable pending form batch", () => {
  it("updates five pinned events once in one durable turn and rejects changed or stale replay", async () => {
    const { fixture } = await setup();
    const questions = await seed(fixture, 5, "batch-five");
    const writesBefore = fixture.legacy.committedWrites;
    const input = batchInput("batch-five-submit", questions);

    const response = await post(fixture, input);
    expect(response.status).toBe(200);
    await expect.poll(async () => (await request(fixture, input.requestId))?.status).not.toBe("processing");
    const completed = await request(fixture, input.requestId);
    expect(completed?.status, JSON.stringify(completed)).toBe("completed");
    expect(completed).toMatchObject({ batchProgress: { total: 5, completed: 5 } });
    expect(completed?.receipts).toHaveLength(1);
    expect(completed?.receipts[0]).toMatchObject({ status: "saved" });
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 5);
    expect(fixture.mcpRequests.filter(value => value.name === "bubu_submit_pending_batch")).toHaveLength(1);

    const replay = await post(fixture, input);
    expect(replay.status).toBe(200);
    expect((await replay.json() as { turn: ChatTurn }).turn.status).toBe("completed");
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 5);

    const changed = structuredClone(input);
    changed.formBatch![0]!.formAnswer = { facts: {}, milkItemAnswers: [{ milkItemId: "milk-1", facts: { milkAmount: 999 } }] };
    expect((await post(fixture, changed)).status).toBe(409);
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 5);

    const stale = { ...input, requestId: "batch-five-stale" };
    expect((await post(fixture, stale)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, stale.requestId))?.status).toBe("failed");
    expect(await request(fixture, stale.requestId)).toMatchObject({ error: { code: "QUESTION_STALE" }, batchProgress: { total: 5, completed: 0 } });
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 5);
  }, 30_000);

  it("preflights every item so a malformed later target causes zero batch writes", async () => {
    const { fixture } = await setup();
    const questions = await seed(fixture, 2, "batch-preflight");
    const writesBefore = fixture.legacy.committedWrites;
    const input = batchInput("batch-preflight-submit", questions);
    input.formBatch![1] = { ...input.formBatch![1]!, eventId: questions[0]!.eventId };

    expect((await post(fixture, input)).status).toBe(400);
    expect(fixture.legacy.committedWrites).toBe(writesBefore);

    const validShape = batchInput("batch-preflight-stale", questions);
    validShape.formBatch![1]!.question.eventVersion++;
    expect((await post(fixture, validShape)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, validShape.requestId))?.status).toBe("failed");
    expect(fixture.legacy.committedWrites).toBe(writesBefore);
  }, 30_000);

  it("recovers a lost batch response after restart through the original MCP request without replaying writes", async () => {
    const setupResult = await setup();
    const { fixture } = setupResult;
    const questions = await seed(fixture, 2, "batch-recovery");
    const writesBefore = fixture.legacy.committedWrites;
    const input = batchInput("batch-recovery-submit", questions);
    fixture.loseToolResponseOnce("bubu_submit_pending_batch");

    expect((await post(fixture, input)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, input.requestId))?.status).not.toBe("processing");
    expect((await request(fixture, input.requestId))?.status, JSON.stringify(await request(fixture, input.requestId))).toBe("needs_recovery");
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 2);
    await setupResult.chat.close();
    await setupResult.restart();

    expect((await post(fixture, input)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, input.requestId))?.status).toBe("completed");
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 2);
    expect(fixture.mcpRequests.filter(value => value.name === "bubu_submit_pending_batch")).toHaveLength(1);
    expect(fixture.mcpRequests.some(value => value.name === "bubu_get_request")).toBe(true);
  }, 30_000);

  it("parses custom text once with no tools and cannot create or retarget records", async () => {
    class Parser implements ChatProvider {
      inputs: ProviderInput[] = [];
      async complete(input: ProviderInput): Promise<ProviderOutput> {
        this.inputs.push(input);
        return { text: JSON.stringify({ answers: [{ questionId: "placeholder", patch: { facts: {}, milkItemAnswers: [{ milkItemId: "milk-1", facts: { milkAmount: 90 } }] } }] }), calls: [] };
      }
    }
    const provider = new Parser();
    const { fixture } = await setup(provider);
    const [question] = await seed(fixture, 1, "batch-custom");
    const writesBefore = fixture.legacy.committedWrites;
    const input: ChatInput = {
      babyId: "baby-a", requestId: "batch-custom-submit", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" },
      formBatch: [{ eventId: question!.eventId, question: { id: question!.id, questionVersion: question!.version, eventVersion: question!.eventVersion }, text: "奶量：90 毫升" }],
    };
    provider.complete = async modelInput => {
      provider.inputs.push(modelInput);
      return { text: JSON.stringify({ answers: [{ questionId: question!.id, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "milk-1", facts: { milkAmount: 90 } }] } }] }), calls: [] };
    };

    expect((await post(fixture, input)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, input.requestId))?.status).toBe("completed");
    expect(provider.inputs).toHaveLength(1);
    expect(provider.inputs[0]!.tools).toEqual([]);
    expect(provider.inputs[0]!.responseFormat?.name).toBe("bubu_form_batch_parse");
    expect(provider.inputs[0]!.responseFormat?.strict).toBe(false);
    expect(JSON.stringify(provider.inputs[0]!.responseFormat?.schema)).toContain('"milkItemAnswers"');
    expect(JSON.stringify(provider.inputs[0]!.responseFormat?.schema)).toContain('"milkItemId"');
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 1);
    expect(fixture.legacy.activities.size).toBe(1);
  }, 30_000);

  it("keeps an explicit item amount authoritative while parsing a supplement onto that item only", async () => {
    class ItemSupplementParser implements ChatProvider {
      questionId = "";
      inputs: ProviderInput[] = [];
      async complete(input: ProviderInput): Promise<ProviderOutput> {
        this.inputs.push(input);
        return { text: JSON.stringify({ answers: [{ questionId: this.questionId, patch: { facts: {}, milkItemAnswers: [
          { milkItemId: "selected-item", facts: { milkDescription: "羊奶" } },
        ] } }] }), calls: [] };
      }
    }
    const provider = new ItemSupplementParser();
    const { fixture } = await setup(provider);
    const client = await fixture.connect();
    const seeded = await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "batch-item-supplement-seed", events: [{ facts: {
      type: "BOTTLE", startTime: "2026-10-23T05:00:00+08:00", milkItems: [
        { id: "known-sibling", milkSource: "BREAST_MILK", milkAmount: 50 }, { id: "selected-item" },
      ],
    } }] });
    const question = seeded.questions[0]!; provider.questionId = question.id;
    const input: ChatInput = { babyId: "baby-a", requestId: "batch-item-supplement-submit", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" }, formBatch: [{
      eventId: question.eventId, question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion },
      formAnswer: { facts: {}, milkItemAnswers: [{ milkItemId: "selected-item", facts: { milkAmount: 120 } }] },
      text: "补充说明：第二项是羊奶",
    }] };
    expect((await post(fixture, input)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, input.requestId))?.status).toBe("completed");
    const receipt = (await request(fixture, input.requestId))!.receipts[0] as RecordReceipt;
    expect(receipt.events[0]?.facts.milkItems).toEqual([
      expect.objectContaining({ id: "known-sibling", milkSource: "BREAST_MILK", milkAmount: 50 }),
      expect.objectContaining({ id: "selected-item", milkDescription: "羊奶", milkAmount: 120 }),
    ]);
    expect(receipt.events[0]?.facts.milkAmount).toBe(170);
    const parserContext = JSON.parse(String(provider.inputs[0]!.messages[0]!.content)) as { items: Array<{ explicitAnswer: unknown }> };
    expect(parserContext.items[0]?.explicitAnswer).toEqual(input.formBatch![0]!.formAnswer);
  }, 30_000);

  it("rejects parser attempts to reinterpret an explicit item selection without any write", async () => {
    class OverwritingParser implements ChatProvider {
      questionId = "";
      async complete(): Promise<ProviderOutput> {
        return { text: JSON.stringify({ answers: [{ questionId: this.questionId, patch: { facts: {}, milkItemAnswers: [
          { milkItemId: "milk-1", facts: { milkAmount: 999 } },
        ] } }] }), calls: [] };
      }
    }
    const provider = new OverwritingParser();
    const { fixture } = await setup(provider);
    const [question] = await seed(fixture, 1, "batch-parser-overwrite"); provider.questionId = question!.id;
    const writesBefore = fixture.legacy.committedWrites;
    const input: ChatInput = { babyId: "baby-a", requestId: "batch-parser-overwrite-submit", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" }, formBatch: [{
      eventId: question!.eventId, question: { id: question!.id, questionVersion: question!.version, eventVersion: question!.eventVersion },
      formAnswer: { facts: {}, milkItemAnswers: [{ milkItemId: "milk-1", facts: { milkAmount: 120 } }] }, text: "补充说明：夜间喝的",
    }] };
    provider.questionId = question!.id;
    expect((await post(fixture, input)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, input.requestId))?.status).toBe("failed");
    expect(fixture.legacy.committedWrites).toBe(writesBefore);
    expect(await request(fixture, input.requestId)).toMatchObject({ error: { code: "CHAT_BATCH_PARSE_OVERWRITE" } });
  }, 30_000);

  it("rejects cross-channel and milk-source alias overwrites before any batch write", async () => {
    class SemanticOverwriteParser implements ChatProvider {
      questionId = "";
      patch: Record<string, unknown> = { facts: {} };
      async complete(): Promise<ProviderOutput> {
        return { text: JSON.stringify({ answers: [{ questionId: this.questionId, patch: this.patch }] }), calls: [] };
      }
    }
    const provider = new SemanticOverwriteParser();
    const { fixture } = await setup(provider);
    const client = await fixture.connect();
    const bottles = await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "semantic-overwrite-bottles", events: [
      { facts: { type: "BOTTLE", startTime: "2026-10-23T05:00:00+08:00", milkItems: [{ id: "valid-item", milkSource: "BREAST_MILK" }] } },
      { facts: { type: "BOTTLE", startTime: "2026-10-23T06:00:00+08:00", milkItems: [{ id: "selected-item" }] } },
    ] });
    const sleep = await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "semantic-overwrite-sleep", events: [{
      facts: { type: "SLEEP", startTime: "2026-10-23T07:00:00+08:00" },
    }] });
    const validEvent = bottles.events.find(event => event.facts.milkItems?.[0]?.id === "valid-item")!;
    const selectedEvent = bottles.events.find(event => event.facts.milkItems?.[0]?.id === "selected-item")!;
    const validQuestion = bottles.questions.find(question => question.eventId === validEvent.id)!;
    const selectedQuestion = bottles.questions.find(question => question.eventId === selectedEvent.id)!;
    const sleepQuestion = sleep.questions[0]!;
    const writesBefore = fixture.legacy.committedWrites;
    const pin = (question: PendingQuestion) => ({ id: question.id, questionVersion: question.version, eventVersion: question.eventVersion });
    const expectAtomicOverwrite = async (requestId: string, question: PendingQuestion, formAnswer: NonNullable<ChatInput["formBatch"]>[number]["formAnswer"], patch: Record<string, unknown>) => {
      provider.questionId = question.id; provider.patch = patch;
      const input: ChatInput = { babyId: "baby-a", requestId, text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" }, formBatch: [
        { eventId: validQuestion.eventId, question: pin(validQuestion), formAnswer: { facts: {}, milkItemAnswers: [{ milkItemId: "valid-item", facts: { milkAmount: 80 } }] } },
        { eventId: question.eventId, question: pin(question), formAnswer, text: "补充说明：夜间喝的" },
      ] };
      expect((await post(fixture, input)).status).toBe(200);
      await expect.poll(async () => (await request(fixture, requestId))?.status).toBe("failed");
      const failed = await request(fixture, requestId);
      expect(failed, JSON.stringify(failed)).toMatchObject({ error: { code: "CHAT_BATCH_PARSE_OVERWRITE" }, batchProgress: { completed: 0 } });
      expect(fixture.legacy.committedWrites).toBe(writesBefore);
    };

    await expectAtomicOverwrite("semantic-overwrite-item-state", selectedQuestion,
      { facts: {}, milkItemAnswers: [{ milkItemId: "selected-item", facts: { milkAmount: 120 } }] },
      { facts: {}, milkItemAnswers: [{ milkItemId: "selected-item", states: { milkAmountState: "unknown" } }] });
    await expectAtomicOverwrite("semantic-overwrite-source-alias", selectedQuestion,
      { facts: {}, milkItemAnswers: [{ milkItemId: "selected-item", facts: { milkSource: "FORMULA" } }] },
      { facts: {}, milkItemAnswers: [{ milkItemId: "selected-item", facts: { milkDescription: "奶粉" } }] });
    await expectAtomicOverwrite("semantic-overwrite-root-state", sleepQuestion,
      { facts: { durationMinutes: 60 } }, { facts: {}, states: { durationMinutes: "unknown" } });
  }, 30_000);

  it("accepts an empty non-factual supplement and exact duplicates only beside a validated explicit answer", async () => {
    class EmptyAndDuplicateParser implements ChatProvider {
      questionIds: string[] = [];
      async complete(): Promise<ProviderOutput> {
        return { text: JSON.stringify({ answers: [
          { questionId: this.questionIds[0], patch: { facts: {} } },
          { questionId: this.questionIds[1], patch: { facts: {}, milkItemAnswers: [{ milkItemId: "milk-1", facts: { milkAmount: 130 } }] } },
        ] }), calls: [] };
      }
    }
    const provider = new EmptyAndDuplicateParser();
    const { fixture } = await setup(provider);
    const questions = await seed(fixture, 2, "empty-supplement-explicit");
    provider.questionIds = questions.map(question => question.id);
    const writesBefore = fixture.legacy.committedWrites;
    const input: ChatInput = { babyId: "baby-a", requestId: "empty-supplement-explicit-submit", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" }, formBatch: questions.map((question, index) => ({
      eventId: question.eventId, question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion },
      formAnswer: { facts: {}, milkItemAnswers: [{ milkItemId: "milk-1", facts: { milkAmount: index ? 130 : 120 } }] },
      text: index ? "补充说明：还是 130 毫升" : "补充说明：夜间喝的",
    })) };
    expect((await post(fixture, input)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, input.requestId))?.status).toBe("completed");
    const receipt = (await request(fixture, input.requestId))!.receipts[0] as RecordReceipt;
    expect(receipt.events.map(event => event.facts.milkAmount)).toEqual([120, 130]);
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 2);
  }, 30_000);

  it("rejects an empty parsed patch for a text-only answer without writing", async () => {
    class EmptyParser implements ChatProvider {
      questionId = "";
      async complete(): Promise<ProviderOutput> {
        return { text: JSON.stringify({ answers: [{ questionId: this.questionId, patch: { facts: {} } }] }), calls: [] };
      }
    }
    const provider = new EmptyParser();
    const { fixture } = await setup(provider);
    const [question] = await seed(fixture, 1, "empty-supplement-text-only"); provider.questionId = question!.id;
    const writesBefore = fixture.legacy.committedWrites;
    const input: ChatInput = { babyId: "baby-a", requestId: "empty-supplement-text-only-submit", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" }, formBatch: [{
      eventId: question!.eventId, question: { id: question!.id, questionVersion: question!.version, eventVersion: question!.eventVersion }, text: "补充说明：夜间喝的",
    }] };
    expect((await post(fixture, input)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, input.requestId))?.status).toBe("failed");
    expect(await request(fixture, input.requestId)).toMatchObject({ error: { code: "CHAT_FORM_EMPTY" } });
    expect(fixture.legacy.committedWrites).toBe(writesBefore);
  }, 30_000);

  it("repairs a non-overlap duration conflict and another event in one idempotent batch, with stale preflight remaining atomic", async () => {
    const { fixture } = await setup();
    const client = await fixture.connect();
    const duration = await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "duration-repair-seed", events: [{
      facts: { type: "SLEEP", startTime: "2026-10-23T02:00:00+08:00", endTime: "2026-10-23T03:00:00+08:00", durationMinutes: 120 }, progress: "ended",
    }] });
    const milk = await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "duration-repair-milk-seed", events: [{ facts: {
      type: "BOTTLE", startTime: "2026-10-23T05:00:00+08:00", milkItems: [{ id: "repair-milk", milkSource: "FORMULA" }],
    } }] });
    const durationQuestion = duration.questions[0]!, milkQuestion = milk.questions[0]!;
    expect(durationQuestion.fields).toEqual([]);
    expect(durationQuestion.conflicts.map(issue => issue.code)).toContain("DURATION_MISMATCH");
    const writesBefore = fixture.legacy.committedWrites;
    const input: ChatInput = { babyId: "baby-a", requestId: "duration-repair-submit", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" }, formBatch: [
      { eventId: durationQuestion.eventId, question: { id: durationQuestion.id, questionVersion: durationQuestion.version, eventVersion: durationQuestion.eventVersion }, choiceAnswer: {
        questionId: `pending-${durationQuestion.id}-conflict-v${durationQuestion.version}`, choiceId: "repair-time-use-start-end",
      } },
      { eventId: milkQuestion.eventId, question: { id: milkQuestion.id, questionVersion: milkQuestion.version, eventVersion: milkQuestion.eventVersion },
        formAnswer: { facts: {}, milkItemAnswers: [{ milkItemId: "repair-milk", facts: { milkAmount: 90 } }] } },
    ] };
    expect((await post(fixture, input)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, input.requestId))?.status).toBe("completed");
    const receipt = (await request(fixture, input.requestId))!.receipts[0] as RecordReceipt;
    expect(receipt.events.find(event => event.id === durationQuestion.eventId)).toMatchObject({ complete: true, facts: { durationMinutes: 60 } });
    expect(receipt.events.find(event => event.id === milkQuestion.eventId)).toMatchObject({ complete: true, facts: { milkAmount: 90 } });
    expect(fixture.mcpRequests.filter(value => value.name === "bubu_submit_pending_batch").at(-1)).toBeDefined();
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 2);
    expect((await post(fixture, input)).status).toBe(200);
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 2);

    const staleSeed = await seed(fixture, 2, "duration-repair-stale");
    const versionsBefore = (await call<{ events: CareEvent[] }>(client, "bubu_query_events", { babyId: "baby-a", includeRetracted: true })).events
      .filter(event => staleSeed.some(question => question.eventId === event.id)).map(event => [event.id, event.version]);
    const staleInput = batchInput("duration-repair-stale-submit", staleSeed);
    staleInput.formBatch![1]!.question.questionVersion++;
    expect((await post(fixture, staleInput)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, staleInput.requestId))?.status).toBe("failed");
    const versionsAfter = (await call<{ events: CareEvent[] }>(client, "bubu_query_events", { babyId: "baby-a", includeRetracted: true })).events
      .filter(event => staleSeed.some(question => question.eventId === event.id)).map(event => [event.id, event.version]);
    expect(versionsAfter).toEqual(versionsBefore);
  }, 30_000);

  it("atomically combines distinct-plus-missing and overlap-plus-missing answers", async () => {
    const { fixture } = await setup();
    const client = await fixture.connect();
    const duplicates = await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "combined-duplicate-seed", events: [0, 1].map(index => ({ facts: {
      type: "BOTTLE", startTime: "2026-10-23T06:00:00+08:00", milkItems: [{ id: `combined-milk-${index}`, milkSource: "FORMULA" }],
    } })) });
    const duplicateQuestion = duplicates.questions.find(item => item.duplicateCandidates.length)!;
    const duplicateItemId = duplicates.events.find(event => event.id === duplicateQuestion.eventId)!.facts.milkItems![0]!.id;
    const distinctInput: ChatInput = { babyId: "baby-a", requestId: "combined-distinct-submit", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" }, formBatch: [{
      eventId: duplicateQuestion.eventId, question: { id: duplicateQuestion.id, questionVersion: duplicateQuestion.version, eventVersion: duplicateQuestion.eventVersion },
      formAnswer: { facts: {}, milkItemAnswers: [{ milkItemId: duplicateItemId, facts: { milkAmount: 120 } }] },
      choiceAnswer: { questionId: `pending-${duplicateQuestion.id}-duplicate-v${duplicateQuestion.version}`, choiceId: "different-events" },
    }] };
    expect((await post(fixture, distinctInput)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, distinctInput.requestId))?.status).toBe("completed");
    const distinct = ((await request(fixture, distinctInput.requestId))!.receipts[0] as RecordReceipt).events[0]!;
    expect(distinct).toMatchObject({ facts: { milkAmount: 120 }, duplicateCandidates: [] });

    const sleep = await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "combined-overlap-sleep", events: [{ facts: {
      type: "SLEEP", startTime: "2026-10-23T08:00:00+08:00", endTime: "2026-10-23T09:00:00+08:00",
    }, progress: "ended" }] });
    const head = await call<RecordReceipt>(client, "bubu_record_events", { babyId: "baby-a", requestId: "combined-overlap-head", events: [{ facts: {
      type: "HEAD_LIFT", startTime: "2026-10-23T08:30:00+08:00",
    }, progress: "ended" }] });
    const overlapQuestion = head.questions.find(item => item.conflicts.some(issue => issue.code === "TIME_OVERLAP"))!;
    expect(overlapQuestion.fields).toContain("endTime");
    const overlapInput: ChatInput = { babyId: "baby-a", requestId: "combined-overlap-submit", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" }, formBatch: [{
      eventId: overlapQuestion.eventId, question: { id: overlapQuestion.id, questionVersion: overlapQuestion.version, eventVersion: overlapQuestion.eventVersion },
      formAnswer: { facts: { durationMinutes: 5 }, progress: "ended" }, choiceAnswer: {
        questionId: `pending-${overlapQuestion.id}-conflict-v${overlapQuestion.version}`, choiceId: `confirm-overlap-${sleep.events[0]!.id}`,
      },
    }] };
    expect((await post(fixture, overlapInput)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, overlapInput.requestId))?.status).toBe("completed");
    const overlapped = ((await request(fixture, overlapInput.requestId))!.receipts[0] as RecordReceipt).events.find(event => event.id === overlapQuestion.eventId)!;
    expect(overlapped).toMatchObject({ complete: true, facts: { durationMinutes: 5 }, conflicts: [] });
    expect(overlapped.confirmedOverlaps).toHaveProperty(sleep.events[0]!.id);
  }, 30_000);

  it("server-validates pending choices and rejects fabricated overlap approval before writes", async () => {
    const { fixture } = await setup();
    const client = await fixture.connect();
    const duplicate = await call<RecordReceipt>(client, "bubu_record_events", {
      babyId: "baby-a", requestId: "batch-choice-seed", events: [0, 1].map(index => ({ facts: {
        type: "BOTTLE", startTime: "2026-10-23T06:00:00+08:00", milkItems: [{ id: `duplicate-${index}`, milkSource: "BREAST_MILK", milkAmount: 100 }],
      } })),
    });
    const question = duplicate.questions.find(candidate => candidate.duplicateCandidates.length)!;
    const writesBefore = fixture.legacy.committedWrites;
    const base = { eventId: question.eventId, question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion } };
    const fake: ChatInput = {
      babyId: "baby-a", requestId: "batch-choice-fake", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" },
      formBatch: [{ ...base, choiceAnswer: { questionId: `pending-${question.id}-duplicate-v${question.version}`, choiceId: `confirm-overlap-${question.duplicateCandidates[0]}` } }],
    };
    expect((await post(fixture, fake)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, fake.requestId))?.status).toBe("failed");
    expect(fixture.legacy.committedWrites).toBe(writesBefore);

    const valid: ChatInput = { ...fake, requestId: "batch-choice-valid", formBatch: [{ ...base, choiceAnswer: {
      questionId: `pending-${question.id}-duplicate-v${question.version}`, choiceId: "different-events",
    } }] };
    expect((await post(fixture, valid)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, valid.requestId))?.status).toBe("completed");
    expect((await request(fixture, valid.requestId))?.receipts[0]).toMatchObject({ status: "saved" });
  }, 30_000);

  it("lets exactly one principal win a same-version batch CAS", async () => {
    const { fixture } = await setup();
    const invite = await fixture.identity.invite(fixture.operator, "baby-a", "write");
    await fixture.identity.acceptInvite(fixture.bob, invite.code);
    const questions = await seed(fixture, 1, "batch-principal-race");
    const writesBefore = fixture.legacy.committedWrites;
    const alice = batchInput("batch-race-alice", questions);
    const bob = batchInput("batch-race-bob", questions);
    bob.formBatch![0]!.formAnswer = { facts: {}, milkItemAnswers: [{ milkItemId: "milk-1", facts: { milkAmount: 120 } }] };
    expect((await post(fixture, alice, fixture.aliceToken)).status).toBe(200);
    expect((await post(fixture, bob, fixture.bobToken)).status).toBe(200);
    await expect.poll(async () => {
      const states = await Promise.all([request(fixture, alice.requestId, fixture.aliceToken), request(fixture, bob.requestId, fixture.bobToken)]);
      return states.map(turn => turn?.status).sort();
    }).toEqual(["completed", "failed"]);
    expect(fixture.legacy.committedWrites).toBe(writesBefore + 1);
  }, 30_000);

  it("rechecks simultaneous interval answers against the complete post-batch overlay without legacy self aliases", async () => {
    const { fixture } = await setup();
    const client = await fixture.connect();
    const overlapping = await call<RecordReceipt>(client, "bubu_record_events", {
      babyId: "baby-a", requestId: "batch-overlay-overlap-seed", events: [
        { facts: { type: "SLEEP" }, progress: "ongoing" },
        { facts: { type: "HEAD_LIFT" }, progress: "ongoing" },
      ],
    });
    const overlapInput: ChatInput = {
      babyId: "baby-a", requestId: "batch-overlay-overlap", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" },
      formBatch: overlapping.questions.map(question => ({ eventId: question.eventId,
        question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion },
        formAnswer: { facts: { startTime: "2026-10-23T01:00:00+08:00" } },
      })),
    };
    expect((await post(fixture, overlapInput)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, overlapInput.requestId))?.status).not.toBe("processing");
    const overlapTurn = await request(fixture, overlapInput.requestId);
    expect(overlapTurn?.status, JSON.stringify(overlapTurn)).toBe("completed");
    const overlapReceipt = overlapTurn!.receipts[0] as RecordReceipt;
    expect(overlapReceipt.status).toBe("needs_information");
    expect(overlapReceipt.events).toHaveLength(2);
    for (const event of overlapReceipt.events) {
      expect(event.duplicateCandidates).toEqual([]);
      expect(event.conflicts.some(issue => issue.code === "TIME_OVERLAP" && issue.relatedEventId && issue.relatedEventId !== event.id && issue.relatedEventId !== event.legacyId)).toBe(true);
    }

    const nonoverlapping = await call<RecordReceipt>(client, "bubu_record_events", {
      babyId: "baby-a", requestId: "batch-overlay-clear-seed", events: [
        { facts: { type: "SLEEP" }, progress: "ongoing" },
        { facts: { type: "HEAD_LIFT" }, progress: "ongoing" },
      ],
    });
    const clearInput: ChatInput = {
      babyId: "baby-a", requestId: "batch-overlay-clear", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" },
      formBatch: nonoverlapping.questions.map((question, index) => ({ eventId: question.eventId,
        question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion },
        formAnswer: { facts: { startTime: index ? "2026-10-23T04:00:00+08:00" : "2026-10-23T03:00:00+08:00" } },
      })),
    };
    expect((await post(fixture, clearInput)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, clearInput.requestId))?.status).toBe("completed");
    const clearReceipt = (await request(fixture, clearInput.requestId))!.receipts[0] as RecordReceipt;
    expect(clearReceipt.status).toBe("saved");
    expect(clearReceipt.events.every(event => !event.conflicts.length && !event.duplicateCandidates.length)).toBe(true);
  }, 30_000);

  it("rejects an overlap approval when the other bound event is also staged for edit", async () => {
    const { fixture } = await setup();
    const client = await fixture.connect();
    const first = await call<RecordReceipt>(client, "bubu_record_events", {
      babyId: "baby-a", requestId: "batch-overlap-target-seed", events: [{ facts: {
        type: "BOTTLE", startTime: "2026-10-23T08:10:00+08:00", milkItems: [{ id: "overlap-milk", milkSource: "BREAST_MILK" }],
      } }],
    });
    const target = first.events[0]!, targetQuestion = first.questions[0]!;
    const second = await call<RecordReceipt>(client, "bubu_record_events", {
      babyId: "baby-a", requestId: "batch-overlap-primary-seed", events: [{ facts: {
        type: "BREASTFEED", endTime: "2026-10-23T08:30:00+08:00", durationMinutes: 20,
      } }],
    });
    const primary = second.events[0]!;
    const conflictQuestion = second.questions.find(question => question.conflicts.some(issue => issue.relatedEventId === target.id));
    expect(conflictQuestion, JSON.stringify(second)).toBeDefined();
    const writesBefore = fixture.legacy.committedWrites;
    const input: ChatInput = {
      babyId: "baby-a", requestId: "batch-overlap-staged-target", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" }, formBatch: [
        { eventId: target.id, question: { id: targetQuestion.id, questionVersion: targetQuestion.version, eventVersion: targetQuestion.eventVersion }, formAnswer: { facts: {}, milkItemAnswers: [{ milkItemId: "overlap-milk", facts: { milkAmount: 100 } }] } },
        { eventId: primary.id, question: { id: conflictQuestion!.id, questionVersion: conflictQuestion!.version, eventVersion: conflictQuestion!.eventVersion }, choiceAnswer: {
          questionId: `pending-${conflictQuestion!.id}-conflict-v${conflictQuestion!.version}`, choiceId: `confirm-overlap-${target.id}`,
        } },
      ],
    };
    expect((await post(fixture, input)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, input.requestId))?.status).toBe("failed");
    expect(await request(fixture, input.requestId)).toMatchObject({ error: { code: "BATCH_TARGET_COLLISION" }, batchProgress: { completed: 0 } });
    expect(fixture.legacy.committedWrites).toBe(writesBefore);
    const current = await call<{ events: Array<{ id: string; version: number; facts: { milkAmount?: number } }> }>(client, "bubu_query_events", { babyId: "baby-a", eventId: target.id, includeRetracted: true });
    expect(current.events[0]).toMatchObject({ version: target.version });
    expect(current.events[0]!.facts.milkAmount).toBeUndefined();
  }, 30_000);

  it("accepts milkDescription only as the exact custom alias for a missing bottle milkSource", async () => {
    class GoatMilkParser implements ChatProvider {
      questionId = "";
      inputs: ProviderInput[] = [];
      async complete(input: ProviderInput): Promise<ProviderOutput> {
        this.inputs.push(input);
        return { text: JSON.stringify({ answers: [{ questionId: this.questionId, patch: { facts: {}, milkItemAnswers: [{ milkItemId: "goat-pending", facts: { milkDescription: "羊奶" } }] } }] }), calls: [] };
      }
    }
    const provider = new GoatMilkParser();
    const { fixture } = await setup(provider);
    const client = await fixture.connect();
    const seeded = await call<RecordReceipt>(client, "bubu_record_events", {
      babyId: "baby-a", requestId: "batch-goat-milk-seed", events: [{ facts: { type: "BOTTLE", startTime: "2026-10-23T09:00:00+08:00", milkItems: [{ id: "goat-pending", milkAmount: 90 }] } }],
    });
    const question = seeded.questions[0]!; provider.questionId = question.id;
    expect(question.fields).toContain("milkSource");
    const input: ChatInput = { babyId: "baby-a", requestId: "batch-goat-milk", text: "", attachmentIds: [], context: { viewedDate: "2026-10-23" },
      formBatch: [{ eventId: question.eventId, question: { id: question.id, questionVersion: question.version, eventVersion: question.eventVersion }, text: "喝的是羊奶" }] };
    expect((await post(fixture, input)).status).toBe(200);
    await expect.poll(async () => (await request(fixture, input.requestId))?.status).toBe("completed");
    const receipt = (await request(fixture, input.requestId))!.receipts[0] as RecordReceipt;
    expect(receipt.events[0]!.facts).toMatchObject({ milkAmount: 90, milkItems: [{ id: "goat-pending", milkDescription: "羊奶", milkAmount: 90 }] });
    expect(receipt.events[0]!.facts.milkSource).toBeUndefined();
    expect(provider.inputs).toHaveLength(1); expect(provider.inputs[0]!.tools).toEqual([]);
  }, 30_000);
});
