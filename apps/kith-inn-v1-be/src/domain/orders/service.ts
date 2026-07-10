import type {
  CmsCustomerProfile,
  CmsOrderCreate,
  CustomerProfile,
  ManualOrderUpdate,
  MealSlot,
  Order,
  SellerSnapshot
} from "@cfp/kith-inn-v1-shared";

export class OrderDraftOnlyError extends Error {}

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

export function draftOrderPatch(order: Order, input: ManualOrderUpdate): ManualOrderUpdate {
  if (order.status !== "draft") throw new OrderDraftOnlyError("只有草稿订单可以修改");
  return input;
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
