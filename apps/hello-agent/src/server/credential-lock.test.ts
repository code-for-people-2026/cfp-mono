import { expect, it, vi } from "vitest";
import { withCredentialExecution, withCredentialLock } from "./credential-lock";

it("撤权登记后阻止替换请求，等所有现有业务结束后自动执行；失败也释放许可", async () => {
  const a = Promise.withResolvers<void>(), b = Promise.withResolvers<void>();
  const first = withCredentialExecution("concurrent", () => a.promise);
  const second = withCredentialExecution("concurrent", () => b.promise);
  const revoke = vi.fn(async () => "revoked");
  const mutation = withCredentialLock("concurrent", revoke);
  try {
    for (let attempt = 0; attempt < 30; attempt++) await expect(withCredentialExecution("concurrent", async () => {})).rejects.toMatchObject({ status: 409 });
    expect(revoke).not.toHaveBeenCalled();
    await expect(withCredentialLock("concurrent", async () => {})).rejects.toMatchObject({ status: 409 });
    a.resolve(); await first;
    expect(revoke).not.toHaveBeenCalled();
    const failed = expect(second).rejects.toThrow("failed"); b.reject(new Error("failed")); await failed;
    await expect(mutation).resolves.toBe("revoked");
    await expect(withCredentialExecution("concurrent", async () => "released")).resolves.toBe("released");
  } finally { a.resolve(); b.resolve(); await Promise.allSettled([first, second, mutation]); }
});
it("凭证变更期间不准入新业务请求，其他身份不受影响", async () => {
  const finish = Promise.withResolvers<void>();
  const mutation = withCredentialLock("changing", () => finish.promise);
  try {
    await expect(withCredentialExecution("changing", async () => {})).rejects.toMatchObject({ status: 409 });
    await expect(withCredentialExecution("other", async () => "ok")).resolves.toBe("ok");
  } finally { finish.resolve(); await mutation; }
  await expect(withCredentialExecution("changing", async () => "ok")).resolves.toBe("ok");
});
it("已准入请求可延长后台流式许可，不能凭已结束的异步上下文继续准入", async () => {
  const start = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>(), late = Promise.withResolvers<void>();
  let background: Promise<void> | undefined, stale: Promise<unknown> | undefined;
  const request = withCredentialExecution("stream", async () => {
    await start.promise;
    background = withCredentialExecution("stream", () => finish.promise);
    stale = late.promise.then(() => withCredentialExecution("stream", async () => "unexpected"));
  });
  const action = vi.fn(async () => {});
  const mutation = withCredentialLock("stream", action);
  try {
    start.resolve(); await request;
    expect(action).not.toHaveBeenCalled();
    const rejected = expect(stale).rejects.toMatchObject({ status: 409 }); late.resolve(); await rejected;
    await expect(withCredentialExecution("stream", async () => {})).rejects.toMatchObject({ status: 409 });
    finish.resolve(); await background; await mutation;
    expect(action).toHaveBeenCalledTimes(1);
  } finally { start.resolve(); finish.resolve(); late.resolve(); await Promise.allSettled([request, background, stale, mutation]); }
});
it("等待中的变更失败后释放排他状态，其他变更可以重试", async () => {
  const finish = Promise.withResolvers<void>();
  const request = withCredentialExecution("failed-writer", () => finish.promise);
  const mutation = withCredentialLock("failed-writer", async () => { throw Error("storage unavailable"); });
  const rejected = expect(mutation).rejects.toThrow("storage unavailable");
  finish.resolve(); await request; await rejected;
  await expect(withCredentialLock("failed-writer", async () => "retried")).resolves.toBe("retried");
});
