import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Bot,
  ExternalLink,
  FileText,
  Handshake,
  Map,
  MessageCircleMore,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getFeaturedProduct } from "@/lib/content";
import type { FeaturedProduct, FeaturedProductLink } from "@/lib/content/types";
import { featuredProductStageNotice } from "@/lib/content/featured-product";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const product = await getFeaturedProduct();
  const description = `${product.organizationRole}，${product.name}是${product.brandRelationship}。当前公开的是${product.stage.label}，${product.stage.dataBoundary}。`;
  return {
    title: `${product.name}｜码成仝`,
    description,
    alternates: { canonical: product.canonicalUrl },
    openGraph: {
      title: `${product.name}｜码成仝`,
      description,
      url: product.canonicalUrl,
      type: "website",
    },
  };
}

function ProductActions({ product, location }: { product: FeaturedProduct; location: string }) {
  return (
    <div data-neighbors-actions={location} className="grid gap-3 sm:flex sm:flex-wrap">
      <Button asChild size="lg" className="min-h-12 w-full sm:w-auto">
        <a href={product.primaryAction.href} target="_blank" rel="noreferrer">
          {product.primaryAction.label}
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
      </Button>
      <Button asChild size="lg" variant="secondary" className="min-h-12 w-full sm:w-auto">
        <a href={product.implementationAction.href} target="_blank" rel="noreferrer">
          {product.implementationAction.label}
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
      </Button>
    </div>
  );
}

const readingIcons = [FileText, Map, ShieldCheck];

function LinkCard({ item, index }: { item: FeaturedProductLink; index: number }) {
  const Icon = readingIcons[index % readingIcons.length];
  const external = item.href.startsWith("http");
  const content = (
    <>
      <div className="flex items-start justify-between gap-4">
        <Icon aria-hidden="true" className="size-5 text-[var(--primary)]" />
        <ArrowRight aria-hidden="true" className="size-4 text-[var(--muted-foreground)]" />
      </div>
      <h3 className="mt-6 text-xl font-bold leading-tight">{item.label}</h3>
      <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">{item.description}</p>
    </>
  );
  const className =
    "block min-h-44 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--foreground)] no-underline shadow-[var(--shadow-e1)] transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-[var(--shadow-e2)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] motion-reduce:transform-none motion-reduce:transition-none";

  return external ? (
    <a className={className} href={item.href} target="_blank" rel="noreferrer">
      {content}
    </a>
  ) : (
    <Link className={className} href={item.href}>
      {content}
    </Link>
  );
}

