import type { CustomerOrderView, CustomerProfile } from "@cfp/kith-inn-v1-shared";

export type CustomerProfileDeactivationResult = {
  profile: CustomerProfile;
  status: "deactivated" | "failed";
};

export function customerDataJson(
  profiles: CustomerProfile[],
  orders: CustomerOrderView[],
  exportedAt = new Date()
): string {
  return JSON.stringify({
    schemaVersion: 1,
    exportedAt: exportedAt.toISOString(),
    profiles: profiles.filter(({ active }) => active).map(({ displayName, address }) => ({ displayName, address })),
    orders: orders.map((order) => ({
      target: { date: order.target.date, occasion: order.target.occasion },
      menuItems: order.menuItems.map((item) => ({
        nameSnapshot: item.nameSnapshot,
        mainIngredientSnapshot: item.mainIngredientSnapshot,
        categorySnapshot: item.categorySnapshot
      })),
      displayName: order.displayName,
      address: order.address,
      quantity: order.quantity,
      unitPriceCents: order.unitPriceCents,
      totalCents: order.totalCents,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paidAt: order.paidAt,
      deliveryStatus: order.deliveryStatus,
      deliveredAt: order.deliveredAt,
      confirmedAt: order.confirmedAt,
      canceledAt: order.canceledAt
    }))
  }, null, 2);
}

export function copyCustomerData(
  profiles: CustomerProfile[],
  orders: CustomerOrderView[],
  setClipboardData: (options: { data: string }) => Promise<unknown>,
  exportedAt = new Date()
): Promise<unknown> {
  return setClipboardData({ data: customerDataJson(profiles, orders, exportedAt) });
}

export async function deactivateCustomerProfiles(
  profiles: CustomerProfile[],
  deactivate: (id: string | number) => Promise<unknown>
): Promise<CustomerProfileDeactivationResult[]> {
  const results: CustomerProfileDeactivationResult[] = [];
  for (const profile of profiles.filter(({ active }) => active)) {
    try {
      await deactivate(profile.id);
      results.push({ profile, status: "deactivated" });
    } catch {
      results.push({ profile, status: "failed" });
    }
  }
  return results;
}
