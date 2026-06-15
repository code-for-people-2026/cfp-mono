import Link from "next/link";
import { ArrowLeft, FileText, Map, ShieldCheck } from "lucide-react";

const readLinks = [
  {
    label: "读数据平权宣言",
    href: "/manifesto",
    description: "先理解我们为什么关心软件、平台和数据红利怎么分。",
    icon: FileText,
  },
  {
    label: "看 7×7 方向地图",
    href: "/map",
    description: "看具体问题之后会如何放进人群处境和能力缺口里。",
    icon: Map,
  },
  {
    label: "看牛马互助协议",
    href: "/license",
    description: "看我们准备用哪些规则约束自己，不把服务做成新的收租。",
    icon: ShieldCheck,
  },
];

export default function DialoguePage() {
  return (
    <main className="min-h-screen bg-[var(--bg)] text-[var(--ink)]">
      <section className="relative isolate flex min-h-screen items-center overflow-hidden px-5 py-8 sm:px-8 lg:px-10">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_18%,var(--glow-cyan),transparent_32%),radial-gradient(circle_at_20%_80%,var(--glow-red),transparent_26%),radial-gradient(circle_at_82%_74%,var(--glow-gold),transparent_24%)]" />
        <div className="mx-auto w-full max-w-5xl">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-bold text-[var(--muted)] no-underline transition-colors hover:text-[var(--accent)]"
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4" />
            回到首页
          </Link>

          <div className="mt-12 border border-[var(--border)] bg-[var(--paper)] p-6 shadow-[var(--shadow-large)] sm:p-10">
            <p className="w-fit rounded-full border border-[var(--border)] bg-[var(--chip)] px-3 py-1 text-xs font-black tracking-[0.18em] text-[var(--accent)] uppercase">
              GUIDE / COMING SOON
            </p>
            <h1 className="mt-8 max-w-3xl text-4xl font-black leading-tight tracking-normal sm:text-6xl">
              对话入口正在接入
            </h1>
            <p className="mt-6 max-w-3xl text-base leading-8 text-[var(--muted)] sm:text-lg">
              之后会接入基于项目知识库的问答，回答会以已经公开的文本为依据。现在先保留入口形态，不假装已经有完整 AI 回答。
            </p>

            <div className="mt-10 grid gap-4 md:grid-cols-3">
              {readLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="border border-[var(--border)] bg-[var(--soft)] p-5 text-[var(--ink)] no-underline transition-colors hover:border-[var(--accent)]"
                  >
                    <Icon aria-hidden="true" className="h-6 w-6 text-[var(--accent)]" />
                    <h2 className="mt-6 text-xl font-black leading-tight">{item.label}</h2>
                    <p className="mt-3 text-sm leading-7 text-[var(--muted)]">
                      {item.description}
                    </p>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
