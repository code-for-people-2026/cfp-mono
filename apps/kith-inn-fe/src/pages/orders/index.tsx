import Taro from "@tarojs/taro";
import { useCallback, useEffect, useRef, useState } from "react";
import { Input, Picker, Text, View } from "@tarojs/components";
import { Button, Tag } from "@nutui/nutui-react-taro";
import type { DeliveryView, Fulfillment, Order } from "@cfp/kith-inn-shared";
import { TabBar } from "@/components/TabBar";
import { TopBar } from "@/components/TopBar";
import { deliveryUrl, markDeliveredUrl, orderConfirmUrl, orderUrl, ordersUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";
import { todayShanghai } from "@/logic/time";
import { customerName, yuan } from "@/logic/ordersView";
import {
  gapCount,
  isSelectable,
  joinOrdersFulfillments,
  lifecycleDots,
  orderQuantity,
  sortByAddress,
  summarizeRows,
  toggleSelection,
  visibleRows,
  type Occasion,
  type Row,
} from "@/logic/ordersLifecycle";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);

const OCCASION_LABEL: Record<Occasion, string> = { lunch: "午餐", dinner: "晚餐" };
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const addDays = (iso: string, n: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
};
const dateLabel = (iso: string): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${m}月${d}日 周${WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}${iso === todayShanghai() ? " 今天" : ""}`;
};

export default function Orders() {
  const [rows, setRows] = useState<Row[]>([]);
  const [date, setDate] = useState<string>(todayShanghai());
  const [prefix, setPrefix] = useState("");
  const [selected, setSelected] = useState<Array<string | number>>([]);
  const [loading, setLoading] = useState(true);
  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    const token = tokens.getToken();
    if (!token) return Taro.redirectTo({ url: "/pages/login/index" });
    setLoading(true);
    try {
      const [ordRes, delRes] = await Promise.all([
        Taro.request({ url: ordersUrl(date), header: { Authorization: `Bearer ${token}` } }),
        Taro.request({ url: deliveryUrl(date), header: { Authorization: `Bearer ${token}` } }),
      ]);
      if (seq !== loadSeq.current) return;
      if (ordRes.statusCode === 401 || delRes.statusCode === 401) {
        tokens.clearToken();
        return Taro.redirectTo({ url: "/pages/login/index" });
      }
      const orders = (ordRes.data as { orders?: Order[] }).orders ?? [];
      const dv = delRes.data as DeliveryView;
      const fulfillments = (dv.sort ?? []).flatMap((g) => g.fulfillments ?? []) as Fulfillment[];
      const joined = sortByAddress(joinOrdersFulfillments(orders, fulfillments));
      setRows(joined);
      setSelected((prev) => prev.filter((id) => joined.some((row) => row.order.id === id && isSelectable(row))));
    } catch {
      if (seq === loadSeq.current) Taro.showToast({ title: "加载失败", icon: "error" });
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // Clear selection when the date or address filter changes (avoid跨集误操作).
  useEffect(() => {
    setSelected([]);
  }, [date, prefix]);

  /** Returns true on success so callers clear selection only when the write landed. */
  const act = async (url: string, method: "POST" | "PATCH", body?: unknown, reload = true): Promise<boolean> => {
    const token = tokens.getToken();
    if (!token) { Taro.redirectTo({ url: "/pages/login/index" }); return false; }
    try {
      const res = await Taro.request({ url, method, data: body, header: { Authorization: `Bearer ${token}`, "content-type": "application/json" } });
      if (res.statusCode === 401) { tokens.clearToken(); Taro.redirectTo({ url: "/pages/login/index" }); return false; }
      if (res.statusCode >= 400) { Taro.showToast({ title: "操作失败", icon: "error" }); return false; }
      if (reload) load();
      return true;
    } catch {
      Taro.showToast({ title: "操作失败", icon: "error" });
      return false;
    }
  };

  const selectedRows = rows.filter((r) => selected.includes(r.order.id));
  const selectedDeliveryIds = selectedRows.flatMap((r) => (r.fulfillment && lifecycleDots(r).delivery === "pending" ? [r.fulfillment.id] : []));
  const selectedUnpaidIds = selectedRows.flatMap((r) => {
    const d = lifecycleDots(r);
    return d.base === "confirmed" && d.payment === "unpaid" ? [r.order.id] : [];
  });

  const bulkPaid = async () => {
    if (selectedUnpaidIds.length === 0) return;
    const ok = (await Promise.all(selectedUnpaidIds.map((id) => act(orderUrl(id), "PATCH", { paymentStatus: "paid" }, false)))).every(Boolean);
    if (ok) {
      setSelected([]);
      load();
    }
  };

  const bulkDeliver = async () => {
    if (selectedDeliveryIds.length === 0) return;
    const ok = await act(markDeliveredUrl(), "PATCH", { ids: selectedDeliveryIds, set: { status: "done" } });
    if (ok) setSelected([]);
  };

  const summary = summarizeRows(rows);
  const renderSection = (occ: Occasion) => {
    const visible = visibleRows(rows, occ, prefix);
    const gaps = gapCount(rows, occ);
    return (
      <View key={occ} className="mt-[28rpx]">
        <View className="mb-[12rpx] flex items-center justify-between">
          <Text className="text-[30rpx] font-bold">{OCCASION_LABEL[occ]}</Text>
          <Text className="text-[24rpx] text-muted">{visible.length} 单 · {gaps > 0 ? `${gaps} 待送` : "全送完"}</Text>
        </View>
        {visible.length === 0 ? (
          <Text className="block rounded-[12rpx] bg-surface px-[20rpx] py-[18rpx] text-[24rpx] text-muted">{prefix.trim() ? "没匹配到。" : "本餐次还没有订单。"}</Text>
        ) : (
          visible.map((row) => {
            const o = row.order;
            const d = lifecycleDots(row);
            const selectable = isSelectable(row);
            const isSelected = selected.includes(o.id);
            const toggle = () => {
              if (selectable) setSelected((prev) => toggleSelection(prev, o.id));
            };
            return (
              <View key={String(o.id)} className={`my-[16rpx] flex card bg-surface p-[24rpx] ${d.base === "canceled" ? "opacity-40" : ""} ${d.base === "draft" ? "opacity-60" : ""}`}>
                <View onClick={toggle} className={`mr-[16rpx] mt-[4rpx] flex h-[40rpx] w-[40rpx] shrink-0 items-center justify-center rounded-[8rpx] border ${isSelected ? "border-green bg-green-soft" : selectable ? "border-line" : "border-transparent"}`}>
                  {isSelected && <Text className="text-[28rpx] font-bold text-green">✓</Text>}
                </View>
                <View className="min-w-0 flex-1">
                  <View className="flex items-start gap-[16rpx]">
                    <View className="min-w-0 flex-1">
                      <Text className={`block text-[28rpx] font-semibold ${d.base === "canceled" ? "line-through" : ""}`}>{customerName(o)}</Text>
                      <Text className="mt-[6rpx] block text-[24rpx] text-muted">{orderQuantity(o)}份{o.address ? ` · ${o.address}` : ""}</Text>
                    </View>
                    <View className="flex shrink-0 gap-[8rpx]">
                      {d.delivery !== "none" && (
                        <Tag className={`inline-flex h-[44rpx] items-center rounded-[8rpx] px-[12rpx] text-[22rpx] ${d.delivery === "done" ? "bg-green-soft text-green" : "bg-amber-soft text-amber"}`}>
                          {d.delivery === "done" ? "送✓" : "送○"}
                        </Tag>
                      )}
                      <Tag className={`inline-flex h-[44rpx] items-center rounded-[8rpx] px-[12rpx] text-[22rpx] ${d.payment === "paid" ? "bg-green-soft text-green" : "bg-red-soft text-red"}`}>
                        {d.payment === "paid" ? "付✓" : "付○"}
                      </Tag>
                    </View>
                    <Text className="shrink-0 text-[24rpx] text-muted">{yuan(o.totalCents)}</Text>
                  </View>
                  <View className="mt-[14rpx] flex flex-wrap gap-[12rpx]">
                    {d.base === "draft" && (
                      <Button type="primary" className="bg-red text-white" onClick={() => act(orderConfirmUrl(o.id), "POST")}>确认订单</Button>
                    )}
                    {d.base === "confirmed" && d.payment === "unpaid" && (
                      <Button className="bg-surface text-ink" onClick={() => act(orderUrl(o.id), "PATCH", { paymentStatus: "paid" })}>标已付</Button>
                    )}
                    {d.base === "confirmed" && o.paymentStatus === "paid" && (
                      <Button className="bg-surface text-muted" onClick={() => act(orderUrl(o.id), "PATCH", { paymentStatus: "unpaid" })}>回退未付</Button>
                    )}
                    {row.fulfillment && d.delivery === "pending" && (
                      <Button className="bg-surface text-ink" onClick={() => act(markDeliveredUrl(), "PATCH", { ids: [row.fulfillment!.id], set: { status: "done" } })}>标送达</Button>
                    )}
                  </View>
                </View>
              </View>
            );
          })
        )}
      </View>
    );
  };

  return (
    <View className="page-shell">
      <TopBar title="街坊味" subtitle="桃子的灶台" />
      <View className="px-[32rpx] pb-[200rpx] pt-[32rpx]">
        <View className="mb-[20rpx] flex items-center justify-between gap-[16rpx]">
          <Button className="bg-surface text-ink" onClick={() => setDate(addDays(date, -1))}>前一天</Button>
          <Picker mode="date" value={date} onChange={(e) => setDate(String(e.detail.value))}>
            <Text className="text-[30rpx] font-bold text-ink">{dateLabel(date)}</Text>
          </Picker>
          <Button className="bg-surface text-ink" onClick={() => setDate(addDays(date, 1))}>后一天</Button>
        </View>
        {date !== todayShanghai() && (
          <View className="mb-[16rpx] text-center">
            <Text className="text-[24rpx] text-amber" onClick={() => setDate(todayShanghai())}>跳回今天</Text>
          </View>
        )}

        <View className="mb-[20rpx] card bg-surface p-[20rpx]">
          <Text className="block text-[28rpx] font-bold">{summary.orders} 单 · {summary.servings} 份 · {yuan(summary.totalCents)}</Text>
          <Text className="mt-[8rpx] block text-[24rpx] text-muted">草稿 {summary.drafts} · 未付 {summary.unpaid} · 待送 {summary.pendingDeliveries}</Text>
        </View>

        <View className="mb-[16rpx]">
          <Input
            value={prefix}
            placeholder="按地址筛选（如 3a）"
            onInput={(e) => setPrefix(e.detail.value)}
            className="rounded-[12rpx] border border-line bg-white px-[16rpx] py-[12rpx] text-[28rpx]"
          />
        </View>
        <View className="mb-[24rpx] flex flex-wrap gap-[16rpx]">
          <Button
            disabled={selectedUnpaidIds.length === 0}
            className={selectedUnpaidIds.length === 0 ? "bg-surface text-muted" : "bg-green text-white"}
            onClick={bulkPaid}
          >
            批量已付{selectedUnpaidIds.length > 0 ? `(${selectedUnpaidIds.length})` : ""}
          </Button>
          <Button
            type="primary"
            disabled={selectedDeliveryIds.length === 0}
            className={selectedDeliveryIds.length === 0 ? "bg-surface text-muted" : "bg-red text-white"}
            onClick={bulkDeliver}
          >
            批量送达{selectedDeliveryIds.length > 0 ? `(${selectedDeliveryIds.length})` : ""}
          </Button>
          {selected.length > 0 && <Text className="self-center text-[24rpx] text-muted">已选 {selected.length}</Text>}
        </View>

        {loading ? (
          <Text className="block text-[24rpx] text-muted">加载中…</Text>
        ) : (
          (["lunch", "dinner"] as Occasion[]).map(renderSection)
        )}
      </View>
      <TabBar active="orders" />
    </View>
  );
}
