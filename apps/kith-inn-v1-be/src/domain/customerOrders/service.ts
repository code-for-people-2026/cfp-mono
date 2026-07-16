import { customerReservationOrderSchema } from "@cfp/kith-inn-v1-shared/api";
import type { CmsCustomerBookingBatch, CmsCustomerOrderCreate, CmsCustomerOrderUpdate, CustomerProfile,
  CustomerReservationInput, CustomerReservationResponse, CustomerReservationResult, Order } from "@cfp/kith-inn-v1-shared";
import { getCustomerBookingBatch } from "../../lib/cms/bookingBatches";
import { createCustomerOwnedProfile, listCustomerOwnedProfiles, touchCustomerOwnedProfile }
  from "../../lib/cms/customerProfiles";
import { CmsOrderError, createCustomerOrder, findCustomerOrderBySlot, updateCustomerOrder } from "../../lib/cms/orders";

export class CustomerReservationError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
class ItemError extends Error { constructor(public readonly code: string, message: string) { super(message); } }

export type CustomerReservationDeps = {
  getBatch: (token: string, publicId: string) => Promise<CmsCustomerBookingBatch>;
  listProfiles: (token: string) => Promise<CustomerProfile[]>;
  createProfile: (token: string, input: { displayName: string; address: string }) => Promise<CustomerProfile>;
  touchProfile: (token: string, id: string | number) => Promise<CustomerProfile>;
  findOrder: (token: string, slotId: string | number, profileId: string | number) => Promise<Order | null>;
  createOrder: (token: string, input: CmsCustomerOrderCreate) => Promise<Order>;
  updateOrder: (token: string, id: string | number, input: CmsCustomerOrderUpdate,
    expectedStatus: "draft" | "canceled") => Promise<Order>;
  now: () => string;
};

export const reservationNow = () => new Date().toISOString();
const defaults: CustomerReservationDeps = {
  getBatch: getCustomerBookingBatch, listProfiles: listCustomerOwnedProfiles,
  createProfile: createCustomerOwnedProfile, touchProfile: touchCustomerOwnedProfile,
  findOrder: findCustomerOrderBySlot, createOrder: createCustomerOrder, updateOrder: updateCustomerOrder, now: reservationNow
};
const fail = (code: string, message: string): never => { throw new ItemError(code, message); };

function available(internal: CmsCustomerBookingBatch, slotId: string | number, now: string) {
  if (internal.batch.status !== "open") fail("booking-batch-closed", "预订批次已关闭");
  const slot = internal.slots.find(({ id }) => String(id) === String(slotId));
  if (!slot || !internal.batch.mealSlotIds.some((id) => String(id) === String(slotId))) {
    return fail("meal-slot-not-in-batch", "餐次不属于当前预订批次");
  }
  if (slot.orderStatus !== "open") fail("meal-slot-closed", "餐次已关闭登记");
  if (slot.orderDeadline === null || Date.parse(slot.orderDeadline) <= Date.parse(now)) {
    fail("order-deadline-passed", "餐次登记已截止");
  }
  return slot;
}

function resultFailure(mealSlotId: string | number, error: unknown): CustomerReservationResult {
  const candidate = error as Error & { code?: unknown; status?: unknown };
  const known = error instanceof ItemError || (
    error instanceof Error && typeof candidate.status === "number" && typeof candidate.code === "string"
  );
  if (!known) {
    return { mealSlotId, status: "failed", error: "reservation-item-failed", message: "登记失败" };
  }
  return { mealSlotId, status: "failed", error: candidate.code as string, message: candidate.message };
}

function writable(order: Order) {
  if (order.source !== "customer-card") fail("order-coordinate-occupied", "该餐次资料已被其他订单占用");
  return order;
}

async function recheck(token: string, input: CustomerReservationInput, profile: CustomerProfile,
  item: CustomerReservationInput["items"][number], deps: CustomerReservationDeps
) {
  const internal = await deps.getBatch(token, input.batchPublicId);
  const slot = available(internal, item.mealSlotId, deps.now());
  const owned = (await deps.listProfiles(token)).find(({ id, sellerId, active }) =>
    String(id) === String(profile.id) && String(sellerId) === String(internal.seller.id) && active);
  if (!owned) fail("customer-profile-inactive", "顾客资料已停用或不存在");
  return { quantity: item.quantity, unitPriceCents: slot.priceCents ?? internal.seller.defaultPriceCents,
    displayName: input.displayName, address: input.address, note: null };
}

