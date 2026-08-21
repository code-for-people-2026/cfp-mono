import { Loader2 } from "lucide-react";

// Instant shell shown during the /chat route's RSC fetch, so navigating from the
// home page never looks frozen.
export default function ChatLoading() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem)] w-full max-w-3xl flex-col px-5 sm:px-8 md:h-[calc(100dvh-4rem)] lg:px-10">
      <div className="flex flex-1 items-center justify-center gap-2 text-[var(--muted-foreground)]">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        <span className="text-sm font-semibold">正在打开对话…</span>
      </div>
    </div>
  );
}
