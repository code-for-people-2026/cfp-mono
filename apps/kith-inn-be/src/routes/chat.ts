import { Hono } from "hono";
import type { ChatMessage as LlmMessage } from "../lib/llm/chatWithTools";
import { findOfferings } from "../lib/cms/client";
import {
  createFulfillments,
  createOrderDraft,
  getSeller,
  getOrder,
  listFulfillments,
  listOrders,
  setFulfillmentsByOrderItems,
  updateOrder,
  upsertSlots,
} from "../lib/cms/orders";
import { listCustomers } from "../lib/cms/customers";
import { createChatMessage, listChatMessages } from "../lib/cms/chat";
import { createCmsAgentServices, type AgentCms } from "../agent/services";
import { runAgent } from "../agent/run";
import { sellerAuth, type AppVars } from "../middleware/sellerAuth";

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
    setFulfillmentsByOrderItems,
    listCustomers,
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
      // Project to the 4 fields the miniapp needs — cms depth-populates
      // operator/seller, which must not leak to the client (Codex).
      const messages = (await listChat(jwt, { limit: 50 })).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      }));
      return c.json({ messages });
    } catch {
      return c.json({ error: "history failed" }, 502);
    }
  });

  app.post("/", async (c) => {
    const jwt = c.get("token") as string;
    const body = (await c.req.json().catch(() => null)) as { text?: string } | null;
    if (!body?.text) return c.json({ error: "text required" }, 400);
    try {
      const recent = await listChat(jwt, { limit: 20 });
      const history: LlmMessage[] = [...recent].reverse().map((m) => ({ role: m.role, content: m.content }));
      const reply = await run({ userText: body.text, history, services: createCmsAgentServices({ jwt, cms }) });
      // Best-effort: a chat-history write failure must NOT fail the turn once the
      // agent's business side-effects (e.g. record_order) already committed — a 502
      // here would read as "chat failed" and a retry would duplicate the draft.
      await Promise.all([
        createChat(jwt, { content: body.text, role: "user" }),
        createChat(jwt, { content: reply, role: "assistant" }),
      ]).catch(() => null);
      return c.json({ reply });
    } catch {
      return c.json({ error: "chat failed" }, 502);
    }
  });

  return app;
}
