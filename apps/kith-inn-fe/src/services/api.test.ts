import { describe, expect, it } from "vitest";
import {
  DEFAULT_BE_BASE_URL,
  beBaseUrl,
  deliveryUrl,
  devLoginUrl,
  menuWeekUrl,
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
      expect(menuWeekUrl()).toBe("https://be.example.com/menu/week");
      expect(ordersUrl()).toBe("https://be.example.com/orders");
      expect(orderUrl(9)).toBe("https://be.example.com/orders/9");
      expect(orderConfirmUrl(9)).toBe("https://be.example.com/orders/9/confirm");
      expect(deliveryUrl()).toBe("https://be.example.com/delivery");
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
