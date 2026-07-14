const PRODUCTION_URL_ERROR =
  "生产 BE_BASE_URL 必须是显式的公网 HTTPS origin，且不能包含 IP、局域网、保留域名、路径、查询或片段";

function invalidProductionUrl(): never {
  throw new Error(PRODUCTION_URL_ERROR);
}

const IANA_EXAMPLE_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

/** Pure build/runtime contract shared by Taro config and endpoint builders. */
export function productionBeBaseUrl(value?: string): string {
  const normalized = value?.trim().replace(/\/+$/, "");
  if (!normalized) invalidProductionUrl();

  const match = /^https:\/\/([^/?#]+)$/i.exec(normalized);
  if (!match) invalidProductionUrl();

  const authority = match[1]!;
  if (authority.includes("@")) invalidProductionUrl();

  const authorityParts = authority.split(":");
  if (authorityParts.length > 2) invalidProductionUrl();
  const [hostname = "", port] = authorityParts;
  const host = hostname.toLowerCase();
  if (port && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535)) invalidProductionUrl();

  const validHostname = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
  if (
    !validHostname.test(host) ||
    ipv4.test(host) ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".lan") ||
    host.endsWith(".home.arpa") ||
    host.endsWith(".invalid") ||
    host.endsWith(".example") ||
    host.endsWith(".test") ||
    IANA_EXAMPLE_DOMAINS.has(host) ||
    [...IANA_EXAMPLE_DOMAINS].some((domain) => host.endsWith(`.${domain}`))
  ) {
    invalidProductionUrl();
  }

  return `https://${authority}`;
}
