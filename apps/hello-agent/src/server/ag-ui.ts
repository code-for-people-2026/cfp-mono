import { EventType, type Event } from "@ag-ui/core";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import { EventEncoder } from "@ag-ui/encoder";
import { z } from "zod";
import {
  A2UI_EVENT,
  CATALOG_ID,
  clientEventSchema,
  toA2ui,
} from "@cfp/hello-agent-protocol";
import { AppError, turnSchema } from "../domain/contracts";
import type { GreetingService } from "../domain/greetings";

export function readAgentInput(value: unknown) {
  const parsed = RunAgentInputSchema.safeParse(value);
  if (!parsed.success) throw new AppError(400, "AG-UI 请求格式不正确");
  const run = parsed.data;
  if (run.protocolVersion && run.protocolVersion !== "1.0")
    throw new AppError(400, "不支持此 AG-UI 版本");
  const props = z
    .object({
      mode: z.enum(["platform", "byok"]),
      apiKey: z.string().min(10).max(256).optional(),
      mediaIds: z.array(z.number().int().positive()).max(3).default([]),
      clientEvent: clientEventSchema.optional(),
      a2uiClientCapabilities: z
        .object({ supportedCatalogIds: z.array(z.string()).max(10) })
        .optional(),
    })
    .parse(run.forwardedProps);
  if (
    props.a2uiClientCapabilities &&
    !props.a2uiClientCapabilities.supportedCatalogIds.includes(CATALOG_ID)
  )
    throw new AppError(400, "客户端不支持阿 Q +的界面目录，请升级后重试");
  const message = run.messages.at(-1);
  if (
    !message ||
    message.role !== "user" ||
    typeof message.content !== "string"
  )
    throw new AppError(400, "请提供本轮用户输入");
  // History, state, client-supplied tools and context never become trusted agent instructions.
  const action = props.clientEvent?.action;
  const match = action?.surfaceId.match(/^turn_(\d+)_(.+)$/);
  return turnSchema.parse({
    sessionId: z.coerce.number().int().positive().parse(run.threadId),
    requestId: run.runId,
    mode: props.mode,
    apiKey: props.apiKey,
    input: {
      text: message.content,
      mediaIds: props.mediaIds,
      ...(action && match
        ? {
            formResponse: {
              turnId: Number(match[1]),
              artifactId: match[2],
              values: action.context.values,
            },
          }
        : {}),
    },
  });
}

// Same domain module as REST and MCP; transport only publishes committed, validated output.
export function agentStream(
  service: {
    generateGreeting: (
      args: z.infer<typeof turnSchema>,
    ) => Promise<
      Pick<
        Awaited<ReturnType<GreetingService["generateGreeting"]>>,
        "id" | "greeting" | "artifacts" | "status"
      >
    >;
  },
  args: z.infer<typeof turnSchema>,
) {
  const encoder = new EventEncoder({ accept: "text/event-stream" });
  const utf8 = new TextEncoder();
  let connected = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Event) => {
        if (connected)
          controller.enqueue(utf8.encode(encoder.encodeSSE(event)));
      };
      const threadId = String(args.sessionId);
      const runId = args.requestId;
      try {
        emit({
          type: EventType.RUN_STARTED,
          threadId,
          runId,
          protocolVersion: "1.0",
        });
        emit({
          type: EventType.STEP_STARTED,
          stepName: "阿 Q +正在构思回应与作品",
        });
        const row = await service.generateGreeting(args);
        emit({
          type: EventType.STEP_FINISHED,
          stepName: "阿 Q +正在构思回应与作品",
        });
        const messageId = `greeting_${row.id}`;
        emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
        });
        emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta: String(row.greeting),
        });
        emit({ type: EventType.TEXT_MESSAGE_END, messageId });
        for (const message of toA2ui(row.id, row.artifacts))
          emit({ type: EventType.CUSTOM, name: A2UI_EVENT, value: message });
        emit({
          type: EventType.STATE_SNAPSHOT,
          snapshot: { turnId: row.id, status: row.status },
        });
        emit({ type: EventType.RUN_FINISHED, threadId, runId });
      } catch (error) {
        emit({
          type: EventType.RUN_ERROR,
          message:
            error instanceof AppError
              ? error.message
              : "本轮未能完成，请刷新记录后重试",
          code: "GENERATION_FAILED",
        });
      } finally {
        if (connected) controller.close();
      }
    },
    // A lost connection doesn't undo a committed response. History is the recovery path.
    cancel() {
      connected = false;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
