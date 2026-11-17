import { EventType, type Event } from "@ag-ui/core";
import { RunAgentInputSchema } from "@ag-ui/core/schemas";
import { EventEncoder } from "@ag-ui/encoder";
import { z } from "zod";
import {
  A2UI_EVENT,
  clientEventSchema,
} from "@cfp/base-chat-protocol";
import {
  AJ_CATALOG_ID,
  LEGACY_AJ_CATALOG_ID,
  ajCatalogIdForCapabilities,
  ajFormResponseFromClientEvent,
  ajPresentationOrigin,
  toAjA2ui,
  toLegacyAjA2uiForClient,
} from "@cfp/a-j-oker-contracts";
import { AppError, turnSchema, type GenerationProgress } from "../domain/contracts";
import type { GreetingService } from "../domain/greetings";
import { requirePlatformInput } from "./service-scope";

export function readAgentInput(value: unknown) {
  const parsed = RunAgentInputSchema.safeParse(value);
  if (!parsed.success) throw new AppError(400, "AG-UI 请求格式不正确");
  const run = parsed.data;
  requirePlatformInput(run.forwardedProps);
  if (run.protocolVersion && run.protocolVersion !== "1.0")
    throw new AppError(400, "不支持此 AG-UI 版本");
  const props = z
    .object({
      mode: z.enum(["platform", "byok"]),
      apiKey: z.string().min(10).max(256).optional(),
      mediaIds: z.array(z.number().int().positive()).max(3).default([]),
      clientEvent: clientEventSchema.optional(),
      action: z.object({
        type: z.literal("return_to_coordinator"),
        taskId: z.string().trim().min(1).max(128),
      }).strict().optional(),
      a2uiClientCapabilities: z
        .object({ supportedCatalogIds: z.array(z.string()).max(10) })
        .optional(),
    })
    .parse(run.forwardedProps);
  if (
    props.a2uiClientCapabilities &&
    !props.a2uiClientCapabilities.supportedCatalogIds.includes(AJ_CATALOG_ID) &&
    !props.a2uiClientCapabilities.supportedCatalogIds.includes(LEGACY_AJ_CATALOG_ID)
  )
    throw new AppError(400, "客户端不支持阿 J 先生的界面目录，请升级后重试");
  const a2uiCatalogId = props.a2uiClientCapabilities
    ? ajCatalogIdForCapabilities(props.a2uiClientCapabilities.supportedCatalogIds)
    : LEGACY_AJ_CATALOG_ID;
  const message = run.messages.at(-1);
  if (
    !message ||
    message.role !== "user" ||
    typeof message.content !== "string"
  )
    throw new AppError(400, "请提供本轮用户输入");
  // History, state, client-supplied tools and context never become trusted agent instructions.
  const action = props.clientEvent?.action;
  const formResponse = action
    ? ajFormResponseFromClientEvent(action)
    : undefined;
  if (action?.context.submission && action.context.submission.requestId !== run.runId)
    throw new AppError(400, "表单提交请求不匹配");
  return {
    ...turnSchema.parse({
    sessionId: z.coerce.number().int().positive().parse(run.threadId),
    requestId: run.runId,
    mode: props.mode,
    apiKey: props.apiKey,
    input: {
      text: message.content,
      mediaIds: props.mediaIds,
      ...(action && formResponse
        ? {
            formResponse,
          }
        : {}),
      ...(props.action ? { action: props.action } : {}),
    },
    }),
    a2uiCatalogId,
  };
}

type AgentArgs = z.infer<typeof turnSchema> & {
  a2uiCatalogId?: string;
};

// Same domain module as REST and MCP; transport only publishes committed, validated output.
export function agentStream(
  service: {
    generateGreeting: (
      args: z.infer<typeof turnSchema>,
      progress?: (stage: GenerationProgress) => void,
    ) => Promise<
      Pick<
        Awaited<ReturnType<GreetingService["generateGreeting"]>>,
        "id" | "greeting" | "artifacts" | "status"
      > &
        Partial<
          Pick<
            Awaited<ReturnType<GreetingService["generateGreeting"]>>,
            "specialist" | "model"
          >
        >
    >;
    resumeImage?: (id: number, apiKey?: string, progress?: (stage: GenerationProgress) => void) => ReturnType<GreetingService["resumeImage"]>;
  },
  args: AgentArgs,
  resumeTurnId?: number,
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
      const heartbeat = setInterval(() => { if (connected) controller.enqueue(utf8.encode(": keepalive\n\n")); }, 15_000);
      try {
        emit({
          type: EventType.RUN_STARTED,
          threadId,
          runId,
          protocolVersion: "1.0",
        });
        // The first stage is real (this run has begun generating), not a
        // fabricated timer stage. Stable IDs ride in generic metadata so old
        // clients keep the human-readable step name.
        emit({
          type: EventType.STEP_STARTED,
          stepName: "阿 J 先生正在构思回应与作品",
          metadata: { stageId: "generating" },
        });
        const progress = (stage: GenerationProgress) =>
          emit({
            type: EventType.STEP_STARTED,
            stepName: stage.stepName,
            metadata: {
              stageId: stage.stageId,
              ...(stage.interimMessage
                ? { interimMessage: stage.interimMessage }
                : {}),
            },
          });
        if (resumeTurnId && !service.resumeImage) throw new AppError(409, "此服务不支持继续取图");
        const row = resumeTurnId ? await service.resumeImage!(resumeTurnId, args.apiKey, progress) : await service.generateGreeting(args, progress);
        emit({
          type: EventType.STEP_FINISHED,
          stepName: "阿 J 先生正在构思回应与作品",
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
        // Missing capabilities are catalog-v1 for deployed clients. The v1
        // adapter projects only compatible saved artifacts; unsupported v2
        // blocks never turn an already committed generation into RUN_ERROR.
        const mappedOrigin = !args.input.action && row.model !== "product-guidance" && row.specialist
          ? ajPresentationOrigin(row.specialist)
          : undefined;
        const origin = mappedOrigin?.state === "unavailable" ? undefined : mappedOrigin;
        const a2uiMessages =
          (args.a2uiCatalogId ?? LEGACY_AJ_CATALOG_ID) === LEGACY_AJ_CATALOG_ID
            ? toLegacyAjA2uiForClient(row.id, row.artifacts ?? [])
            : toAjA2ui(row.id, row.artifacts, { origin });
        for (const message of a2uiMessages)
          emit({ type: EventType.CUSTOM, name: A2UI_EVENT, value: message });
        emit({
          type: EventType.STATE_SNAPSHOT,
          snapshot: { turnId: row.id, status: row.status },
        });
        emit({ type: EventType.RUN_FINISHED, threadId, runId });
      } catch (error) {
        const appError = error instanceof AppError ? error : undefined;
        emit({
          type: EventType.RUN_ERROR,
          message:
            error instanceof AppError
              ? error.message
              : "本轮未能完成，请刷新记录后重试",
          code: appError?.code ?? "GENERATION_FAILED",
          metadata: {
            ...(appError?.retryable !== undefined ? { retryable: appError.retryable } : {}),
            ...(appError?.definitive !== undefined ? { definitive: appError.definitive } : {}),
          },
        });
      } finally {
        clearInterval(heartbeat);
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
