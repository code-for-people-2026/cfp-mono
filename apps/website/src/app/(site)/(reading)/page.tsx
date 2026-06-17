import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Factory, FileText, HeartHandshake, Map, Route, ShieldCheck, Store } from "lucide-react";
import { getHomepage, getSiteSettings } from "@/lib/content";
import { DialogueEntry } from "../shared/dialogue-entry";

const sceneIcons = [Route, Factory, Store, HeartHandshake];
const readIcons = [FileText, Map, ShieldCheck, HeartHandshake];

// Rendered per request from cached Payload data (no DB access at build); the data layer
// caches by tag and is invalidated on publish.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [home, settings] = await Promise.all([getHomepage(), getSiteSettings()]);
  const { brand } = settings;
  const { hero } = home;

  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <section className="relative isolate overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_22%,var(--glow-cyan),transparent_30%),radial-gradient(circle_at_18%_74%,var(--glow-red),transparent_24%),radial-gradient(circle_at_84%_76%,var(--glow-gold),transparent_25%)]" />
        <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-6 sm:px-8 lg:px-10">
          <header className="flex h-12 items-center justify-between gap-4 text-sm text-[var(--muted)]">
            <Link href="/" className="flex items-center gap-3 text-[var(--ink)] no-underline">
              <Image
                src={brand.logoPath}
                alt={brand.logoAlt}
                width={38}
                height={38}
                priority
                className="h-9 w-9 object-contain"
              />
              <span className="flex flex-col">
                <span className="text-lg font-black leading-none">{brand.wordmark}</span>
                <span className="mt-1 text-xs font-semibold text-[var(--muted)]">{brand.tagline}</span>
              </span>
            </Link>
            <nav className="hidden items-center gap-7 font-semibold md:flex">
              {settings.headerNav.map((item) =>
                item.href.startsWith("http") ? (
                  <a key={item.href} href={item.href} target="_blank" rel="noreferrer" className="no-underline">
                    {item.label}
                  </a>
                ) : (
                  <Link key={item.href} href={item.href} className="no-underline">
                    {item.label}
                  </Link>
                ),
              )}
            </nav>
          </header>

          <div className="flex flex-1 flex-col justify-center py-20 text-center">
            <p className="mx-auto w-fit rounded-full border border-[var(--border)] bg-[var(--chip)] px-3 py-1 text-xs font-black tracking-[0.18em] text-[var(--accent)] uppercase">
              {hero.kicker}
            </p>
            <h1 className="mx-auto mt-8 max-w-5xl text-[2.8rem] font-black leading-[1.08] tracking-normal sm:text-6xl lg:text-7xl">
              {hero.title}
            </h1>
            <p className="mx-auto mt-5 max-w-3xl text-xl font-black leading-8 text-[var(--ink)] sm:text-2xl">
              {hero.organizationLine}
            </p>
            <p
              data-testid="hero-manifesto-slogan"
              className="mx-auto mt-9 max-w-4xl border-y border-[var(--border)] px-4 py-4 text-[1.55rem] font-black leading-tight tracking-normal text-[var(--accent)] sm:text-3xl lg:text-4xl"
            >
              {hero.manifestoLine}
            </p>
            {hero.body ? (
              <p className="mx-auto mt-5 max-w-3xl text-base leading-8 text-[var(--muted)] sm:text-lg">
                {hero.body}
              </p>
            ) : null}

            <DialogueEntry entry={home.dialogueEntry} suggestions={home.dialogueSuggestions} />

            <div className="mx-auto mt-14 grid w-full max-w-4xl gap-3 md:grid-cols-3">
              {home.heroFlow.map((item) => (
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
              {home.identity.heading}
            </h2>
            <p className="text-base leading-8 text-[var(--muted)]">{home.identity.intro}</p>
          </div>
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {home.identity.items.map((item, index) => (
              <section
                key={item.title}
                className="border border-[var(--border)] bg-[var(--paper)] p-6 shadow-[var(--shadow-soft)] lg:min-h-56"
              >
                <p className="font-mono text-xs font-bold text-[var(--accent)]">WHO / 0{index + 1}</p>
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
              {home.whyNow.heading}
            </h2>
            <p className="text-base leading-8 text-[var(--muted)]">{home.whyNow.intro}</p>
          </div>
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {home.whyNow.items.map((point, index) => (
              <section
                key={point.title}
                className="relative overflow-hidden border border-[var(--border)] bg-[var(--paper)] p-6 shadow-[var(--shadow-soft)] lg:min-h-72"
              >
                <div className="absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,var(--accent),var(--gold-bright),var(--cyan))]" />
                <p className="font-mono text-xs font-bold text-[var(--accent)]">WHY / 0{index + 1}</p>
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
            {home.lifeScenes.heading}
          </h2>
          <p className="text-base leading-8 text-[var(--muted)]">{home.lifeScenes.intro}</p>
        </div>
        <div className="mt-14 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {home.lifeScenes.items.map((scene, index) => {
            const Icon = sceneIcons[index % sceneIcons.length];
            return (
              <section
                key={scene.title}
                className="flex flex-col border border-[var(--border)] bg-[var(--paper)] p-5 shadow-[var(--shadow-soft)] xl:min-h-72"
              >
                <div className="flex items-start justify-between gap-4">
                  <Icon aria-hidden="true" className="h-6 w-6 text-[var(--accent)]" />
                  <span className="font-mono text-xs font-bold text-[var(--muted)]">0{index + 1}</span>
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
              {home.direction.heading}
            </h2>
            <p className="text-base leading-8 text-[var(--muted)]">{home.direction.intro}</p>
          </div>
          <div className="mt-14 grid gap-5 lg:grid-cols-3">
            {home.direction.items.map((item) => (
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
            {home.selfRestraint.heading}
          </h2>
          <p className="text-base leading-8 text-[var(--muted)]">{home.selfRestraint.intro}</p>
        </div>
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          {home.selfRestraint.items.map((item, index) => (
            <section
              key={item.title}
              className="border border-[var(--border)] bg-[var(--paper)] p-6 shadow-[var(--shadow-soft)] lg:min-h-64"
            >
              <div className="flex items-start justify-between gap-4">
                <ShieldCheck aria-hidden="true" className="h-6 w-6 text-[var(--gold-bright)]" />
                <span className="font-mono text-xs font-bold text-[var(--muted)]">LOCK / 0{index + 1}</span>
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
              {home.continueReads.heading}
            </h2>
            <p className="text-base leading-8 text-[var(--muted)]">{home.continueReads.intro}</p>
          </div>
          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {home.continueReads.items.map((item, index) => {
              const Icon = readIcons[index % readIcons.length];
              const href =
                item.target === "map"
                  ? settings.directionMapUrl
                  : item.target === "license"
                    ? "/license"
                    : "/manifesto";
              const external = href.startsWith("http");
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
                  <p className="mt-4 text-sm leading-7 text-[var(--muted)]">{item.description}</p>
                </Link>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
