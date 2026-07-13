import { Hono } from "hono";
import { cardPayloadSchema } from "@cfp/kith-inn-shared/schemas";
import type { OrderReconciliationPreview } from "@cfp/kith-inn-shared";
import type { ChatMessage as LlmMessage } from "../lib/llm/chatWithTools";
import { createOffering, findOfferings } from "../lib/cms/client";
import {
  cancelOrderAtomic,
  confirmOrderAtomic,
  createOrderDraft,
  getSeller,
  getOrder,
  listFulfillments,
  listOrders,
  reconcileOrders,
  setFulfillmentsByIds,
  updateOrder,
} from "../lib/cms/orders";
import { CmsHttpError } from "../lib/cms/orders";
import { createCustomer, listCustomers } from "../lib/cms/customers";
import { listMenuPlans, getMenuPlan, upsertMenuPlans, patchMenuPlan } from "../lib/cms/menuPlans";
import { createChatMessage, listChatMessages } from "../lib/cms/chat";
import { createCmsAgentServices, type AgentCms } from "../agent/services";
import type { AgentServices } from "../agent/tools";
import { clearPendingOp, completePendingOp, getCompletedOp, getPendingOp } from "../agent/pendingOps";
import { runAgent } from "../agent/run";
import { sellerAuth, type AppVars } from "../middleware/sellerAuth";

/** Real AgentCms = the imported client functions directly (their optional `deps`
 *  param drops to global fetch). Mirrors routes/orders.ts realCms(). */
function realAgentCms(): AgentCms {
  return {
    getSeller,
    findOfferings,
    createOffering,
    getOrder,
    createOrderDraft,
    confirmOrderAtomic,
    cancelOrderAtomic,
    updateOrder,
    setFulfillmentsByIds,
    listCustomers,
    createCustomer,
    listFulfillments,
    listOrders,
    reconcileOrders,
    listMenuPlans,
    getMenuPlan,
    upsertMenuPlans,
    patchMenuPlan,
  };
}

export type ChatRoutesDeps = {
  cms?: AgentCms;
  listChatMessages?: typeof listChatMessages;
  createChatMessage?: typeof createChatMessage;
  runAgent?: typeof runAgent;
};

/**
 * 「今天」chat route (PRD §5.5). sellerAuth-protected; one turn = load recent
 * history → runAgent (tools drive the deterministic services) → persist the user
 * + assistant messages → return the reply. Non-streaming (ponytail: request/
 * response; SSE is a deferred UX upgrade). History is newest-first from cms, so
 * reverse to chronological before feeding runAgent's trimContext.
 */
