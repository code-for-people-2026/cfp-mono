import Link from "next/link";
import { linkVariants } from "@/components/ui/link";
import { cn } from "@/lib/utils";
import { BrandLockup } from "./brand-lockup";
import { siteNavigation } from "./navigation";
import { isSiteLink, type SiteLink, type SiteObject } from "./types";

const defaultPublicLinks: readonly SiteLink[] = [
  { label: "GitHub", href: "https://github.com/code-for-people-2026" },
];

type FullSiteFooterProps = {
  publicLinks?: readonly SiteLink[];
  filing?: SiteLink;
  copyright?: string;
  className?: string;
};

type CompactSiteFooterProps = {
  currentObject: SiteObject;
  returnLink: SiteLink;
  className?: string;
};

function FooterNavigation() {
  return (
    <nav aria-label="页脚导航" className="flex flex-col items-start gap-1">
      {siteNavigation.map((item) => (
        <Link
          key={item.area}
          href={item.href}
          className={cn(linkVariants({ variant: "foreground" }), "min-h-9 px-0 text-sm no-underline")}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

function ObjectLink({ value }: { value: SiteObject }) {
  return isSiteLink(value) ? (
    <Link
      href={value.href}
      className={cn(linkVariants({ variant: "foreground", density: "compact" }), "no-underline")}
    >
      {value.label}
    </Link>
  ) : (
    <span className="font-semibold text-[var(--foreground)]">{value}</span>
  );
}

export function FullSiteFooter({
  publicLinks = defaultPublicLinks,
  filing = { label: "粤ICP备2026098322号-1", href: "https://beian.miit.gov.cn/" },
  copyright = "© 2026 码成仝",
  className,
}: FullSiteFooterProps) {
  return (
    <footer
      className={cn(
        "border-t border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]",
        className,
      )}
    >
      <div className="mx-auto grid w-full max-w-[1280px] gap-10 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_0.8fr_0.8fr] lg:px-8">
        <div>
          <BrandLockup density="full" />
          <p className="mt-4 max-w-md text-sm leading-7 text-[var(--muted-foreground)]">
            软件也是一种服务。我们公开理念、方向与约束，继续学习如何让技术回到真实生活。
          </p>
        </div>
        <div>
          <h2 className="mb-3 text-sm font-bold">网站导航</h2>
          <FooterNavigation />
        </div>
        <div>
          <h2 className="mb-3 text-sm font-bold">公开渠道</h2>
          <div className="flex flex-col items-start gap-1">
            {publicLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className={cn(
                  linkVariants({ variant: "foreground" }),
                  "min-h-9 px-0 text-sm no-underline",
                )}
              >
                {link.label}
              </a>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-[var(--border)]">
        <p className="mx-auto flex max-w-[1280px] flex-wrap gap-x-2 gap-y-1 px-4 py-5 text-xs leading-5 text-[var(--muted-foreground)] sm:px-6 lg:px-8">
          <a
            href={filing.href}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm text-inherit no-underline hover:text-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            {filing.label}
          </a>
          <span aria-hidden="true">·</span>
          <span>{copyright}</span>
        </p>
      </div>
    </footer>
  );
}

export function CompactSiteFooter({ currentObject, returnLink, className }: CompactSiteFooterProps) {
  return (
    <footer
      className={cn(
        "border-t border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
        className,
      )}
    >
      <div className="mx-auto grid w-full max-w-[1280px] gap-6 px-4 py-6 sm:px-6 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center lg:px-8">
        <BrandLockup density="compact" />
        <p className="min-w-0 text-sm text-[var(--muted-foreground)]">
          当前对象：<ObjectLink value={currentObject} />
        </p>
        <Link href={returnLink.href} className={cn(linkVariants(), "justify-self-start md:justify-self-end")}>
          {returnLink.label}
        </Link>
      </div>
    </footer>
  );
}

export type { CompactSiteFooterProps, FullSiteFooterProps };
