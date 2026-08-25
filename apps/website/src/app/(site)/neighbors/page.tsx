import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Check,
  CircleUserRound,
  ExternalLink,
  HeartHandshake,
  MessageCircleMore,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { neighborsIdentity } from "@/content/neighbors";
import { getNeighborsPage } from "@/lib/content";
import type { Card, ContinueRead, SectionBlock } from "@/lib/content/types";

export const dynamic = "force-dynamic";

const howIcons = [MessageCircleMore, CircleUserRound, UserRoundCheck];
const evidenceIcons = [CircleUserRound, MessageCircleMore, BadgeCheck, ShieldCheck];
const responsibilityIcons = [BadgeCheck, Bot, ShieldCheck];
const sourceExampleIcons = [CircleUserRound, UserRoundCheck, Bot];
const readingIcons = [HeartHandshake, BadgeCheck, ShieldCheck];

const readingHrefs: Record<ContinueRead["target"], string> = {
  manifesto: "/manifesto",
  map: "/wam",
  license: "/license",
};

export async function generateMetadata(): Promise<Metadata> {
  const content = await getNeighborsPage();
  return {
    title: `${neighborsIdentity.name}｜码成仝`,
    description: content.hero.summary,
    alternates: { canonical: neighborsIdentity.canonicalUrl },
    openGraph: {
      title: `${neighborsIdentity.name}｜码成仝`,
      description: content.hero.summary,
      url: neighborsIdentity.canonicalUrl,
      type: "website",
    },
  };
}

function SectionIntro({
  index,
  section,
  inverted = false,
}: {
  index: string;
  section: Pick<SectionBlock<Card>, "heading" | "intro">;
  inverted?: boolean;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.72fr)_minmax(18rem,0.38fr)] lg:items-end">
      <div>
        <p
          className={`font-mono text-xs font-bold tracking-[0.16em] uppercase ${
            inverted ? "text-white/55" : "text-[var(--primary)]"
          }`}
        >
          {index}
        </p>
        <h2 className="mt-4 max-w-4xl text-4xl font-black leading-[1.14] tracking-[-0.035em] sm:text-5xl">
          {section.heading}
        </h2>
      </div>
      <p
        className={`text-base leading-8 ${
          inverted ? "text-white/68" : "text-[var(--muted-foreground)]"
        }`}
      >
        {section.intro}
      </p>
    </div>
  );
}

function NumberedCards({
  items,
  icons,
}: {
  items: Card[];
  icons: LucideIcon[];
}) {
  return (
    <ol className="mt-12 grid gap-4 md:grid-cols-3">
      {items.map((item, index) => {
        const Icon = icons[index % icons.length];
        return (
          <li
            key={item.title}
            className="flex min-h-56 flex-col rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-e1)]"
          >
            <div className="flex items-center justify-between gap-4">
              <Icon aria-hidden="true" className="size-6 text-[var(--primary)]" />
              <span className="font-mono text-xs font-bold text-[var(--muted-foreground)]">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <h3 className="mt-10 text-xl font-black leading-tight">{item.title}</h3>
            <p className="mt-4 text-base leading-7 text-[var(--muted-foreground)]">{item.body}</p>
          </li>
        );
      })}
    </ol>
  );
}

function ReadingCard({ item, index }: { item: ContinueRead; index: number }) {
  const Icon = readingIcons[index % readingIcons.length];
  return (
    <Link
      href={readingHrefs[item.target]}
      className="group block min-h-48 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--foreground)] no-underline shadow-[var(--shadow-e1)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-[var(--shadow-e2)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] motion-reduce:transform-none motion-reduce:transition-none"
    >
      <div className="flex items-start justify-between gap-4">
        <Icon aria-hidden="true" className="size-6 text-[var(--primary)]" />
        <ArrowRight
          aria-hidden="true"
          className="size-5 text-[var(--muted-foreground)] transition-transform group-hover:translate-x-1 motion-reduce:transition-none"
        />
      </div>
      <h3 className="mt-8 text-xl font-black">{item.label}</h3>
      <p className="mt-3 text-base leading-7 text-[var(--muted-foreground)]">{item.description}</p>
    </Link>
  );
}

