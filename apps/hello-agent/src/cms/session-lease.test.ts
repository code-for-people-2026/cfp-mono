import { afterEach, expect, it, vi } from "vitest";
import { assertSessionLease, holdSessionLease, SESSION_LEASE_MS } from "./session-lease";

afterEach(() => vi.useRealTimers());

function store() {
  let nextId = 0;
  let row: { id: number; expiresAt: number } | undefined;
  let failRenewal = false;
  let beforeRenew: (() => Promise<void>) | undefined;
  return {
    failRenewal: () => { failRenewal = true; },
    pauseRenewal: (wait: () => Promise<void>) => { beforeRenew = wait; },
    acquire() {
      if (row && row.expiresAt > Date.now()) throw new Error("session busy");
      const id = ++nextId;
      row = { id, expiresAt: Date.now() + SESSION_LEASE_MS };
      return holdSessionLease({ owner: "owner", id, createdAt: new Date().toISOString(), expiresAt: row.expiresAt,
        renew: async (now, expiresAt) => {
          await beforeRenew?.();
          if (failRenewal) throw new Error("database unavailable");
          if (!row || row.id !== id || row.expiresAt <= now) return false;
          row.expiresAt = expiresAt;
          return true;
        },
        release: async () => { if (row?.id === id) row = undefined; },
      });
    },
  };
}

it("输入审核与生图累计超过原三分钟期限时仍拒绝第二轮，完成后立即准入", async () => {
  vi.useFakeTimers();
  const database = store();
  const first = database.acquire();
  const generation = Promise.withResolvers<void>();
  const work = first.run(async () => {
    await generation.promise;
    assertSessionLease("owner");
    return "saved";
  });
  await vi.advanceTimersByTimeAsync(210_000);
  expect(first.signal.aborted).toBe(false);
  expect(() => database.acquire()).toThrow("session busy");
  generation.resolve();
  await expect(work).resolves.toBe("saved");
  await first();
  const second = database.acquire();
  await second();
  expect(vi.getTimerCount()).toBe(0);
});

it("续租失败取消当前执行，迟到的模型结果不能继续写入", async () => {
  vi.useFakeTimers();
  const database = store();
  const lease = database.acquire();
  const response = Promise.withResolvers<void>();
  const save = vi.fn();
  const work = lease.run(async () => { await response.promise; assertSessionLease("owner"); save(); });
  database.failRenewal();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(lease.signal.aborted).toBe(true);
  const rejected = expect(work).rejects.toMatchObject({ status: 409 });
  response.resolve(); await rejected;
  expect(save).not.toHaveBeenCalled();
  await lease();
  expect(vi.getTimerCount()).toBe(0);
});

it("续租请求挂起时到期仍取消；旧续租和释放都不能影响替换执行", async () => {
  vi.useFakeTimers();
  const database = store();
  const renewal = Promise.withResolvers<void>();
  database.pauseRenewal(() => renewal.promise);
  const old = database.acquire();
  await vi.advanceTimersByTimeAsync(SESSION_LEASE_MS);
  expect(old.signal.aborted).toBe(true);
  const replacement = database.acquire();
  await old();
  renewal.resolve();
  await vi.advanceTimersByTimeAsync(0);
  expect(() => database.acquire()).toThrow("session busy");
  expect(replacement.signal.aborted).toBe(false);
  await replacement();
  expect(vi.getTimerCount()).toBe(0);
});

it("已完成执行的异步回调不能借用新一轮的许可", async () => {
  vi.useFakeTimers();
  const database = store();
  const old = database.acquire();
  const callback = Promise.withResolvers<void>();
  const late = old.run(async () => { await callback.promise; assertSessionLease("owner"); });
  await old();
  const replacement = database.acquire();
  const rejected = expect(late).rejects.toMatchObject({ status: 409 });
  callback.resolve(); await rejected;
  await replacement.run(async () => { assertSessionLease("owner"); });
  await replacement();
  expect(vi.getTimerCount()).toBe(0);
});

it("同一身份的嵌套执行范围恢复原许可，不把内部许可泄漏给外部回调", async () => {
  vi.useFakeTimers();
  const outer = store().acquire(), inner = store().acquire();
  await expect(outer.run(async () => {
    await inner.run(async () => {
      await outer();
      assertSessionLease("owner");
    });
    assertSessionLease("owner");
  })).rejects.toMatchObject({ status: 409 });
  await inner();
  expect(vi.getTimerCount()).toBe(0);
});
