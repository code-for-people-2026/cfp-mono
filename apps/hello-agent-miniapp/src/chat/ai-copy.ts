// Browser selection copying is a real export path, including a table cell or
// card fragment. Leave user messages, uploads and input fields untouched.
export function installAiCopyLabels(root: Document = document) {
  const handler = (event: ClipboardEvent) => {
    const selection = root.getSelection();
    if (!selection || selection.isCollapsed || !event.clipboardData) return;
    const range = selection.getRangeAt(0);
    const nodes = root.querySelectorAll('[data-ai-generated="true"], .artifact-surface, .assistant-bubble');
    if (![...nodes].some((node) => range.intersectsNode(node))) return;
    event.clipboardData.setData("text/plain", `AI 生成 · 阿 J 先生\n${selection.toString()}`);
    event.preventDefault();
  };
  root.addEventListener("copy", handler);
  return () => root.removeEventListener("copy", handler);
}
