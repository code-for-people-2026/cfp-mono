import { describe, expect, it } from "vitest";
import { ReconciliationError, buildIncrementPreview, buildSnapshotPreview, fingerprintActiveOrders, type ReconciliationOrder } from "./reconciliation";

const scope = [{ date: "2026-07-13", occasion: "lunch" as const }];
const customers = [
  { id: 12, displayName: "王阿姨" },
  { id: 13, displayName: "李叔叔" },
  { id: 14, displayName: "陈老师" },
];
const item = (id: number, quantity: number, offering = 9) => ({ id, offering, quantity, unitPriceCents: 3000 });
const order = (over: Partial<ReconciliationOrder> & Pick<ReconciliationOrder, "id" | "customer">): ReconciliationOrder => ({
  date: "2026-07-13",
  occasion: "lunch",
  status: "draft",
  paymentStatus: "unpaid",
  updatedAt: "2026-07-12T08:00:00.000Z",
  items: [item(Number(over.id) + 100, 1)],
  ...over,
});

describe("snapshot reconciliation preview", () => {
  it("computes create, update, cancel and unchanged across every active order", () => {
    const orders = [
      order({ id: 1, customer: customers[0]!, items: [item(101, 1)] }),
      order({ id: 2, customer: customers[1]!, items: [item(102, 2)] }),
      order({ id: 3, customer: customers[2]!, status: "confirmed", fulfillmentStatus: "pending", items: [item(103, 1)] }),
      order({ id: 99, customer: customers[0]!, date: "2026-07-14" }),
    ];
    const preview = buildSnapshotPreview({
      scope,
      items: [
        { customerName: " 王阿姨 ", date: "2026-07-13", occasion: "lunch", quantity: 3 },
        { customerName: "李叔叔", date: "2026-07-13", occasion: "lunch", quantity: 2 },
        { customerName: "新街坊", date: "2026-07-13", occasion: "lunch", quantity: 1 },
      ],
      customers,
      offering: 9,
      unitPriceCents: 3000,
      orders,
      operationKey: "op-1",
    });

    expect(preview.candidates).toEqual([
      expect.objectContaining({ customer: 12, quantity: 3, totalCents: 9000 }),
      expect.objectContaining({ customer: 13, quantity: 2, totalCents: 6000 }),
      expect.objectContaining({ newCustomer: { displayName: "新街坊" }, quantity: 1, totalCents: 3000 }),
    ]);
    expect(preview.rows).toEqual([
      expect.objectContaining({ kind: "update", customerName: "王阿姨", beforeQuantity: 1, afterQuantity: 3 }),
      expect.objectContaining({ kind: "unchanged", customerName: "李叔叔", beforeQuantity: 2, afterQuantity: 2 }),
      expect.objectContaining({ kind: "create", customerName: "新街坊", afterQuantity: 1 }),
      expect.objectContaining({ kind: "cancel", customerName: "陈老师", beforeQuantity: 1, afterQuantity: 0, affectsConfirmed: true }),
    ]);
    expect(preview.expectedFingerprint).toBe(fingerprintActiveOrders(orders.slice(0, 3)));
  });

  it("normalizes customer names and marks confirmed updates", () => {
    const preview = buildSnapshotPreview({
      scope,
      items: [{ customerName: "  WANG   AYi ", date: "2026-07-13", occasion: "lunch", quantity: 2 }],
      customers: [{ id: 12, displayName: "Wang AYi" }],
      offering: 9,
      unitPriceCents: 3000,
      orders: [order({ id: 1, customer: { id: 12, displayName: "Wang AYi" }, status: "confirmed", fulfillmentStatus: "pending" })],
      operationKey: "op-2",
    });
    expect(preview.rows[0]).toMatchObject({ kind: "update", affectsConfirmed: true, orderStatus: "confirmed" });
  });

  it("uses an order-independent fingerprint that changes with tracked state", () => {
    const first = order({ id: 1, customer: customers[0]!, items: [item(202, 2), item(201, 1)] });
    const second = order({ id: 2, customer: customers[1]! });
    expect(fingerprintActiveOrders([first, second])).toBe(fingerprintActiveOrders([second, { ...first, items: [...first.items].reverse() }]));
    expect(fingerprintActiveOrders([first])).not.toBe(fingerprintActiveOrders([{ ...first, paymentStatus: "paid" }]));
    expect(fingerprintActiveOrders([{ ...first, customer: 12 }])).toBe(fingerprintActiveOrders([first]));
  });

  it("allows an explicitly confirmed empty snapshot but blocks a suspicious empty parse", () => {
    const input = { scope, items: [], customers, offering: 9, unitPriceCents: 3000, orders: [order({ id: 1, customer: customers[0]! })], operationKey: "op-clear" };
    expect(() => buildSnapshotPreview(input)).toThrowError(expect.objectContaining({ code: "empty-snapshot" }));
    expect(buildSnapshotPreview({ ...input, allowEmptySnapshot: true }).rows[0]).toMatchObject({ kind: "cancel", afterQuantity: 0 });
  });

  it.each([
    ["已付款", { paymentStatus: "paid", fulfillmentStatus: "pending" }],
    ["已送达", { paymentStatus: "unpaid", fulfillmentStatus: "done" }],
  ])("blocks automatic changes to %s confirmed orders", (_label, sideEffects) => {
    const current = order({ id: 1, customer: customers[0]!, status: "confirmed", ...sideEffects });
    const input = { scope, customers, offering: 9, unitPriceCents: 3000, orders: [current], operationKey: "op-settled" };
    const update = [{ customerName: "王阿姨", date: "2026-07-13", occasion: "lunch" as const, quantity: 2 }];

    expect(() => buildSnapshotPreview({ ...input, items: update })).toThrowError(expect.objectContaining({ code: "settled-order" }));
    expect(() => buildSnapshotPreview({ ...input, items: [], allowEmptySnapshot: true })).toThrowError(expect.objectContaining({ code: "settled-order" }));
  });

  it("preserves a settled order's historical price when product and quantity are unchanged", () => {
    const current = order({
      id: 1,
      customer: customers[0]!,
      status: "confirmed",
      paymentStatus: "paid",
      fulfillmentStatus: "pending",
      items: [{ ...item(101, 1), unitPriceCents: 2500 }],
    });
    const preview = buildSnapshotPreview({
      scope,
      items: [{ customerName: "王阿姨", date: "2026-07-13", occasion: "lunch", quantity: 1 }],
      customers,
      offering: 9,
      unitPriceCents: 3000,
      orders: [current],
      operationKey: "op-old-price",
    });

    expect(preview.rows).toEqual([expect.objectContaining({ kind: "unchanged" })]);
    expect(preview.candidates).toEqual([expect.objectContaining({ unitPriceCents: 2500, totalCents: 2500 })]);
  });

  it("fails closed on duplicate coordinates, ambiguous names, bad scope and inconsistent active orders", () => {
    const base = { scope, customers, offering: 9, unitPriceCents: 3000, orders: [], operationKey: "op-bad" };
    const one = { customerName: "王阿姨", date: "2026-07-13", occasion: "lunch" as const, quantity: 1 };
    expect(() => buildSnapshotPreview({ ...base, items: [one, one] })).toThrowError(expect.objectContaining({ code: "duplicate-coordinate" }));
    expect(() => buildSnapshotPreview({ ...base, customers: [...customers, { id: 15, displayName: " 王阿姨 " }], items: [one] })).toThrowError(expect.objectContaining({ code: "ambiguous-customer" }));
    expect(() => buildSnapshotPreview({ ...base, items: [{ ...one, date: "2026-07-14" }] })).toThrowError(expect.objectContaining({ code: "outside-scope" }));
    expect(() => buildSnapshotPreview({ ...base, items: [one], orders: [order({ id: 1, customer: customers[0]!, items: [] })] })).toThrowError(expect.objectContaining({ code: "inconsistent-order" }));
    expect(() => buildSnapshotPreview({ ...base, scope: [scope[0]!, scope[0]!], items: [one] })).toThrowError(expect.objectContaining({ code: "duplicate-scope" }));
    expect(() => buildSnapshotPreview({ ...base, items: [{ ...one, quantity: 0 }] })).toThrowError(expect.objectContaining({ code: "invalid-quantity" }));
    expect(new ReconciliationError("empty-snapshot", "x").name).toBe("ReconciliationError");
  });
});

