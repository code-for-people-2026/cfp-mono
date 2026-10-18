// The lexicon is a risk signal, not a verdict. Keep harmless context for review.
function normalizeKeywordText(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/gu, "");
}

type Node = { children: Map<string, Node>; word?: string };

export function createKeywordMatcher(words: readonly string[]) {
  const root: Node = { children: new Map() };
  for (const entry of words) {
    const word = normalizeKeywordText(entry).trim();
    if ([...word].length < 2) continue;
    let node = root;
    for (const character of word) {
      let child = node.children.get(character);
      if (!child) {
        child = { children: new Map() };
        node.children.set(character, child);
      }
      node = child;
    }
    node.word = word;
  }
  return (text: string, limit = 20, ignored: ReadonlySet<string> = new Set()): string[] => {
    const characters = [...normalizeKeywordText(text)];
    const hits = new Set<string>();
    for (let start = 0; start < characters.length; start++) {
      let node: Node | undefined = root;
      for (let end = start; end < characters.length; end++) {
        node = node.children.get(characters[end]);
        if (!node) break;
        // Ignored words must not consume the recall budget and hide later hits.
        if (!node.word || ignored.has(node.word)) continue;
        // English terms must not match inside an unrelated word (e.g. class).
        if (/^[a-z0-9]/.test(node.word) && /[a-z0-9]/.test(characters[start - 1] ?? "")) continue;
        if (/[a-z0-9]$/.test(node.word) && /[a-z0-9]/.test(characters[end + 1] ?? "")) continue;
        hits.add(node.word);
        if (hits.size >= limit) return [...hits];
      }
    }
    return [...hits];
  };
}

// Inspect every string leaf, including nested form labels and illustration text.
export function textLeaves(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(textLeaves);
  if (value && typeof value === "object") return Object.values(value).flatMap(textLeaves);
  return [];
}
