import { describe, expect, it, vi } from "vitest";
import type { CmsCustomerBookingBatch, CustomerProfile, CustomerReservationInput, MealSlot, Order } from "@cfp/kith-inn-v1-shared";
import { CmsOrderError } from "../../lib/cms/orders";
import { CustomerReservationError, reservationNow, submitCustomerReservations, type CustomerReservationDeps } from "./service";
const NOW = "2026-07-10T01:00:00.000Z";
const profile: CustomerProfile = { id: 21, sellerId: 7, displayName: "王阿姨", address: "3A", active: true };
const slot = (id: number, overrides: Partial<MealSlot> = {}): MealSlot => ({
  id, sellerId: 7, date: "2026-07-13", occasion: "lunch",
  menuItems: Array.from({ length: 5 }, (_, index) => ({ offeringId: index + 1, nameSnapshot: `菜${index + 1}`,
    mainIngredientSnapshot: null, categorySnapshot: index < 2 ? "meat" : index < 4 ? "veg" : "soup" })),
  orderStatus: "open", orderDeadline: "2026-07-12T01:00:00.000Z", priceCents: null, generatedAt: NOW,
  ...overrides
});
const internal = (slots: MealSlot[] = [slot(11), slot(12, { priceCents: 2800 })]): CmsCustomerBookingBatch => ({
  seller: { id: 7, name: "桃子", defaultPriceCents: 3000, status: "active" },
  batch: { id: 31, sellerId: 7, publicId: "72b8b5fc-84d2-4c70-a35b-0a42742fcd11", title: "一周", status: "open",
    mealSlotIds: slots.map(({ id }) => id), createdById: 1 }, slots
});
const order = (mealSlotId: number, overrides: Partial<Order> = {}): Order => ({
  id: mealSlotId + 20, sellerId: 7, mealSlotId, customerProfileId: 21, status: "draft",
  source: "customer-card", displayName: "快照", address: "旧址", quantity: 1, unitPriceCents: 3000,
  totalCents: 3000, paymentStatus: "unpaid", paidAt: null, deliveryStatus: "pending", deliveredAt: null,
  confirmedAt: null, canceledAt: null, note: null, ...overrides
});
const input = (items: CustomerReservationInput["items"], useNew = false): CustomerReservationInput => ({
  batchPublicId: internal().batch.publicId, profile: useNew ? { newProfile: { displayName: "王", address: "3A" } }
    : { customerProfileId: 21 }, displayName: "本次称呼", address: "本次地址", items
});
function deps(overrides: Partial<CustomerReservationDeps> = {}): CustomerReservationDeps {
  return {
    getBatch: vi.fn(async () => internal()), listProfiles: vi.fn(async () => [profile]),
    createProfile: vi.fn(async () => profile), touchProfile: vi.fn(async () => profile), findOrder: vi.fn(async () => null),
    createOrder: vi.fn(async (_token, value) => order(Number(value.mealSlotId), {
      customerProfileId: value.customerProfileId, displayName: value.displayName, address: value.address,
      quantity: value.quantity, unitPriceCents: value.unitPriceCents,
      totalCents: value.quantity * value.unitPriceCents })),
    updateOrder: vi.fn(async (_token, id, value) => order(Number(id) - 20,
      { ...value, totalCents: (value.quantity ?? 1) * (value.unitPriceCents ?? 3000) })),
    now: () => NOW, ...overrides
  };
}
const submit = (items: CustomerReservationInput["items"], injected: CustomerReservationDeps, useNew = false) =>
  submitCustomerReservations("jwt", "wx", input(items, useNew), injected);
