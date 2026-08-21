export type SiteLink = Readonly<{
  label: string;
  href: string;
}>;

export type SiteObject = string | SiteLink;

export function isSiteLink(value: SiteObject): value is SiteLink {
  return typeof value !== "string";
}
