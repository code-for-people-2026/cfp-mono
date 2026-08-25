import * as React from "react";
import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-base text-[var(--foreground)] shadow-[var(--shadow-e1)] outline-none transition-[border-color,box-shadow,background-color] duration-200 placeholder:text-[var(--muted-foreground)] hover:border-[var(--foreground)] active:border-[var(--primary-active)] focus-visible:border-[var(--primary)] focus-visible:ring-3 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed disabled:bg-[var(--disabled)] disabled:text-[var(--disabled-foreground)] disabled:opacity-100 aria-[invalid=true]:border-[var(--destructive)] aria-[invalid=true]:ring-3 aria-[invalid=true]:ring-[var(--destructive-soft)] motion-reduce:transition-none md:text-sm",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export { Input };
