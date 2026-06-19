import { Info } from "lucide-react";

export function ContinuePanel() {
  return (
    <details className="my-3 mb-4 overflow-hidden rounded-[calc(var(--radius)-4px)] border border-border bg-card shadow-panel">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 border-l-[3px] border-l-[var(--gold)] px-3 text-muted-foreground">
        <Info aria-hidden="true" size={16} />
        继续了解
      </summary>
      <div className="px-3 pb-3 text-sm leading-[1.65] text-muted-foreground">
        <p className="mt-2 mb-0">如果你想继续聊，可以等摊主空下来直接问。</p>
        <p className="mt-2 mb-0">
          想看完整理念和文档，可以访问官网{" "}
          <a
            href="https://www.codeforpeople.cn"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--gold)] underline underline-offset-2"
          >
            www.codeforpeople.cn
          </a>
          ；也可以先让 AI 帮你把问题整理清楚。
        </p>
      </div>
    </details>
  );
}
