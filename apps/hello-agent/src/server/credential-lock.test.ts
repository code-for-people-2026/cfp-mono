import { expect, it } from "vitest";
import { withCredentialExecution, withCredentialLock } from "./credential-lock";

it("同身份多个业务请求可并发，全部完成前不能撤销；失败释放执行许可", async () => {
  const a = Promise.withResolvers<void>(), b = Promise.withResolvers<void>();
  const first = withCredentialExecution("concurrent", () => a.promise);
  const second = withCredentialExecution("concurrent", () => b.promise);
  try {
    await expect(withCredentialLock("concurrent", async () => {})).rejects.toMatchObject({ status: 409 });
    a.resolve(); await first;
    await expect(withCredentialLock("concurrent", async () => {})).rejects.toMatchObject({ status: 409 });
    const failed = expect(second).rejects.toThrow("failed"); b.reject(new Error("failed")); await failed;
    await expect(withCredentialLock("concurrent", async () => "released")).resolves.toBe("released");
  } finally { a.resolve(); b.resolve(); await Promise.allSettled([first, second]); }
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
