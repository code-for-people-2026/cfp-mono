import Image from "next/image";
import Link from "next/link";
import { siBilibili, siKuaishou, siTiktok } from "simple-icons";
import {
  ArrowRight,
  Factory,
  FileText,
  Github,
  HeartHandshake,
  Map,
  MonitorPlay,
  Route,
  ShieldCheck,
  Store,
} from "lucide-react";
import {
  brandAssets,
  continueReads,
  directionApproach,
  formFallbackHref,
  hero,
  heroFlow,
  identityCards,
  identityIntro,
  lifeScenes,
  lifeScenesIntro,
  selfRestraints,
  socialChannels,
  whyNowPoints,
} from "@/content/site";
import { DialogueEntry } from "./shared/dialogue-entry";

function getTencentFormHref() {
  return process.env.NEXT_PUBLIC_TENCENT_FORM_URL || formFallbackHref;
}

function resolveHref(href: string, formHref: string) {
  return href === formFallbackHref ? formHref : href;
}

const sceneIcons = [Route, Factory, Store, HeartHandshake];
const readIcons = [FileText, Map, ShieldCheck, HeartHandshake];
const footerLinks = [
  { label: "首页", href: "/" },
  { label: "宣言", href: "/manifesto" },
  { label: "方向地图", href: "/map" },
  { label: "协议", href: "/license" },
];
const organizationGithubHref = "https://github.com/code-for-people-2026";

function getSocialIcon(label: string) {
  if (label === "抖音") {
    return siTiktok;
  }
  if (label === "快手") {
    return siKuaishou;
  }
  if (label === "B站") {
    return siBilibili;
  }
  return null;
}