export function chatRoutes(jwtSecret: string, deps: ChatRoutesDeps = {}) {
  const app = new Hono<AppVars>();
  app.use("*", sellerAuth(jwtSecret));
  const cms = deps.cms ?? realAgentCms();
  const listChat = deps.listChatMessages ?? listChatMessages;
  const createChat = deps.createChatMessage ?? createChatMessage;
  const run = deps.runAgent ?? runAgent;

  /** GET /chat — the operator's recent chat history (newest-first from cms), for
   *  the 「今天」 page to render on mount. */
  app.get("/", async (c) => {
    const jwt = c.get("token") as string;
    try {
      // Project to the visible fields the miniapp needs — cms depth-populates
      // operator/seller, which must not leak to the client (Codex).
      const messages = (await listChat(jwt, { limit: 50 })).map((m) => {
        const card = cardPayloadSchema.safeParse(m.card);
        const hasStoredCard = m.card !== undefined && m.card !== null;
        return {
          id: m.id,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          ...(card.success ? { card: card.data } : {}),
          ...(!card.success && hasStoredCard ? { cardUnavailable: true } : {}),
        };
      });
      return c.json({ messages });
    } catch {
      return c.json({ error: "history failed" }, 502);
    }
  });

  app.post("/", async (c) => {
    const jwt = c.get("token") as string;
    const operatorId = c.get("operatorId") as string | number;
    const body = (await c.req.json().catch(() => null)) as { text?: string } | null;
    if (!body?.text) return c.json({ error: "text required" }, 400);
    try {
      const recent = await listChat(jwt, { limit: 20 });
      const history: LlmMessage[] = [...recent].reverse().map((m) => ({ role: m.role, content: m.content }));
      const { reply, card } = await run({
        userText: body.text,
        history,
        services: createCmsAgentServices({ jwt, cms, operatorId }),
      });
      // Best-effort: a chat-history write failure must NOT fail the turn once the
      // agent's business side-effects (e.g. record_orders) already committed — a 502
      // here would read as "chat failed" and a retry would duplicate the draft.
      await Promise.all([
        createChat(jwt, { content: body.text, role: "user" }),
        createChat(jwt, { content: reply, role: "assistant", ...(card ? { card } : {}) }),
      ]).catch(() => null);
      return c.json({ reply, card });
    } catch {
      return c.json({ error: "chat failed" }, 502);
    }
  });

  /**
   * POST /chat/confirm-operation — the deterministic "确认" behind operation-confirm
   * cards (#126). Reads the per-operator pending op → dispatches to the corresponding
   * AgentServices write method → retains one replayable success → returns the result text.
   * Body: `{ opId, items? }`. `opId` must match the stored pending op's id, else the
   * click is from a stale (older) card and we reject 409 (newest-overwrites semantics
   * mean only the latest card is actionable). `items` carries address edits for
   * record_orders; immutable fields stay server-side (dispatch trusts pending only).
   */
  app.post("/confirm-operation", async (c) => {
    const jwt = c.get("token") as string;
    const operatorId = c.get("operatorId") as string | number;
    const body = (await c.req.json().catch(() => null)) as { opId?: unknown; items?: unknown } | null;
    const completed = getCompletedOp(operatorId, body?.opId);
    if (completed) return c.json({ reply: completed.reply, ok: true, alreadyCompleted: true });
    const op = getPendingOp(operatorId);
    if (!op) return c.json({ error: "no pending operation" }, 404);
    if (body?.opId !== op.opId) return c.json({ error: "card stale" }, 409);
    const services = createCmsAgentServices({ jwt, cms, operatorId });
    try {
      const result = await dispatchPendingOp(services, op, body);
      const ok = operationReplySucceeded(result);
      if (ok) completePendingOp(operatorId, op.opId, result);
      // Best-effort persist the outcome as an assistant message.
      await createChat(jwt, { content: result, role: "assistant" }).catch(() => null);
      return c.json({ reply: result, ok });
    } catch (error) {
      if (error instanceof CmsHttpError && error.code === "stale-preview") {
        clearPendingOp(operatorId);
        const message = op.toolName === "record_orders" && (op.args as { mode?: unknown }).mode === "increment"
          ? "订单已经变化，请重新说一遍补单，系统会按最新数量重新计算"
          : "订单已经变化，请重新粘贴接龙查看最新差异";
        return c.json({ error: "stale-preview", message }, 409);
      }
      if (error instanceof CmsHttpError && error.code === "settled-order") {
        clearPendingOp(operatorId);
        return c.json({ error: "settled-order", message: "本次修改涉及已付款或已送达订单，请单独处理这些订单" }, 409);
      }
      return c.json({ error: "operation failed" }, 502);
    }
  });

  return app;
}

/** Dispatch a pending op to the corresponding AgentServices write method. Returns the result text.
 *  Exported for direct unit-testing of each opType branch (#126). */
