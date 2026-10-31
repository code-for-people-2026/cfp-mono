import { describe, expect, it, vi } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  extractDocument,
  plainText,
  relevantPassage,
} from "./knowledge-document";
import { searchIma, safeDocumentUrl } from "./knowledge";
const connection = {
  clientId: "fixture-id",
  apiKey: "fixture-key",
  knowledgeBaseId: "fixture-kb",
};
const signal = new AbortController().signal;
const json = (data: unknown) => new Response(JSON.stringify({ code: 0, data }));
const found = {
  info_list: [
    {
      media_id: "doc",
      title: "自动思维记录",
      media_type: 6,
      highlight_content: "",
    },
  ],
};

describe("ima 正文读取", () => {
  it("组合检索词为空时尝试短关键词，并记录真正命中的词", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ info_list: [] }))
      .mockResolvedValueOnce(json({ info_list: [] }))
      .mockResolvedValueOnce(
        json({
          info_list: [{ title: "引出自动思维", highlight_content: "正文片段" }],
        }),
      );
    const sources = await searchIma(
      connection,
      "自动思维记录 认知重构",
      signal,
      fetcher,
    );
    expect(
      fetcher.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).query),
    ).toEqual(["自动思维记录 认知重构", "自动思维记录", "自动思维"]);
    expect(sources[0]).toMatchObject({
      searchQuery: "自动思维",
      readStatus: "snippet",
      excerpt: "正文片段",
    });
  });
  it("标题匹配后按官方原文入口提取内容，凭证不会发给原文服务", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(found))
      .mockResolvedValueOnce(
        json({
          media_type: 6,
          url_info: { url: "https://mp.weixin.qq.com/s/example" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          "<html><script>秘密脚本</script><main><h1>自动思维</h1><p>先区分事实 &amp; 想法，再检查证据。</p></main></html>",
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
      );
    const result = await searchIma(connection, "自动思维", signal, fetcher);
    expect(result[0]).toMatchObject({
      readStatus: "document",
      excerpt: expect.stringContaining("先区分事实 & 想法"),
    });
    expect(result[0].excerpt).not.toContain("秘密脚本");
    expect(fetcher.mock.calls[2][1]?.headers).toEqual({});
    expect(fetcher.mock.calls[2][1]?.redirect).toBe("error");
    expect(JSON.stringify(result)).not.toContain("mp.weixin");
  });
  it("订阅库限制单独记录，不伪造正文或泄漏服务商内容", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(found))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 220030, msg: connection.apiKey })),
      );
    const result = await searchIma(connection, "自动思维", signal, fetcher);
    expect(result[0]).toMatchObject({
      readStatus: "restricted",
      excerpt: "",
      notice: expect.stringContaining("订阅库"),
    });
    expect(JSON.stringify(result)).not.toContain(connection.apiKey);
  });
  it("笔记使用 note_id 读取纯文本", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(found))
      .mockResolvedValueOnce(
        json({ media_type: 11, notebook_ext_info: { notebook_id: "note1" } }),
      )
      .mockResolvedValueOnce(json({ content: "这份笔记的真实正文" }));
    expect(
      (await searchIma(connection, "自动思维", signal, fetcher))[0],
    ).toMatchObject({ readStatus: "document", excerpt: "这份笔记的真实正文" });
    expect(fetcher.mock.calls[2][0]).toBe(
      "https://ima.qq.com/openapi/note/v1/get_doc_content",
    );
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({
      note_id: "note1",
      target_content_format: 0,
    });
  });
  it("阻止内网、仿冒域名、异常请求头，不把网页跳转当原文", async () => {
    for (const url of [
      "http://mp.weixin.qq.com/a",
      "https://127.0.0.1/a",
      "https://ima.qq.com.evil.test/a",
      "https://a.myqcloud.com@evil.test/a",
      "https://a.myqcloud.com:9000/a",
    ])
      expect(() => safeDocumentUrl(url)).toThrow();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(found))
      .mockResolvedValueOnce(
        json({
          media_type: 6,
          url_info: {
            url: "https://mp.weixin.qq.com/s/a",
            headers: { "ima-openapi-apikey": "bad" },
          },
        }),
      );
    expect(
      (await searchIma(connection, "自动思维", signal, fetcher))[0].readStatus,
    ).toBe("unavailable");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("PDF 实际解析文字并释放读取任务，无需字体包", async () => {
    const objects = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Length 49 >>\nstream\nBT /F1 12 Tf 30 200 Td (CBT reference text) Tj ET\nendstream",
    ];
    let pdf = "%PDF-1.4\n";
    const offsets = [0];
    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
      .slice(1)
      .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
      .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    expect(
      await extractDocument(
        new Uint8Array(Buffer.from(pdf)),
        "application/pdf",
        1,
        signal,
      ),
    ).toContain("CBT reference text");
  });
  it("超过下载上限时不注入正文", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(found))
      .mockResolvedValueOnce(
        json({
          media_type: 6,
          url_info: { url: "https://mp.weixin.qq.com/s/a" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("large", { headers: { "content-length": "5000001" } }),
      );
    expect(
      (await searchIma(connection, "自动思维", signal, fetcher))[0],
    ).toMatchObject({ readStatus: "unavailable", excerpt: "" });
  });
  it("DOCX 提取真实文本，排除其他 ZIP 内容", async () => {
    const document = zipSync({
      "word/document.xml": strToU8(
        "<w:document><w:p><w:r><w:t>事实与想法</w:t></w:r></w:p><w:p><w:r><w:t>寻找不同证据</w:t></w:r></w:p></w:document>",
      ),
      "evil.txt": strToU8("不应出现"),
    });
    const text = await extractDocument(
      document,
      "application/octet-stream",
      3,
      signal,
    );
    expect(text).toContain("事实与想法");
    expect(text).toContain("寻找不同证据");
    expect(text).not.toContain("不应出现");
  });
  it("相关段落不会总截取前言，HTML 解码但不执行脚本", () => {
    const text =
      "前言".repeat(3000) +
      "自动思维：这里才是所需证据。" +
      "尾部".repeat(3000);
    expect(relevantPassage(text, "自动思维")).toContain("这里才是所需证据");
    expect(relevantPassage(text, "自动思维").length).toBeLessThanOrEqual(2802);
    expect(plainText("<p>想法 &lt; 事实</p><style>bad</style>")).toBe(
      "想法 < 事实",
    );
  });
});
