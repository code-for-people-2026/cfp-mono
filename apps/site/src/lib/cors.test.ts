import { afterEach, describe, expect, it } from "vitest";
import { createCorsHeaders, getAllowedMiniappOrigin } from "./cors";

describe("cors helpers", () => {
  const previousOrigin = process.env.MINIAPP_H5_ORIGIN;

  afterEach(() => {
    process.env.MINIAPP_H5_ORIGIN = previousOrigin;
  });

  it("uses the configured miniapp H5 origin", () => {
    process.env.MINIAPP_H5_ORIGIN = "https://miniapp.codeforpeople.cn";

    expect(getAllowedMiniappOrigin()).toBe("https://miniapp.codeforpeople.cn");
    expect(createCorsHeaders("https://miniapp.codeforpeople.cn")).toMatchObject({
      "Access-Control-Allow-Origin": "https://miniapp.codeforpeople.cn"
    });
  });

  it("falls back to the allowed origin when request origin is missing", () => {
    process.env.MINIAPP_H5_ORIGIN = "https://miniapp.codeforpeople.cn";

    expect(createCorsHeaders(null)).toMatchObject({
      "Access-Control-Allow-Origin": "https://miniapp.codeforpeople.cn"
    });
  });

  it("uses the local miniapp H5 origin by default", () => {
    delete process.env.MINIAPP_H5_ORIGIN;

    expect(getAllowedMiniappOrigin()).toBe("http://localhost:3301");
  });
});
