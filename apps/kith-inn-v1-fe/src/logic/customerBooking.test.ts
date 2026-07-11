import { describe, expect, it, vi } from "vitest";
import {
  beginCustomerSession,
  bookingBatchPublicId,
  bookingUnavailableText,
  formatBookingPrice
} from "./customerBooking";

const PUBLIC_ID = "72b8b5fc-84d2-4c70-a35b-0a42742fcd11";

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
});