describe("customer reservation orchestration", () => {
  it("creates a new profile then creates/updates items sequentially with price snapshots", async () => {
    const injected = deps({
      findOrder: vi.fn(async (_token, id) => Number(id) === 12 ? order(12) : null),
      touchProfile: vi.fn(async () => { throw new Error("offline"); })
    });
    const result = await submit([{ mealSlotId: 11, quantity: 2, resubmitCanceled: false },
      { mealSlotId: 12, quantity: 3, resubmitCanceled: false }], injected, true);
    expect(result.results.map(({ status }) => status)).toEqual(["created", "updated"]);
    expect(injected.createOrder).toHaveBeenCalledWith("jwt", expect.objectContaining({ customerOpenid: "wx",
      source: "customer-card", unitPriceCents: 3000, quantity: 2 }), internal().batch.publicId);
    expect(injected.updateOrder).toHaveBeenCalledWith("jwt", 32, expect.objectContaining({ unitPriceCents: 2800,
      quantity: 3, displayName: "本次称呼" }), "draft", internal().batch.publicId);
    expect(injected.getBatch).toHaveBeenCalledTimes(2);
    expect(injected.listProfiles).toHaveBeenCalledTimes(2);
    expect(injected.touchProfile).toHaveBeenCalledOnce();
  });
  it("resubmits canceled orders and returns deterministic partial failures", async () => {
    const states = new Map<number, Order | null>([[11, order(11, { status: "canceled", canceledAt: NOW })],
      [12, order(12, { status: "confirmed", confirmedAt: NOW })],
      [13, order(13, { status: "canceled", canceledAt: NOW })], [14, order(14, { source: "manual" })]]);
    const batch = internal([slot(11), slot(12), slot(13), slot(14), slot(15, { orderStatus: "closed" }), slot(16)]);
    const injected = deps({ getBatch: vi.fn(async () => batch), findOrder: vi.fn(async (_token, id) => {
      if (Number(id) === 16) throw new Error("offline");
      return states.get(Number(id)) ?? null;
    }) });
    const result = await submit([{ mealSlotId: 11, quantity: 2, resubmitCanceled: true },
      { mealSlotId: 12, quantity: 1, resubmitCanceled: false }, { mealSlotId: 13, quantity: 1, resubmitCanceled: false },
      { mealSlotId: 14, quantity: 1, resubmitCanceled: false }, { mealSlotId: 15, quantity: 1, resubmitCanceled: false },
      { mealSlotId: 16, quantity: 1, resubmitCanceled: false }], injected);
    expect(result.results.map((item) => item.status === "failed" ? item.error : item.status)).toEqual([
      "resubmitted", "confirmed-order-locked", "canceled-order-confirmation-required", "order-coordinate-occupied",
      "meal-slot-closed", "reservation-item-failed"
    ]);
    expect(injected.updateOrder).toHaveBeenCalledWith("jwt", 31, expect.objectContaining({ status: "draft",
      paymentStatus: "unpaid", canceledAt: null }), "canceled", internal().batch.publicId);
    expect(result.results[5]).toMatchObject({ message: "登记失败" });
  });
  it("re-reads unique conflicts, preserves profiles and rejects missing owners", async () => {
    const raced = deps({ createOrder: vi.fn(async () => { throw new CmsOrderError(409, "order-exists", "已存在"); }),
      findOrder: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(order(11)) });
    await expect(submit([{ mealSlotId: 11, quantity: 2, resubmitCanceled: false }], raced))
      .resolves.toMatchObject({ results: [{ status: "updated" }] });
    const oldProfile = { ...profile, displayName: "王", address: "3A" };
    const newProfile = { ...oldProfile, id: 22 };
    const retry = deps({ listProfiles: vi.fn(async () => [oldProfile, newProfile]), createProfile: vi.fn(async () => newProfile) });
    await expect(submit([{ mealSlotId: 11, quantity: 2, resubmitCanceled: false }], retry, true))
      .resolves.toMatchObject({ profile: newProfile, results: [{ status: "created", doc: { customerProfileId: 22 } }] });
    expect(retry.createProfile).toHaveBeenCalledWith("jwt", { displayName: "王", address: "3A" });
    const closed = internal(); closed.batch.status = "closed";
    const closedRace = deps({
      getBatch: vi.fn().mockResolvedValueOnce(internal()).mockResolvedValueOnce(closed),
      createOrder: vi.fn(async () => { throw new CmsOrderError(409, "order-exists", "已存在"); }),
      findOrder: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(order(11))
    });
    await expect(submit([{ mealSlotId: 11, quantity: 2, resubmitCanceled: false }], closedRace))
      .resolves.toMatchObject({ results: [{ error: "booking-batch-closed" }] });
    expect(closedRace.updateOrder).not.toHaveBeenCalled();
    const failed = deps({ getBatch: vi.fn(async () => internal([])), listProfiles: vi.fn(async () => [profile]) });
    const created = await submit([{ mealSlotId: 11, quantity: 1, resubmitCanceled: false }], failed, true);
    expect(created.results[0]).toMatchObject({ status: "failed", error: "meal-slot-not-in-batch" });
    expect(failed.createProfile).toHaveBeenCalledOnce();
    expect(failed.touchProfile).not.toHaveBeenCalled();
    await expect(submit([{ mealSlotId: 11, quantity: 1, resubmitCanceled: false }],
      deps({ listProfiles: vi.fn(async () => []) }))).rejects.toBeInstanceOf(CustomerReservationError);
  });
  it("rechecks batch, deadline, profile and dependency failures for every item", async () => {
    const one = [{ mealSlotId: 11, quantity: 1, resubmitCanceled: false }] as const;
    const run = (overrides: Partial<CustomerReservationDeps>) => submit([...one], deps(overrides));
    const closed = internal(); closed.batch.status = "closed";
    await expect(run({ getBatch: vi.fn(async () => closed) })).resolves.toMatchObject({ results: [{ error: "booking-batch-closed" }] });
    await expect(run({ getBatch: vi.fn(async () => internal([slot(11, { orderDeadline: null })])) }))
      .resolves.toMatchObject({ results: [{ error: "order-deadline-passed" }] });
    await expect(run({ listProfiles: vi.fn().mockResolvedValueOnce([profile]).mockResolvedValueOnce([]) }))
      .resolves.toMatchObject({ results: [{ error: "customer-profile-inactive" }] });
    await expect(run({ findOrder: vi.fn(async () => { throw "offline"; }) })).resolves.toMatchObject({
      results: [{ error: "reservation-item-failed", message: "登记失败" }]
    });
    for (const error of [new Error("offline"), new CmsOrderError(500, "bad", "失败"),
      new CmsOrderError(409, "other", "失败"), new CmsOrderError(409, "order-exists", "已存在")]) {
      const extra = error instanceof CmsOrderError && error.code === "order-exists"
        ? { findOrder: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null) } : {};
      await expect(run({ createOrder: vi.fn(async () => { throw error; }), ...extra }))
        .resolves.toMatchObject({ results: [{ status: "failed" }] });
    }
    expect(Date.parse(reservationNow())).not.toBeNaN();
  });
  it("maps atomic status-change conflicts back to stable customer domain errors", async () => {
    for (const [latest, expected] of [
      [order(11, { status: "confirmed", confirmedAt: NOW }), "confirmed-order-locked"],
      [order(11, { status: "canceled", canceledAt: NOW }), "canceled-order-confirmation-required"],
      [order(11), "order-status-changed"],
      [null, "order-status-changed"]
    ] as const) {
      const injected = deps({ findOrder: vi.fn().mockResolvedValueOnce(order(11)).mockResolvedValueOnce(latest),
        updateOrder: vi.fn(async () => { throw new CmsOrderError(409, "customer-order-status-changed", "订单状态已变化，请重试"); }) });
      await expect(submit([{ mealSlotId: 11, quantity: 2, resubmitCanceled: false }], injected))
        .resolves.toMatchObject({ results: [{ status: "failed", error: expected }] });
      expect(injected.findOrder).toHaveBeenCalledTimes(2);
    }
    for (const error of [
      new Error("offline"),
      new CmsOrderError(500, "cms-failed", "失败"),
      new CmsOrderError(409, "other-conflict", "冲突")
    ]) {
      await expect(submit([{ mealSlotId: 11, quantity: 2, resubmitCanceled: false }],
        deps({ findOrder: vi.fn(async () => order(11)), updateOrder: vi.fn(async () => { throw error; }) })))
        .resolves.toMatchObject({ results: [{ status: "failed" }] });
    }
  });
});
