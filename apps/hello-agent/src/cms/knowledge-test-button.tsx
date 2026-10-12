"use client";

import { useState } from "react";

export function KnowledgeTestButton({ id }: { id?: string | number }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function check() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/hello-admin/knowledge/${id}/test`, {
        method: "POST",
        credentials: "same-origin",
      });
      const result = await response.json();
      setMessage(
        response.ok
          ? result.message
          : result.error || "连接检查失败，请稍后重试。",
      );
    } catch {
      setMessage("连接检查失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ margin: "12px 0 24px" }}>
      <button
        type="button"
        className="btn btn--style-secondary btn--size-medium"
        disabled={!id || busy}
        onClick={check}
      >
        {busy ? "正在检查…" : "测试已保存的连接"}
      </button>
      <p>
        {id
          ? "修改连接信息后，请先保存，再测试。"
          : "请先保存知识库，再测试连接。"}
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
      <a
        href="https://ima.qq.com/agent-interface"
        target="_blank"
        rel="noreferrer"
      >
        打开 ima OpenAPI 配置页
      </a>
    </div>
  );
}
