import { useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { Button, Text } from "@tarojs/components";
import type { WeeklyMenuPlanDto } from "@cfp/weekly-menu-shared";
import ScreenContainer from "@/components/ScreenContainer";
import { clientFeedback } from "@/lib/client-feedback";
import { weeklyMenuClient } from "@/lib/weekly-menu-client";
import "./index.css";

export default function HistoryPage() {
  const [plans, setPlans] = useState<WeeklyMenuPlanDto[]>([]);

  useDidShow(() => {
    void weeklyMenuClient
      .listPlans()
      .then(setPlans)
      .catch(async (error: unknown) => {
        const feedback = clientFeedback(error, "历史菜单读取失败，请重试");
        await Taro.showToast({ title: feedback.title, icon: "none" });
        if (feedback.returnHome) {
          await Taro.reLaunch({ url: "/pages/index/index" });
        }
      });
  });

  return (
    <ScreenContainer>
      <Text className="history-title">菜单历史</Text>
      {plans.length === 0 ? (
        <Text className="empty-state">还没有保存的菜单。</Text>
      ) : (
        plans.map((plan) => (
          <Button
            className="history-card"
            key={plan.id}
            onClick={() =>
              Taro.navigateTo({
                url: `/pages/history-detail/index?id=${encodeURIComponent(plan.id)}`
              })
            }
          >
            <Text className="history-week">{plan.weekStart} 开始的一周</Text>
            <Text className={`history-status history-status--${plan.status}`}>
              {plan.status === "confirmed" ? "已确认" : "草稿"}
            </Text>
            <Text className="history-link">查看详情</Text>
          </Button>
        ))
      )}
    </ScreenContainer>
  );
}
