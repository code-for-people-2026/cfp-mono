import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import type { CustomerBookingBatchView, CustomerOrderView, CustomerProfile } from "@cfp/kith-inn-v1-shared";
import { beginCustomerSession, bookingBatchPublicId, formatBookingPrice } from "@/logic/customerBooking";
import { copyCustomerData, deactivateCustomerProfiles } from "@/logic/customerData";
import { customerOrderLabels, customerOrderLockText, customerOrderQuantity, customerWriteErrorText }
  from "@/logic/customerOrders";
import { createApiClient, type RequestAdapter } from "@/services/api";
import { createCustomerSessionStore, type CustomerStorage } from "@/store/customerSession";
import { createSessionStore, type Storage } from "@/store/session";

const storage: Storage & CustomerStorage = { get: (key) => Taro.getStorageSync(key) || null,
  set: (key, value) => Taro.setStorageSync(key, value), remove: (key) => Taro.removeStorageSync(key) };
const customerSessions = createCustomerSessionStore(storage);
const api = createApiClient({ sessions: createSessionStore(storage), customerSessions,
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
  const [confirmAllProfiles, setConfirmAllProfiles] = useState(false);
  const [deactivationFailures, setDeactivationFailures] = useState<CustomerProfile[]>([]);
  const [actionNotice, setActionNotice] = useState("");
  const [dataLoaded, setDataLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setDataLoaded(false);
    if (!publicId) return setError("我的预订加载失败，请从预订卡片重试");
    void beginCustomerSession(process.env.TARO_ENV === "weapp" ? "weapp" : "h5", publicId, { api,
      devOpenid: process.env.KITH_INN_V1_CUSTOMER_DEV_OPENID ?? "", wxCode: async () => {
        const { code } = await Taro.login();
        if (!code) throw new Error("wx.login 未返回 code");
        return code;
      } }).then((response) => { customerSessions.setSession({ token: response.token, ...response.session });
      return Promise.all([api.listOwnedCustomerOrders(), api.listOwnedCustomerProfiles(),
        api.getPublicBookingBatch(publicId)]); })
    .then(([nextOrders, nextProfiles, nextBatch]) => {
      setOrders(nextOrders); setProfiles(nextProfiles); setBatch(nextBatch);
      setQuantities(Object.fromEntries(nextOrders.map((order) => [String(order.id), String(order.quantity)])));
      setDataLoaded(true);
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
      setDeactivationFailures((current) => current.filter(({ id }) => String(id) !== String(profile.id)));
      setActionNotice("资料已软停用；历史预订仍可查看");
      setConfirmProfile(null); setError(""); } catch { setError("资料停用失败，请稍后重试"); }
  };
  const copyData = async () => {
    if (!dataLoaded) return setError("我的数据尚未加载完成");
    try { await copyCustomerData(profiles, orders, (options) => Taro.setClipboardData(options));
      setActionNotice("我的数据已复制"); setError("");
    } catch { setError("数据复制失败，请稍后重试"); }
  };
  const deactivateAll = async () => {
    if (!confirmAllProfiles) return setConfirmAllProfiles(true);
    const results = await deactivateCustomerProfiles(profiles, (id) => api.deactivateOwnedCustomerProfile(id));
    const deactivatedIds = new Set(results.filter(({ status }) => status === "deactivated")
      .map(({ profile }) => String(profile.id)));
    const failures = results.filter(({ status }) => status === "failed").map(({ profile }) => profile);
    setProfiles((current) => current.filter(({ id }) => !deactivatedIds.has(String(id))));
    setDeactivationFailures(failures);
    setConfirmAllProfiles(false);
    const successCount = results.length - failures.length;
    setActionNotice(failures.length > 0
      ? `已软停用 ${successCount} 条资料；${failures.length} 条失败，可重试`
      : `已软停用 ${successCount} 条资料；历史预订仍可查看`);
    setError("");
  };
  return <View className="page customer-orders-page">
    <Text className="title">我的预订</Text>
    <Button onClick={() => void Taro.navigateTo({ url: "/pages/privacy/index" })}>
      查看个人信息用途说明
    </Button>
    {error && <Text className="notice">{error}</Text>}
    {actionNotice && <Text className="notice">{actionNotice}</Text>}
    <View className="card customer-data-controls">
      <Text className="section-title">我的数据</Text>
      <Button disabled={!dataLoaded} onClick={() => void copyData()}>复制我的数据</Button>
      {profiles.length > 0 && <Button className="danger" onClick={() => void deactivateAll()}>
        {confirmAllProfiles ? `确认批量软停用 ${profiles.length} 条资料` : "删除保存的资料"}
      </Button>}
      <Text className="meta">“删除”仅批量软停用常用资料，不会物理删除或改写历史预订。</Text>
      {deactivationFailures.map((profile) => <Text className="deactivation-failure" key={String(profile.id)}>
        停用失败：{profile.displayName}，请重试
      </Text>)}
    </View>
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