export default async function NeighborsPage() {
  const content = await getNeighborsPage();

  return (
    <main
      data-neighbors-page=""
      className="min-w-0 overflow-x-clip bg-[var(--background)] text-[var(--foreground)]"
    >
      <section
        data-neighbors-section="hero"
        className="relative isolate overflow-hidden border-b border-[var(--border)] bg-[var(--surface)]"
      >
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_76%_18%,var(--primary-soft),transparent_30%),radial-gradient(circle_at_20%_84%,var(--confirm-soft),transparent_26%),linear-gradient(135deg,transparent_0_58%,var(--muted)_58%_58.12%,transparent_58.12%)]" />
        <div className="mx-auto grid min-h-[calc(100svh-4rem)] w-full max-w-[1180px] gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center lg:px-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="prototype">{content.hero.stageLabel}</Badge>
              <p className="font-mono text-xs font-bold tracking-[0.14em] text-[var(--muted-foreground)] uppercase">
                {content.hero.eyebrow}
              </p>
            </div>
            <h1 className="mt-8 text-[clamp(3.5rem,10vw,7.5rem)] font-black leading-[0.92] tracking-[-0.065em]">
              {neighborsIdentity.name}
            </h1>
            <p className="mt-9 max-w-4xl text-3xl font-black leading-tight tracking-[-0.035em] text-[var(--primary)] sm:text-4xl lg:text-5xl">
              {content.hero.tagline}
            </p>
            <p className="mt-7 max-w-3xl text-lg leading-9 text-[var(--muted-foreground)] sm:text-xl">
              {content.hero.summary}
            </p>
            <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
              <Button asChild size="lg" className="min-h-12 w-full sm:w-auto">
                <a
                  data-neighbors-primary-action=""
                  href={neighborsIdentity.prototypeUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`${content.cta.label}（新窗口打开）`}
                >
                  {content.cta.label}
                  <ExternalLink aria-hidden="true" className="size-4" />
                </a>
              </Button>
              <p className="max-w-md text-sm leading-6 text-[var(--muted-foreground)]">
                {content.cta.description}
              </p>
            </div>
          </div>

          <aside className="rounded-[var(--radius-container)] border border-[var(--border-strong)] bg-[var(--prototype-stage)] p-7 text-[var(--prototype-stage-foreground)] shadow-[var(--shadow-e3)] sm:p-8">
            <HeartHandshake aria-hidden="true" className="size-9 text-[var(--primary)]" />
            <p className="mt-8 text-2xl font-black leading-tight">{content.hero.distinction}</p>
            <div className="mt-8 space-y-4 border-t border-white/15 pt-6">
              {content.evidence.items.slice(0, 3).map((item) => (
                <div key={item.title} className="flex gap-3 text-sm font-semibold leading-6 text-white/72">
                  <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-[var(--confirm)]" />
                  <span>{item.title}</span>
                </div>
              ))}
            </div>
            <p className="mt-8 font-mono text-xs font-bold tracking-[0.12em] text-white/48 uppercase">
              {content.hero.affiliation}
            </p>
          </aside>
        </div>
      </section>

      <section
        data-neighbors-section="how-it-works"
        className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28"
      >
        <SectionIntro index="01" section={content.howItWorks} />
        <NumberedCards items={content.howItWorks.items} icons={howIcons} />
      </section>

      <section
        data-neighbors-section="evidence"
        className="bg-[var(--prototype-stage)] text-[var(--prototype-stage-foreground)]"
      >
        <div className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
          <SectionIntro index="02" section={content.evidence} inverted />
          <div className="mt-12 grid gap-px overflow-hidden rounded-[var(--radius-container)] border border-white/15 bg-white/15 md:grid-cols-2">
            {content.evidence.items.map((item, index) => {
              const Icon = evidenceIcons[index % evidenceIcons.length];
              return (
                <article key={item.title} className="bg-[var(--prototype-stage)] p-7 sm:p-9">
                  <Icon aria-hidden="true" className="size-7 text-[var(--primary)]" />
                  <h3 className="mt-8 text-2xl font-black leading-tight">{item.title}</h3>
                  <p className="mt-4 max-w-xl text-sm leading-7 text-white/66 sm:text-base">
                    {item.body}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section
        data-neighbors-section="responsibility"
        className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28"
      >
        <SectionIntro index="03" section={content.responsibility} />
        <div className="mt-12 grid gap-4 lg:grid-cols-3">
          {content.responsibility.items.map((item, index) => {
            const Icon = responsibilityIcons[index % responsibilityIcons.length];
            return (
              <article
                key={item.title}
                className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-7 shadow-[var(--shadow-e1)] sm:p-8"
              >
                <div className="flex items-center justify-between gap-4">
                  <Icon aria-hidden="true" className="size-7 text-[var(--primary)]" />
                  <span className="font-mono text-xs font-bold text-[var(--muted-foreground)]">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </div>
                <h3 className="mt-8 text-2xl font-black">{item.title}</h3>
                <p className="mt-4 text-base leading-8 text-[var(--muted-foreground)]">{item.body}</p>
              </article>
            );
          })}
        </div>

        <div className="mt-12 overflow-hidden rounded-[var(--radius-container)] border border-[var(--border-strong)] bg-[var(--prototype-stage)] text-[var(--prototype-stage-foreground)] shadow-[var(--shadow-e2)]">
          <div className="border-b border-white/15 px-6 py-7 sm:px-9">
            <h3 className="text-2xl font-black leading-tight">
              {content.responsibility.example.heading}
            </h3>
            <p className="mt-4 text-base leading-7 text-white/70">
              {content.responsibility.example.request}
            </p>
          </div>
          <div className="grid gap-px bg-white/15 md:grid-cols-3">
            {content.responsibility.example.items.map((item, index) => {
              const Icon = sourceExampleIcons[index % sourceExampleIcons.length];
              return (
                <article key={item.title} className="bg-[var(--prototype-stage)] p-6 sm:p-8">
                  <div className="flex items-center gap-3">
                    <Icon aria-hidden="true" className="size-5 text-[var(--primary)]" />
                    <h4 className="font-mono text-xs font-bold tracking-[0.12em] text-white/70 uppercase">
                      {item.title}
                    </h4>
                  </div>
                  <p className="mt-5 text-base leading-8 text-white/78">{item.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section
        data-neighbors-section="prototype"
        className="bg-[var(--prototype-stage)] text-[var(--prototype-stage-foreground)]"
      >
        <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.7fr)_minmax(18rem,0.4fr)] lg:items-center lg:px-8 lg:py-28">
          <div>
            <p className="font-mono text-xs font-bold tracking-[0.16em] text-[var(--primary)] uppercase">
              04 · {content.prototype.eyebrow}
            </p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-[-0.035em] sm:text-5xl">
              {content.prototype.heading}
            </h2>
            <p className="mt-6 max-w-3xl text-base leading-8 text-white/68 sm:text-lg">
              {content.prototype.intro}
            </p>
          </div>
          <div className="rounded-[var(--radius-container)] border border-white/15 bg-white/5 p-6 sm:p-8">
            <p className="text-base leading-7 text-white/65">{content.prototype.notice}</p>
            <Button asChild size="lg" className="mt-7 min-h-12 w-full">
              <a
                data-neighbors-primary-action=""
                href={neighborsIdentity.prototypeUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`${content.cta.label}（新窗口打开）`}
              >
                {content.cta.label}
                <ExternalLink aria-hidden="true" className="size-4" />
              </a>
            </Button>
          </div>
        </div>
      </section>

      <section
        data-neighbors-section="related-reading"
        className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28"
      >
        <SectionIntro index="05" section={content.relatedReading} />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {content.relatedReading.items.map((item, index) => (
            <ReadingCard key={item.target} item={item} index={index} />
          ))}
        </div>
      </section>
    </main>
  );
}
