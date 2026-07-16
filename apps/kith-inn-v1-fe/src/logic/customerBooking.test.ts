import { describe, expect, it, vi } from "vitest";
import {
  beginCustomerSession,
  bookingBatchPublicId,
  bookingUnavailableText,
  buildCustomerReservation,
  canceledReservationDraft,
  defaultCustomerProfile,
  formatBookingPrice,
  loadCustomerBookingState,
  profileUseText,
  reservationRefreshError,
  reservationResultText
} from "./customerBooking";

const PUBLIC_ID = "72b8b5fc-84d2-4c70-a35b-0a42742fcd11";
const profile = { id: 21, sellerId: 7, displayName: "王阿姨", address: "3A", active: true };
const view = { sellerName: "桃子", title: "一周", status: "open" as const, sharePath: `/pages/booking/index?batch=${PUBLIC_ID}`,
  slots: [{ date: "2026-07-13", occasion: "lunch" as const, menuItems: [], unitPriceCents: 3000,
    orderDeadline: "2026-07-12T01:00:00.000Z", canBook: true, unavailableReason: null },
  { date: "2026-07-14", occasion: "dinner" as const, menuItems: [], unitPriceCents: 2800,
    orderDeadline: "2026-07-13T01:00:00.000Z", canBook: true, unavailableReason: null }] };

