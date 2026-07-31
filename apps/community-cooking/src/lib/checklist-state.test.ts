import { describe, expect, it, vi } from "vitest";
import {
  readCheckedDishNames,
  writeCheckedDishNames,
  type ChecklistLocalStorage
} from "./checklist-state";

describe("菜品勾选本地状态", () => {
  it("忽略损坏值以及不在当前 confirmed 清单中的历史菜名", () => {
    const invalidStorage: ChecklistLocalStorage = {
      get: () => "broken",
      set: vi.fn()
    };
    expect(
      [...readCheckedDishNames("plan-1", ["红烧肉"], invalidStorage)]
    ).toEqual([]);

    const storage: ChecklistLocalStorage = {
      get: () => ["红烧肉", "已移除菜品", 42, "红烧肉"],
      set: vi.fn()
    };
    expect([...readCheckedDishNames("plan-1", ["红烧肉"], storage)]).toEqual([
      "红烧肉"
    ]);
  });

  it("仅按 confirmed 清单顺序写入有效 checked 菜名", () => {
    const set = vi.fn();
    const storage: ChecklistLocalStorage = { get: () => [], set };
    writeCheckedDishNames(
      "plan-1",
      ["红烧肉", "青菜", "豆腐"],
      new Set(["豆腐", "红烧肉", "未知菜名"]),
      storage
    );
    expect(set).toHaveBeenCalledWith("weekly-menu:checklist:plan-1", [
      "红烧肉",
      "豆腐"
    ]);
  });
});
