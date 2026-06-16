import Image from "next/image";
import { Loader2 } from "lucide-react";
import { brandAssets } from "@/content/site";

// Instant shell shown during the /chat route's RSC fetch, so navigating from the
// home page never looks frozen.
export default function ChatLoading() {
  return (
    <div className="mx-auto flex h-[100dvh] w-full max-w-3xl flex-col px-5 sm:px-8 lg:px-10">
      <header className="flex h-16 shrink-0 items-center gap-3">
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
      </header>
      <div className="flex flex-1 items-center justify-center gap-2 text-[var(--muted)]">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        <span className="text-sm font-semibold">正在打开对话…</span>
      </div>
    </div>
  );
}
