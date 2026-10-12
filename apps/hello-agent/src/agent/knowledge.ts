import { z } from "zod";

export type KnowledgeContext = {
  sources: {
    library: string;
    title: string;
    excerpt: string;
    sourceId?: string;
  }[];
  notices: string[];
};
export type ImaConnection = {
  clientId: string;
  apiKey: string;
  knowledgeBaseId: string;
};
const responseSchema = z.object({
  retcode: z.number(),
  data: z.unknown().optional(),
});
const searchSchema = z.object({
  info_list: z
    .array(
      z.object({
        media_id: z.string().optional(),
        title: z.string(),
        highlight_content: z.string().optional(),
      }),
    )
    .max(1000),
});

// Fixed origin, no redirects, bounded response/time. No returned vendor errors,
// credentials, document downloads, or arbitrary URLs enter model context.
async function imaRequest(
  connection: ImaConnection,
  operation: "search_knowledge" | "get_knowledge_base",
  body: object,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(
    `https://ima.qq.com/openapi/wiki/v1/${operation}`,
    {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "ima-openapi-clientid": connection.clientId,
        "ima-openapi-apikey": connection.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    },
  );
  if (!response.ok || !response.body)
    throw new Error("ima 连接失败，请检查凭证和知识库权限");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 1_000_000) throw new Error("ima 返回内容超出限制");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  const result = responseSchema.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  if (result.retcode !== 0)
    throw new Error("ima 连接失败，请检查凭证和知识库权限");
  return result.data;
}

export async function searchIma(
  connection: ImaConnection,
  query: string,
  signal: AbortSignal,
  fetcher?: typeof fetch,
) {
  const data = searchSchema.parse(
    await imaRequest(
      connection,
      "search_knowledge",
      {
        knowledge_base_id: connection.knowledgeBaseId,
        query: query.trim().slice(0, 80),
        cursor: "",
      },
      signal,
      fetcher,
    ),
  );
  return data.info_list.slice(0, 3).map((item) => ({
    title: item.title.slice(0, 160),
    sourceId: item.media_id?.slice(0, 256),
    excerpt: (item.highlight_content ?? "")
      .replace(/<[^>]*>/g, "")
      .slice(0, 1500),
  }));
}

export async function checkImaConnection(
  connection: ImaConnection,
  signal: AbortSignal,
  fetcher?: typeof fetch,
) {
  const data = z
    .object({ infos: z.record(z.string(), z.object({ name: z.string() })) })
    .parse(
      await imaRequest(
        connection,
        "get_knowledge_base",
        { ids: [connection.knowledgeBaseId] },
        signal,
        fetcher,
      ),
    );
  const info = data.infos[connection.knowledgeBaseId];
  if (!info) throw new Error("凭证无法读取这个知识库，请检查 ID 和权限");
  return info.name.slice(0, 160);
}
