import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Factory,
  FileText,
  HeartHandshake,
  Map,
  Route,
  ShieldCheck,
  Store,
} from "lucide-react";
import {
  brandAssets,
  continueReads,
  directionApproach,
  directionMapHref,
  hero,
  heroFlow,
  identityCards,
  identityIntro,
  lifeScenes,
  lifeScenesIntro,
  selfRestraints,
  whyNowPoints,
} from "@/content/site";
import { DialogueEntry } from "../shared/dialogue-entry";

function isExternalHref(href: string) {
  return href.startsWith("http");
}

const sceneIcons = [Route, Factory, Store, HeartHandshake];
const readIcons = [FileText, Map, ShieldCheck, HeartHandshake];

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
        <a href={directionMapHref} target="_blank" rel="noreferrer" className="no-underline">
          方向地图
        </a>
        <Link href="/license" className="no-underline">
          协议
        </Link>
      </nav>
    </header>
  );
}

export default function HomePage() {
  return (
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
            <p className="text-base leading-8 text-[var(--muted)]">
              想更深入了解，可以顺着这三份已经公开的文本读下去：宣言讲为什么，方向地图讲做什么，协议讲怎么约束自己。
            </p>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {continueReads.map((item, index) => {
              const Icon = readIcons[index];
              const href = item.href;
              const external = isExternalHref(href);
              return (
                <Link
                  key={item.label}
                  href={href}
                  aria-label={item.label}
                  target={external ? "_blank" : undefined}
                  rel={external ? "noreferrer" : undefined}
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
  );
}
