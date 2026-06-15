import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocumentContent } from "@/content/site";

export function DocumentPage({ document }: { document: DocumentContent }) {
  return (
    <main className="min-h-screen bg-[var(--bg)]">
      <article>
        <section className="border-b border-[rgba(255,253,248,0.14)] bg-[var(--carbon)] text-[var(--on-carbon)]">
          <div className="mx-auto max-w-5xl px-5 py-7 sm:px-8 lg:px-10">
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="-ml-3 text-[rgba(255,253,248,0.82)] hover:bg-[rgba(255,253,248,0.08)] hover:text-[var(--on-carbon)]"
            >
              <Link href="/">
                <ArrowLeft className="h-4 w-4" />
                回到首页
              </Link>
            </Button>

            <div className="py-16">
              <div>
                <p className="text-sm font-semibold tracking-[0.2em] text-[var(--gold-bright)]">
                  {document.eyebrow}
                </p>
                <h1 className="mt-5 max-w-3xl text-4xl font-black leading-tight tracking-normal sm:text-5xl">
                  {document.title}
                </h1>
                <p className="mt-7 max-w-2xl text-base leading-8 text-[rgba(255,253,248,0.72)] sm:text-lg">
                  {document.summary}
                </p>
                {document.meta ? (
                  <p className="mt-5 w-fit border border-[rgba(255,253,248,0.16)] bg-[rgba(255,253,248,0.06)] px-3 py-2 text-sm font-semibold text-[rgba(255,253,248,0.78)]">
                    {document.meta}
                  </p>
                ) : null}
                {document.fullSections ? (
                  <Button
                    asChild
                    size="sm"
                    className="mt-8 bg-[var(--on-carbon)] text-[var(--carbon)] hover:bg-[rgba(255,253,248,0.88)]"
                  >
                    <Link href="#full-text">
                      阅读全文
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-16 sm:px-8 lg:px-10">
          {document.guide ? (
            <section className="mb-14 border-l-4 border-[var(--accent)] bg-[rgba(139,30,45,0.06)] px-5 py-5">
              <h2 className="text-2xl font-black leading-tight tracking-normal">先读这一段</h2>
              <div className="mt-5 space-y-4 text-base leading-8 text-[var(--ink)]">
                {document.guide.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ) : null}

          <div className="space-y-8">
            {document.sections.map((section) => (
              <section
                key={section.label}
                className="grid gap-5 border-t border-[var(--border)] pt-10 lg:grid-cols-[120px_1fr]"
              >
                <div className="font-mono text-sm font-semibold text-[var(--accent)]">
                  {section.label}
                </div>
                <div>
                  <h2 className="max-w-3xl text-2xl font-black leading-tight tracking-normal sm:text-3xl">
                    {section.heading}
                  </h2>
                  <div className="mt-6 space-y-5 text-base leading-8 text-[var(--ink)] sm:text-lg">
                    {section.paragraphs.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                  {section.points ? (
                    <ul className="mt-6 grid gap-3 sm:grid-cols-2">
                      {section.points.map((point) => (
                        <li
                          key={point}
                          className="border border-[var(--border)] bg-[var(--paper)] px-4 py-3 text-sm leading-6 text-[var(--muted)]"
                        >
                          {point}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </section>
            ))}
          </div>

          {document.closing ? (
            <p className="mt-12 border-l-4 border-[var(--accent)] bg-[rgba(139,30,45,0.06)] px-5 py-4 text-lg font-semibold leading-8">
              {document.closing}
            </p>
          ) : null}

          {document.fullSections ? (
            <section id="full-text" className="mt-20 border-t border-[var(--border)] pt-14">
              <p className="font-mono text-sm font-bold text-[var(--accent)]">完整文本</p>
              <h2 className="mt-4 text-3xl font-black leading-tight tracking-normal sm:text-4xl">
                {document.fullTitle ?? "全文"}
              </h2>
              <div className="mt-10 space-y-12">
                {document.fullSections.map((section) => (
                  <section key={section.label} className="max-w-3xl">
                    <p className="font-mono text-sm font-semibold text-[var(--accent)]">
                      {section.label}
                    </p>
                    <h3 className="mt-3 text-2xl font-black leading-tight tracking-normal">
                      {section.heading}
                    </h3>
                    <div className="mt-5 space-y-5 text-base leading-8 text-[var(--ink)] sm:text-lg">
                      {section.paragraphs.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                    </div>
                    {section.points ? (
                      <ul className="mt-6 space-y-3 text-base leading-8 text-[var(--ink)] sm:text-lg">
                        {section.points.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    ) : null}
                  </section>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      </article>
    </main>
  );
}
