import { describe, expect, it } from "vitest";
import { createDemoPayload } from "./miniapp-demo";

describe("createDemoPayload", () => {
  it("returns the miniapp demo API payload", () => {
    expect(createDemoPayload()).toEqual({
      message: "码成工 API 已连接",
      source: "payload-site-api"
    });
  });
});

