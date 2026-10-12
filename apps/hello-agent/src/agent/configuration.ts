import type { Payload } from "payload";
import type { KnowledgeBase } from "../payload-types";
import { AppError } from "../domain/contracts";
import { decryptKnowledgeSecret } from "../cms/secret";
import type { PsychologyApproach } from "./psychology";
import {
  searchIma,
  type KnowledgeContext,
  type ImaConnection,
} from "./knowledge";

export type SpecialistDefinition = {
  approach: PsychologyApproach;
  label: string;
  prompt: string;
  revision: string;
  knowledge?: (query: string, signal: AbortSignal) => Promise<KnowledgeContext>;
};
export type AgentConfiguration = {
  coordinator: string;
  revision: string;
  specialists: SpecialistDefinition[];
};

export function imaConnection(
  row: KnowledgeBase,
  secret: string,
): ImaConnection {
  if (!row.clientId || !row.knowledgeBaseId || !row.encryptedApiKey)
    throw new Error("请填写 ima 知识库 ID、Client ID 和 API Key 后保存");
  return {
    clientId: row.clientId,
    knowledgeBaseId: row.knowledgeBaseId,
    apiKey: decryptKnowledgeSecret(row.encryptedApiKey, secret),
  };
}

// Read once per turn, so edits apply to the next turn. Secrets stay in closures;
// neither ADK sessions nor public artifacts contain the stored configuration.
export async function loadAgentConfiguration(
  payload: Payload,
): Promise<AgentConfiguration> {
  const result = await payload.find({
    collection: "agent-configs",
    limit: 9,
    depth: 0,
    overrideAccess: true,
    sort: "key",
  });
  const coordinator = result.docs.find((doc) => doc.key === "coordinator");
  if (!coordinator?.enabled)
    throw new AppError(503, "助手配置尚未初始化，请管理员运行 seed");
  const enabled = result.docs.filter(
    (doc) => doc.key !== "coordinator" && doc.enabled,
  );
  const ids = [
    ...new Set(
      enabled.flatMap((doc) =>
        (doc.knowledgeBases ?? []).map((ref) =>
          typeof ref === "number" ? ref : ref.id,
        ),
      ),
    ),
  ];
  const libraries = ids.length
    ? (
        await payload.find({
          collection: "knowledge-bases",
          where: { and: [{ id: { in: ids } }, { enabled: { equals: true } }] },
          limit: 16,
          depth: 0,
          overrideAccess: true,
          context: { helloKnowledgeSecrets: true },
        })
      ).docs
    : [];
  return {
    coordinator: coordinator.prompt,
    revision: `${coordinator.id}:${coordinator.updatedAt}`,
    specialists: enabled.map((doc) => {
      const boundIds = (doc.knowledgeBases ?? []).map((ref) =>
        typeof ref === "number" ? ref : ref.id,
      );
      const bound = libraries
        .filter((lib) => boundIds.includes(lib.id))
        .slice(0, 2);
      return {
        approach: doc.key as PsychologyApproach,
        label: doc.name,
        prompt: doc.prompt,
        revision: `${doc.id}:${doc.updatedAt}`,
        knowledge: bound.length
          ? async (query, signal) => {
              const sources: KnowledgeContext["sources"] = [];
              const notices: string[] = [];
              for (const library of bound) {
                if (signal.aborted) throw new AppError(408, "生成已超时");
                if (library.provider === "inline") {
                  if (library.content)
                    sources.push({
                      library: library.name,
                      title: library.name,
                      excerpt: library.content.slice(0, 6000),
                    });
                  continue;
                }
                try {
                  const matches = await searchIma(
                    imaConnection(library, payload.secret),
                    query,
                    signal,
                  );
                  sources.push(
                    ...matches.map((match) => ({
                      ...match,
                      library: library.name,
                    })),
                  );
                  if (!matches.length)
                    notices.push(`${library.name}：未找到相关资料。`);
                  if (matches.some((match) => !match.excerpt))
                    notices.push(
                      `${library.name}：部分结果只有标题，没有可引用正文。`,
                    );
                } catch {
                  if (signal.aborted) throw new AppError(408, "生成已超时");
                  notices.push(
                    `${library.name}：本次读取失败，不得声称已核对该知识库。`,
                  );
                }
              }
              return { sources, notices };
            }
          : undefined,
      };
    }),
  };
}
