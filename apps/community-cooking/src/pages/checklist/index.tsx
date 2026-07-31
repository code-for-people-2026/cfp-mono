import { useEffect, useState } from "react";
import Taro, { useRouter } from "@tarojs/taro";
import {
  Button,
  Checkbox,
  CheckboxGroup,
  Label,
  Text,
  View
} from "@tarojs/components";
import type { DishChecklistDto } from "@cfp/weekly-menu-shared";
import ScreenContainer from "@/components/ScreenContainer";
import { clientFeedback } from "@/lib/client-feedback";
import {
  readCheckedDishNames,
  writeCheckedDishNames,
  type ChecklistLocalStorage
} from "@/lib/checklist-state";
import { weeklyMenuClient } from "@/lib/weekly-menu-client";
import "./index.css";

const localStorage: ChecklistLocalStorage = {
  get: (key) => Taro.getStorageSync(key),
  set: (key, value) => Taro.setStorageSync(key, value)
};

export default function ChecklistPage() {
  const { params } = useRouter<{ id?: string }>();
  const planId = params.id;
  const [checklist, setChecklist] = useState<DishChecklistDto | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!planId) {
      void Taro.reLaunch({ url: "/pages/index/index" });
      return;
    }
    async function loadChecklist() {
      try {
        const loaded = await weeklyMenuClient.getDishChecklist(planId!);
        const names = loaded.items.map(({ name }) => name);
        setChecklist(loaded);
        setChecked(readCheckedDishNames(loaded.planId, names, localStorage));
      } catch (error) {
        const feedback = clientFeedback(error, "菜品清单读取失败，请重试");
        await Taro.showToast({ title: feedback.title, icon: "none" });
        if (feedback.returnHome) {
          await Taro.reLaunch({ url: "/pages/index/index" });
        } else {
          await Taro.navigateBack();
        }
      }
    }
    void loadChecklist();
  }, [planId]);

  function updateChecked(names: string[]) {
    if (!checklist) return;
    const next = new Set(names);
    const available = checklist.items.map(({ name }) => name);
    writeCheckedDishNames(checklist.planId, available, next, localStorage);
    setChecked(next);
  }

  return (
    <ScreenContainer>
      <Text className="checklist-title">本周菜品勾选清单</Text>
      <Text className="checklist-hint">
        仅按已确认菜单的菜名去重，用于备菜核对；不是食材购物清单。
      </Text>
      {checklist ? (
        <>
          <CheckboxGroup
            onChange={(event) => updateChecked(event.detail.value)}
          >
            {checklist.items.map(({ name }) => (
              <Label className="checklist-item" key={name}>
                <Checkbox value={name} checked={checked.has(name)} />
                <Text className={checked.has(name) ? "is-checked" : ""}>
                  {name}
                </Text>
              </Label>
            ))}
          </CheckboxGroup>
          <Text className="checklist-progress">
            已核对 {checked.size} / {checklist.items.length}
          </Text>
          <View className="checklist-actions">
            <Button
              className="secondary-button"
              onClick={() => Taro.navigateTo({ url: "/pages/history/index" })}
            >
              查看历史
            </Button>
            <Button
              className="primary-button"
              onClick={() => Taro.reLaunch({ url: "/pages/index/index" })}
            >
              返回首页
            </Button>
          </View>
        </>
      ) : (
        <Text className="empty-state">正在生成菜品清单…</Text>
      )}
    </ScreenContainer>
  );
}
