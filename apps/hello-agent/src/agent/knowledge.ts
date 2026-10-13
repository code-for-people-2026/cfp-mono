import { z } from "zod";
import {
  extractDocument,
  plainText,
  relevantPassage,
} from "./knowledge-document";

export type KnowledgeSource = {
  library: string;
  title: string;
  excerpt: string;
  sourceId?: string;
  searchQuery?: string;
  referenceId?: string;
  readStatus?:
    | "snippet"
    | "document"
    | "title_only"
    | "restricted"
    | "unavailable";
  notice?: string;
};
export type KnowledgeContext = {
  sources: KnowledgeSource[];
  notices: string[];
  query?: string;
};
export type ImaConnection = {
  clientId: string;
  apiKey: string;
  knowledgeBaseId: string;
};
const responseSchema = z.object({
  code: z.number(),
  data: z.unknown().optional(),
});
const searchSchema = z.object({
  info_list: z
    .array(
      z.object({
        media_id: z.string().optional(),
        title: z.string(),
        highlight_content: z.string().nullish(),
        media_type: z.number().optional(),
      }),
    )
    .max(1000),
});
class ImaError extends Error {
  constructor(readonly code: number) {
    super(
      code === 220030
        ? "ima 不允许通过接口读取这份订阅库的原文，请在 ima 客户端查看或使用已获原文读取权限的知识库。"
        : "ima 连接失败，请检查凭证和知识库权限",
    );
  }
}
async function boundedBytes(response: Response, limit: number) {
  if (!response.ok || !response.body) throw new Error("读取失败");
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("ima 返回内容超出限制");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > limit) throw new Error("ima 返回内容超出限制");
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  return new Uint8Array(Buffer.concat(chunks));
}
async function imaRequest(
  connection: ImaConnection,
  operation:
    | "wiki/v1/search_knowledge"
    | "wiki/v1/get_knowledge_base"
    | "wiki/v1/get_media_info"
    | "note/v1/get_doc_content",
  body: object,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(`https://ima.qq.com/openapi/${operation}`, {
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
  });
  const result = responseSchema.parse(
    JSON.parse(
      Buffer.from(await boundedBytes(response, 1_000_000)).toString("utf8"),
    ),
  );
  if (result.code !== 0) throw new ImaError(result.code);
  return result.data;
}

/** Only official IMA-returned Tencent document hosts; API credentials never leave IMA. */
export function safeDocumentUrl(raw: string): URL {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !(
      url.hostname === "ima.qq.com" ||
      url.hostname === "mp.weixin.qq.com" ||
      url.hostname.endsWith(".myqcloud.com")
    )
  ) {
    throw new Error("原文地址不在允许的读取范围");
  }
  return url;
}
async function readOriginal(
  connection: ImaConnection,
  mediaId: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  const media = z
    .object({
      media_type: z.number().optional(),
      url_info: z
        .object({
          url: z.string(),
          headers: z.record(z.string(), z.string()).optional(),
        })
        .nullish(),
      notebook_ext_info: z.object({ notebook_id: z.string() }).nullish(),
    })
    .parse(
      await imaRequest(
        connection,
        "wiki/v1/get_media_info",
        { media_id: mediaId },
        signal,
        fetcher,
      ),
    );
  if (media.media_type === 11 && media.notebook_ext_info?.notebook_id) {
    const note = z.object({ content: z.string() }).parse(
      await imaRequest(
        connection,
        "note/v1/get_doc_content",
        {
          note_id: media.notebook_ext_info.notebook_id,
          target_content_format: 0,
        },
        signal,
        fetcher,
      ),
    );
    return note.content;
  }
  if (!media.url_info?.url) throw new Error("原文暂不可读");
  const url = safeDocumentUrl(media.url_info.url);
  const headers = media.url_info.headers || {};
  if (
    Object.keys(headers).some((name) =>
      /^(?:ima-|host$|cookie$|proxy-|connection$)/i.test(name),
    )
  )
    throw new Error("原文请求包含不允许的请求头");
  const response = await fetcher(url.href, {
    headers,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]),
  });
  const bytes = await boundedBytes(response, 5_000_000);
  return extractDocument(
    bytes,
    response.headers.get("content-type") || "",
    media.media_type,
    signal,
  );
}

export async function searchIma(
  connection: ImaConnection,
  query: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(16000)]);
  const phrase = query.trim().slice(0, 80);
  // ima 搜索偏向标题匹配；长组合词无结果时，最多再试一个词和其短前缀。
  const firstTerm = phrase.split(/[\s，、,；;]+/)[0];
  const shortTerm = /^[\p{Script=Han}]{5,}/u.test(firstTerm)
    ? firstTerm.slice(0, 4)
    : firstTerm;
  const phrases = [...new Set([phrase, firstTerm, shortTerm])]
    .filter(Boolean)
    .slice(0, 3);
  let data: z.infer<typeof searchSchema> = { info_list: [] };
  let matchedQuery = phrase;
  for (const candidate of phrases) {
    bounded.throwIfAborted();
    data = searchSchema.parse(
      await imaRequest(
        connection,
        "wiki/v1/search_knowledge",
        {
          knowledge_base_id: connection.knowledgeBaseId,
          query: candidate,
          cursor: "",
        },
        bounded,
        fetcher,
      ),
    );
    matchedQuery = candidate;
    if (data.info_list.length) break;
  }
  return Promise.all(
    data.info_list.slice(0, 3).map(async (item) => {
      const source: Omit<KnowledgeSource, "library"> = {
        searchQuery: matchedQuery,
        title: item.title.slice(0, 160),
        sourceId: item.media_id?.slice(0, 256),
        excerpt: plainText(item.highlight_content || "").slice(0, 1500),
        readStatus: "title_only",
      };
      if (source.excerpt) {
        source.readStatus = "snippet";
        return source;
      }
      if (!item.media_id) return source;
      try {
        const text = await readOriginal(
          connection,
          item.media_id,
          bounded,
          fetcher,
        );
        source.excerpt = relevantPassage(text, phrase);
        source.readStatus = source.excerpt ? "document" : "title_only";
        if (!source.excerpt)
          source.notice =
            "原文没有可提取文字；扫描图片等内容需在 ima 客户端查看。";
      } catch (error) {
        signal.throwIfAborted();
        source.readStatus =
          error instanceof ImaError &&
          [220030, 110030, 100005, 210011, 210034].includes(error.code)
            ? "restricted"
            : "unavailable";
        source.notice =
          error instanceof ImaError && error.code === 220030
            ? error.message
            : "未能读取原文（权限、格式、大小或连接限制）；不能据此声称读过正文。";
      }
      return source;
    }),
  );
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
        "wiki/v1/get_knowledge_base",
        { ids: [connection.knowledgeBaseId] },
        signal,
        fetcher,
      ),
    );
  const info = data.infos[connection.knowledgeBaseId];
  if (!info) throw new Error("凭证无法读取这个知识库，请检查 ID 和权限");
  return info.name.slice(0, 160);
}
