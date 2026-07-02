import { Hono } from "hono";
import type { ConfirmCustomerItem } from "@cfp/kith-inn-shared";
import { cardPayloadSchema } from "@cfp/kith-inn-shared/schemas";
import type { ChatMessage as LlmMessage } from "../lib/llm/chatWithTools";
import { findOfferings } from "../lib/cms/client";
import {
  createFulfillments,
  createOrderDraft,
  getSeller,
  getOrder,
  listFulfillments,
  listOrders,
  setFulfillmentsByIds,
  setFulfillmentsByOrders,
  updateOrder,
  upsertSlots,
} from "../lib/cms/orders";
import { createCustomer, listCustomers } from "../lib/cms/customers";
import { createChatMessage, listChatMessages } from "../lib/cms/chat";
import { createCmsAgentServices, type AgentCms } from "../agent/services";
import { clearPending, getPending } from "../agent/pendingState";
import { runAgent } from "../agent/run";
import { sellerAuth, type AppVars } from "../middleware/sellerAuth";

/** Equality of the submitted payload vs the pending list — the stale-card check
 *  for POST /chat/confirm-customers (Codex P2). Order-sensitive JSON compare is
 *  fine: the card's items come straight from the pending response, so FE echoes
 *  them in the same order. */
function sameItems(submitted: unknown, pending: ConfirmCustomerItem[]): boolean {
  if (!Array.isArray(submitted) || submitted.length !== pending.length) return false;
  const norm = (xs: ConfirmCustomerItem[]) =>
    JSON.stringify(xs.map((it) => ({ customerName: it.customerName, address: it.address, quantity: it.quantity, occasion: it.occasion, date: it.date })));
  return norm(submitted as ConfirmCustomerItem[]) === norm(pending);
}

/** Real AgentCms = the imported client functions directly (their optional `deps`
 *  param drops to global fetch). Mirrors routes/orders.ts realCms(). */
function realAgentCms(): AgentCms {
  return {
    getSeller,
    findOfferings,
    getOrder,
    createOrderDraft,
    updateOrder,
    upsertSlots,
    createFulfillments,
    setFulfillmentsByOrders,
    setFulfillmentsByIds,
    listCustomers,
    createCustomer,
    listFulfillments,
    listOrders,
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
   * POST /chat/confirm-customers — the deterministic "全部建档并记单" behind the
   * customer-confirm card (#97). The body carries the clicked card's items; we
   * validate they still match the server-side pending list (else the card is
   * stale — e.g. a newer 接龙 overwrote pending) → creates customers + draft
   * orders off **pending** (server stays source of truth) → clears pending.
   */
  app.post("/confirm-customers", async (c) => {
    const jwt = c.get("token") as string;
    const operatorId = c.get("operatorId") as string | number;
    const pending = getPending(operatorId);
    if (pending.length === 0) return c.json({ error: "no pending customers" }, 404);
    const body = (await c.req.json().catch(() => null)) as { items?: unknown } | null;
    // Correlate the click with its card: the submitted items must match pending,
    // else a newer record_orders overwrote pending between render and click (Codex P2).
    if (!sameItems(body?.items, pending)) {
      return c.json({ error: "card stale" }, 409);
    }
    try {
      // Pending items carry `customerName` (recordOrders shape); createCustomersAndOrders
      // takes `displayName` — map across (same join the old create tool did).
      const r = await createCmsAgentServices({ jwt, cms, operatorId }).createCustomersAndOrders(
        pending.map((it) => ({ displayName: it.customerName, address: it.address, quantity: it.quantity, occasion: it.occasion, date: it.date })),
      );
      clearPending(operatorId);
      const summary =
        r.created.length > 0
          ? `已建 ${r.created.length} 单：${r.created.map((x) => x.name).join("、")}`
          : "没有建成，再看看？";
      // Best-effort persist of the outcome (mirrors POST /chat).
      await createChat(jwt, { content: summary, role: "assistant" }).catch(() => null);
      return c.json({ created: r.created, failed: r.failed });
    } catch {
      return c.json({ error: "confirm failed" }, 502);
    }
  });

  return app;
}