async function writeItem(token: string, openid: string, input: CustomerReservationInput, profile: CustomerProfile,
  item: CustomerReservationInput["items"][number], deps: CustomerReservationDeps
): Promise<CustomerReservationResult> {
  let snapshot = await recheck(token, input, profile, item, deps);
  let existing = await deps.findOrder(token, item.mealSlotId, profile.id);
  if (!existing) {
    try {
      const doc = await deps.createOrder(token, {
        mealSlotId: item.mealSlotId, customerProfileId: profile.id, customerOpenid: openid, status: "draft",
        source: "customer-card", ...snapshot, paymentStatus: "unpaid", paidAt: null, deliveryStatus: "pending",
        deliveredAt: null, confirmedAt: null, canceledAt: null
      });
      return { mealSlotId: item.mealSlotId, status: "created", doc: customerReservationOrderSchema.parse(doc) };
    } catch (error) {
      if (!(error instanceof CmsOrderError) || error.status !== 409 || error.code !== "order-exists") throw error;
      existing = await deps.findOrder(token, item.mealSlotId, profile.id);
      if (!existing) throw error;
      snapshot = await recheck(token, input, profile, item, deps);
    }
  }
  const current = writable(existing);
  const expectedStatus = current.status;
  if (expectedStatus === "confirmed") return fail("confirmed-order-locked", "商家已确认，不能修改");
  if (expectedStatus === "canceled" && !item.resubmitCanceled) {
    return fail("canceled-order-confirmation-required", "订单已取消，请确认后重登记");
  }
  const resubmitting = expectedStatus === "canceled";
  const patch: CmsCustomerOrderUpdate = resubmitting ? { ...snapshot, status: "draft", paymentStatus: "unpaid",
    paidAt: null, deliveryStatus: "pending", deliveredAt: null, confirmedAt: null, canceledAt: null } : snapshot;
  let updated: Order;
  try {
    updated = await deps.updateOrder(token, current.id, patch, expectedStatus);
  } catch (error) {
    if (!(error instanceof CmsOrderError) || error.status !== 409 || error.code !== "customer-order-status-changed") {
      throw error;
    }
    const latest = await deps.findOrder(token, item.mealSlotId, profile.id);
    if (latest) {
      const raced = writable(latest);
      if (raced.status === "confirmed") return fail("confirmed-order-locked", "商家已确认，不能修改");
      if (raced.status === "canceled") {
        return fail("canceled-order-confirmation-required", "订单已取消，请确认后重登记");
      }
    }
    return fail("order-status-changed", "订单状态已变化，请重新提交");
  }
  const doc = customerReservationOrderSchema.parse(updated);
  return { mealSlotId: item.mealSlotId, status: resubmitting ? "resubmitted" : "updated", doc };
}

export async function submitCustomerReservations(token: string, openid: string, input: CustomerReservationInput,
  deps: CustomerReservationDeps = defaults
): Promise<CustomerReservationResponse> {
  const choice = input.profile;
  const selected = "newProfile" in choice
    ? await deps.createProfile(token, choice.newProfile)
    : (await deps.listProfiles(token)).find(({ id, active }) =>
      String(id) === String(choice.customerProfileId) && active);
  if (!selected) throw new CustomerReservationError(404, "customer-profile-not-found", "顾客资料不存在");
  const results: CustomerReservationResult[] = [];
  for (const item of input.items) {
    try { results.push(await writeItem(token, openid, input, selected, item, deps)); }
    catch (error) { results.push(resultFailure(item.mealSlotId, error)); }
  }
  if (results.some(({ status }) => status !== "failed")) {
    await deps.touchProfile(token, selected.id).catch(() => undefined);
  }
  return { profile: { ...selected, active: true }, results };
}
