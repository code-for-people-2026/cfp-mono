import { describe, expect, it, vi } from "vitest";
import { createRecoverableSubmitController } from "./recoverable-submit";

type Result = { id: string; state: "completed" | "running" | "failed" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((callbackResolve) => {
    resolve = callbackResolve;
  });
  return { promise, resolve };
}

function setup(options?: { status?: Result | undefined }) {
  const ids = ["id-1", "id-2", "id-3"];
  const send = vi.fn(async (_submission: { requestId: string; request: string }) =>
    ({ id: "result", state: "completed" }) as Result,
  );
  const lookup = vi.fn(async () => options?.status);
  const controller = createRecoverableSubmitController<number, string, Result>({
    createRequestId: () => ids.shift() || "id-new",
    fingerprint: (request) => request,
    lookup,
    classify: (result) =>
      result === undefined
        ? "missing"
        : result.state === "completed"
          ? "completed"
          : result.state,
    send,
  });
  return { controller, send, lookup, ids };
}

describe("recoverable submit controller", () => {
  it("denies a duplicate submission while the first request is in flight", async () => {
    const { controller, send } = setup();
    let finishSend: ((value: Result) => void) | undefined;
    send.mockImplementation(
      () =>
        new Promise<Result>((resolve) => {
          finishSend = resolve;
        }),
    );
    const first = controller.submit(1, "same");
    const second = await controller.submit(1, "same");
    expect(second).toEqual({ type: "busy" });
    expect(send).toHaveBeenCalledTimes(1);
    finishSend!({ id: "result", state: "completed" });
    await expect(first).resolves.toEqual({
      type: "completed",
      result: { id: "result", state: "completed" },
      recovered: false,
    });
    expect(controller.hasPending(1)).toBe(false);
  });

  it("queries an ambiguous pending request and reuses its id when it is missing", async () => {
    const { controller, send, lookup } = setup();
    send.mockRejectedValueOnce(new Error("network lost"));
    const first = await controller.submit(1, "same");
    expect(first).toMatchObject({ type: "failed", confirmedFailed: false });
    expect(controller.pendingFor(1)).toMatchObject({ requestId: "id-1" });
    await controller.submit(1, "same");
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].requestId).toBe("id-1");
    expect(send.mock.calls[1][0].requestId).toBe("id-1");
  });

  it("creates a new id only after the server explicitly reports failure", async () => {
    const failed = { id: "failed", state: "failed" } as Result;
    const { controller, send } = setup({ status: failed });
    send.mockRejectedValueOnce(new Error("request failed"));
    const first = await controller.submit(1, "same");
    expect(first).toMatchObject({ type: "failed", confirmedFailed: true });
    expect(controller.hasPending(1)).toBe(false);
    await controller.submit(1, "same");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0].requestId).toBe("id-1");
    expect(send.mock.calls[1][0].requestId).toBe("id-2");
  });

  it("retires an unknown request after a later failed lookup and creates one new id", async () => {
    const { controller, send, lookup } = setup();
    send.mockRejectedValueOnce(new Error("response unknown"));
    await controller.submit(1, "same");
    expect(controller.pendingFor(1)?.requestId).toBe("id-1");

    lookup.mockResolvedValueOnce({ id: "failed", state: "failed" });
    await controller.submit(1, "same");

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0].requestId).toBe("id-2");
    expect(controller.hasPending(1)).toBe(false);
  });

  it.each(["running", "failed"] as const)(
    "does not accept a fulfilled send result classified as %s",
    async (state) => {
      const { controller, send } = setup();
      send.mockResolvedValueOnce({ id: "not-complete", state });
      await expect(controller.submit(1, "same")).resolves.toMatchObject({
        type: "failed",
        confirmedFailed: state === "failed",
        running: state === "running",
      });
      expect(controller.hasPending(1)).toBe(state === "running");
    },
  );

  it("checks again before retry and never starts a second send while running", async () => {
    const running = { id: "running", state: "running" } as Result;
    const { controller, send, lookup } = setup({ status: running });
    send.mockRejectedValueOnce(new Error("response lost"));
    await controller.submit(1, "same");
    const retry = await controller.submit(1, "same");
    expect(retry).toMatchObject({ type: "failed", running: true });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(1);
    expect(controller.pendingFor(1)?.requestId).toBe("id-1");
  });

  it("recovers a completed result after the send response is lost", async () => {
    const completed = { id: "saved", state: "completed" } as Result;
    const { controller, send } = setup({ status: completed });
    send.mockRejectedValueOnce(new Error("response lost"));
    await expect(controller.submit(1, "same")).resolves.toEqual({
      type: "completed",
      result: completed,
      recovered: true,
    });
    expect(controller.hasPending()).toBe(false);
    await expect(controller.check(1)).resolves.toEqual({ type: "missing" });
  });

  it("invalidates an old completion after scope reset", async () => {
    const { controller, send } = setup();
    let finishSend: ((value: Result) => void) | undefined;
    send.mockImplementation(
      () =>
        new Promise<Result>((resolve) => {
          finishSend = resolve;
        }),
    );
    const submission = controller.submit(1, "old");
    controller.reset();
    finishSend!({ id: "old-result", state: "completed" });
    await expect(submission).resolves.toEqual({ type: "stale" });
    expect(controller.hasPending()).toBe(false);
  });

  it("lets a reset scope submit while an old send is still unresolved", async () => {
    const { controller, send } = setup();
    const gates = [deferred<Result>(), deferred<Result>()];
    send.mockImplementation(() => gates[send.mock.calls.length - 1]!.promise);

    const oldSubmission = controller.submit(1, "old");
    controller.reset();
    const newSubmission = controller.submit(1, "new");
    const duplicateNew = await controller.submit(1, "new");

    expect(duplicateNew).toEqual({ type: "busy" });
    gates[0]!.resolve({ id: "old-result", state: "completed" });
    await expect(oldSubmission).resolves.toEqual({ type: "stale" });
    expect(controller.hasPending(1)).toBe(true);
    expect(await controller.submit(1, "new")).toEqual({ type: "busy" });
    gates[1]!.resolve({ id: "new-result", state: "completed" });
    await expect(newSubmission).resolves.toEqual({
      type: "completed",
      result: { id: "new-result", state: "completed" },
      recovered: false,
    });
  });

  it("keeps a newer lookup/send lock isolated from an unresolved old lookup", async () => {
    const { controller, send, lookup } = setup();
    const oldLookup = deferred<Result | undefined>();
    const newSend = deferred<Result>();
    send.mockRejectedValueOnce(new Error("old response unknown"));
    lookup.mockResolvedValueOnce(undefined);
    await controller.submit(1, "old");
    expect(controller.hasPending(1)).toBe(true);

    lookup.mockReturnValueOnce(oldLookup.promise);
    const oldRetry = controller.submit(1, "old");
    controller.reset();
    send.mockImplementation(() => newSend.promise);
    const newSubmission = controller.submit(2, "new");
    const duplicateNew = await controller.submit(2, "new");
    expect(duplicateNew).toEqual({ type: "busy" });

    oldLookup.resolve({ id: "old-completed", state: "completed" });
    await expect(oldRetry).resolves.toEqual({ type: "stale" });
    expect(controller.hasPending(2)).toBe(true);
    expect(await controller.submit(2, "new")).toEqual({ type: "busy" });

    newSend.resolve({ id: "new-completed", state: "completed" });
    await expect(newSubmission).resolves.toMatchObject({
      type: "completed",
      result: { id: "new-completed" },
    });
  });
});
