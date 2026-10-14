import { useEffect, useRef, useState } from "react";
import { Text, View } from "@tarojs/components";
import { useRouter } from "@tarojs/taro";
import * as api from "./api";
import { PageButton, SettingsPage } from "./settings-page";
import "./safety.css";

export function HelpPage() {
  const params = useRouter().params;
  const turnId = Number(params.turnId) > 0 ? Number(params.turnId) : undefined;
  const [contact, setContact] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  async function refresh() {
    if (inFlight.current) return;
    inFlight.current = true; setRefreshing(true); setError(""); setContact("");
    try { setContact((await api.getLegal()).contact); }
    catch (e) { setError(e instanceof Error ? e.message : "联系渠道读取失败，请点击右上角刷新"); }
    finally { inFlight.current = false; setRefreshing(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return <SettingsPage title="帮助与反馈" onRefresh={() => void refresh()} refreshing={refreshing}>
    <Text className="page-intro">遇到问题，或对回应有疑问，都可以在这里找到帮助。</Text>
    {error && <Text className="page-result page-error">{error}</Text>}
    <View className="page-card page-card-padded">
      <Text className="page-heading">意见与问题反馈</Text>
      <Text className="help-description">在线反馈暂未开放。你可以通过下方联系渠道说明问题，目前不会在应用内提交或生成受理记录。</Text>
      {turnId && <Text className="page-caption">反馈这条回应时，可附上回应编号 #{turnId}。</Text>}
      <PageButton className="page-primary" disabled>在线反馈暂未开放</PageButton>
    </View>
    <View className="page-card page-card-padded">
      <Text className="page-heading">联系渠道</Text>
      <Text className="help-description" selectable>{contact || (refreshing ? "正在读取联系渠道…" : "暂未获取联系渠道，请刷新重试。")}</Text>
      <Text className="page-caption">请勿发送密码、连接令牌、完整证件号或恢复码。</Text>
    </View>
    <View className="page-card page-card-padded">
      <Text className="page-heading">隐私与数据</Text>
      <Text className="help-description">在设置中的“隐私与数据”可管理授权、导出和删除数据。关于查阅、更正或其他隐私问题，可通过上述渠道联系。</Text>
    </View>
  </SettingsPage>;
}
