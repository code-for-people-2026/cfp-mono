import { Button, Input, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useState } from "react";
import type { CustomerBookingBatchView, CustomerProfile, CustomerReservationResult } from "@cfp/kith-inn-v1-shared";
import {
  beginCustomerSession,
  bookingBatchPublicId,
  bookingUnavailableText,
  buildCustomerReservation,
  defaultCustomerProfile,
  formatBookingPrice,
  profileUseText,
  reservationResultText,
  type CustomerReservationDraft
} from "@/logic/customerBooking";
import { createApiClient, type RequestAdapter } from "@/services/api";
import { createCustomerSessionStore, type CustomerStorage } from "@/store/customerSession";
import { createSessionStore, type Storage } from "@/store/session";

const storage: Storage & CustomerStorage = {
  get: (key) => Taro.getStorageSync(key) || null,
  set: (key, value) => Taro.setStorageSync(key, value),
  remove: (key) => Taro.removeStorageSync(key)
};
const sessions = createSessionStore(storage);
const customerSessions = createCustomerSessionStore(storage);
const request: RequestAdapter = async (options) => {
  const response = await Taro.request(options);
  return { statusCode: response.statusCode, data: response.data };
};
const api = createApiClient({ request, sessions, customerSessions });
const occasionText = (occasion: "lunch" | "dinner") => occasion === "lunch" ? "午餐" : "晚餐";

