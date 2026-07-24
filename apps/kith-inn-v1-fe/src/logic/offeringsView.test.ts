import { describe, expect, it } from "vitest";
import type { Offering } from "@cfp/kith-inn-v1-shared";
import {
  CATEGORY_FILTERS,
  ImportDraftTracker,
  OfferingToggleTracker,
  filterOfferingsByCategory,
  mergeSavedOffering,
  partitionOfferingsPreservingOrder
} from "./offeringsView";

const offerings: Offering[] = [
  { id: 1, sellerId: 7, name: "红烧肉", mainIngredient: "猪肉", category: "meat", active: true },
  { id: 2, sellerId: 7, name: "清炒时蔬", mainIngredient: "青菜", category: "veg", active: true },
  { id: 3, sellerId: 7, name: "番茄蛋汤", mainIngredient: null, category: "soup", active: true }
];

describe("offerings view correctness", () => {
  it("uses the fixed category order and preserves source order while filtering", () => {
    expect(CATEGORY_FILTERS.map((item) => [item.value, item.label])).toEqual([
      ["all", "全部"],
      ["meat", "荤菜"],
      ["veg", "素菜"],
      ["soup", "汤"]
    ]);
    expect(filterOfferingsByCategory(offerings, "all")).toEqual(offerings);
    expect(filterOfferingsByCategory(offerings, "veg")).toEqual([offerings[1]]);
  });

  it("tracks concurrent toggles per offering without cross-unlocking", () => {
    const tracker = new OfferingToggleTracker();
    const meatRevision = tracker.begin("1");
    const vegRevision = tracker.begin("2");

    expect(meatRevision).toBe(1);
    expect(vegRevision).toBe(1);
    expect(tracker.begin("1")).toBeNull();
    expect(tracker.isPending("1")).toBe(true);
    expect(tracker.isPending("2")).toBe(true);

    expect(tracker.finish("1", meatRevision ?? 0)).toBe(true);
    expect(tracker.isPending("1")).toBe(false);
    expect(tracker.isPending("2")).toBe(true);
    expect(tracker.finish("2", vegRevision ?? 0)).toBe(true);
  });

  it("rejects an old toggle revision after a newer request starts", () => {
    const tracker = new OfferingToggleTracker();
    const first = tracker.begin("1") ?? 0;
    expect(tracker.finish("1", first)).toBe(true);
    const second = tracker.begin("1") ?? 0;

    expect(second).toBeGreaterThan(first);
    expect(tracker.isCurrent("1", first)).toBe(false);
    expect(tracker.finish("1", first)).toBe(false);
    expect(tracker.isPending("1")).toBe(true);
    expect(tracker.finish("1", second)).toBe(true);
  });

  it("replaces edits in place, appends creates and ignores missing edit targets", () => {
    const edited = { ...offerings[1], name: "蒜蓉时蔬" };
    const created = { ...offerings[0], id: 4, name: "糖醋排骨" };

    const afterEdit = mergeSavedOffering(offerings, edited, "edit");
    expect(afterEdit.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(afterEdit[1]).toEqual(edited);

    const afterCreate = mergeSavedOffering(afterEdit, created, "create");
    expect(afterCreate.map(({ id }) => id)).toEqual([1, 2, 3, 4]);
    expect(mergeSavedOffering(offerings, { ...offerings[0], id: 99 }, "edit")).toEqual(offerings);
  });

  it("keeps source order within active and inactive groups after a rename", () => {
    const mixed: Offering[] = [
      offerings[0],
      { ...offerings[1], active: false },
      offerings[2],
      { ...offerings[0], id: 4, name: "白灼菜心", active: false }
    ];
    const renamed = mergeSavedOffering(mixed, { ...offerings[2], name: "阿婆番茄蛋汤" }, "edit");
    const groups = partitionOfferingsPreservingOrder(renamed);

    expect(groups.active.map(({ id }) => id)).toEqual([1, 3]);
    expect(groups.inactive.map(({ id }) => id)).toEqual([2, 4]);
  });

  it("invalidates import snapshots whenever the source text changes", () => {
    const tracker = new ImportDraftTracker("");
    tracker.update("红烧肉 / 五花肉 / 荤");
    const first = tracker.capture();

    expect(tracker.isCurrent(first)).toBe(true);
    tracker.update("清炒时蔬 / 青菜 / 素");
    const second = tracker.capture();

    expect(second.revision).toBeGreaterThan(first.revision);
    expect(tracker.currentRevision).toBe(second.revision);
    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
  });
});
