export function labeledAiText(value: string, external = false) {
  return `AI 生成${external ? "（外部客户端声明）" : ""} · 阿 J 先生\n${value}`;
}

// Browser selection copying is a real export path, including a table cell or
// card fragment. Leave user messages, uploads and input fields untouched.
export function installAiCopyLabels(root: Document = document) {
  const handler = (event: ClipboardEvent) => {
    const selection = root.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1 || !event.clipboardData) return;
    const range = selection.getRangeAt(0);
    // Only override a selection wholly inside one AI source container. A
    // multi-message selection must keep the browser's original mixed content.
    const common = range.commonAncestorContainer;
    const element = common.nodeType === 1 ? common as Element : common.parentElement;
    const source = element?.closest('[data-ai-generated="true"], .artifact-surface, .assistant-bubble');
    if (!source || element?.closest('input, textarea, [contenteditable="true"]')) return;
    // Inspect only the selected fragment. Containers also include system
    // statuses, controls and user fields, which must not acquire AI provenance.
    const fragment = range.cloneContents();
    const text = root.createTreeWalker(fragment, 4 /* SHOW_TEXT */);
    let hasGeneratedText = false;
    for (let node = text.nextNode(); node; node = text.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const context = node.parentElement || element;
      const origin = context?.closest('[data-ai-generated]') || element?.closest('[data-ai-generated]');
      if (origin?.getAttribute("data-ai-generated") !== "true" || context?.closest('input, textarea, [contenteditable="true"]')) return;
      hasGeneratedText = true;
    }
    if (!hasGeneratedText) return;
    const external = !!source.closest('[data-ai-external="true"]');
    event.clipboardData.setData("text/plain", labeledAiText(selection.toString(), external));
    event.preventDefault();
  };
  root.addEventListener("copy", handler);
  return () => root.removeEventListener("copy", handler);
}
