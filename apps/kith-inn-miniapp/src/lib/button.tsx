import type { ReactNode } from "react";
import { Button as TaroButton } from "@tarojs/components";
export function Button(props: { children: ReactNode; onClick: () => void; disabled?: boolean; className?: string; ariaLabel?: string; ariaExpanded?: boolean }) {
  // H5's Taro button custom element lacks native keyboard and disabled semantics.
  const className = `action-button ${props.className ?? ""}`;
  return process.env.TARO_ENV === "h5"
    ? <button type="button" className={className} disabled={props.disabled} aria-label={props.ariaLabel} aria-expanded={props.ariaExpanded} onClick={props.onClick}>{props.children}</button>
    : <TaroButton {...props} className={className} />;
}

