import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";

type BrandLockupProps = {
  density: "full" | "compact";
  label?: string;
  className?: string;
};

export function BrandLockup({ density, label = "码成仝", className }: BrandLockupProps) {
  return (
    <Link
      href="/"
      aria-label="码成仝首页"
      className={cn(
        "group flex min-h-11 shrink-0 items-center gap-2.5 rounded-[var(--radius-control)] text-[var(--foreground)] no-underline outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]",
        className,
      )}
    >
      <Image
        src="/assets/brand/code-for-people-logo.png"
        alt=""
        width={40}
        height={40}
        priority={density === "full"}
        className={cn(
          "size-9 rounded-[var(--radius-control)] object-cover shadow-[var(--shadow-e1)] transition-transform duration-200 group-hover:scale-[1.03] motion-reduce:transition-none",
          density === "compact" && "size-8",
        )}
      />
      <span className="flex min-w-0 flex-col">
        <span className="text-base font-bold leading-5 tracking-[-0.01em]">{label}</span>
        {density === "full" ? (
          <span className="hidden text-xs font-medium leading-4 text-[var(--muted-foreground)] sm:block">
            为“工友”敲键盘
          </span>
        ) : null}
      </span>
    </Link>
  );
}
