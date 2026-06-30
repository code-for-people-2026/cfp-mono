/** be → cms internal calls for the 「今天」chat history (PR7a). Seller-scoped via
 *  the operator JWT header; mirrors lib/cms/client.ts's findOfferings style. */
import type { ChatMessage, ChatRole } from "@cfp/kith-inn-shared";
import { cmsBase, OPERATOR_JWT_HEADER, type CmsDeps } from "./client";

/** GET /api/internal/chat_messages — the seller's recent chat (newest first). */
export async function listChatMessages(
  operatorJwt: string,
  query: { limit?: number } = {},
  deps: CmsDeps = {},
): Promise<ChatMessage[]> {
  const fetchImpl = deps.fetch ?? fetch;
  const qs = new URLSearchParams();
  if (query.limit) qs.set("limit", String(query.limit));
  const tail = qs.toString();
  const res = await fetchImpl(`${cmsBase()}/api/internal/chat_messages${tail ? `?${tail}` : ""}`, {
    headers: { [OPERATOR_JWT_HEADER]: operatorJwt },
  });
  if (!res.ok) throw new Error(`cms chat list failed: ${res.status}`);
  const json = (await res.json()) as { docs?: ChatMessage[] };
  return json.docs ?? [];
}

/** POST /api/internal/chat_messages — persist one user/assistant message. */
export async function createChatMessage(
  operatorJwt: string,
  input: { content: string; role: ChatRole },
  deps: CmsDeps = {},
): Promise<ChatMessage> {
  const fetchImpl = deps.fetch ?? fetch;
  const res = await fetchImpl(`${cmsBase()}/api/internal/chat_messages`, {
    method: "POST",
    headers: { [OPERATOR_JWT_HEADER]: operatorJwt, "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`cms chat create failed: ${res.status}`);
  return (await res.json()) as ChatMessage;
}
