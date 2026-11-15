import type { Payload, PayloadRequest } from "payload";
import { beforeEach, describe, expect, it, vi } from "vitest";

const payloadTransaction = vi.hoisted(() => ({
  createLocalReq: vi.fn(), initTransaction: vi.fn(), commitTransaction: vi.fn(), killTransaction: vi.fn(),
}));
vi.mock("payload", () => payloadTransaction);

import { afterTransactionCommit, transaction } from "./transaction";

describe("operation transaction commit confirmations", () => {
  const payload = {} as Payload;
  const req = { context: {} } as PayloadRequest;
  beforeEach(() => {
    vi.clearAllMocks();
    payloadTransaction.createLocalReq.mockResolvedValue(req);
    payloadTransaction.initTransaction.mockResolvedValue(true);
    payloadTransaction.commitTransaction.mockResolvedValue(undefined);
    payloadTransaction.killTransaction.mockResolvedValue(undefined);
  });

  it("does not run a ledger confirmation when the database transaction rolls back", async () => {
    const confirmation = vi.fn();
    await expect(transaction(payload, async (localReq) => {
      afterTransactionCommit(localReq, confirmation);
      throw new Error("synthetic audit rollback");
    })).rejects.toThrow("synthetic audit rollback");
    expect(payloadTransaction.commitTransaction).not.toHaveBeenCalled();
    expect(payloadTransaction.killTransaction).toHaveBeenCalledOnce();
    expect(confirmation).not.toHaveBeenCalled();
  });

  it("reports a commit-boundary ledger failure without pretending the committed DB rolled back", async () => {
    await expect(transaction(payload, async (localReq) => {
      afterTransactionCommit(localReq, async () => { throw new Error("synthetic ledger confirmation failure"); });
      return "committed";
    })).rejects.toThrow("synthetic ledger confirmation failure");
    expect(payloadTransaction.commitTransaction).toHaveBeenCalledOnce();
    expect(payloadTransaction.killTransaction).not.toHaveBeenCalled();
  });
});