export default function CustomerBooking() {
  const [view, setView] = useState<CustomerBookingBatchView | null>(null);
  const [error, setError] = useState("");
  const [profiles, setProfiles] = useState<CustomerProfile[]>([]);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [createNew, setCreateNew] = useState(false);
  const [saveAsNew, setSaveAsNew] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [address, setAddress] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<CustomerReservationDraft | null>(null);
  const [results, setResults] = useState<CustomerReservationResult[] | null>(null);
  const [formError, setFormError] = useState("");
  const params = Taro.getCurrentInstance().router?.params ?? {};
  const publicId = bookingBatchPublicId(params);

  useEffect(() => {
    if (!publicId) {
      setError("这个预订登记链接已失效");
      return;
    }
    void beginCustomerSession(
      process.env.TARO_ENV === "weapp" ? "weapp" : "h5",
      publicId,
      {
        api,
        devOpenid: process.env.KITH_INN_V1_CUSTOMER_DEV_OPENID ?? "",
        wxCode: async () => {
          const { code } = await Taro.login();
          if (!code) throw new Error("wx.login 未返回 code");
          return code;
        }
      }
    ).then((response) => {
      customerSessions.setSession({ token: response.token, ...response.session });
      return Promise.all([api.getPublicBookingBatch(publicId), api.listOwnedCustomerProfiles()]);
    }).then(([nextView, nextProfiles]) => {
      setView(nextView); setProfiles(nextProfiles);
      const selected = defaultCustomerProfile(nextProfiles);
      setProfile(selected); setCreateNew(nextProfiles.length === 0);
      setDisplayName(selected?.displayName ?? ""); setAddress(selected?.address ?? "");
    }).catch(() => setError("预订信息加载失败，请稍后重试"));
  }, [publicId]);

  const selectProfile = (selected: CustomerProfile) => {
    setProfile(selected); setCreateNew(false); setSaveAsNew(false);
    setDisplayName(selected.displayName); setAddress(selected.address);
  };
  const newProfile = () => {
    setProfile(null); setCreateNew(true); setSaveAsNew(false); setDisplayName(""); setAddress("");
  };
  const review = () => {
    if (!view || !publicId) return;
    const next = buildCustomerReservation(publicId, view,
      { profile, createNew, saveAsNew, displayName, address, quantities });
    if (!next) return setFormError("请选择资料，并为至少一个可登记餐次填写正整数份数");
    setFormError(""); setDraft(next);
  };
  const submit = () => {
    if (!draft) return;
    void api.submitCustomerReservations(draft.input).then((response) => {
      setResults(response.results); setProfile(response.profile); setCreateNew(false); setSaveAsNew(false);
      setProfiles((current) => current.some(({ id }) => String(id) === String(response.profile.id))
        ? current : [...current, response.profile]);
    }).catch(() => setFormError("提交失败，请稍后重试"));
  };

  if (error) return <View className="page booking-page"><Text className="notice">{error}</Text></View>;
  if (!view) return <View className="page booking-page"><Text>正在加载预订信息…</Text></View>;

  return (
    <View className="page booking-page">
      <Text className="title">{view.sellerName}</Text>
      <Text className="subtitle">{view.title}</Text>
      <Text className="batch-status">
        {view.status === "open" ? "开放登记" : view.status === "closed" ? "批次已关闭" : "批次已归档"}
      </Text>
      {view.slots.map((slot) => (
        <View className="card booking-slot" key={`${slot.date}-${slot.occasion}`}>
          <Text className="section-title">{slot.date} {occasionText(slot.occasion)}</Text>
          {slot.menuItems.map((item, index) => (
            <Text className="booking-menu-item" key={`${item.categorySnapshot}-${item.nameSnapshot}-${index}`}>
              {item.nameSnapshot}
            </Text>
          ))}
          <Text className="booking-price">{formatBookingPrice(slot.unitPriceCents)} / 份</Text>
          <Text className="meta">截止：{slot.orderDeadline ?? "未设置"}</Text>
          <Text className={slot.canBook ? "available" : "notice"}>
            {bookingUnavailableText(slot.unavailableReason)}
          </Text>
          {slot.canBook && !draft && <Input type="number" placeholder="份数"
            value={quantities[`${slot.date}:${slot.occasion}`] ?? ""}
            onInput={(event) => setQuantities((current) =>
              ({ ...current, [`${slot.date}:${slot.occasion}`]: event.detail.value }))} />}
        </View>
      ))}
      {view.slots.some(({ canBook }) => canBook) && !draft && <View className="card order-form">
        <Text className="section-title">登记资料</Text>
        <Text className="meta">{profileUseText(view.sellerName)}</Text>
        <View className="profile-list">
          {profiles.map((item) => <Button key={String(item.id)}
            className={String(profile?.id) === String(item.id) && !createNew ? "selected" : ""}
            onClick={() => selectProfile(item)}>{item.displayName}｜{item.address}</Button>)}
          <Button className={createNew ? "selected" : ""} onClick={newProfile}>使用新资料</Button>
        </View>
        <Input placeholder="称呼" value={displayName} onInput={(event) => setDisplayName(event.detail.value)} />
        <Input placeholder="送餐地址" value={address} onInput={(event) => setAddress(event.detail.value)} />
        {profile && !createNew && <Button onClick={() => setSaveAsNew((value) => !value)}>
          另存为新资料：{saveAsNew ? "是" : "否"}
        </Button>}
        {formError && <Text className="notice">{formError}</Text>}
        <Button className="primary" onClick={review}>查看确认摘要</Button>
      </View>}
      {draft && !results && <View className="card booking-summary">
        <Text className="section-title">确认摘要</Text>
        <Text>{draft.input.displayName}｜{draft.input.address}</Text>
        {draft.items.map((item) => <Text className="booking-summary-item"
          key={`${item.target.date}:${item.target.occasion}`}>
          {item.target.date} {occasionText(item.target.occasion)}：{item.quantity} 份 × {formatBookingPrice(item.unitPriceCents)}
        </Text>)}
        <Text>总计：{formatBookingPrice(draft.totalCents)}</Text>
        {formError && <Text className="notice">{formError}</Text>}
        <Button className="primary" onClick={submit}>确认提交</Button>
        <Button onClick={() => setDraft(null)}>返回修改</Button>
      </View>}
      {results && <View className="card booking-results">
        <Text className="section-title">登记结果</Text>
        {results.map((result) => <View className="booking-result" key={`${result.target.date}:${result.target.occasion}`}>
          <Text>{result.target.date} {occasionText(result.target.occasion)}</Text>
          <Text>{reservationResultText(result)}</Text>
        </View>)}
        <Button onClick={() => { setDraft(null); setResults(null); }}>继续修改</Button>
      </View>}
    </View>
  );
}
