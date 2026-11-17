const ambiguousPercentEncoding = /%(?:0[0-9a-f]|1[0-9a-f]|2e|2f|5c|7f)/i;
const invalidPercentEncoding = /%(?![0-9a-f]{2})/i;
const trustedPathPattern = /^\/[A-Za-z0-9._~!$&'()*+,;=:@/%-]+$/;

function rejectAmbiguousText(value: string, field: string): void {
  const hasForbiddenCharacter = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 || character === "\\";
  });
  if (
    hasForbiddenCharacter
    || value.startsWith("//")
    || /(?:^|\/)\.{1,2}(?:\/|$|[?#])/.test(value)
    || invalidPercentEncoding.test(value)
    || ambiguousPercentEncoding.test(value)
  ) {
    throw new Error(`${field} contains an ambiguous or forbidden URL representation`);
  }
}

export function normalizeTrustedBaseUrl(value: string, field: string): URL {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty absolute http(s) URL`);
  }
  rejectAmbiguousText(value, field);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${field} must use http or https`);
  }
  if (url.protocol === "http:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "[::1]") {
    throw new Error(`${field} must use https outside local tests`);
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "" || url.search !== "" || url.pathname !== "/") {
    throw new Error(`${field} must be an origin without credentials, path, query or fragment`);
  }
  return new URL(`${url.origin}/`);
}

export function normalizeTrustedPath(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty absolute path`);
  }
  rejectAmbiguousText(value, field);
  if (
    !trustedPathPattern.test(value)
    || value === "/"
    || value.endsWith("/")
    || value.includes("//")
    || value.includes("?")
    || value.includes("#")
  ) {
    throw new Error(`${field} must be an unambiguous absolute path without query, fragment or trailing slash`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`${field} must not contain path normalization segments`);
  }
  return value;
}

export function configuredUrl(baseUrl: URL | string, path: string): string {
  const url = new URL(path, baseUrl);
  if (url.pathname !== path || url.search !== "" || url.hash !== "") {
    throw new Error("Configured A2A URL changed during URL normalization");
  }
  return url.toString();
}

export function normalizeExactHttpUrl(value: string, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a URL`);
  rejectAmbiguousText(value, field);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute http(s) URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${field} must use http or https`);
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new Error(`${field} must not contain credentials, query or fragment`);
  }
  return url.toString();
}