describe("increment reconciliation preview", () => {
  const base = { scope, customers, offering: 9, unitPriceCents: 3000, operationKey: "op-increment" };

  it("creates a missing coordinate and explains add from zero", () => {
    const preview = buildIncrementPreview({
      ...base,
      operation: "add",
      items: [{ customerName: "新街坊", date: "2026-07-13", occasion: "lunch", quantity: 2 }],
      orders: [order({ id: 2, customer: customers[1]!, items: [item(102, 4)] })],
    });

    expect(preview).toMatchObject({
      mode: "increment",
      operation: "add",
      candidates: [{ newCustomer: { displayName: "新街坊" }, quantity: 2, totalCents: 6000 }],
      rows: [{ kind: "create", beforeQuantity: 0, changeQuantity: 2, afterQuantity: 2, affectsConfirmed: false }],
    });
    expect(preview.expectedFingerprint).toBe(fingerprintActiveOrders([]));
  });

  it("distinguishes add from set without rendering another same-day order", () => {
    const target = order({ id: 1, customer: customers[0]!, status: "confirmed", fulfillmentStatus: "pending", items: [item(101, 1)] });
    const other = order({ id: 2, customer: customers[1]!, items: [item(102, 4)] });
    const input = {
      ...base,
      items: [{ customerName: "王阿姨", date: "2026-07-13", occasion: "lunch" as const, quantity: 2 }],
      orders: [target, other],
    };

    expect(buildIncrementPreview({ ...input, operation: "add" }).rows).toEqual([
      expect.objectContaining({ kind: "add", beforeQuantity: 1, changeQuantity: 2, afterQuantity: 3, affectsConfirmed: true }),
    ]);
    expect(buildIncrementPreview({ ...input, operation: "set" }).rows).toEqual([
      expect.objectContaining({ kind: "set", beforeQuantity: 1, afterQuantity: 2, affectsConfirmed: true }),
    ]);
    expect(buildIncrementPreview({ ...input, operation: "add" }).expectedFingerprint).toBe(fingerprintActiveOrders([target]));
  });
});
