import { describe, expect, it } from "vitest";
import { buildingProgress, fulfillmentStatusLabel, type AddressGroup, type Fulfillment } from "./deliveryView";

const group = (statuses: string[]): AddressGroup => ({
  address: "3A",
  count: statuses.length,
  fulfillments: statuses.map(
    (s, i) =>
      ({
        id: i,
        order: i,
        serviceDate: "2026-06-30",
        status: s as "pending" | "done",
      }) as unknown as Fulfillment, // fixture only exercises status — partial is fine for the view helper
  ),
});

describe("buildingProgress", () => {
  it("counts done vs total and the percent", () => {
    expect(buildingProgress(group(["done", "pending", "done"]))).toEqual({ done: 2, total: 3, percent: 67 });
  });
  it("is 100% when all done", () => {
    expect(buildingProgress(group(["done", "done"]))).toEqual({ done: 2, total: 2, percent: 100 });
  });
  it("is 0% when none done", () => {
    expect(buildingProgress(group(["pending", "pending"]))).toEqual({ done: 0, total: 2, percent: 0 });
  });
  it("is 0% for an empty address group", () => {
    expect(buildingProgress(group([]))).toEqual({ done: 0, total: 0, percent: 0 });
  });
});

describe("fulfillmentStatusLabel", () => {
  it("labels each status", () => {
    expect(fulfillmentStatusLabel("done")).toBe("完成");
    expect(fulfillmentStatusLabel("canceled")).toBe("已取消");
    expect(fulfillmentStatusLabel("pending")).toBe("待送");
  });
  it("falls back to 待送 for unknown statuses", () => {
    expect(fulfillmentStatusLabel("???")).toBe("待送");
  });
});
