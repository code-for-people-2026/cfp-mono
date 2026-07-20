import Image from "next/image";
import Link from "next/link";
import { siBilibili, siGithub, siKuaishou, siTiktok } from "simple-icons";
import { MonitorPlay } from "lucide-react";
import { getFooter, getSiteSettings } from "@/lib/content";
import type { FooterContent, SocialChannelIcon } from "@/lib/content/types";

const iconByKey: Record<SocialChannelIcon, { path: string }> = {
  douyin: siTiktok,
  kuaishou: siKuaishou,
  bilibili: siBilibili,
};

function isExternalHref(href: string) {
  return href.startsWith("http");
}

function BrandIcon({ path, testId }: { path: string; testId?: string }) {
  return (
    <span className="grid h-6 w-6 place-items-center border border-[var(--tag-border)] bg-[var(--tag-bg)] text-[var(--accent)]">
      <svg aria-hidden="true" data-testid={testId} viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
        <path d={path} />
      </svg>
    </span>
  );
}

const socialChipClass =
  "flex items-center gap-2 border border-[var(--border)] bg-[var(--paper)] px-3 py-2 text-sm font-black text-[var(--ink)] no-underline transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]";
const defaultIcpFiling = "粤ICP备2026098322号-1";

function SocialChannelEntry({ channel }: { channel: FooterContent["channels"][number] }) {
  const icon = iconByKey[channel.iconKey];

  return (
    <div className="footer-social-entry group relative">
      <button
        type="button"
        aria-label={`${channel.label}二维码`}
        data-testid={`footer-social-trigger-${channel.label}`}
        className={socialChipClass}
      >
        {icon ? <BrandIcon path={icon.path} testId={`footer-social-icon-${channel.label}`} /> : null}
        <span>{channel.label}</span>
      </button>
      <div
        data-testid={`footer-social-popover-${channel.label}`}
        className="footer-social-popover absolute bottom-full left-0 z-30 mb-3 w-44 border border-[var(--border)] bg-[var(--paper)] p-3 shadow-[var(--shadow-soft)] transition"
      >
        <div className="mx-auto grid h-24 w-24 place-items-center bg-white p-2">
          {channel.qrPath ? (
            <Image
              src={channel.qrPath}
              alt={channel.qrAlt ?? `${channel.label}二维码`}
              width={160}
              height={160}
              className="h-full w-full object-contain"
            />
          ) : (
            <div
              aria-label={`${channel.label}二维码待补充`}
              className="flex h-full w-full flex-col items-center justify-center border border-[var(--border)] bg-[var(--soft)] text-center text-[var(--accent)]"
            >
              <MonitorPlay aria-hidden="true" className="h-6 w-6" />
              <span className="mt-2 text-xs font-black leading-none">待补充</span>
            </div>
          )}
        </div>
        <p className="mt-3 text-xs font-bold text-[var(--accent)]">{channel.status}</p>
        <p className="mt-2 text-xs leading-5 text-[var(--muted)]">{channel.description}</p>
      </div>
    </div>
  );
}

export async function SiteFooter() {
  const [footer, settings] = await Promise.all([getFooter(), getSiteSettings()]);
  const { brand } = settings;
  const icpFiling = footer.beian || defaultIcpFiling;

  return (
    <footer id="follow" className="border-t border-[var(--border)] bg-[var(--soft)] text-[var(--ink)]">
      <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.7fr_1fr]">
          <div>
            <Link href="/" className="flex items-center gap-3 text-[var(--ink)] no-underline">
              <Image
                src={brand.logoPath}
                alt="码成工页脚标识"
                width={44}
                height={44}
                className="h-10 w-10 object-contain"
              />
              <span className="flex flex-col">
                <span className="text-lg font-black leading-none">{brand.wordmark}</span>
                <span className="mt-1 text-xs font-semibold text-[var(--muted)]">{brand.tagline}</span>
              </span>
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-7 text-[var(--muted)]">{footer.description}</p>
          </div>

          <nav aria-label="页脚导航">
            <h2 className="text-sm font-black text-[var(--ink)]">{footer.linksHeading}</h2>
            <div className="mt-4 flex flex-col items-start gap-3 text-sm font-semibold text-[var(--muted)]">
              {footer.footerLinks.map((link) =>
                isExternalHref(link.href) ? (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="no-underline transition-colors hover:text-[var(--accent)]"
                  >
                    {link.label}
                  </a>
                ) : (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="no-underline transition-colors hover:text-[var(--accent)]"
                  >
                    {link.label}
                  </Link>
                ),
              )}
            </div>
          </nav>

          <div>
            <h2 className="text-sm font-black text-[var(--ink)]">{footer.channelsHeading}</h2>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--muted)]">
              {footer.channels.map((channel) => (
                <SocialChannelEntry key={channel.label} channel={channel} />
              ))}
              <a
                aria-label="GitHub"
                href={settings.githubUrl}
                target="_blank"
                rel="noreferrer"
                className={socialChipClass}
              >
                <BrandIcon path={siGithub.path} />
                <span>{footer.githubLabel}</span>
              </a>
            </div>
          </div>
        </div>

        <p className="mt-10 border-t border-[var(--border)] pt-6 text-sm font-semibold text-[var(--muted)]">
          <a
            href="https://beian.miit.gov.cn/"
            target="_blank"
            rel="noreferrer"
            className="no-underline transition-colors hover:text-[var(--accent)]"
          >
            {icpFiling}
          </a>{" "}
          ·{" "}
          {footer.copyright}
        </p>
      </div>
    </footer>
  );
}
