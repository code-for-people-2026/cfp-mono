"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";

type DocumentAnchorLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: `#${string}`;
};

export function DocumentAnchorLink({ href, onClick, ...props }: DocumentAnchorLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);

    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const target = document.getElementById(href.slice(1));
    if (!target) {
      return;
    }

    event.preventDefault();
    window.history.pushState(null, "", href);
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  }

  return <Link href={href} onClick={handleClick} {...props} />;
}
