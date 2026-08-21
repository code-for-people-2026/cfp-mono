import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DocSection, SiteDocument } from "@/lib/content/types";
import { DocumentAnchorLink } from "./document-anchor-link";

const documentPresentation = {
  manifesto: {
    intent: "为什么做",
    role: "立场文件",
    bridgeHeading: "从立场回到产品探索",
  },
  license: {
    intent: "如何约束",
    role: "公开协议草案",
    bridgeHeading: "从约束回到产品探索",
  },
} satisfies Record<
  SiteDocument["slug"],
  { intent: string; role: string; bridgeHeading: string }
>;

const anchorTargetClass =
  "scroll-mt-28 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-[var(--accent)]";
const bodyTextClass = "space-y-6 text-base leading-7 text-[var(--ink)]";
const anchorLinkClass =
  "rounded-sm text-[var(--muted)] no-underline transition-colors hover:text-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]";

function DocumentPoints({ points }: { points: string[] }) {
  return (
    <ul className="mt-6 list-disc space-y-3 border-l border-[var(--border)] py-1 pl-8 pr-2 text-base leading-7 text-[var(--ink)] marker:text-[var(--accent)]">
      {points.map((point) => (
        <li key={point} className="pl-1">
          {point}
        </li>
      ))}
    </ul>
  );
}

