import { Button, Checkbox, Text, Textarea, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import type { JielongCommitResponse } from "@cfp/kith-inn-v1-shared";
import {
  applyJielongPreview,
  commitConfirmedJielongImport,
  createJielongImportState,
  setJielongConfirmed,
  setJielongText,
  summarizeJielongCommit
} from "@/logic/jielongImport";
import { merchantRoute } from "@/logic/login";
import { ApiError, createApiClient, type RequestAdapter } from "@/services/api";
import { createSessionStore, type Storage } from "@/store/session";

const storage: Storage = {
  get: (key) => Taro.getStorageSync(key) || null,
  set: (key, value) => Taro.setStorageSync(key, value),
  remove: (key) => Taro.removeStorageSync(key)
};
const sessions = createSessionStore(storage);
const request: RequestAdapter = async (options) => {
  const response = await Taro.request(options);
  return { statusCode: response.statusCode, data: response.data };
};
const api = createApiClient({
  request,
  sessions,
  onAuthFailure: (status) => {
    const reason = status === 403 ? "?reason=membership-inactive" : "";
    void Taro.redirectTo({ url: `/pages/merchant/login/index${reason}` });
  }
});
const handledAuthFailure = (error: unknown) =>
  error instanceof ApiError && (error.status === 401 || error.status === 403);
const occasionText = (occasion: "lunch" | "dinner") => occasion === "lunch" ? "午餐" : "晚餐";
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

export default function MerchantJielongImport() {
  const [state, setState] = useState(createJielongImportState);
  const [result, setResult] = useState<JielongCommitResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "login") {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
    }
  }, []);

  const previewText = async () => {
    const text = state.text;
    setBusy(true);
    try {
      const preview = await api.previewJielongImport(text);
      setState((current) => current.text === text ? applyJielongPreview(text, preview) : current);
      setResult(null);
    } catch (error) {
      if (!handledAuthFailure(error)) {
        await Taro.showToast({ title: error instanceof Error ? error.message : "接龙预览失败", icon: "none" });
      }
    } finally {
      setBusy(false);
    }
  };

  const commitText = async () => {
    setBusy(true);
    try {
      setResult(await commitConfirmedJielongImport(api, state));
    } catch (error) {
      if (!handledAuthFailure(error)) {
        await Taro.showToast({ title: error instanceof Error ? error.message : "接龙导入失败", icon: "none" });
      }
    } finally {
      setBusy(false);
    }
  };

  const summary = result ? summarizeJielongCommit(result) : null;
  return (
    <View className="page jielong-import-page">
      <Text className="title">接龙导入兜底</Text>
      <Text className="subtitle">确定性解析，不调用 AI；写入前必须核对预览。</Text>
      <Button onClick={() => void Taro.navigateTo({ url: "/pages/merchant/menu/index" })}>菜单</Button>
      <View className="card jielong-import-card">
        <Textarea
          aria-label="粘贴接龙文本"
          maxlength={10_000}
          disabled={busy}
          placeholder="粘贴接龙文本"
          value={state.text}
          onInput={(event) => {
            setState((current) => setJielongText(current, event.detail.value));
            setResult(null);
          }}
        />
        <Button disabled={busy || !state.text} onClick={() => void previewText()}>预览接龙</Button>
      </View>

      {state.preview && (
        <View className="card jielong-preview">
          <Text className="section-title">
            {state.preview.target.date} {occasionText(state.preview.target.occasion)}
          </Text>
          {state.preview.lines.map((line) => (
            <Text key={line.lineNumber}>{line.displayName} · {line.quantity} 份 · {money(line.totalCents)}</Text>
          ))}
          <Text className="jielong-total">合计 {money(state.preview.totalCents)}</Text>
          <Checkbox
            aria-label="我已核对以上接龙预览"
            value="confirmed"
            checked={state.confirmedPreviewHash === state.preview.previewHash}
            onClick={() => setState((current) => setJielongConfirmed(current, current.confirmedPreviewHash === null))}
          >我已核对以上接龙预览</Checkbox>
          <Button
            className="primary"
            disabled={busy || state.confirmedPreviewHash !== state.preview.previewHash}
            onClick={() => void commitText()}
          >写入草稿订单</Button>
        </View>
      )}

      {summary && (
        <View className="card jielong-result">
          <Text>新增 {summary.created} 单，已存在 {summary.existing} 单，共 {summary.total} 单</Text>
          <Button onClick={() => void Taro.navigateTo({ url: "/pages/merchant/orders/index" })}>查看餐次订单</Button>
        </View>
      )}
    </View>
  );
}
