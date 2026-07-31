import { useEffect, useState } from "react";
import Taro, { useRouter } from "@tarojs/taro";
import { Button, Text } from "@tarojs/components";
import type {
  DraftPlanDto,
  ReplaceDishInput
} from "@cfp/weekly-menu-shared";
import ScreenContainer from "@/components/ScreenContainer";
import PlanOverview from "@/components/PlanOverview";
import { clientFeedback } from "@/lib/client-feedback";
import {
  weeklyMenuClient,
  weeklyMenuClientMode
} from "@/lib/weekly-menu-client";
import "./index.css";

export default function MenuPage() {
  const { params } = useRouter<{ id?: string }>();
  const planId = params.id;
  const [plan, setPlan] = useState<DraftPlanDto | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleError(error: unknown, fallbackTitle: string) {
    const feedback = clientFeedback(error, fallbackTitle);
    await Taro.showToast({ title: feedback.title, icon: "none" });
    if (feedback.returnHome) {
      await Taro.reLaunch({ url: "/pages/index/index" });
    }
    return feedback.returnHome;
  }

  useEffect(() => {
    async function loadPlan() {
      try {
        const loaded = planId
          ? await weeklyMenuClient.getPlan(planId)
          : await weeklyMenuClient.generateDraft();
        if (loaded.status !== "draft") {
          throw new Error("NOT_DRAFT");
        }
        setPlan(loaded);
      } catch (error) {
        if (!(await handleError(error, "菜单读取失败，请从首页重试"))) {
          await Taro.reLaunch({ url: "/pages/index/index" });
        }
      }
    }
    void loadPlan();
  }, [planId]);

  async function replaceDish(input: ReplaceDishInput) {
    if (!plan || busy) return;
    setBusy(true);
    try {
      setPlan(await weeklyMenuClient.replaceDraftDish(plan, input));
      setNotice("已换一道并自动保存");
    } catch (error) {
      await handleError(error, "换菜失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft() {
    if (!plan || busy) return;
    setBusy(true);
    try {
      setPlan(await weeklyMenuClient.saveDraft(plan));
      setNotice("草稿已保存");
    } catch (error) {
      await handleError(error, "草稿保存失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPlan() {
    if (!plan || busy) return;
    setBusy(true);
    try {
      const confirmed = await weeklyMenuClient.confirmDraft(plan);
      await Taro.redirectTo({
        url: `/pages/checklist/index?id=${encodeURIComponent(confirmed.id)}`
      });
    } catch (error) {
      await handleError(error, "菜单确认失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenContainer>
      <Text className="menu-title">本周菜单</Text>
      <Text className="menu-hint">
        {weeklyMenuClientMode === "real" ? "真实 API" : "Mock 模式"} ·
        生成和换菜会立即保存
      </Text>
      {plan ? (
        <>
          {plan.sourcePlanId ? (
            <Text className="menu-source">由历史菜单复制</Text>
          ) : null}
          <PlanOverview plan={plan} onRotate={(input) => void replaceDish(input)} />
          {notice ? <Text className="feedback">{notice}</Text> : null}
          <Button
            className="secondary-button"
            disabled={busy}
            onClick={() => void saveDraft()}
          >
            保存草稿
          </Button>
          <Button
            className="primary-button"
            disabled={busy}
            onClick={() => void confirmPlan()}
          >
            确认菜单
          </Button>
          <Button
            className="secondary-button"
            onClick={() => Taro.navigateTo({ url: "/pages/history/index" })}
          >
            查看历史
          </Button>
        </>
      ) : (
        <Text className="empty-state">正在生成菜单…</Text>
      )}
    </ScreenContainer>
  );
}
