import type { CardPayload } from "@cfp/kith-inn-shared";
import { describe, expect, it } from "vitest";
import {
  CUSTOMER_CONFIRM_ACTION_LABEL,
  CUSTOMER_CONFIRM_STALE_TEXT,
  getCustomerConfirmActionState,
  type ChatCardMessage,
} from "./chatCards";

const confirmCard: CardPayload = {
  type: "customer-confirm",
  data: { items: [{ customerName: "大龙猫", quantity: 1, occasion: "lunch" }] },
};

const msg = (over: Partial<ChatCardMessage>): ChatCardMessage => ({
  role: "assistant",
  content: "看卡",
  ...over,
});

describe("getCustomerConfirmActionState", () => {
  it("marks restored historical customer-confirm cards as stale/read-only", () => {
    const messages = [msg({ card: confirmCard, fromHistory: true })];
    expect(getCustomerConfirmActionState(messages, 0, new Set())).toEqual({
      status: "stale",
      label: CUSTOMER_CONFIRM_ACTION_LABEL,
      message: CUSTOMER_CONFIRM_STALE_TEXT,
    });
  });

  it("only keeps the latest current-session customer-confirm card active", () => {
    const messages = [msg({ card: confirmCard }), msg({ card: confirmCard })];
    expect(getCustomerConfirmActionState(messages, 0, new Set())).toMatchObject({ status: "stale" });
    expect(getCustomerConfirmActionState(messages, 1, new Set())).toEqual({
      status: "active",
      label: CUSTOMER_CONFIRM_ACTION_LABEL,
    });
  });

  it("ignores later text-only assistant messages when finding the active confirm card", () => {
    const messages = [msg({ card: confirmCard }), msg({ content: "普通回复" })];
    expect(getCustomerConfirmActionState(messages, 0, new Set())).toEqual({
      status: "active",
      label: CUSTOMER_CONFIRM_ACTION_LABEL,
    });
  });

  it("keeps an already acted card in confirmed state", () => {
    const messages = [msg({ card: confirmCard })];
    expect(getCustomerConfirmActionState(messages, 0, new Set([0]))).toEqual({
      status: "confirmed",
      label: CUSTOMER_CONFIRM_ACTION_LABEL,
      message: "已建",
    });
  });

  it("does not create action state for text-only or non-customer cards", () => {
    const orders: CardPayload = { type: "orders", data: { orders: [], date: "2026-07-02" } };
    expect(getCustomerConfirmActionState([msg({})], 0, new Set())).toBeNull();
    expect(getCustomerConfirmActionState([msg({ card: orders })], 0, new Set())).toBeNull();
  });
});
