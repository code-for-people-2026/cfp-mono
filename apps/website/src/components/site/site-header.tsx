"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BrandLockup } from "./brand-lockup";
import { siteNavigation, type SiteNavigationArea, type SiteShellDensity } from "./navigation";
import { isSiteLink, type SiteLink, type SiteObject } from "./types";

type SiteHeaderProps = {
  density: SiteShellDensity;
  currentObject: SiteObject;
  currentArea?: SiteNavigationArea;
  contextAction?: SiteLink;
  returnLink?: SiteLink;
  className?: string;
};

function sameLink(left?: SiteLink, right?: SiteLink) {
  return left?.href === right?.href && left?.label === right?.label;
}

function CurrentObject({ value, compact = false }: { value: SiteObject; compact?: boolean }) {
  const className = cn(
    "min-w-0 break-words text-xs font-semibold leading-4 text-[var(--muted-foreground)]",
    compact && "text-sm text-[var(--foreground)]",
  );

  return isSiteLink(value) ? (
    <Link
      href={value.href}
      className={cn(
        className,
        "rounded-sm no-underline transition-colors hover:text-[var(--primary)] active:text-[var(--primary-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] motion-reduce:transition-none",
      )}
    >
      {value.label}
    </Link>
  ) : (
    <span className={className}>{value}</span>
  );
}

export type { SiteHeaderProps };

function NavigationLinks({
  currentArea,
  mobile = false,
  onNavigate,
}: {
  currentArea?: SiteNavigationArea;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  return siteNavigation.map((item) => {
    const active = item.area === currentArea;

    return (
      <Link
        key={item.area}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={cn(
          "inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-semibold text-[var(--foreground)] no-underline outline-none transition-[color,background-color,border-color] duration-200 hover:bg-[var(--muted)] hover:text-[var(--primary)] active:bg-[var(--border)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] motion-reduce:transition-none",
          active && "bg-[var(--primary-soft)] text-[var(--primary)]",
          !mobile && "rounded-none border-b-2 border-transparent px-1",
          !mobile && active && "border-[var(--primary)] bg-transparent",
          mobile && "w-full justify-between",
        )}
      >
        {item.label}
        {mobile && active ? <span className="text-xs">当前</span> : null}
      </Link>
    );
  });
}

export function SiteHeader({
  density,
  currentObject,
  currentArea,
  contextAction,
  returnLink,
  className,
}: SiteHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const secondaryMobileLink = sameLink(contextAction, returnLink) ? undefined : returnLink;

  useEffect(() => {
    if (!menuOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  const action = contextAction ?? returnLink;

  return (
    <header
      data-density={density}
      className={cn(
        "z-40 w-full border-b border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]",
        density === "compact" && "sticky top-0",
        className,
      )}
    >
      <div
        className={cn(
          "mx-auto grid min-h-14 w-full max-w-[1280px] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-6 md:px-6 lg:px-8",
          density === "full" ? "md:min-h-20" : "md:min-h-16",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandLockup density={density} />
          <span className="text-[var(--border-strong)]" aria-hidden="true">
            /
          </span>
          <span className={cn(density === "full" && "md:hidden")}>
            <CurrentObject value={currentObject} compact={density === "compact"} />
          </span>
        </div>

        <nav aria-label="主导航" className="hidden min-w-0 items-center justify-end gap-5 md:flex">
          <NavigationLinks currentArea={currentArea} />
        </nav>

        {action ? (
          <Button asChild variant="secondary" size="sm" className="hidden md:inline-flex">
            <Link href={action.href}>{action.label}</Link>
          </Button>
        ) : null}

        <Button
          ref={menuButtonRef}
          type="button"
          variant="secondary"
          size="sm"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          onClick={() => setMenuOpen((open) => !open)}
          className="min-h-11 md:hidden"
        >
          {menuOpen ? "收起" : "导航"}
        </Button>
      </div>

      <div
        id={menuId}
        hidden={!menuOpen}
        className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 md:hidden"
      >
        <nav aria-label="移动主导航" className="mx-auto flex max-w-[1280px] flex-col gap-1">
          <NavigationLinks currentArea={currentArea} mobile onNavigate={() => setMenuOpen(false)} />
        </nav>
        {action || secondaryMobileLink ? (
          <div className="mx-auto mt-3 flex max-w-[1280px] flex-col gap-2 border-t border-[var(--border)] pt-3">
            {action ? (
              <Button asChild size="sm" variant="secondary" className="w-full">
                <Link href={action.href} onClick={() => setMenuOpen(false)}>
                  {action.label}
                </Link>
              </Button>
            ) : null}
            {secondaryMobileLink ? (
              <Button asChild size="sm" variant="ghost" className="w-full">
                <Link href={secondaryMobileLink.href} onClick={() => setMenuOpen(false)}>
                  {secondaryMobileLink.label}
                </Link>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
