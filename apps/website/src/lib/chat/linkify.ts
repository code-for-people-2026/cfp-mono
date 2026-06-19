// Safety net for assistant replies rendered with react-markdown + remark-gfm.
//
// Two problems this guards against, regardless of how the model formats its answer:
//
// 1. remark-gfm's autolink-literal extends a bare http(s) URL until it hits ASCII
//    whitespace, and does NOT treat CJK characters/punctuation (。《》 etc.) as
//    terminators. In Chinese replies a URL is followed immediately by CJK, so the
//    autolink swallows the rest of the sentence into one broken link.
//
// 2. The assistant sometimes emits the site's internal reading paths (/manifesto,
//    /license) as bare text. remark-gfm does NOT auto-link relative paths at all, so they
//    render as un-clickable plain text.
//
// We pre-wrap both cases as explicit markdown links so the boundary is unambiguous. The
// internal paths are an explicit whitelist (not arbitrary "/foo") so fractions like
// "1/3" are never mistaken for links. Lookbehind is avoided for Safari compatibility.

// A bare http(s) URL, matched with an ASCII-only URL character class so it naturally stops
// at CJK and whitespace. The leading group skips URLs already inside a markdown link/image
// or an angle-bracket autolink, avoiding double-wrapping.
const bareUrl = /(^|[^[\]("'<=])(https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+)/g;

// Known internal reading routes that should become clickable links when emitted bare. The
// leading group rejects a preceding word char / slash (so it is not part of a longer path
// or URL) and markdown-link punctuation; the trailing lookahead rejects path continuation
// (so "/licenses" or "/license/x" is not matched as "/license").
const bareInternalPath = /(^|[^A-Za-z0-9/\]("'<=])(\/(?:manifesto|license))(?![A-Za-z0-9/-])/g;

// Trailing punctuation that is almost always sentence punctuation rather than part of the
// URL. Closing brackets/parens are left alone so URLs that legitimately contain them are
// not truncated.
const trailingPunctuation = /[.,!?;:]+$/;

export function linkifyAssistantMarkdown(text: string): string {
  return text
    .replace(bareUrl, (_full, pre: string, url: string) => {
      const trailing = url.match(trailingPunctuation)?.[0] ?? "";
      const clean = trailing ? url.slice(0, url.length - trailing.length) : url;
      return `${pre}[${clean}](${clean})${trailing}`;
    })
    .replace(bareInternalPath, (_full, pre: string, path: string) => `${pre}[${path}](${path})`);
}
