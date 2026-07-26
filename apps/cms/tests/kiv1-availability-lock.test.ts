import type { BasePayload, PayloadRequest } from "payload";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createLocalReq: vi.fn(),
  initTransaction: vi.fn(),
  commitTransaction: vi.fn(),
  killTransaction: vi.fn()
}));

vi.mock("payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("payload")>()),
  ...mocks
}));
vi.mock("@payload-config", () => ({ default: Promise.resolve({}) }));

import { lockSellerDate, withKiv1Transaction } from "../src/lib/kiv1-internal";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createLocalReq.mockResolvedValue({ transactionID: Promise.resolve("tx-1") });
  mocks.initTransaction.mockResolvedValue(true);
});

describe("seller/date availability transaction", () => {
  it("commits successful work and rolls failed work back", async () => {
    const payload = {} as BasePayload;
    await expect(withKiv1Transaction(payload, async () => "ok")).resolves.toBe("ok");
    expect(mocks.commitTransaction).toHaveBeenCalledOnce();
    expect(mocks.killTransaction).not.toHaveBeenCalled();

    await expect(withKiv1Transaction(payload, async () => { throw new Error("boom"); }))
      .rejects.toThrow("boom");
    expect(mocks.killTransaction).toHaveBeenCalledOnce();
  });

  it("takes the seller row lock before the date advisory lock on Postgres", async () => {
    const execute = vi.fn(async () => undefined);
    const transaction = {};
    const payload = {
      db: {
        name: "postgres",
        sessions: { "tx-1": { db: transaction } },
        execute
      }
    } as unknown as BasePayload;
    const req = { transactionID: Promise.resolve("tx-1") } as PayloadRequest;

    await lockSellerDate(payload, req, 7, "2026-07-27");

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({ db: transaction }));
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ db: transaction }));
  });

  it("relies on SQLite's immediate transaction without Postgres SQL", async () => {
    const execute = vi.fn();
    const payload = { db: { name: "sqlite", execute } } as unknown as BasePayload;
    await lockSellerDate(payload, {} as PayloadRequest, 7, "2026-07-27");
    expect(execute).not.toHaveBeenCalled();
  });
});
