import { convert } from "html-to-text";
import { unzipSync } from "fflate";

export function plainText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "a", options: { ignoreHref: true } },
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "nav", format: "skip" },
      { selector: "footer", format: "skip" },
    ],
    limits: { maxInputLength: 2_000_000 },
  })
    .replace(/\u0000/g, "")
    .trim();
}

/** Select a bounded passage around the query, rather than always the preface. */
export function relevantPassage(text: string, query: string, limit = 2800) {
  const clean = text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (clean.length <= limit) return clean;
  const terms = query.split(/[\s，、,；;]+/).filter((term) => term.length > 1);
  const candidates = terms
    .map((term) => clean.toLowerCase().indexOf(term.toLowerCase()))
    .filter((index) => index >= 0);
  const first = candidates.length ? Math.min(...candidates) : 0;
  const start = Math.max(0, first - 400);
  return `${start ? "…" : ""}${clean.slice(start, start + limit)}${start + limit < clean.length ? "…" : ""}`;
}

async function extractPdf(bytes: Uint8Array, signal: AbortSignal) {
  let destroy: (() => Promise<void>) | undefined;
  const cleanup = () => {
    const release = destroy;
    destroy = undefined;
    // PDF.js cleanup can itself wait for unfinished parsing; never extend the deadline.
    if (release) void release().catch(() => {});
  };
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const parse = async () => {
    const { getResolvedPDFJS } = await import("unpdf");
    signal.throwIfAborted();
    const { getDocument } = await getResolvedPDFJS();
    signal.throwIfAborted();
    const task = getDocument({
      data: bytes,
      useSystemFonts: false,
      disableFontFace: true,
    });
    destroy = () => task.destroy();
    const document = await task.promise;
    signal.throwIfAborted();
    const parts: string[] = [];
    for (let page = 1; page <= Math.min(document.numPages, 40); page++) {
      const current = await document.getPage(page);
      signal.throwIfAborted();
      const content = await current.getTextContent();
      signal.throwIfAborted();
      parts.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
      if (parts.join("\n").length >= 100_000) break;
    }
    return parts.join("\n").slice(0, 100_000);
  };
  try {
    return await Promise.race([parse(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    cleanup();
  }
}

export async function extractDocument(
  bytes: Uint8Array,
  contentType: string,
  mediaType: number | undefined,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  if (Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-") {
    return extractPdf(bytes, signal);
  }
  if (mediaType === 3 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    // Only decompress the document XML, with an explicit expanded-size bound.
    const files = unzipSync(bytes, {
      filter: (file) =>
        file.name === "word/document.xml" && file.originalSize <= 2_000_000,
    });
    const document = files["word/document.xml"];
    if (!document) throw new Error("文档正文不存在或超过读取限制");
    return plainText(
      new TextDecoder()
        .decode(document)
        .replace(/<\/w:p>/g, "</p>\n")
        .replace(/<w:p(?:\s[^>]*)?>/g, "<p>"),
    );
  }
  if (
    /text\/|application\/(?:xhtml\+xml|json)/i.test(contentType) ||
    [2, 6, 7, 13, 14, 20].includes(mediaType ?? -1)
  ) {
    const charset =
      contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || "utf-8";
    const text = new TextDecoder(charset).decode(bytes);
    if (/html/i.test(contentType) || [2, 6, 7, 20].includes(mediaType ?? -1)) {
      return plainText(text);
    }
    return text.replace(/\u0000/g, "").trim();
  }
  throw new Error("此文件格式暂不支持正文提取，请在 ima 客户端查看");
}
