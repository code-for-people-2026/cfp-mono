import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex min-h-6 items-center rounded-full border px-2.5 py-0.5 text-[0.8125rem] font-semibold leading-5",
  {
    variants: {
      variant: {
        prototype:
          "border-[var(--primary)]/25 bg-[var(--primary-soft)] text-[var(--primary)] before:mr-1.5 before:size-1.5 before:rounded-full before:bg-[var(--primary)]",
        neutral:
          "border-[var(--border)] bg-[var(--muted)] text-[var(--muted-foreground)]",
        confirmed:
          "border-[var(--confirm)]/30 bg-[var(--confirm-soft)] text-[var(--confirm-foreground)]",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge, badgeVariants };
