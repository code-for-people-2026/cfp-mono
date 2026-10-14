import type { Payload } from "payload";
import { DEFAULT_AGENT_CONFIGS } from "../agent/default-prompts";

/** Explicit, repeatable initialization. Existing prompts, disabled agents and
 * knowledge bindings belong to administrators and are never overwritten. */
export async function seedAgents(payload: Payload) {
  const existing = await payload.find({
    collection: "agent-configs",
    limit: 9,
    depth: 0,
    overrideAccess: true,
  });
  const keys = new Set(existing.docs.map((doc) => doc.key));
  let created = 0;
  for (const data of DEFAULT_AGENT_CONFIGS) {
    if (keys.has(data.key)) continue;
    await payload.create({
      collection: "agent-configs",
      data,
      overrideAccess: true,
    });
    created++;
  }
  return { created, preserved: existing.docs.length };
}
