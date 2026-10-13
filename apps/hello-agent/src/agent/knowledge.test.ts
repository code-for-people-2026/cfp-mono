import { describe, expect, it, vi } from "vitest";
import { checkImaConnection, searchIma } from "./knowledge";
import { decryptKnowledgeSecret, encryptKnowledgeSecret } from "../cms/secret";

const connection = {
  clientId: "fixture-client",
  apiKey: "fixture-secret",
  knowledgeBaseId: "fixture-kb",
};
const signal = new AbortController().signal;
const json = (data: unknown) => new Response(JSON.stringify(data));
describe("ima 官方 OpenAPI 适配", () => {
  it("固定官方地址、带认证、禁止重定向，只送关键词并读取官方 envelope", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        code: 0,
        data: {
          info_list: [
            {
              media_id: "ref1",
              title: "认知记录",
              highlight_content: "<em>想法</em>不等于事实",
            },
            { title: "只有标题" },
          ],
        },
      }),
    );
    const result = await searchIma(connection, "认知重构", signal, fetcher);
    expect(result).toEqual([
      {
        searchQuery: "认知重构",
        sourceId: "ref1",
        title: "认知记录",
        excerpt: "想法不等于事实",
        readStatus: "snippet",
      },
      {
        searchQuery: "认知重构",
        title: "只有标题",
        sourceId: undefined,
        excerpt: "",
        readStatus: "title_only",
      },
    ]);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://ima.qq.com/openapi/wiki/v1/search_knowledge");
    expect(options?.redirect).toBe("error");
    expect(options?.headers).toMatchObject({
      "ima-openapi-clientid": connection.clientId,
      "ima-openapi-apikey": connection.apiKey,
    });
    expect(JSON.parse(String(options?.body))).toEqual({
      query: "认知重构",
      cursor: "",
      knowledge_base_id: "fixture-kb",
    });
    expect(JSON.stringify(result)).not.toContain(connection.apiKey);
  });
  it("连接检查验证指定知识库的读取权限", async () => {
    expect(
      await checkImaConnection(
        connection,
        signal,
        vi.fn<typeof fetch>().mockResolvedValue(
          json({
            code: 0,
            data: { infos: { "fixture-kb": { name: "方法库" } } },
          }),
        ),
      ),
    ).toBe("方法库");
    await expect(
      checkImaConnection(
        connection,
        signal,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(json({ code: 0, data: { infos: {} } })),
      ),
    ).rejects.toThrow("权限");
  });
  it("错误不暴露服务商原文中的秘密", async () => {
    await expect(
      searchIma(
        connection,
        "CBT",
        signal,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(json({ code: 110030, msg: connection.apiKey })),
      ),
    ).rejects.toThrow("检查凭证");
  });
  it("拒绝超大响应，限制匹配数量和正文长度", async () => {
    await expect(
      searchIma(
        connection,
        "CBT",
        signal,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("x".repeat(1_000_001))),
      ),
    ).rejects.toThrow("超出限制");
    const result = await searchIma(
      connection,
      "CBT",
      signal,
      vi.fn<typeof fetch>().mockResolvedValue(
        json({
          code: 0,
          data: {
            info_list: Array.from({ length: 10 }, () => ({
              title: "t",
              highlight_content: "x".repeat(3000),
            })),
          },
        }),
      ),
    );
    expect(result).toHaveLength(3);
    expect(result[0].excerpt).toHaveLength(1500);
  });
  it("密钥使用随机 nonce 加密，篡改或更换服务端密钥不能解密", () => {
    const first = encryptKnowledgeSecret(connection.apiKey, "server-secret");
    expect(first).not.toContain(connection.apiKey);
    expect(first).not.toBe(
      encryptKnowledgeSecret(connection.apiKey, "server-secret"),
    );
    expect(decryptKnowledgeSecret(first, "server-secret")).toBe(
      connection.apiKey,
    );
    expect(() => decryptKnowledgeSecret(first, "wrong-secret")).toThrow();
    expect(() =>
      decryptKnowledgeSecret(first.slice(0, -3), "server-secret"),
    ).toThrow();
  });
});