export default async function NeighborsPage() {
  const product = await getFeaturedProduct();

  return (
    <main className="min-w-0 overflow-x-clip bg-[var(--background)] text-[var(--foreground)]">
      <section
        data-neighbors-section="affiliation"
        className="relative isolate overflow-hidden border-b border-[var(--border)] bg-[var(--surface)]"
      >
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_78%_18%,var(--primary-soft),transparent_34%),linear-gradient(135deg,transparent_0_58%,var(--muted)_58%_58.15%,transparent_58.15%)]" />
        <div className="mx-auto grid min-h-[calc(100svh-4rem)] w-full max-w-[1180px] gap-10 px-4 py-14 sm:px-6 sm:py-20 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center lg:px-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="prototype">{product.stage.label}</Badge>
              <span className="font-mono text-xs font-semibold tracking-[0.14em] text-[var(--muted-foreground)] uppercase">
                01 / 归属
              </span>
            </div>
            <h1 className="mt-7 max-w-4xl text-5xl font-black leading-[1.06] tracking-tight sm:text-6xl lg:text-7xl">
              {product.name}
            </h1>
            <p className="mt-6 max-w-3xl text-xl font-bold leading-9 sm:text-2xl">
              {product.organizationRole}；{product.name}是{product.brandRelationship}。
            </p>
            <p className="mt-5 max-w-2xl text-base leading-8 text-[var(--muted-foreground)] sm:text-lg">
              这是一份主站上的正式产品介绍。先理解它想解决什么，再去体验 ideal 子域里的交互原型。
            </p>
            <div className="mt-8">
              <ProductActions product={product} location="hero" />
            </div>
            <p className="mt-4 max-w-2xl text-sm font-semibold leading-6 text-[var(--muted-foreground)]">
              {featuredProductStageNotice(product)}。请勿在原型中输入真实个人资料或敏感信息。
            </p>
          </div>

          <aside
            aria-label="当前公开边界"
            className="rounded-[var(--radius-container)] border border-[var(--border-strong)] bg-[var(--prototype-stage)] p-6 text-[var(--prototype-stage-foreground)] shadow-[var(--shadow-e3)] sm:p-8"
          >
            <p className="font-mono text-xs font-semibold tracking-[0.14em] text-white/60 uppercase">
              Prototype notice
            </p>
            <p className="mt-5 text-2xl font-bold leading-tight">可以体验机制，不能办理真实事务</p>
            <ul className="mt-6 space-y-4 text-sm leading-7 text-white/75">
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                {product.stage.dataBoundary}
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                {product.stage.serviceBoundary}
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--primary)]" />
                关键事实与承诺仍由真人确认
              </li>
            </ul>
          </aside>
        </div>
      </section>

      <section data-neighbors-section="what" className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.72fr)_minmax(18rem,0.48fr)]">
          <div>
            <p className="font-mono text-xs font-semibold tracking-[0.14em] text-[var(--primary)] uppercase">
              02 / 它是什么
            </p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">
              把亲历经验带回邻里关系
            </h2>
            <p className="mt-6 max-w-3xl text-lg leading-9 text-[var(--muted-foreground)]">
              {product.exploration}，{product.humanResponsibility}。
            </p>
          </div>
          <div className="rounded-[var(--radius-container)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-e1)] sm:p-8">
            <p className="text-sm font-bold text-[var(--primary)]">服务对象</p>
            <p className="mt-3 text-base leading-8">{product.audience}。</p>
          </div>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            { icon: MessageCircleMore, title: "邻里提供亲历", body: "从具体处境和亲历经验出发，区分事实、观察与仍需核实的信息。" },
            { icon: Bot, title: "AI 协助连接", body: "协助整理线索、发现关联，但不替代任何人提供事实或作出承诺。" },
            { icon: UserRoundCheck, title: "真人确认关键动作", body: "最终判断、事实核对与承诺都回到真实关系中的人。" },
          ].map(({ icon: Icon, title, body }) => (
            <article key={title} className="rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow-e1)]">
              <Icon aria-hidden="true" className="size-6 text-[var(--primary)]" />
              <h3 className="mt-7 text-xl font-bold">{title}</h3>
              <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section data-neighbors-section="why" className="border-y border-[var(--border)] bg-[var(--muted)]">
        <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.38fr_0.82fr] lg:px-8 lg:py-28">
          <p className="font-mono text-xs font-semibold tracking-[0.14em] text-[var(--primary)] uppercase">
            03 / 为什么值得做
          </p>
          <div>
            <h2 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl">{product.motivation.heading}</h2>
            <p className="mt-6 max-w-3xl text-lg leading-9 text-[var(--muted-foreground)]">{product.motivation.summary}</p>
            <Button asChild variant="outline" className="mt-8 min-h-11">
              <Link href="/manifesto">阅读完整立场<ArrowRight aria-hidden="true" className="size-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      <section data-neighbors-section="prototype" className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <p className="font-mono text-xs font-semibold tracking-[0.14em] text-[var(--primary)] uppercase">
          04 / 原型怎样演示
        </p>
        <div className="mt-4 grid gap-6 lg:grid-cols-[0.72fr_0.48fr] lg:items-end">
          <h2 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl">{product.prototype.heading}</h2>
          <p className="text-base leading-8 text-[var(--muted-foreground)]">{product.prototype.summary}</p>
        </div>
        <ol className="mt-12 grid gap-4 lg:grid-cols-4">
          {product.prototype.steps.map((step, index) => {
            const human = step.responsibility === "human";
            const ai = step.responsibility === "ai";
            return (
              <li
                key={step.title}
                className={`rounded-[var(--radius-card)] border p-6 ${
                  human
                    ? "border-[var(--confirm)]/40 bg-[var(--confirm-soft)]"
                    : "border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs font-bold text-[var(--muted-foreground)]">0{index + 1}</span>
                  <Badge variant={human ? "confirmed" : ai ? "neutral" : "prototype"}>
                    {human ? "真人确认" : ai ? "AI 协助" : "邻里亲历"}
                  </Badge>
                </div>
                <h3 className="mt-8 text-xl font-bold leading-tight">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--muted-foreground)]">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section data-neighbors-section="boundary" className="border-y border-[var(--border)] bg-[var(--surface)]">
        <div className="mx-auto grid max-w-[1180px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.46fr_0.74fr] lg:px-8 lg:py-28">
          <div>
            <p className="font-mono text-xs font-semibold tracking-[0.14em] text-[var(--primary)] uppercase">
              05 / 当前边界
            </p>
            <h2 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">{product.boundaries.heading}</h2>
            <p className="mt-6 text-base leading-8 text-[var(--muted-foreground)]">{product.boundaries.summary}</p>
          </div>
          <ul className="divide-y divide-[var(--border)] rounded-[var(--radius-container)] border border-[var(--border)] bg-[var(--background)] px-5 sm:px-7">
            {product.boundaries.points.map((point) => (
              <li key={point} className="flex gap-4 py-5 text-sm leading-7 sm:text-base">
                <ShieldCheck aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--primary)]" />
                {point}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section data-neighbors-section="next" className="mx-auto max-w-[1180px] px-4 py-20 sm:px-6 lg:px-8 lg:py-28">
        <p className="font-mono text-xs font-semibold tracking-[0.14em] text-[var(--primary)] uppercase">
          06 / 下一步去哪里
        </p>
        <div className="mt-4 grid gap-8 lg:grid-cols-[0.72fr_0.48fr] lg:items-end">
          <div>
            <h2 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl">先体验，再顺着正式文本追问</h2>
            <p className="mt-5 max-w-3xl text-base leading-8 text-[var(--muted-foreground)]">
              客户体验原型是主要入口；实施对照只为希望检查角色、状态与协作机制的人提供次级材料。
            </p>
          </div>
          <ProductActions product={product} location="next" />
        </div>

        <div className="mt-16">
          <h2 className="text-2xl font-black">延伸阅读</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {product.relatedReading.map((item, index) => <LinkCard key={item.href} item={item} index={index} />)}
          </div>
        </div>

        <div className="mt-16 border-t border-[var(--border)] pt-12">
          <div className="grid gap-6 lg:grid-cols-[0.72fr_0.48fr] lg:items-end">
            <div>
              <Badge variant="neutral">场景探索，不是新产品</Badge>
              <h2 className="mt-4 text-2xl font-black">从两段生活场景继续观察</h2>
            </div>
            <p className="text-sm leading-7 text-[var(--muted-foreground)]">
              “街坊味”和“楼道收一收”只是帮助讨论机制的场景探索，不代表已经形成服务、社区或交易网络。
            </p>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {product.sceneExplorations.map((scene) => (
              <a
                key={scene.href}
                href={scene.href}
                target="_blank"
                rel="noreferrer"
                className="group flex min-h-28 items-start gap-4 rounded-[var(--radius-card)] border border-[var(--border)] bg-[var(--surface)] p-5 text-[var(--foreground)] no-underline shadow-[var(--shadow-e1)] transition-[border-color,box-shadow] hover:border-[var(--primary)] hover:shadow-[var(--shadow-e2)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] motion-reduce:transition-none"
              >
                <Handshake aria-hidden="true" className="mt-1 size-5 shrink-0 text-[var(--primary)]" />
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-lg font-bold">
                    {scene.label}<ExternalLink aria-hidden="true" className="size-4" />
                  </span>
                  <span className="mt-2 block text-sm leading-7 text-[var(--muted-foreground)]">{scene.description}</span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
