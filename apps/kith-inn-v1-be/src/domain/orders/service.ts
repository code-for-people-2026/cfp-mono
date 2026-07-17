import type {
  CmsCustomerProfile,
  CmsOrderCreate,
  CmsOrderUpdate,
  CustomerProfile,
  ManualOrderUpdate,
  MealSlot,
  Order,
  OrderAction,
  OrderResubmit,
  SellerSnapshot
} from "@cfp/kith-inn-v1-shared";

export class InvalidOrderTransitionError extends Error {}
export class ConfirmedImpactConfirmationRequiredError extends Error {}

export function buildDraftOrder(input: {
  seller: SellerSnapshot;
  slot: MealSlot;
  profile: CmsCustomerProfile;
  quantity: number;
  note: string | null;
}): CmsOrderCreate {
  return {
    mealSlotId: input.slot.id,
    customerProfileId: input.profile.id,
    customerOpenid: input.profile.openid,
    status: "draft",
    source: "manual",
    displayName: input.profile.displayName,
    address: input.profile.address,
    quantity: input.quantity,
    unitPriceCents: input.slot.priceCents ?? input.seller.defaultPriceCents,
    paymentStatus: "unpaid",
    paidAt: null,
    deliveryStatus: "pending",
    deliveredAt: null,
    confirmedAt: null,
    canceledAt: null,
    note: input.note
  };
}

export function editOrderPatch(order: Order, input: ManualOrderUpdate): CmsOrderUpdate {
  if (order.status === "canceled") throw new InvalidOrderTransitionError("已取消订单不能普通修改");
  if (order.status === "confirmed" && input.confirmedImpactAccepted !== true) {
    throw new ConfirmedImpactConfirmationRequiredError("修改已确认订单会影响备餐或配送，请先确认");
  }
  const patch = { ...input };
  delete patch.confirmedImpactAccepted;
  if (order.source === "jielong-import") {
    delete patch.displayName;
    delete patch.address;
  }
  return patch;
}

type LifecycleAction = Exclude<OrderAction, "resubmit">;

export function transitionOrder(order: Order, action: LifecycleAction, now: string): CmsOrderUpdate | null {
  if (action === "confirm") {
    if (order.status === "confirmed") return null;
    if (order.status !== "draft") throw new InvalidOrderTransitionError("只有草稿订单可以确认");
    return { status: "confirmed", confirmedAt: now, canceledAt: null };
  }
  if (action === "cancel") {
    if (order.status === "canceled") return null;
    return { status: "canceled", canceledAt: now };
  }
  if (order.status !== "confirmed") {
    throw new InvalidOrderTransitionError("只有已确认订单可以修改付款或配送状态");
  }
  if (action === "mark-paid") {
    return order.paymentStatus === "paid" ? null : { paymentStatus: "paid", paidAt: now };
  }
  if (action === "mark-unpaid") {
    return order.paymentStatus === "unpaid" ? null : { paymentStatus: "unpaid", paidAt: null };
  }
  if (action === "mark-delivered") {
    return order.deliveryStatus === "done" ? null : { deliveryStatus: "done", deliveredAt: now };
  }
  return order.deliveryStatus === "pending"
    ? null
    : { deliveryStatus: "pending", deliveredAt: null };
}

export function resubmitOrderPatch(order: Order, input: OrderResubmit, unitPriceCents: number): CmsOrderUpdate {
  if (order.status !== "canceled") throw new InvalidOrderTransitionError("只有已取消订单可以重提");
  return {
    ...input,
    unitPriceCents,
    status: "draft",
    paymentStatus: "unpaid",
    paidAt: null,
    deliveryStatus: "pending",
    deliveredAt: null,
    confirmedAt: null,
    canceledAt: null
  };
}

export function publicCustomerProfile(profile: CmsCustomerProfile): CustomerProfile {
  return {
    id: profile.id,
    sellerId: profile.sellerId,
    displayName: profile.displayName,
    address: profile.address,
    active: profile.active
  };
}

export function existingOrderSummary(order: Order) {
  return { id: order.id, status: order.status, quantity: order.quantity };
}
