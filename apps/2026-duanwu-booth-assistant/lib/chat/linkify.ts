// remark-gfm's autolink-literal feature extends a bare URL until it hits ASCII
// whitespace, and it does NOT treat CJK characters or CJK punctuation (。《》 etc.) as
// terminators. In Chinese text a URL is almost always followed immediately by CJK with no
// space, so the autolink swallows the rest of the sentence into one broken link. We
// pre-wrap bare URLs as explicit markdown links so the link boundary is unambiguous and
// the trailing CJK stays outside the link.

// Match a bare http(s) URL using an ASCII-only URL character class (so it naturally stops
// at CJK and whitespace). The leading group skips URLs that are already part of a markdown
// link/image or an angle-bracket autolink, avoiding double-wrapping. Lookbehind is avoided
// for Safari compatibility.
const bareUrl = /(^|[^[\]("'<=])(https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/g;

// Trailing punctuation that is almost always sentence punctuation rather than part of the
// URL. Closing brackets/parens are left alone so URLs that legitimately contain them
// (e.g. wiki links) are not truncated.
const trailingPunctuation = /[.,!?;:]+$/;

export function linkifyAssistantMarkdown(text: string): string {
  return text.replace(bareUrl, (_full, pre: string, url: string) => {
    const trailing = url.match(trailingPunctuation)?.[0] ?? "";
    const clean = trailing ? url.slice(0, url.length - trailing.length) : url;
    return `${pre}[${clean}](${clean})${trailing}`;
  });
}
