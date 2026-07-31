import { useEffect, useState } from "react";
import Taro, { useRouter } from "@tarojs/taro";
import { Button, Text } from "@tarojs/components";
import type { WeeklyMenuPlanDto } from "@cfp/weekly-menu-shared";
import PlanOverview from "@/components/PlanOverview";
import ScreenContainer from "@/components/ScreenContainer";
import { clientFeedback } from "@/lib/client-feedback";
import { weeklyMenuClient } from "@/lib/weekly-menu-client";
import "./index.css";

export default function HistoryDetailPage() {
  const { params } = useRouter<{ id?: string }>();
  const planId = params.id;
  const [plan, setPlan] = useState<WeeklyMenuPlanDto | null>(null);

  async function handleError(error: unknown, fallbackTitle: string) {
    const feedback = clientFeedback(error, fallbackTitle);
    await Taro.showToast({ title: feedback.title, icon: "none" });
    if (feedback.returnHome) {
      await Taro.reLaunch({ url: "/pages/index/index" });
    }
    return feedback.returnHome;
  }

  useEffect(() => {
    if (!planId) {
      void Taro.reLaunch({ url: "/pages/index/index" });
      return;
    }
    void weeklyMenuClient
      .getPlan(planId)
      .then(setPlan)
      .catch(async (error: unknown) => {
        if (!(await handleError(error, "菜单详情读取失败，请重试"))) {
          await Taro.navigateBack();
        }
      });
  }, [planId]);

  async function copyPlan() {
    if (!plan) return;
    try {
      const copied = await weeklyMenuClient.copyConfirmed(plan.id);
      await Taro.redirectTo({
        url: `/pages/menu/index?id=${encodeURIComponent(copied.id)}`
      });
    } catch (error) {
      await handleError(error, "菜单复制失败，请重试");
    }
  }

  async function deletePlan() {
    if (!plan) return;
    const result = await Taro.showModal({
      title: "删除草稿？",
      content: "删除后无法恢复。"
    });
    if (!result.confirm) return;
    try {
      await weeklyMenuClient.deleteDraft(plan.id);
      await Taro.navigateBack();
    } catch (error) {
      await handleError(error, "草稿删除失败，请重试");
    }
  }

  if (!plan) {
    return (
      <ScreenContainer>
        <Text className="empty-state">正在读取菜单…</Text>
      </ScreenContainer>
    );
  }

  return (
    <ScreenContainer>
      <Text className="detail-title">{plan.weekStart} 开始的一周</Text>
      <Text className="detail-status">
        {plan.status === "confirmed" ? "已确认菜单" : "草稿菜单"}
      </Text>
      <PlanOverview plan={plan} />
      {plan.status === "confirmed" ? (
        <>
          <Button
            className="primary-button"
            onClick={() => void copyPlan()}
          >
            复制为新草稿
          </Button>
          <Button
            className="secondary-button"
            onClick={() =>
              Taro.navigateTo({
                url: `/pages/checklist/index?id=${encodeURIComponent(plan.id)}`
              })
            }
          >
            查看本周菜品勾选清单
          </Button>
          <Text className="feedback">已确认菜单不可修改或删除。</Text>
        </>
      ) : (
        <>
          <Button
            className="primary-button"
            onClick={() =>
              Taro.redirectTo({
                url: `/pages/menu/index?id=${encodeURIComponent(plan.id)}`
              })
            }
          >
            继续编辑
          </Button>
          <Button className="danger-button" onClick={() => void deletePlan()}>
            删除草稿
          </Button>
        </>
      )}
    </ScreenContainer>
  );
}
