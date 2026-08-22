import Link from "next/link";
import { Button } from "@/components/ui/button";
import { featuredProductStageNotice } from "@/lib/content/featured-product";
import type { FeaturedProduct } from "@/lib/content/types";

export function FeaturedProductActions({ product }: { product: FeaturedProduct }) {
  return (
    <section
      aria-label={`${product.name}体验入口`}
      className="mt-5 border-t border-[var(--border)] pt-4"
    >
      <p className="text-xs font-semibold leading-5 text-[var(--muted-foreground)]">
        {featuredProductStageNotice(product)}
      </p>
      <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
        <Button asChild size="lg" className="w-full sm:w-auto">
          <a href={product.primaryAction.href} target="_blank" rel="noreferrer">
            {product.primaryAction.label}
          </a>
        </Button>
        <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
          <Link href={product.secondaryAction.href}>{product.secondaryAction.label}</Link>
        </Button>
      </div>
    </section>
  );
}
