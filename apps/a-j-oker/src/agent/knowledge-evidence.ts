import type { Payload } from "payload";
import { z } from "zod";
import { PSYCHOLOGY_APPROACHES } from "./psychology";

const sourceSchema = z.object({
  library: z.string(),
  title: z.string(),
  excerpt: z.string(),
  sourceId: z.string().optional(),
  referenceId: z.string().optional(),
  searchQuery: z.string().optional(),
  readStatus: z.string().optional(),
  notice: z.string().optional(),
});
const contextSchema = z.object({
  sources: z.array(sourceSchema),
  notices: z.array(z.string()),
  query: z.string().optional(),
});
export type KnowledgeEvidence = {
  approach: string;
  label: string;
  query: string;
  sources: (z.infer<typeof sourceSchema> & { cited: boolean })[];
  notices: string[];
};

export function expertSessionApproach(id: string) {
  const match =
    /^\d+(?::[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?:([a-z_]+)(?::attempt-[1-9]\d*)?$/.exec(
      id,
    );
  return match && Object.hasOwn(PSYCHOLOGY_APPROACHES, match[1])
    ? match[1]
    : undefined;
}

export function evidenceFromSnapshot(
  approach: string,
  snapshot: unknown,
): KnowledgeEvidence {
  const stored = z.object({ state: z.object({ safetyKnowledgeEvidence: z.object({ approach: z.string(), label: z.string(), query: z.string(), sources: z.array(sourceSchema.extend({ cited: z.boolean() })), notices: z.array(z.string()) }) }) }).safeParse(snapshot);
  const previous = stored.success ? stored.data.state.safetyKnowledgeEvidence : undefined;
  const document = z
    .object({
      events: z.array(
        z.object({
          content: z
            .object({
              role: z.string().optional(),
              parts: z.array(z.unknown()).optional(),
            })
            .optional(),
        }),
      ),
    })
    .safeParse(snapshot);
  // 已脱敏的历史从独立依据字段恢复；本次新事件仍须参与计算，不能被旧快照短路。
  let context: z.infer<typeof contextSchema> | undefined = previous;
  const calls = new Map<string, string[]>();
  let cited: string[] = previous?.sources.filter((source) => source.cited).map((source) => source.referenceId || "") ?? [];
  for (const event of document.success ? document.data.events : []) {
    for (const part of event.content?.parts ?? []) {
      const item = z
        .object({
          text: z.string().optional(),
          functionCall: z
            .object({
              id: z.string().optional(),
              name: z.string().optional(),
              args: z.unknown(),
            })
            .optional(),
          functionResponse: z
            .object({
              id: z.string().optional(),
              name: z.string().optional(),
              response: z.unknown(),
            })
            .optional(),
        })
        .safeParse(part);
      if (!item.success) continue;
      if (event.content?.role === "user" && item.data.text) {
        try {
          const body = JSON.parse(item.data.text);
          if (
            typeof body.coordinatorRequest === "string" &&
            typeof body.configurationRevision === "string"
          ) {
            const parsed = contextSchema.safeParse(body.knowledgeContext);
            if (parsed.success) context = parsed.data;
          }
        } catch {
          /* Ordinary chat text is not a knowledge record. */
        }
      }
      const call = item.data.functionCall;
      if (call?.name === "submit_psychology_plan" && call.id) {
        const args = z
          .object({ usedSourceIds: z.array(z.string()).default([]) })
          .safeParse(call.args);
        if (args.success) calls.set(call.id, args.data.usedSourceIds);
      }
      const response = item.data.functionResponse;
      if (
        response?.name === "submit_psychology_plan" &&
        response.id &&
        z.object({ submitted: z.literal(true) }).safeParse(response.response)
          .success
      ) {
        cited = calls.get(response.id) || [];
      }
    }
  }
  const label =
    Object.entries(PSYCHOLOGY_APPROACHES).find(([key]) => key === approach)?.[1]
      .label || approach;
  return {
    approach,
    label,
    query: context?.query || "",
    sources: (context?.sources ?? []).map((source) => ({
      ...source,
      cited: !!source.excerpt && cited.includes(source.referenceId || ""),
    })),
    notices: context?.notices ?? [
      "这位专家本轮没有绑定知识库，或旧版本未记录资料。",
    ],
  };
}

export async function readTurnKnowledge(payload: Payload, turnId: number) {
  // Called only after administrator authentication; never exposed through visitor responses.
  const turn = await payload.findByID({
    collection: "a-j-oker",
    id: turnId,
    depth: 0,
  });
  const prefix = `hello_agent:${turn.owner}:${turnId}:`;
  const rows = await payload.find({
    collection: "adk-sessions",
    depth: 0,
    limit: 100,
    sort: "-id",
    where: {
      and: [
        { owner: { equals: turn.owner } },
        { key: { contains: prefix } },
      ],
    },
  });
  const found = new Set<string>();
  return rows.docs.flatMap((row) => {
    if (!row.key.startsWith(prefix)) return [];
    const approach = expertSessionApproach(
      row.key.slice(`hello_agent:${turn.owner}:`.length),
    );
    if (!approach || found.has(approach)) return [];
    found.add(approach);
    return [evidenceFromSnapshot(approach, row.snapshot)];
  });
}