export async function dispatchPendingOp(
  services: AgentServices,
  op: { opId: string; toolName: string; args: Record<string, unknown>; summary: string },
  body: { opId?: unknown; items?: unknown } | null,
): Promise<string> {
  const a = op.args;
  switch (op.toolName) {
    case "record_orders": {
      // Quantities/scope/fingerprint remain server-side; the client may only fill
      // addresses for new-customer candidates, aligned by candidate index.
      const preview = a as unknown as OrderReconciliationPreview;
      const bodyAddrs = (Array.isArray(body?.items) ? body!.items : []) as Array<{ address?: string }>;
      const candidates = preview.candidates.map((candidate, index) => {
        if (!candidate.newCustomer) return candidate;
        const submittedAddress = bodyAddrs[index]?.address;
        const address = typeof submittedAddress === "string" ? submittedAddress.trim() || undefined : candidate.newCustomer.address;
        return { ...candidate, newCustomer: { ...candidate.newCustomer, address } };
      });
      const request = {
        mode: preview.mode,
        operation: preview.operation,
        operationKey: preview.operationKey,
        scope: preview.scope,
        expectedFingerprint: preview.expectedFingerprint,
        candidates,
      };
      const result = await services.reconcileOrders(request);
      return preview.mode === "increment"
        ? `已完成单独补单：新增 ${result.created.length}、更新 ${result.updated.length}、不变 ${result.unchanged.length}。`
        : `已按最新完整接龙更新：新增 ${result.created.length}、更新 ${result.updated.length}、取消 ${result.canceled.length}、不变 ${result.unchanged.length}。`;
    }
    case "confirm_order": {
      const r = await services.confirmOrder({ orderId: Number(a.orderId) });
      return r.ok ? `已确认订单 #${a.orderId}（已开餐、进入送餐清单）。` : `确认失败：${r.error}`;
    }
    case "cancel_order": {
      const r = await services.cancelOrder({ orderId: Number(a.orderId) });
      return r.ok ? `已取消订单 #${a.orderId}。` : `取消失败：${r.error}`;
    }
    case "mark_paid": {
      const r = await services.markPaid({ orderId: Number(a.orderId) });
      return r.ok ? `已标记订单 #${a.orderId} 为已付款。` : `标记失败：${r.error}`;
    }
    case "mark_unpaid": {
      const r = await services.markUnpaid?.({ orderId: Number(a.orderId) }) ?? { ok: false as const, error: "not implemented" };
      return r.ok ? `已回退订单 #${a.orderId} 为未付款。` : `回退失败：${r.error}`;
    }
    case "generate_menu": {
      const targets = a.targets as Array<{ date: string; occasion: "lunch" | "dinner" }>;
      const plannedItems = a.plannedItems as Array<{ date: string; occasion: "lunch" | "dinner"; offerings: Array<string | number> }> | undefined;
      const r = await services.generateMenu(targets, a.force === true, plannedItems);
      if (!r.ok) return r.reason === "pool-too-small" ? "菜品池不够。" : `生成失败：${r.reason}`;
      const lines = r.plans.map((p) => `${p.occasion === "lunch" ? "午餐" : "晚餐"}：${p.dishes.map((d) => d.name).join("、")}`);
      return `排好了：\n${lines.join("\n")}`;
    }
    case "swap_dish": {
      const replacementId = a.replacementId === undefined ? undefined : Number(a.replacementId);
      const force = a.force === true;
      const dishIndex = a.dishIndex === undefined ? undefined : Number(a.dishIndex);
      const r = await services.swapDish(Number(a.planId), Number(a.dishId), replacementId, force, dishIndex, a.automatic === true);
      if (!r.ok) return `换菜失败：${r.error}`;
      return `已换好。`;
    }
    case "publish_menu": {
      const r = await services.publishMenu(Number(a.planId));
      if (!r.ok) return `发布失败：${r.error}`;
      return `菜单已发布，文案已复制，去群粘贴：\n\n${r.publishText}`;
    }
    case "add_dish": {
      const r = await services.createOffering({ name: String(a.name), mainIngredient: a.mainIngredient ? String(a.mainIngredient) : undefined, category: a.category ? String(a.category) : undefined });
      return `加好了：${r.name}（#${r.id}）。`;
    }
    default:
      return `未知操作：${op.toolName}`;
  }
}

export function operationReplySucceeded(reply: string): boolean {
  return (
    reply.startsWith("已按最新完整接龙更新") ||
    reply.startsWith("已完成单独补单") ||
    reply.startsWith("已确认订单") ||
    reply.startsWith("已取消订单") ||
    reply.startsWith("已标记订单") ||
    reply.startsWith("已回退订单") ||
    reply.startsWith("排好了：") ||
    reply.startsWith("已换好") ||
    reply.startsWith("菜单已发布") ||
    reply.startsWith("加好了：")
  );
}
