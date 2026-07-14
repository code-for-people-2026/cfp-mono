import { describe, expect, it } from "vitest";
import { productionBeBaseUrl } from "../../config/production";
import {
  DEFAULT_BE_BASE_URL,
  beBaseUrl,
  chatUrl,
  deliveryUrl,
  markDeliveredUrl,
  devLoginUrl,
  menuWeekUrl,
  menuPlansUrl,
  menuPlansRangeUrl,
  menuGenerateUrl,
  menuPlanSwapUrl,
  menuPlanPublishUrl,
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

  it.each([
    ["missing", undefined],
    ["blank", "   "],
    ["reserved .invalid", "https://api.example.invalid"],
    ["reserved .example", "https://api.example"],
    ["reserved .test", "https://api.example.test"],
    ["reserved example.com", "https://example.com"],
    ["reserved example.net subdomain", "https://api.example.net"],
    ["reserved example.org", "https://example.org"],
    ["http", "http://codeforpeople.cn"],
    ["credentials", "https://user@codeforpeople.cn"],
    ["non-numeric port", "https://codeforpeople.cn:https"],
    ["zero port", "https://codeforpeople.cn:0"],
    ["out-of-range port", "https://codeforpeople.cn:65536"],
    ["IPv4", "https://192.168.1.20"],
    ["IPv6", "https://[::1]"],
    ["localhost", "https://localhost"],
    ["localhost subdomain", "https://api.localhost"],
    ["LAN hostname", "https://be.local"],
    ["LAN-only .lan hostname", "https://api.lan"],
    ["home network special-use hostname", "https://router.home.arpa"],
    ["query", "https://codeforpeople.cn?debug=1"],
    ["fragment", "https://codeforpeople.cn#debug"],
    ["path", "https://codeforpeople.cn/api"],
  ])("rejects %s production URL", (_label, value) => {
    expect(() => productionBeBaseUrl(value)).toThrow("生产 BE_BASE_URL");
  });

  it("accepts and normalizes a legal production HTTPS origin", () => {
    expect(productionBeBaseUrl("  https://codeforpeople.cn///  ")).toBe("https://codeforpeople.cn");
    expect(productionBeBaseUrl("https://codeforpeople.cn:443/")).toBe("https://codeforpeople.cn:443");
  });
});

describe("endpoint builders", () => {
  it("uses the validated production origin and disables dev-login", () => {
    const originalDevBuild = process.env.KITH_INN_DEV_BUILD;
    const originalBaseUrl = process.env.BE_BASE_URL;
    delete process.env.KITH_INN_DEV_BUILD;
    process.env.BE_BASE_URL = "https://codeforpeople.cn/";
    try {
      expect(beBaseUrl()).toBe("https://codeforpeople.cn");
      expect(() => devLoginUrl()).toThrow("生产构建禁用 dev-login");
    } finally {
      if (originalDevBuild === undefined) delete process.env.KITH_INN_DEV_BUILD;
      else process.env.KITH_INN_DEV_BUILD = originalDevBuild;
      process.env.BE_BASE_URL = originalBaseUrl;
    }
  });

  it("build against BE_BASE_URL when set", () => {
    const originalDevBuild = process.env.KITH_INN_DEV_BUILD;
    const orig = process.env.BE_BASE_URL;
    process.env.KITH_INN_DEV_BUILD = "1";
    process.env.BE_BASE_URL = "https://be.example.com/";
    try {
      expect(beBaseUrl()).toBe("https://be.example.com");
      expect(wxLoginUrl()).toBe("https://be.example.com/auth/wx-login");
      expect(devLoginUrl()).toBe("https://be.example.com/auth/dev-login");
      expect(offeringsUrl()).toBe("https://be.example.com/offerings");
      expect(offeringDetailUrl(14)).toBe("https://be.example.com/offerings/14");
      expect(menuWeekUrl()).toBe("https://be.example.com/menu/week");
      expect(menuPlansUrl()).toBe("https://be.example.com/menu/plans");
      expect(menuPlansUrl("2026-07-08")).toBe("https://be.example.com/menu/plans?date=2026-07-08");
      expect(menuPlansRangeUrl("2026-07-06", "2026-07-10")).toBe("https://be.example.com/menu/plans?from=2026-07-06&to=2026-07-10");
      expect(menuGenerateUrl()).toBe("https://be.example.com/menu/generate");
      expect(menuPlanSwapUrl(501)).toBe("https://be.example.com/menu/plans/501/swap");
      expect(menuPlanPublishUrl(501)).toBe("https://be.example.com/menu/plans/501/publish");
      expect(ordersUrl()).toBe("https://be.example.com/orders");
      expect(orderUrl(9)).toBe("https://be.example.com/orders/9");
      expect(orderConfirmUrl(9)).toBe("https://be.example.com/orders/9/confirm");
      expect(deliveryUrl()).toBe("https://be.example.com/delivery");
      expect(ordersUrl("2026-06-30")).toBe("https://be.example.com/orders?date=2026-06-30");
      expect(deliveryUrl("2026-06-30")).toBe("https://be.example.com/delivery?date=2026-06-30");
      expect(deliveryUrl("2026-06-30", "dinner")).toBe("https://be.example.com/delivery?date=2026-06-30&occasion=dinner");
      expect(markDeliveredUrl()).toBe("https://be.example.com/delivery/fulfillments");
      expect(chatUrl()).toBe("https://be.example.com/chat");
    } finally {
      if (originalDevBuild === undefined) delete process.env.KITH_INN_DEV_BUILD;
      else process.env.KITH_INN_DEV_BUILD = originalDevBuild;
      process.env.BE_BASE_URL = orig;
    }
  });

  it("fall back to the local default be port", () => {
    const originalDevBuild = process.env.KITH_INN_DEV_BUILD;
    const orig = process.env.BE_BASE_URL;
    process.env.KITH_INN_DEV_BUILD = "1";
    delete process.env.BE_BASE_URL;
    try {
      expect(offeringsUrl()).toBe(`${DEFAULT_BE_BASE_URL}/offerings`);
    } finally {
      if (originalDevBuild === undefined) delete process.env.KITH_INN_DEV_BUILD;
      else process.env.KITH_INN_DEV_BUILD = originalDevBuild;
      process.env.BE_BASE_URL = orig;
    }
  });
});
