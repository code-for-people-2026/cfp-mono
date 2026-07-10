export const SELLER_STATUSES = ["active", "paused"] as const;
export type SellerStatus = (typeof SELLER_STATUSES)[number];

export const OCCASIONS = ["lunch", "dinner"] as const;
export type Occasion = (typeof OCCASIONS)[number];

export const OFFERING_CATEGORIES = ["meat", "veg", "soup"] as const;
export type OfferingCategory = (typeof OFFERING_CATEGORIES)[number];

export const MEAL_SLOT_ORDER_STATUSES = ["draft", "open", "closed"] as const;
export type MealSlotOrderStatus = (typeof MEAL_SLOT_ORDER_STATUSES)[number];

export const BOOKING_BATCH_STATUSES = ["open", "closed", "archived"] as const;
export type BookingBatchStatus = (typeof BOOKING_BATCH_STATUSES)[number];

export const ORDER_STATUSES = ["draft", "confirmed", "canceled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_SOURCES = ["customer-card", "manual", "jielong-import"] as const;
export type OrderSource = (typeof ORDER_SOURCES)[number];

export const PAYMENT_STATUSES = ["unpaid", "paid"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DELIVERY_STATUSES = ["pending", "done"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
