import type {
  CustomerBookingBatchView,
  CustomerProfile,
  CustomerReservationInput,
  CustomerReservationResult,
  CustomerSessionResponse
} from "@cfp/kith-inn-v1-shared";

type CustomerLoginApi = {
  customerWxSession: (code: string, batchPublicId: string) => Promise<CustomerSessionResponse>;
  customerDevSession: (openid: string, batchPublicId: string) => Promise<CustomerSessionResponse>;
};

export function bookingBatchPublicId(params: Record<string, unknown>): string | null {
  const raw = Array.isArray(params.batch) ? params.batch[0] : params.batch;
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export function beginCustomerSession(
  platform: "h5" | "weapp",
  batchPublicId: string,
  deps: { api: CustomerLoginApi; wxCode: () => Promise<string>; devOpenid: string }
): Promise<CustomerSessionResponse> {
  return platform === "weapp"
    ? deps.wxCode().then((code) => deps.api.customerWxSession(code, batchPublicId))
    : deps.api.customerDevSession(deps.devOpenid, batchPublicId);
}

export async function loadCustomerBookingState(api: {
  getPublicBookingBatch: (batchPublicId: string) => Promise<CustomerBookingBatchView>;
  listOwnedCustomerProfiles: () => Promise<CustomerProfile[]>;
}, batchPublicId: string): Promise<{ view: CustomerBookingBatchView; profiles: CustomerProfile[] }> {
  const view = await api.getPublicBookingBatch(batchPublicId);
  const profiles = view.slots.some(({ canBook }) => canBook) ? await api.listOwnedCustomerProfiles() : [];
  return { view, profiles };
}

export function formatBookingPrice(cents: number): string {
  return `¥${(cents / 100).toFixed(2)}`;
}

export function bookingUnavailableText(
  reason: CustomerBookingBatchView["slots"][number]["unavailableReason"]
): string {
  if (reason === "booking-batch-closed") return "本批次已关闭，仅供查看；如有疑问请联系桃子";
  if (reason === "meal-slot-closed") return "本餐次已关闭；如需登记请联系桃子";
  if (reason === "order-deadline-passed") return "已过登记截止时间；如需登记请联系桃子";
  return "可登记";
}

export function customerBookingPageNotice(view: CustomerBookingBatchView | null, error: string): string | null {
  if (error) return error;
  if (!view) return "正在加载预订信息…";
  return view.slots.some(({ canBook }) => canBook)
    ? null : "当前批次暂无可登记餐次；已有预订可在“我的预订”查看";
}

export const profileUseText = (sellerName: string) => `用于${sellerName}识别订单和送餐地址`;
export const defaultCustomerProfile = (profiles: CustomerProfile[]) => profiles.length === 1 ? profiles[0]! : null;

export type CustomerBookingForm = {
  profile: CustomerProfile | null;
  createNew: boolean;
  saveAsNew: boolean;
  displayName: string;
  address: string;
  quantities: Record<string, string>;
};

export type CustomerReservationDraft = {
  input: CustomerReservationInput;
  items: Array<{ target: CustomerReservationInput["items"][number]["target"]; quantity: number; unitPriceCents: number }>;
  totalCents: number;
};

export function reservationRefreshError(draft: CustomerReservationDraft,
  view: CustomerBookingBatchView): string | null {
  const slots = new Map(view.slots.map((slot) => [`${slot.date}:${slot.occasion}`, slot]));
  for (const item of draft.items) {
    const slot = slots.get(`${item.target.date}:${item.target.occasion}`);
    if (!slot || !slot.canBook) return "餐次状态已更新，请重新确认";
    if (slot.unitPriceCents !== item.unitPriceCents) return "餐次价格已更新，请重新确认";
  }
  return null;
}

export function buildCustomerReservation(batchPublicId: string, view: CustomerBookingBatchView,
  form: CustomerBookingForm): CustomerReservationDraft | null {
  const displayName = form.displayName.trim();
  const address = form.address.trim();
  const profileChoice = form.createNew || form.saveAsNew
    ? { newProfile: { displayName, address } }
    : form.profile ? { customerProfileId: form.profile.id } : null;
  if (!displayName || !address || !profileChoice) return null;
  const items: CustomerReservationDraft["items"] = [];
  for (const slot of view.slots) {
    if (!slot.canBook) continue;
    const raw = (form.quantities[`${slot.date}:${slot.occasion}`] ?? "").trim();
    if (!raw) continue;
    const quantity = Number(raw);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return null;
    items.push({ target: { date: slot.date, occasion: slot.occasion }, quantity, unitPriceCents: slot.unitPriceCents });
  }
  if (items.length === 0) return null;
  return { input: { batchPublicId, profile: profileChoice, displayName, address,
    items: items.map(({ target, quantity }) => ({ target, quantity, resubmitCanceled: false })) }, items,
  totalCents: items.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0) };
}

export function reservationResultText(result: CustomerReservationResult): string {
  if (result.status === "failed") return `失败：${result.message}`;
  return { created: "登记成功", updated: "已更新", resubmitted: "已重新登记" }[result.status];
}

export function canceledReservationDraft(draft: CustomerReservationDraft, results: CustomerReservationResult[],
  profile: CustomerProfile): CustomerReservationDraft | null {
  const canceled = new Set(results.filter((result) => result.status === "failed" &&
    result.error === "canceled-order-confirmation-required")
    .map(({ target }) => `${target.date}:${target.occasion}`));
  if (canceled.size === 0) return null;
  const matches = ({ target }: { target: { date: string; occasion: string } }) =>
    canceled.has(`${target.date}:${target.occasion}`);
  const items = draft.items.filter(matches);
  return { input: { ...draft.input, profile: { customerProfileId: profile.id },
    items: draft.input.items.filter(matches).map((item) => ({ ...item, resubmitCanceled: true })) }, items,
  totalCents: items.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0) };
}
