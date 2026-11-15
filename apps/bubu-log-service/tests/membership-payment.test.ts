import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "../src/contracts";
import { DisabledPaymentProvider, rejectPayment, type PaymentOrderExpectation, type PaymentProvider, type PaymentTarget, type RawPaymentNotification } from "../src/membership/payment";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const order: PaymentOrderExpectation = { babyId: "sample-baby", appId: "sample-app", merchantId: "sample-merchant", merchantOrderId: "sample-order", totalFen: 1, currency: "CNY" };
const target: PaymentTarget = { kind: "payment", order };
const refund = { order, transactionId: "sample-transaction", merchantRefundId: "sample-refund", refundFen: 1 };
const notification: RawPaymentNotification = {
  rawBody: new TextEncoder().encode('{"verified":true,"status":"SUCCESS","enabled":true,"userCount":500}'),
  headers: { "wechatpay-signature": "WECHATPAY/SIGNTEST/not-a-signature", "wechatpay-serial": "untrusted-key" },
  receivedAt: "2026-10-23T00:00:00.000Z",
};
const disabled = { status: 409, code: "PAYMENT_DISABLED", retryable: false };

describe("disabled membership payment boundary", () => {
  const operations: [string, (provider: PaymentProvider) => Promise<unknown>][] = [
    ["creation", provider => provider.create({ order, requestId: "sample-create", payerOpenId: "sample-payer" })],
    ["payment notification", provider => provider.verifyNotification(notification, target)],
    ["refund notification", provider => provider.verifyNotification(notification, { kind: "refund", refund })],
    ["payment query", provider => provider.query(target)],
    ["refund query", provider => provider.query({ kind: "refund", refund })],
    ["refund submission", provider => provider.refund({ ...refund, requestId: "sample-refund-request", reason: "isolated contract test" })],
    ["order closure", provider => provider.close({ order, requestId: "sample-close" })],
  ];
  it.each(operations)("rejects %s before making any network call", async (_name, operation) => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must not run"));
    const provider = new DisabledPaymentProvider();
    expect(provider.enabled).toBe(false);
    await expect(operation(provider)).rejects.toMatchObject(disabled);
    expect(network).not.toHaveBeenCalled();
  });

  it("does not activate from environment flags or claimed merchant configuration", async () => {
    vi.stubEnv("BUBU_PAYMENT_ENABLED", "true");
    vi.stubEnv("WECHAT_PAY_ENABLED", "true");
    vi.stubEnv("WECHAT_PAY_MCH_ID", "sample-merchant");
    vi.stubEnv("BUBU_USER_COUNT", "500");
    const provider = new DisabledPaymentProvider();
    expect(Reflect.set(provider, "enabled", true)).toBe(false);
    for (const [, operation] of operations) await expect(operation(provider)).rejects.toMatchObject(disabled);
    expect(provider.enabled).toBe(false);
  });

  it("never reads or treats raw notification fields as verified proof", async () => {
    const notificationBody = vi.fn((): Uint8Array => { throw new Error("untrusted body must not be read"); });
    const raw = { ...notification, get rawBody() { return notificationBody(); } };
    await expect(new DisabledPaymentProvider().verifyNotification(raw, target)).rejects.toMatchObject(disabled);
    expect(notificationBody).not.toHaveBeenCalled();
  });

  it("rejects duplicate attempts consistently without changing the caller's order", async () => {
    const provider = new DisabledPaymentProvider(), before = structuredClone(order);
    await expect(provider.create({ order, requestId: "same-request", payerOpenId: "sample-payer" })).rejects.toMatchObject(disabled);
    await expect(provider.create({ order, requestId: "same-request", payerOpenId: "sample-payer" })).rejects.toMatchObject(disabled);
    expect(order).toEqual(before);
  });

  it("supplies a safe non-retryable HTTP business error", () => {
    expect(rejectPayment).toThrow(AppError);
    expect(rejectPayment).toThrow(expect.objectContaining({ ...disabled, message: "微信支付尚未启用，当前为限时免费服务。" }));
  });
});
