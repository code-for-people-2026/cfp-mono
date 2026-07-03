import { describe, expect, it } from "vitest";
import {
  DEFAULT_BE_BASE_URL,
  beBaseUrl,
  chatUrl,
  confirmCustomersUrl,
  deliveryUrl,
  markDeliveredUrl,
  devLoginUrl,
  menuWeekUrl,
  offeringDetailUrl,
  offeringsUrl,
  orderConfirmUrl,
  orderUrl,
  ordersUrl,
  resolveBeBaseUrl,
  wxLoginUrl,
} from "./api";

describe("resolveBeBaseUrl", () => {
  it("falls back to the default when value is missing/blank", () => {
    expect(resolveBeBaseUrl()).toBe(DEFAULT_BE_BASE_URL);
    expect(resolveBeBaseUrl("   ")).toBe(DEFAULT_BE_BASE_URL);
  });

  it("trims whitespace and strips trailing slashes", () => {
    expect(resolveBeBaseUrl("  https://be.example.com//  ")).toBe("https://be.example.com");
  });
});

describe("endpoint builders", () => {
  it("build against BE_BASE_URL when set", () => {
    const orig = process.env.BE_BASE_URL;
    process.env.BE_BASE_URL = "https://be.example.com/";
    try {
      expect(beBaseUrl()).toBe("https://be.example.com");
      expect(wxLoginUrl()).toBe("https://be.example.com/auth/wx-login");
      expect(devLoginUrl()).toBe("https://be.example.com/auth/dev-login");
      expect(offeringsUrl()).toBe("https://be.example.com/offerings");
      expect(offeringDetailUrl(14)).toBe("https://be.example.com/offerings/14");
      expect(menuWeekUrl()).toBe("https://be.example.com/menu/week");
      expect(ordersUrl()).toBe("https://be.example.com/orders");
      expect(orderUrl(9)).toBe("https://be.example.com/orders/9");
      expect(orderConfirmUrl(9)).toBe("https://be.example.com/orders/9/confirm");
      expect(deliveryUrl()).toBe("https://be.example.com/delivery");
      expect(ordersUrl("2026-06-30")).toBe("https://be.example.com/orders?date=2026-06-30");
      expect(deliveryUrl("2026-06-30")).toBe("https://be.example.com/delivery?date=2026-06-30");
      expect(deliveryUrl("2026-06-30", "dinner")).toBe("https://be.example.com/delivery?date=2026-06-30&occasion=dinner");
      expect(markDeliveredUrl()).toBe("https://be.example.com/delivery/fulfillments");
      expect(chatUrl()).toBe("https://be.example.com/chat");
      expect(confirmCustomersUrl()).toBe("https://be.example.com/chat/confirm-customers");
    } finally {
      process.env.BE_BASE_URL = orig;
    }
  });

  it("fall back to the local default be port", () => {
    const orig = process.env.BE_BASE_URL;
    delete process.env.BE_BASE_URL;
    try {
      expect(offeringsUrl()).toBe(`${DEFAULT_BE_BASE_URL}/offerings`);
    } finally {
      process.env.BE_BASE_URL = orig;
    }
  });
});
