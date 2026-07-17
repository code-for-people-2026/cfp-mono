import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import type { CustomerBookingBatchView, CustomerOrderView, CustomerProfile } from "@cfp/kith-inn-v1-shared";
import { bookingBatchPublicId, formatBookingPrice } from "@/logic/customerBooking";
import { customerOrderLabels, customerOrderLockText, customerOrderQuantity, customerWriteErrorText }
  from "@/logic/customerOrders";
import { createApiClient, type RequestAdapter } from "@/services/api";
import { createCustomerSessionStore, type CustomerStorage } from "@/store/customerSession";
import { createSessionStore, type Storage } from "@/store/session";

const storage: Storage & CustomerStorage = { get: (key) => Taro.getStorageSync(key) || null,
  set: (key, value) => Taro.setStorageSync(key, value), remove: (key) => Taro.removeStorageSync(key) };
const api = createApiClient({ sessions: createSessionStore(storage), customerSessions: createCustomerSessionStore(storage),
  request: (async (options) => { const response = await Taro.request(options);
    return { statusCode: response.statusCode, data: response.data }; }) as RequestAdapter });
const occasionText = (value: "lunch" | "dinner") => value === "lunch" ? "午餐" : "晚餐";

export default function CustomerOrders() {
  const publicId = bookingBatchPublicId(Taro.getCurrentInstance().router?.params ?? {});
  const [orders, setOrders] = useState<CustomerOrderView[]>([]);
  const [profiles, setProfiles] = useState<CustomerProfile[]>([]);
  const [batch, setBatch] = useState<CustomerBookingBatchView | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [confirmOrder, setConfirmOrder] = useState<string | null>(null);
  const [confirmProfile, setConfirmProfile] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void Promise.all([api.listOwnedCustomerOrders(), api.listOwnedCustomerProfiles(),
    publicId ? api.getPublicBookingBatch(publicId) : Promise.resolve(null)])
    .then(([nextOrders, nextProfiles, nextBatch]) => {
      setOrders(nextOrders); setProfiles(nextProfiles); setBatch(nextBatch);
      setQuantities(Object.fromEntries(nextOrders.map((order) => [String(order.id), String(order.quantity)])));
    }).catch(() => setError("我的预订加载失败，请从预订卡片重试")); }, [publicId]);
  const replace = (next: CustomerOrderView) => setOrders((current) => current.map((order) =>
    String(order.id) === String(next.id) ? next : order));
  const update = async (order: CustomerOrderView) => {
    const quantity = customerOrderQuantity(quantities[String(order.id)] ?? "");
    if (!publicId || !quantity) return setError("份数必须是正整数");
    try { replace(await api.updateOwnedCustomerOrder(order.id, { batchPublicId: publicId, quantity })); setError(""); }
    catch (cause) { setError(customerWriteErrorText(cause)); }
  };
  const cancel = async (order: CustomerOrderView) => {
    if (confirmOrder !== String(order.id)) return setConfirmOrder(String(order.id));
    if (!publicId) return setError("如需取消，请从预订卡片进入");
    try { replace(await api.cancelOwnedCustomerOrder(order.id, { batchPublicId: publicId, confirmed: true }));
      setConfirmOrder(null); setError(""); } catch (cause) { setError(customerWriteErrorText(cause)); }
  };
  const deactivate = async (profile: CustomerProfile) => {
    if (confirmProfile !== String(profile.id)) return setConfirmProfile(String(profile.id));
    try { await api.deactivateOwnedCustomerProfile(profile.id);
      setProfiles((current) => current.filter(({ id }) => String(id) !== String(profile.id)));
      setConfirmProfile(null); setError(""); } catch { setError("资料停用失败，请稍后重试"); }
  };
  return <View className="page customer-orders-page">
    <Text className="title">我的预订</Text>
    {error && <Text className="notice">{error}</Text>}
    <View className="card customer-profiles"><Text className="section-title">常用资料</Text>
      {profiles.length === 0 && <Text className="meta">暂无可用资料</Text>}
      {profiles.map((profile) => <Button key={String(profile.id)} onClick={() => void deactivate(profile)}>
        {confirmProfile === String(profile.id) ? `确认停用${profile.displayName}` : `停用资料：${profile.displayName}`}
      </Button>)}
    </View>
    {orders.length === 0 && <View className="card"><Text>还没有预订记录</Text></View>}
    {orders.map((order) => { const lock = customerOrderLockText(order, batch); const labels = customerOrderLabels(order);
      return <View className="card customer-order-card" key={String(order.id)}>
        <Text className="section-title">{order.target.date} {occasionText(order.target.occasion)}</Text>
        <Text>{order.displayName}｜{order.address}</Text>
        <Text className="meta">{order.menuItems.map(({ nameSnapshot }) => nameSnapshot).join("、")}</Text>
        <Text>{order.quantity} 份｜{formatBookingPrice(order.totalCents)}</Text>
        <View className="status-axes">{labels.map((label) => <Text key={label}>{label}</Text>)}</View>
        {lock ? <Text className="notice">{lock}</Text> : <View className="customer-order-actions">
          <Input type="number" value={quantities[String(order.id)] ?? ""}
            onInput={(event) => setQuantities((current) => ({ ...current, [String(order.id)]: event.detail.value }))} />
          <Button onClick={() => void update(order)}>修改份数</Button>
          <Button className="danger" onClick={() => void cancel(order)}>
            {confirmOrder === String(order.id) ? "确认取消" : "取消预订"}
          </Button>
        </View>}
      </View>; })}
  </View>;
}
