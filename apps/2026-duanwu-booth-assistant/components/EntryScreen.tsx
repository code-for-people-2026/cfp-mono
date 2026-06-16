import type { EntryMode } from "@/lib/chat/conversation";
import { Button } from "@/components/ui/button";

type EntryScreenProps = {
  onSelectMode: (mode: EntryMode) => void;
};

const entryOptions: Array<{ mode: EntryMode; label: string }> = [
  { mode: "intro", label: "我先看看这是啥" },
  { mode: "doubt", label: "我有点怀疑" },
  { mode: "continue", label: "我想继续聊" },
];

export function EntryScreen({ onSelectMode }: EntryScreenProps) {
  return (
    <section className="relative flex min-h-[62dvh] flex-1 flex-col justify-center gap-3">
      <p className="m-0 text-sm tracking-normal text-muted-foreground">为工友敲键盘</p>
      <h1 className="m-0 text-[46px] leading-[1.08] font-[820] tracking-normal text-foreground md:text-[56px]">
        摊位助手
      </h1>
      <p className="m-0 w-fit rounded-full border border-border bg-secondary px-[11px] py-1.5 text-sm leading-none text-secondary-foreground">
        数据平权，AI 下乡
      </p>
      <p className="m-0 max-w-96 [overflow-wrap:anywhere] text-base leading-[1.7] text-muted-foreground">
        摊主正在和别人聊时，你可以先问我。我的回答只基于摊位材料；材料没有覆盖的内容，会明确说明边界。
      </p>
      <div className="mt-1 grid gap-2.5" aria-label="选择开始方式">
        {entryOptions.map((option) => (
          <Button
            key={option.mode}
            type="button"
            variant="outline"
            className="min-h-[52px] justify-start rounded-[calc(var(--radius)-6px)] border-border bg-card px-[15px] text-left text-card-foreground shadow-panel hover:border-ring hover:bg-secondary active:translate-y-px"
            onClick={() => onSelectMode(option.mode)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </section>
  );
}
