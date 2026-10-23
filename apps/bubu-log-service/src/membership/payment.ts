import { AppError } from "../contracts";

/** Future input from trusted server configuration and a persisted server order, never client totals. */
export interface PaymentOrderExpectation {
  babyId: string;
  appId: string;
  merchantId: string;
  merchantOrderId: string;
  /** Integer minor units; no default price, duration or refund policy is supplied here. */
  totalFen: number;
  currency: "CNY";
}
export interface PaymentRefundExpectation {
  order: PaymentOrderExpectation;
  merchantRefundId: string;
  transactionId: string;
  refundFen: number;
}
export type PaymentTarget = { kind: "payment"; order: PaymentOrderExpectation } | { kind: "refund"; refund: PaymentRefundExpectation };
export interface RawPaymentNotification {
  /** Exact received bytes, before JSON parsing or re-serialization. */
  rawBody: Uint8Array;
  headers: Readonly<Record<string, string | undefined>>;
  receivedAt: string;
}
/** @public Future verified provider observations are part of the payment integration contract. */
export type PaymentObservation =
  | { kind: "payment"; state: "NOTPAY" | "SUCCESS" | "CLOSED" | "REFUND"; transactionId: string | null }
  | { kind: "refund"; state: "PROCESSING" | "SUCCESS" | "CLOSED" | "ABNORMAL"; transactionId: string; merchantRefundId: string; refundId: string; refundFen: number };

/**
 * Only a trusted server provider may produce this value after real signature verification,
 * decryption where applicable, and exact merchant/app/order/amount/currency matching.
 * These types are not cryptographic proof: never deserialize client JSON into this contract.
 * Refund notifications bind appId through the original trusted order; they do not carry appId.
 */
export interface VerifiedPaymentEvidence {
  order: PaymentOrderExpectation;
  observation: PaymentObservation;
  verification: {
    signatureVerified: true;
    expectedOrderMatched: true;
    rawBodySha256: string;
    verifiedAt: string;
    keyId: string;
  } & ({ source: "notification"; notificationId: string } | { source: "query"; providerRequestId: string });
}
export interface PaymentCreateInput { order: PaymentOrderExpectation; requestId: string; payerOpenId: string }
export interface PaymentCreationReceipt { merchantOrderId: string; prepayId: string }

/** Future integration only. No enabled provider, signer, network client or order store exists. */
export interface PaymentProvider {
  readonly enabled: boolean;
  /** Retry the same trusted merchant order; do not treat a client success callback as payment evidence. */
  create(input: PaymentCreateInput): Promise<PaymentCreationReceipt>;
  /** Verify raw bytes and trusted key before emitting evidence; reject mismatched targets and signatures. */
  verifyNotification(notification: RawPaymentNotification, expected: PaymentTarget): Promise<VerifiedPaymentEvidence>;
  /** Signed, verified query compensates for lost/delayed callbacks using the original order/refund ID. */
  query(expected: PaymentTarget): Promise<VerifiedPaymentEvidence>;
  /** Submission is not refund completion. Confirmation comes from verified refund query/notification. */
  refund(input: PaymentRefundExpectation & { requestId: string; reason: string }): Promise<{ merchantRefundId: string; state: "submitted" }>;
  /** Query before close; already paid orders require a separately authorized refund, never a local revoke. */
  close(input: { order: PaymentOrderExpectation; requestId: string }): Promise<{ merchantOrderId: string; state: "closed" }>;
}

/**
 * Future consumer must atomically deduplicate notification IDs AND order/refund business keys.
 * Duplicate confirmations do not grant twice; conflicting/older evidence needs a verified query.
 * Payment/refund facts alone never select a price, entitlement duration or revocation policy.
 * @public Future payment integration contract; intentionally has no enabled consumer yet.
 */
export interface PaymentConfirmationConsumer {
  confirm(evidence: VerifiedPaymentEvidence): Promise<{
    outcome: "recorded" | "duplicate" | "needs_reconciliation";
    membershipEffect: "none_until_explicit_policy";
  }>;
}

/** HTTP handlers may use this before reading a body or selecting any future provider. */
export function rejectPayment(): never {
  throw new AppError(409, "PAYMENT_DISABLED", "微信支付尚未启用，当前为限时免费服务。", false);
}

/** Hard closed: environment variables, audience counts and client inputs cannot enable payment. */
export class DisabledPaymentProvider implements PaymentProvider {
  get enabled(): false { return false; }
  async create(_input: PaymentCreateInput): Promise<never> { return rejectPayment(); }
  async verifyNotification(_notification: RawPaymentNotification, _expected: PaymentTarget): Promise<never> { return rejectPayment(); }
  async query(_expected: PaymentTarget): Promise<never> { return rejectPayment(); }
  async refund(_input: PaymentRefundExpectation & { requestId: string; reason: string }): Promise<never> { return rejectPayment(); }
  async close(_input: { order: PaymentOrderExpectation; requestId: string }): Promise<never> { return rejectPayment(); }
}
