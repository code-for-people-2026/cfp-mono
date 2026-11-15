"use client";
import { useEffect, useState } from "react";
import type { KnowledgeEvidence } from "../agent/knowledge-evidence";
const readLabels: Record<string, string> = {
  snippet: "搜索正文片段",
  document: "原文节选",
  title_only: "仅标题",
  restricted: "原文权限受限",
  unavailable: "原文读取失败",
};
export function KnowledgeEvidencePanel({ id }: { id?: string | number }) {
  const [experts, setExperts] = useState<KnowledgeEvidence[]>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void fetch(`/api/hello-admin/turns/${id}/knowledge`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error("资料记录暂时无法读取，请刷新后重试。");
        setExperts((await response.json()).experts);
      })
      .catch((value) => {
        if (!controller.signal.aborted)
          setError(value instanceof Error ? value.message : "读取失败");
      });
    return () => controller.abort();
  }, [id]);
  return (
    <section
      style={{
        margin: "24px 0",
        padding: 20,
        border: "1px solid var(--theme-elevation-200)",
        borderRadius: 8,
      }}
    >
      <h3>本轮参考资料</h3>
      <p>
        区分检索结果、提供给专家的正文与专家声明引用。引用标记不能单独证明最终回答准确，请结合原文核对。
      </p>
      {error ? (
        <p role="alert">{error}</p>
      ) : !experts ? (
        <p>正在读取…</p>
      ) : !experts.length ? (
        <p>本轮没有心理专家执行记录（直接回应、外部 Agent 或旧记录）。</p>
      ) : (
        experts.map((expert) => (
          <div key={expert.approach} style={{ marginTop: 24 }}>
            <h4>
              {expert.label} ·{" "}
              {expert.sources.filter((source) => source.excerpt).length} 份正文
              · {expert.sources.filter((source) => source.cited).length}{" "}
              份声明引用
            </h4>
            {expert.query && <p>检索词：{expert.query}</p>}
            {expert.notices.map((notice, index) => (
              <p key={index}>{notice}</p>
            ))}
            {expert.sources.map((source, index) => (
              <details
                key={index}
                style={{
                  borderTop: "1px solid var(--theme-elevation-150)",
                  padding: "12px 0",
                }}
              >
                <summary>
                  {source.cited
                    ? "专家声明引用"
                    : source.excerpt
                      ? "已提供正文"
                      : "未提供正文"}{" "}
                  · {source.title}
                </summary>
                <p>
                  知识库：{source.library} ·{" "}
                  {readLabels[source.readStatus || ""] ||
                    (source.excerpt ? "正文片段" : "仅标题")}
                </p>
                {source.searchQuery && <p>命中检索词：{source.searchQuery}</p>}
                {source.notice && <p>{source.notice}</p>}
                {source.excerpt && (
                  <blockquote
                    style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                  >
                    {source.excerpt}
                  </blockquote>
                )}
              </details>
            ))}
          </div>
        ))
      )}
    </section>
  );
}
