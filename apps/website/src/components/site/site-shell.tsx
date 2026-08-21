import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { SiteNavigationArea } from "./navigation";
import { CompactSiteFooter, FullSiteFooter, type FullSiteFooterProps } from "./site-footer";
import { SiteHeader } from "./site-header";
import type { SiteLink, SiteObject } from "./types";

type SharedShellProps = {
  children?: ReactNode;
  currentArea?: SiteNavigationArea;
  className?: string;
  contentClassName?: string;
};

type FullSiteShellProps = SharedShellProps & {
  currentObject?: SiteObject;
  footer?: FullSiteFooterProps;
  footerSlot?: ReactNode;
};

type CompactSiteShellProps = SharedShellProps & {
  currentObject: SiteObject;
  returnLink: SiteLink;
  contextAction?: SiteLink;
};

function ShellFrame({
  children,
  header,
  footer,
  className,
  contentClassName,
}: Pick<SharedShellProps, "children" | "className" | "contentClassName"> & {
  header: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      data-site-shell=""
      className={cn(
        "flex min-h-screen min-w-0 flex-col bg-[var(--background)] text-[var(--foreground)]",
        className,
      )}
    >
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 -translate-y-24 rounded-[var(--radius-control)] bg-[var(--foreground)] px-4 py-3 text-sm font-semibold text-[var(--background)] no-underline shadow-[var(--shadow-e2)] transition-transform focus:translate-y-0 motion-reduce:transition-none"
      >
        跳到主要内容
      </a>
      {header}
      <div id="main-content" tabIndex={-1} className={cn("min-w-0 flex-1", contentClassName)}>
        {children}
      </div>
      {footer}
    </div>
  );
}

export function FullSiteShell({
  children,
  currentArea,
  currentObject = "公共官网",
  footer,
  footerSlot,
  className,
  contentClassName,
}: FullSiteShellProps) {
  return (
    <ShellFrame
      className={className}
      contentClassName={contentClassName}
      header={
        <SiteHeader density="full" currentArea={currentArea} currentObject={currentObject} />
      }
      footer={footerSlot ?? <FullSiteFooter {...footer} />}
    >
      {children}
    </ShellFrame>
  );
}

export function CompactSiteShell({
  children,
  currentArea,
  currentObject,
  returnLink,
  contextAction,
  className,
  contentClassName,
}: CompactSiteShellProps) {
  return (
    <ShellFrame
      className={className}
      contentClassName={contentClassName}
      header={
        <SiteHeader
          density="compact"
          currentArea={currentArea}
          currentObject={currentObject}
          contextAction={contextAction}
          returnLink={returnLink}
        />
      }
      footer={<CompactSiteFooter currentObject={currentObject} returnLink={returnLink} />}
    >
      {children}
    </ShellFrame>
  );
}

export type { CompactSiteShellProps, FullSiteShellProps };
