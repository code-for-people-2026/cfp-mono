import type { Offering, OfferingCategory } from "@cfp/kith-inn-v1-shared";

export type CategoryFilter = "all" | OfferingCategory;
export type SaveMode = "create" | "edit";

export type ImportDraftSnapshot = Readonly<{
  revision: number;
  text: string;
}>;

export const CATEGORY_FILTERS: ReadonlyArray<{ value: CategoryFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "meat", label: "荤菜" },
  { value: "veg", label: "素菜" },
  { value: "soup", label: "汤" }
];

export function filterOfferingsByCategory(
  offerings: Offering[],
  filter: CategoryFilter
): Offering[] {
  return filter === "all"
    ? offerings
    : offerings.filter((offering) => offering.category === filter);
}

export function partitionOfferingsPreservingOrder(offerings: Offering[]): {
  active: Offering[];
  inactive: Offering[];
} {
  return {
    active: offerings.filter((offering) => offering.active),
    inactive: offerings.filter((offering) => !offering.active)
  };
}

export function mergeSavedOffering(
  offerings: Offering[],
  saved: Offering,
  mode: SaveMode
): Offering[] {
  if (mode === "create") return [...offerings, saved];

  let found = false;
  const merged = offerings.map((offering) => {
    if (String(offering.id) !== String(saved.id)) return offering;
    found = true;
    return saved;
  });
  return found ? merged : offerings;
}

export class OfferingToggleTracker {
  private readonly pending = new Set<string>();
  private readonly revisions = new Map<string, number>();

  begin(id: string): number | null {
    if (this.pending.has(id)) return null;
    const revision = (this.revisions.get(id) ?? 0) + 1;
    this.revisions.set(id, revision);
    this.pending.add(id);
    return revision;
  }

  isPending(id: string): boolean {
    return this.pending.has(id);
  }

  isCurrent(id: string, revision: number): boolean {
    return this.pending.has(id) && this.revisions.get(id) === revision;
  }

  finish(id: string, revision: number): boolean {
    if (!this.isCurrent(id, revision)) return false;
    this.pending.delete(id);
    return true;
  }
}

export class ImportDraftTracker {
  private revision = 0;

  constructor(private text: string) {}

  get currentRevision(): number {
    return this.revision;
  }

  update(text: string): number {
    this.text = text;
    this.revision += 1;
    return this.revision;
  }

  capture(): ImportDraftSnapshot {
    return { revision: this.revision, text: this.text };
  }

  isCurrent(snapshot: ImportDraftSnapshot): boolean {
    return snapshot.revision === this.revision && snapshot.text === this.text;
  }
}