function SocialChannelEntry({ channel }: { channel: (typeof socialChannels)[number] }) {
  const icon = getSocialIcon(channel.label);

  return (
    <details className="footer-social-entry relative">
      <summary
        aria-label={`${channel.label}二维码`}
        data-testid={`footer-social-trigger-${channel.label}`}
        className="flex cursor-pointer list-none items-center gap-2 border border-[var(--border)] bg-[var(--paper)] px-3 py-2 text-sm font-black text-[var(--ink)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] [&::-webkit-details-marker]:hidden"
      >
        <span className="grid h-6 w-6 place-items-center border border-[var(--tag-border)] bg-[var(--tag-bg)] text-[var(--accent)]">
          {icon ? (
            <svg
              aria-hidden="true"
              data-testid={`footer-social-icon-${channel.label}`}
              viewBox="0 0 24 24"
              className="h-3.5 w-3.5 fill-current"
            >
              <path d={icon.path} />
            </svg>
          ) : null}
        </span>
        <span>{channel.label}</span>
      </summary>
      <div
        data-testid={`footer-social-popover-${channel.label}`}
        className="footer-social-popover absolute bottom-full left-0 z-30 mb-3 w-44 border border-[var(--border)] bg-[var(--paper)] p-3 shadow-[var(--shadow-soft)] transition"
      >
        <div className="mx-auto grid h-24 w-24 place-items-center bg-white p-2">
          {channel.qrSrc ? (
            <Image
              src={channel.qrSrc}
              alt={`${channel.label}二维码`}
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
    </details>
  );
}

function SiteHeader() {
  return (
    <header className="flex h-12 items-center justify-between gap-4 text-sm text-[var(--muted)]">
      <Link href="/" className="flex items-center gap-3 text-[var(--ink)] no-underline">
        <Image
          src={brandAssets.logoSrc}
          alt="码成工 logo"
          width={38}
          height={38}
          priority
          className="h-9 w-9 object-contain"
        />
        <span className="flex flex-col">
          <span className="text-lg font-black leading-none">码成工</span>
          <span className="mt-1 text-xs font-semibold text-[var(--muted)]">为“工友”敲键盘</span>
        </span>
      </Link>
      <nav className="hidden items-center gap-7 font-semibold md:flex">
        <Link href="/manifesto" className="no-underline">
          宣言
        </Link>
        <Link href="/map" className="no-underline">
          方向地图
        </Link>
        <Link href="/license" className="no-underline">
          协议
        </Link>
      </nav>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer
      id="follow"
      className="border-t border-[var(--border)] bg-[var(--soft)] text-[var(--ink)]"
    >
      <div className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.7fr_1fr_0.7fr]">
          <div>
            <Link href="/" className="flex items-center gap-3 text-[var(--ink)] no-underline">
              <Image
                src={brandAssets.logoSrc}
                alt="码成工页脚标识"
                width={44}
                height={44}
                className="h-10 w-10 object-contain"
              />
              <span className="flex flex-col">
                <span className="text-lg font-black leading-none">码成工</span>
                <span className="mt-1 text-xs font-semibold text-[var(--muted)]">
                  为“工友”敲键盘
                </span>
              </span>
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-7 text-[var(--muted)]">
              软件也是一种服务。我们把理念、协议和方向公开出来，继续学习如何把技术能力还给真实生活。
            </p>
          </div>

          <nav aria-label="页脚导航">
            <h2 className="text-sm font-black text-[var(--ink)]">网站链接</h2>
            <div className="mt-4 flex flex-col items-start gap-3 text-sm font-semibold text-[var(--muted)]">
              {footerLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="no-underline transition-colors hover:text-[var(--accent)]"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </nav>

          <div>
            <h2 className="text-sm font-black text-[var(--ink)]">公开渠道</h2>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--muted)]">
              {socialChannels.map((channel) => (
                <SocialChannelEntry key={channel.label} channel={channel} />
              ))}
              <a
                aria-label="GitHub"
                href={organizationGithubHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 border border-[var(--border)] bg-[var(--paper)] px-3 py-2 text-[var(--ink)] no-underline transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                <Github aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span>GitHub</span>
              </a>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-black text-[var(--ink)]">合规信息</h2>
            <div className="mt-4 space-y-3 text-sm font-semibold text-[var(--muted)]">
              <p>备案信息待补充</p>
              <p>© 2026 码成工</p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default function HomePage() {
  const formHref = getTencentFormHref();

  return (
    <>
      <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
        <section className="relative isolate overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_22%,var(--glow-cyan),transparent_30%),radial-gradient(circle_at_18%_74%,var(--glow-red),transparent_24%),radial-gradient(circle_at_84%_76%,var(--glow-gold),transparent_25%)]" />
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
          <SiteHeader />

          <div className="flex flex-1 flex-col justify-center py-20 text-center">
            <p className="mx-auto w-fit rounded-full border border-[var(--border)] bg-[var(--chip)] px-3 py-1 text-xs font-black tracking-[0.18em] text-[var(--accent)] uppercase">
              {hero.kicker}
            </p>
            <h1
              aria-label={hero.title}
              className="mx-auto mt-8 max-w-5xl text-[2.8rem] font-black leading-[1.08] tracking-normal sm:text-6xl lg:text-7xl"
            >
              <span aria-hidden="true">
                你好，我们是
                <span className="block text-[var(--accent)]">码成工</span>
              </span>
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-xl font-black leading-8 text-[var(--ink)] sm:text-2xl">
              {hero.organizationLine}
            </p>
            <p
              data-testid="hero-manifesto-slogan"
              className="mx-auto mt-9 max-w-4xl border-y border-[var(--border)] px-4 py-4 text-[1.55rem] font-black leading-tight tracking-normal text-[var(--ink)] sm:text-3xl lg:text-4xl"
            >
              软件也是一种
              <span data-testid="hero-slogan-highlight-service" className="text-[var(--accent)]">
                服务
              </span>
              ，
              <span data-testid="hero-slogan-highlight-for" className="text-[var(--accent)]">
                为
              </span>
              何不还给
              <span data-testid="hero-slogan-highlight-people" className="text-[var(--accent)]">
                人民
              </span>
            </p>
            {hero.body ? (
              <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-[var(--muted)] sm:text-lg">
                {hero.body}
              </p>
            ) : null}

            <DialogueEntry />

            <div className="mx-auto mt-14 grid w-full max-w-4xl gap-3 md:grid-cols-3">
              {heroFlow.map((item) => (
                <section
                  key={item.title}
                  className="border border-[var(--border)] bg-[var(--paper)] p-5 text-left shadow-[var(--shadow-soft)]"
                >
                  <h2 className="text-lg font-black leading-tight">{item.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{item.body}</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--border)] bg-[var(--soft)]">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_0.48fr] lg:items-end">
            <h2 className="max-w-3xl text-4xl font-black leading-tight tracking-normal sm:text-5xl">
              {identityIntro.title}
            </h2>
            <p className="text-base leading-8 text-[var(--muted)]">{identityIntro.body}</p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {identityCards.map((item, index) => (
              <section
                key={item.title}
                className="border border-[var(--border)] bg-[var(--paper)] p-6 shadow-[var(--shadow-soft)] lg:min-h-56"
              >
                <p className="font-mono text-xs font-bold text-[var(--accent)]">
                  WHO / 0{index + 1}
                </p>
                <h3 className="mt-8 text-2xl font-black leading-tight">{item.title}</h3>
                <p className="mt-4 text-sm leading-7 text-[var(--muted)]">{item.body}</p>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-[var(--border)] bg-[var(--soft)]">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_0.48fr] lg:items-end">
            <h2 className="max-w-3xl text-4xl font-black leading-tight tracking-normal sm:text-5xl">
              规则背后，是红利怎么分
            </h2>
            <p className="text-base leading-8 text-[var(--muted)]">
              路线、订单、评价和流水从普通人的实践中产生，却常常变成平台的规则优势。软件越有能力，越要追问这些红利该回到谁那里。
            </p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {whyNowPoints.map((point, index) => (
              <section
                key={point.title}
                className="relative overflow-hidden border border-[var(--border)] bg-[var(--paper)] p-6 shadow-[var(--shadow-soft)] lg:min-h-72"
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--accent),var(--gold-bright),var(--cyan))]" />
                <p className="font-mono text-xs font-bold text-[var(--accent)]">
                  WHY / 0{index + 1}
                </p>
                <h3 className="mt-10 text-2xl font-black leading-tight">{point.title}</h3>
                <p className="mt-4 text-sm leading-7 text-[var(--muted)]">{point.body}</p>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section id="life-scenes" className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_0.48fr] lg:items-end">
          <h2 className="max-w-3xl text-4xl font-black leading-tight tracking-normal sm:text-5xl">
            {lifeScenesIntro.title}
          </h2>
          <p className="text-base leading-8 text-[var(--muted)]">{lifeScenesIntro.body}</p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {lifeScenes.map((scene, index) => {
            const Icon = sceneIcons[index];
            return (
              <section
                key={scene.title}
                className="flex flex-col border border-[var(--border)] bg-[var(--paper)] p-5 shadow-[var(--shadow-soft)] xl:min-h-72"
              >
                <div className="flex items-start justify-between gap-4">
                  <Icon aria-hidden="true" className="h-6 w-6 text-[var(--accent)]" />
                  <span className="font-mono text-xs font-bold text-[var(--muted)]">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-8 text-2xl font-black">{scene.title}</h3>
                <p className="mt-4 text-sm leading-7 text-[var(--muted)]">{scene.body}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-6">
                  {scene.tags.map((tag) => (
                    <span
                      key={tag}
                      className="border border-[var(--tag-border)] bg-[var(--tag-bg)] px-2.5 py-1 text-xs font-bold text-[var(--accent)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <section className="border-y border-[var(--border)] bg-[var(--soft)]">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_0.48fr] lg:items-end">
            <h2 className="max-w-3xl text-4xl font-black leading-tight tracking-normal sm:text-5xl">
              我们怎么判断方向
            </h2>
            <p className="text-base leading-8 text-[var(--muted)]">
              7×7 是一张方向地图：横轴看人的处境，纵轴看能力缺口。它提醒我们先理解问题，再判断什么值得做。
            </p>
          </div>

          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {directionApproach.map((item) => (
              <section
                key={item.title}
                className="border border-[var(--border)] bg-[var(--paper)] p-6 shadow-[var(--shadow-soft)] lg:min-h-60"
              >
                <h3 className="text-2xl font-black leading-tight">{item.title}</h3>
                <p className="mt-4 text-sm leading-7 text-[var(--muted)]">{item.body}</p>
              </section>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10">
        <div className="grid gap-8 lg:grid-cols-[0.72fr_0.48fr] lg:items-end">
          <h2 className="max-w-3xl text-4xl font-black leading-tight tracking-normal sm:text-5xl">
            我们如何约束自己
          </h2>
          <p className="text-base leading-8 text-[var(--muted)]">
            软件要服务普通人，组织也要先约束自己。让利、资金、分配和修正过程，都应该公开留痕。
          </p>
        </div>

        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {selfRestraints.map((item, index) => (
            <section
              key={item.title}
              className="border border-[var(--border)] bg-[var(--paper)] p-6 shadow-[var(--shadow-soft)] lg:min-h-64"
            >
              <div className="flex items-start justify-between gap-4">
                <ShieldCheck aria-hidden="true" className="h-6 w-6 text-[var(--gold-bright)]" />
                <span className="font-mono text-xs font-bold text-[var(--muted)]">
                  LOCK / 0{index + 1}
                </span>
              </div>
              <h3 className="mt-8 text-2xl font-black leading-tight">{item.title}</h3>
              <p className="mt-4 text-sm leading-7 text-[var(--muted)]">{item.body}</p>
            </section>
          ))}
        </div>
      </section>

      <section className="border-t border-[var(--border)] bg-[var(--soft)]">
        <div className="mx-auto max-w-7xl px-5 py-24 sm:px-8 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[0.72fr_0.48fr] lg:items-end">
            <h2 className="max-w-3xl text-4xl font-black leading-tight tracking-normal sm:text-5xl">
              继续阅读
            </h2>
            <div>
              <p className="text-base leading-8 text-[var(--muted)]">
                如果你想继续了解，可以按这三条线读下去；想加入或提出批评，放在最后，不打断第一次访问者。
              </p>
              {formHref === formFallbackHref ? (
                <p
                  id="tencent-form-pending"
                  className="mt-4 border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm leading-6 text-[var(--muted)]"
                >
                  腾讯表单入口还在准备中。这一版先把入口目的说清楚，不伪装成已经上线的通道。
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            {continueReads.map((item, index) => {
              const Icon = readIcons[index];
              return (
                <Link
                  key={item.label}
                  href={resolveHref(item.href, formHref)}
                  aria-label={item.label}
                  className="group border border-[var(--border)] bg-[var(--paper)] p-5 text-[var(--ink)] no-underline shadow-[var(--shadow-soft)] transition-colors hover:border-[var(--accent)] xl:min-h-64"
                >
                  <div className="flex items-start justify-between gap-4">
                    <Icon aria-hidden="true" className="h-6 w-6 text-[var(--accent)]" />
                    <ArrowRight
                      aria-hidden="true"
                      className="h-5 w-5 text-[var(--muted)] transition-transform group-hover:translate-x-1"
                    />
                  </div>
                  <h3 className="mt-8 text-2xl font-black leading-tight">{item.label}</h3>
                  <p className="mt-4 text-sm leading-7 text-[var(--muted)]">
                    {item.description}
                  </p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      </main>
      <SiteFooter />
    </>
  );
}