describe("customer booking entry logic", () => {
  it("recovers and validates the batch query", () => {
    expect(bookingBatchPublicId({ batch: ` ${PUBLIC_ID} ` })).toBe(PUBLIC_ID);
    expect(bookingBatchPublicId({ batch: [PUBLIC_ID] })).toBe(PUBLIC_ID);
    expect(bookingBatchPublicId({ batch: "bad" })).toBeNull();
    expect(bookingBatchPublicId({})).toBeNull();
  });

  it("uses wx.login only on weapp and dev identity only on H5", async () => {
    const wxSession = {
      token: "wx-token",
      session: { sellerName: "桃子", role: "customer" as const, expiresAt: "2027-01-01T00:00:00.000Z" }
    };
    const devSession = { ...wxSession, token: "dev-token" };
    const api = {
      customerWxSession: vi.fn(async () => wxSession),
      customerDevSession: vi.fn(async () => devSession)
    };
    const wxCode = vi.fn(async () => "one-time-code");
    await expect(beginCustomerSession("weapp", PUBLIC_ID, { api, wxCode, devOpenid: "dev" }))
      .resolves.toBe(wxSession);
    expect(api.customerWxSession).toHaveBeenCalledWith("one-time-code", PUBLIC_ID);
    await expect(beginCustomerSession("h5", PUBLIC_ID, { api, wxCode, devOpenid: "dev" }))
      .resolves.toBe(devSession);
    expect(api.customerDevSession).toHaveBeenCalledWith("dev", PUBLIC_ID);
    expect(wxCode).toHaveBeenCalledOnce();
  });

  it("derives concise read-only labels", () => {
    expect(formatBookingPrice(3000)).toBe("¥30.00");
    expect(bookingUnavailableText(null)).toBe("可登记");
    expect(bookingUnavailableText("booking-batch-closed")).toBe("本批次已关闭，仅供查看");
    expect(bookingUnavailableText("meal-slot-closed")).toBe("本餐次已关闭");
    expect(bookingUnavailableText("order-deadline-passed")).toBe("已过登记截止时间");
  });

  it("defaults exactly one profile and explains its narrow purpose", () => {
    expect(profileUseText("桃子")).toBe("用于桃子识别订单和送餐地址");
    expect(defaultCustomerProfile([])).toBeNull();
    expect(defaultCustomerProfile([profile])).toBe(profile);
    expect(defaultCustomerProfile([profile, { ...profile, id: 22 }])).toBeNull();
  });

  it("builds a public-target summary for existing and newly saved profiles", () => {
    const form = { profile, createNew: false, saveAsNew: false, displayName: " 王阿姨 ", address: " 3A ",
      quantities: { "2026-07-13:lunch": "2", "2026-07-14:dinner": "1" } };
    const draft = buildCustomerReservation(PUBLIC_ID, view, form)!;
    expect(draft.input).toEqual({ batchPublicId: PUBLIC_ID, profile: { customerProfileId: 21 }, displayName: "王阿姨",
      address: "3A", items: [{ target: { date: "2026-07-13", occasion: "lunch" }, quantity: 2,
        resubmitCanceled: false }, { target: { date: "2026-07-14", occasion: "dinner" }, quantity: 1,
        resubmitCanceled: false }] });
    expect(draft.totalCents).toBe(8800);
    expect(buildCustomerReservation(PUBLIC_ID, view, { ...form, saveAsNew: true })!.input.profile)
      .toEqual({ newProfile: { displayName: "王阿姨", address: "3A" } });
    expect(buildCustomerReservation(PUBLIC_ID, view, { ...form, profile: null, createNew: true })!.input.profile)
      .toEqual({ newProfile: { displayName: "王阿姨", address: "3A" } });
  });

  it("rechecks availability and skips profile loading for read-only batches", async () => {
    const draft = buildCustomerReservation(PUBLIC_ID, view, { profile, createNew: false, saveAsNew: false,
      displayName: "王阿姨", address: "3A", quantities: { "2026-07-13:lunch": "1" } })!;
    expect(reservationRefreshError(draft, view)).toBeNull();
    expect(reservationRefreshError(draft, { ...view, slots: [{ ...view.slots[0]!, unitPriceCents: 3100 }] }))
      .toBe("餐次价格已更新，请重新确认");
    expect(reservationRefreshError(draft, { ...view, slots: [{ ...view.slots[0]!, canBook: false,
      unavailableReason: "meal-slot-closed" as const }] })).toBe("餐次状态已更新，请重新确认");
    expect(reservationRefreshError(draft, { ...view, slots: [] })).toBe("餐次状态已更新，请重新确认");
    const api = { getPublicBookingBatch: vi.fn(async () => ({ ...view, status: "closed" as const,
      slots: view.slots.map((slot) => ({ ...slot, canBook: false as const,
        unavailableReason: "booking-batch-closed" as const })) })), listOwnedCustomerProfiles: vi.fn(async () => [profile]) };
    await expect(loadCustomerBookingState(api, PUBLIC_ID)).resolves.toMatchObject({ profiles: [] });
    expect(api.listOwnedCustomerProfiles).not.toHaveBeenCalled();
    await expect(loadCustomerBookingState({ ...api, getPublicBookingBatch: vi.fn(async () => view) }, PUBLIC_ID))
      .resolves.toMatchObject({ profiles: [profile] });
    expect(api.listOwnedCustomerProfiles).toHaveBeenCalledOnce();
  });

  it("rejects incomplete forms and labels every partial result", () => {
    const base = { profile, createNew: false, saveAsNew: false, displayName: "王", address: "3A", quantities: {} };
    expect(buildCustomerReservation(PUBLIC_ID, view, base)).toBeNull();
    expect(buildCustomerReservation(PUBLIC_ID, view, { ...base, profile: null })).toBeNull();
    expect(buildCustomerReservation(PUBLIC_ID, view, { ...base, createNew: true, address: "" })).toBeNull();
    expect(buildCustomerReservation(PUBLIC_ID, view, { ...base, quantities: { "2026-07-13:lunch": "1.5" } })).toBeNull();
    expect(buildCustomerReservation(PUBLIC_ID, { ...view, slots: [{ ...view.slots[0]!, canBook: false,
      unavailableReason: "meal-slot-closed" as const }] }, { ...base, quantities: { "2026-07-13:lunch": "1" } })).toBeNull();
    expect(buildCustomerReservation(PUBLIC_ID, { ...view, slots: [{ ...view.slots[0]!, canBook: false,
      unavailableReason: "meal-slot-closed" as const }, view.slots[1]!] },
    { ...base, quantities: { "2026-07-13:lunch": "1", "2026-07-14:dinner": "2" } })?.items)
      .toEqual([{ target: { date: "2026-07-14", occasion: "dinner" }, quantity: 2, unitPriceCents: 2800 }]);
    for (const [status, expected] of [["created", "登记成功"], ["updated", "已更新"], ["resubmitted", "已重新登记"]] as const)
      expect(reservationResultText({ target: { date: "2026-07-13", occasion: "lunch" }, status, doc: {} } as never)).toBe(expected);
    expect(reservationResultText({ target: { date: "2026-07-14", occasion: "dinner" }, status: "failed",
      error: "meal-slot-closed", message: "本餐次已关闭" })).toBe("失败：本餐次已关闭");
    expect(canceledReservationDraft(buildCustomerReservation(PUBLIC_ID, view,
      { ...base, quantities: { "2026-07-13:lunch": "1" } })!, [], profile)).toBeNull();
    expect(canceledReservationDraft(buildCustomerReservation(PUBLIC_ID, view,
      { ...base, quantities: { "2026-07-13:lunch": "1" } })!, [{ target: { date: "2026-07-13", occasion: "lunch" },
      status: "failed", error: "canceled-order-confirmation-required", message: "需确认" }], profile)?.input)
      .toMatchObject({ profile: { customerProfileId: 21 }, items: [{ resubmitCanceled: true }] });
  });
});
