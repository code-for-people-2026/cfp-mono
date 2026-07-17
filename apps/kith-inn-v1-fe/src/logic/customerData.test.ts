import { expect, it, vi } from "vitest";
import type { CustomerOrderView, CustomerProfile } from "@cfp/kith-inn-v1-shared";
import { copyCustomerData, customerDataJson, deactivateCustomerProfiles } from "./customerData";

const profile: CustomerProfile = {
  id: 21,
  sellerId: 7,
  displayName: "王阿姨",
  address: "3A-1201",
  active: true
};

const order: CustomerOrderView = {
  id: 31,
  target: { date: "2026-07-13", occasion: "lunch" },
  menuItems: Array.from({ length: 5 }, (_, index) => ({
    nameSnapshot: `菜${index + 1}`,
    mainIngredientSnapshot: index === 0 ? "猪肉" : null,
    categorySnapshot: index < 2 ? "meat" : index < 4 ? "veg" : "soup"
  })),
  orderStatus: "open",
  orderDeadline: "2026-07-12T01:00:00.000Z",
  displayName: "王阿姨",
  address: "3A-1201",
  quantity: 2,
  unitPriceCents: 3000,
  totalCents: 6000,
  status: "confirmed",
  paymentStatus: "paid",
  paidAt: "2026-07-13T01:00:00.000Z",
  deliveryStatus: "done",
  deliveredAt: "2026-07-13T04:00:00.000Z",
  confirmedAt: "2026-07-12T02:00:00.000Z",
  canceledAt: null
};

it("exports only explicit customer-visible fields and active profiles", () => {
  const text = customerDataJson(
    [
      { ...profile, openid: "secret", token: "secret" } as CustomerProfile,
      { ...profile, id: 22, active: false }
    ],
    [{ ...order, customerOpenid: "secret", note: "内部备注", operator: 9 } as CustomerOrderView],
    new Date("2026-07-17T01:02:03.000Z")
  );

  expect(JSON.parse(text)).toEqual({
    schemaVersion: 1,
    exportedAt: "2026-07-17T01:02:03.000Z",
    profiles: [{ displayName: "王阿姨", address: "3A-1201" }],
    orders: [{
      target: order.target,
      menuItems: order.menuItems,
      displayName: "王阿姨",
      address: "3A-1201",
      quantity: 2,
      unitPriceCents: 3000,
      totalCents: 6000,
      status: "confirmed",
      paymentStatus: "paid",
      paidAt: "2026-07-13T01:00:00.000Z",
      deliveryStatus: "done",
      deliveredAt: "2026-07-13T04:00:00.000Z",
      confirmedAt: "2026-07-12T02:00:00.000Z",
      canceledAt: null
    }]
  });
  for (const forbidden of ["id", "sellerId", "openid", "token", "operator", "note", "orderDeadline", "orderStatus"]) {
    expect(text).not.toContain(`"${forbidden}"`);
  }
});

it("copies the versioned JSON through the platform clipboard", async () => {
  const setClipboardData = vi.fn(async () => undefined);
  await copyCustomerData([profile], [order], setClipboardData, new Date("2026-07-17T01:02:03.000Z"));
  expect(setClipboardData).toHaveBeenCalledWith({
    data: customerDataJson([profile], [order], new Date("2026-07-17T01:02:03.000Z"))
  });
});

it("soft-deactivates active profiles one by one and keeps failures retryable", async () => {
  const deactivate = vi.fn(async (id: string | number) => {
    if (id === 22) throw new Error("temporary");
  });
  const second = { ...profile, id: 22, displayName: "李叔" };

  await expect(deactivateCustomerProfiles([
    profile,
    second,
    { ...profile, id: 23, active: false }
  ], deactivate)).resolves.toEqual([
    { profile, status: "deactivated" },
    { profile: second, status: "failed" }
  ]);
  expect(deactivate).toHaveBeenCalledTimes(2);
  expect(deactivate).toHaveBeenNthCalledWith(1, 21);
  expect(deactivate).toHaveBeenNthCalledWith(2, 22);
});