function DocumentTableOfContents({ document }: { document: SiteDocument }) {
  return (
    <nav aria-label="文档目录" className="min-w-0">
      <p className="font-mono text-xs font-semibold tracking-[0.12em] text-[var(--accent)]">
        阅读导航
      </p>
      <div className="mt-5 space-y-6">
        <div>
          <p className="text-xs font-semibold text-[var(--dim)]">摘要</p>
          <ol className="mt-3 space-y-2.5 text-sm leading-6">
            {document.guide ? (
              <li>
                <DocumentAnchorLink className={anchorLinkClass} href="#reading-guide">
                  导读
                </DocumentAnchorLink>
              </li>
            ) : null}
            {document.sections.map((section, index) => (
              <li key={`summary-${section.label}-${section.heading}`} className="min-w-0">
                <DocumentAnchorLink
                  className={`${anchorLinkClass} block [overflow-wrap:anywhere]`}
                  href={`#summary-${index + 1}`}
                >
                  {section.heading}
                </DocumentAnchorLink>
              </li>
            ))}
          </ol>
        </div>

        {document.fullSections ? (
          <div className="border-t border-[var(--border)] pt-5">
            <DocumentAnchorLink
              className="inline-flex items-center gap-2 rounded-sm text-sm font-semibold text-[var(--accent)] no-underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
              href="#full-text"
            >
              阅读全文
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </DocumentAnchorLink>
            <ol className="mt-3 space-y-2.5 text-sm leading-6">
              {document.fullSections.map((section, index) => (
                <li key={`full-${section.label}-${section.heading}`} className="min-w-0">
                  <DocumentAnchorLink
                    className={`${anchorLinkClass} block [overflow-wrap:anywhere]`}
                    href={`#full-${index + 1}`}
                  >
                    {section.heading}
                  </DocumentAnchorLink>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </nav>
  );
}

function SummarySection({ section, index }: { section: DocSection; index: number }) {
  return (
    <section
      id={`summary-${index + 1}`}
      tabIndex={-1}
      className={`${anchorTargetClass} border-t border-[var(--border)] pt-8 md:pt-10`}
    >
      <p className="font-mono text-xs font-semibold tracking-[0.12em] text-[var(--accent)]">
        {section.label}
      </p>
      <h2 className="mt-4 text-[1.75rem] font-bold leading-9 tracking-[-0.025em] text-[var(--ink)] md:text-4xl md:leading-[2.75rem]">
        {section.heading}
      </h2>
      <div className={`mt-6 ${bodyTextClass}`}>
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      {section.points ? <DocumentPoints points={section.points} /> : null}
    </section>
  );
}

function FullTextSection({ section, index }: { section: DocSection; index: number }) {
  return (
    <section
      id={`full-${index + 1}`}
      tabIndex={-1}
      className={`${anchorTargetClass} max-w-[45rem]`}
    >
      <p className="font-mono text-xs font-semibold tracking-[0.12em] text-[var(--accent)]">
        {section.label}
      </p>
      <h3 className="mt-3 text-2xl font-bold leading-8 tracking-[-0.015em] text-[var(--ink)]">
        {section.heading}
      </h3>
      <div className={`mt-6 ${bodyTextClass}`}>
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
      {section.points ? <DocumentPoints points={section.points} /> : null}
    </section>
  );
}

export function DocumentPage({
  document,
  backToHome,
}: {
  document: SiteDocument;
  backToHome: string;
}) {
  const presentation = documentPresentation[document.slug];

  return (
    <main className="min-h-screen min-w-0 bg-[var(--bg)] text-[var(--ink)]">
      <article className="min-w-0">
        <header className="border-b border-[var(--border)] bg-[var(--carbon)] text-[var(--on-carbon)]">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
            <Link
              href="/"
              className="inline-flex min-h-11 items-center gap-2 rounded-sm text-sm font-semibold text-[var(--dim)] no-underline transition-colors hover:text-[var(--on-carbon)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--on-carbon)]"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              {backToHome}
            </Link>

            <div className="grid min-w-0 gap-10 py-14 sm:py-16 lg:grid-cols-[12rem_minmax(0,45rem)] lg:justify-center lg:gap-16 lg:py-20">
              <div className="min-w-0">
                <p className="font-mono text-xs font-semibold tracking-[0.12em] text-[var(--gold-bright)] [overflow-wrap:anywhere]">
                  {document.eyebrow}
                </p>
                <p className="mt-5 text-sm font-semibold text-[var(--on-carbon)]">
                  {presentation.intent}
                </p>
                <p className="mt-1 text-xs leading-[1.125rem] text-[var(--dim)]">{presentation.role}</p>
                {document.meta ? (
                  <p className="mt-6 border-t border-[var(--border)] pt-4 font-mono text-xs leading-[1.125rem] text-[var(--dim)]">
                    {document.meta}
                  </p>
                ) : null}
              </div>

              <div className="min-w-0">
                <h1 className="max-w-[45rem] text-4xl font-bold leading-[2.75rem] tracking-[-0.035em] text-[var(--on-carbon)] sm:text-5xl sm:leading-[3.5rem]">
                  {document.title}
                </h1>
                <p className="mt-6 max-w-[45rem] text-lg leading-[1.875rem] text-[var(--dim)]">
                  {document.summary}
                </p>
                {document.fullSections ? (
                  <Button
                    asChild
                    className="mt-8 bg-[var(--on-carbon)] text-[var(--carbon)] shadow-none hover:bg-[var(--paper)]"
                  >
                    <DocumentAnchorLink href="#full-text">
                      阅读全文
                      <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </DocumentAnchorLink>
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 xl:grid xl:grid-cols-[14rem_minmax(0,45rem)] xl:justify-center xl:gap-20 xl:py-24">
          <details className="mb-14 min-w-0 border-y border-[var(--border)] py-1 xl:hidden">
            <summary className="flex min-h-11 items-center justify-between gap-4 py-2 text-sm font-semibold text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]">
              文档目录
              <span aria-hidden="true" className="font-mono text-xs text-[var(--accent)]">
                INDEX
              </span>
            </summary>
            <div className="border-t border-[var(--border)] py-5">
              <DocumentTableOfContents document={document} />
            </div>
          </details>

          <aside className="hidden min-w-0 xl:block">
            <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto border-t border-[var(--border)] pt-5 pr-3">
              <DocumentTableOfContents document={document} />
            </div>
          </aside>

          <div className="min-w-0 max-w-[45rem]">
            {document.guide ? (
              <section
                id="reading-guide"
                tabIndex={-1}
                className={`${anchorTargetClass} border-l-2 border-[var(--accent)] pl-5 sm:pl-6`}
              >
                <p className="font-mono text-xs font-semibold tracking-[0.12em] text-[var(--accent)]">
                  导读
                </p>
                <h2 className="mt-3 text-2xl font-bold leading-8 tracking-[-0.015em] text-[var(--ink)]">
                  先读这一段
                </h2>
                <div className="mt-5 space-y-6 text-lg leading-[1.875rem] text-[var(--ink)]">
                  {document.guide.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                </div>
              </section>
            ) : null}

            <div
              className={
                document.guide
                  ? "mt-16 space-y-16 md:mt-20 md:space-y-20"
                  : "space-y-16 md:space-y-20"
              }
            >
              {document.sections.map((section, index) => (
                <SummarySection
                  key={`${section.label}-${section.heading}`}
                  section={section}
                  index={index}
                />
              ))}
            </div>

            {document.closing ? (
              <p className="mt-16 border-y border-[var(--border)] py-8 text-2xl font-semibold leading-9 tracking-[-0.015em] text-[var(--ink)] md:mt-20">
                {document.closing}
              </p>
            ) : null}

            {document.fullSections ? (
              <section
                id="full-text"
                tabIndex={-1}
                className={`${anchorTargetClass} mt-20 border-t border-[var(--border)] pt-14 md:mt-24 md:pt-16`}
              >
                <p className="font-mono text-xs font-semibold tracking-[0.12em] text-[var(--accent)]">
                  完整文本
                </p>
                <h2 className="mt-4 text-[1.75rem] font-bold leading-9 tracking-[-0.025em] text-[var(--ink)] md:text-4xl md:leading-[2.75rem]">
                  {document.fullTitle ?? "全文"}
                </h2>
                <div className="mt-12 space-y-16 md:mt-16 md:space-y-20">
                  {document.fullSections.map((section, index) => (
                    <FullTextSection
                      key={`${section.label}-${section.heading}`}
                      section={section}
                      index={index}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <aside className="mt-20 border-t border-[var(--border)] pt-8 md:mt-24">
              <p className="font-mono text-xs font-semibold tracking-[0.12em] text-[var(--accent)]">
                当前产品
              </p>
              <h2 className="mt-3 text-2xl font-bold leading-8 tracking-[-0.015em] text-[var(--ink)]">
                {presentation.bridgeHeading}
              </h2>
              <p className="mt-4 text-base leading-7 text-[var(--muted)]">
                从这份文档回到近邻互助组的正式介绍，了解它在当前产品探索中的位置。
              </p>
              <Link
                href="/neighbors"
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-sm font-semibold text-[var(--accent)] underline decoration-[var(--border)] underline-offset-4 transition-colors hover:text-[var(--accent-strong)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--accent)]"
              >
                了解近邻互助组
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </aside>
          </div>
        </div>
      </article>
    </main>
  );
}
