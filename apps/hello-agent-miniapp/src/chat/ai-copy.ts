export function labeledAiText(value: string, external = false) {
  return `AI 生成${external ? "（外部客户端声明）" : ""} · 阿 J 先生\n${value}`;
}

// Browser selection copying is a real export path, including a table cell or
// card fragment. Leave user messages, uploads and input fields untouched.
export function installAiCopyLabels(root: Document = document) {
  const handler = (event: ClipboardEvent) => {
    const selection = root.getSelection();
    if (!selection || selection.isCollapsed || !event.clipboardData) return;
    const range = selection.getRangeAt(0);
    const nodes = root.querySelectorAll('[data-ai-generated="true"], .artifact-surface, .assistant-bubble');
    const selected = [...nodes].filter((node) => range.intersectsNode(node));
    if (!selected.length) return;
    const external = selected.some((node) => node.closest('[data-ai-external="true"]'));
    event.clipboardData.setData("text/plain", labeledAiText(selection.toString(), external));
    event.preventDefault();
  };
  root.addEventListener("copy", handler);
  return () => root.removeEventListener("copy", handler);
}
