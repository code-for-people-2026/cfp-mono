import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const linkVariants = cva(
  "inline-flex min-h-11 items-center rounded-[var(--radius-control)] font-semibold underline decoration-current/40 underline-offset-4 transition-[color,background-color,text-decoration-color] duration-200 hover:text-[var(--primary-hover)] hover:decoration-current active:text-[var(--primary-active)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] aria-disabled:pointer-events-none aria-disabled:text-[var(--disabled-foreground)] aria-disabled:no-underline motion-reduce:transition-none",
  {
    variants: {
      variant: {
        default: "text-[var(--primary)]",
        foreground: "text-[var(--foreground)]",
        muted: "text-[var(--muted-foreground)]",
      },
      density: {
        default: "px-1",
        compact: "min-h-0 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      density: "default",
    },
  },
);

export interface TextLinkProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement>,
    VariantProps<typeof linkVariants> {}

const TextLink = React.forwardRef<HTMLAnchorElement, TextLinkProps>(
  ({ className, variant, density, onClick, ...props }, ref) => {
    const disabled = props["aria-disabled"] === true;

    return (
      <a
        {...props}
        ref={ref}
        className={cn(linkVariants({ variant, density, className }))}
        onClick={(event) => {
          if (disabled) event.preventDefault();
          onClick?.(event);
        }}
        tabIndex={disabled ? -1 : props.tabIndex}
      />
    );
  },
);
TextLink.displayName = "TextLink";

export { TextLink, linkVariants };
