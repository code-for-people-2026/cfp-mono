import type { CollectionConfig } from "payload";
import { Sellers } from "./collections/Sellers";
import { Operators } from "./collections/Operators";
import { Offerings } from "./collections/Offerings";

/**
 * kith-inn's Payload collections, consumed by the shared `apps/cms` host
 * (`payload.config.ts` does `collections: [...kithInnCollections]`). This package
 * owns the collection shapes + the tenant-isolation access/hooks; it depends on
 * Payload + the zero-dep `@cfp/kith-inn-shared` domain kernel (enums/types).
 */
export const collections: CollectionConfig[] = [Sellers, Operators, Offerings];
