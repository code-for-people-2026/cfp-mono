import Taro from "@tarojs/taro";
import { useCallback, useEffect, useState } from "react";
import { Input, Text, View } from "@tarojs/components";
import { Button } from "@nutui/nutui-react-taro";
import type { Offering, OfferingCategory, OfferingUpdate } from "@cfp/kith-inn-shared";
import { TopBar } from "@/components/TopBar";
import { groupByMainIngredient, type OfferingGroup } from "@/logic/groupByMainIngredient";
import {
  createOffering,
  deactivateOffering,
  partitionByActive,
  restoreOffering,
  updateOffering,
  type Req,
} from "@/logic/offeringsCrud";
import { offeringsUrl } from "@/services/api";
import { createTokenStore, type Storage } from "@/store/auth";

const taroStorage: Storage = {
  get: (k) => Taro.getStorageSync(k) || null,
  set: (k, v) => Taro.setStorageSync(k, v),
  remove: (k) => Taro.removeStorageSync(k),
};
const tokens = createTokenStore(taroStorage);
// ponytail: cast — Taro.request is structurally a Req at runtime; the typed logic
// layer stays unit-testable with a plain vi.fn (page is display, covered by e2e).
const req = Taro.request as unknown as Req;

const CATEGORIES: { value: OfferingCategory; label: string }[] = [
  { value: "meat", label: "荤" },
  { value: "veg", label: "素" },
  { value: "soup", label: "汤" },
  { value: "staple", label: "主食" },
];

type Form = { name: string; mainIngredient: string; category: OfferingCategory };
const EMPTY_FORM: Form = { name: "", mainIngredient: "", category: "veg" };

export default function Kitchen() {
  const [groups, setGroups] = useState<OfferingGroup[]>([]);
  const [inactive, setInactive] = useState<Offering[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);

  const load = useCallback(() => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return;
    }
    Taro.request({ url: offeringsUrl(), header: { Authorization: `Bearer ${token}` } })
      .then((res) => {
        if (res.statusCode === 401) {
          tokens.clearToken();
          Taro.redirectTo({ url: "/pages/login/index" });
          return;
        }
        if (res.statusCode !== 200) {
          Taro.showToast({ title: "加载失败", icon: "error" });
          return;
        }
        const all = (res.data as { offerings?: Offering[] }).offerings ?? [];
        const { active, inactive } = partitionByActive(all);
        setGroups(groupByMainIngredient(active));
        setInactive(inactive);
      })
      .catch(() => Taro.showToast({ title: "加载失败", icon: "error" }));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const requireToken = (): string | null => {
    const token = tokens.getToken();
    if (!token) {
      Taro.redirectTo({ url: "/pages/login/index" });
      return null;
    }
    return token;
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const submit = async () => {
    const name = form.name.trim();
    if (!name) {
      Taro.showToast({ title: "菜名必填", icon: "none" });
      return;
    }
    const token = requireToken();
    if (!token) return;
    const mi = form.mainIngredient.trim();
    try {
      if (editingId != null) {
        // null = explicitly clear 主料 (undefined would be dropped by JSON.stringify → field unchanged, Codex #112 P2).
        const patch: OfferingUpdate = { name, category: form.category, mainIngredient: mi === "" ? null : mi };
        await updateOffering({ token, id: editingId, patch }, req);
      } else {
        await createOffering({ token, name, mainIngredient: mi || undefined, category: form.category }, req);
      }
      closeForm();
      load();
    } catch {
      Taro.showToast({ title: "保存失败", icon: "error" });
    }
  };

  const edit = (o: Offering) => {
    setEditingId(o.id);
    setForm({ name: o.name, mainIngredient: o.mainIngredient ?? "", category: o.category ?? "veg" });
    setFormOpen(true);
  };

  const del = async (o: Offering) => {
    const token = requireToken();
    if (!token) return;
    const c = await Taro.showModal({ title: "移出菜品池", content: `把「${o.name}」移到已停用？可随时恢复。` });
    if (!c.confirm) return;
    try {
      await deactivateOffering({ token, id: o.id }, req);
      load();
    } catch {
      Taro.showToast({ title: "删除失败", icon: "error" });
    }
  };

  const restore = async (o: Offering) => {
    const token = requireToken();
    if (!token) return;
    try {
      await restoreOffering({ token, id: o.id }, req);
      load();
    } catch {
      Taro.showToast({ title: "恢复失败", icon: "error" });
    }
  };

  const isEmpty = groups.length === 0 && inactive.length === 0;

  return (
    <View className="page-shell">
      <TopBar title="桃子的灶台" subtitle="菜品池" />
      <View className="px-[32rpx] pb-[60rpx] pt-[32rpx]">
        <View className="mb-[24rpx] flex justify-end">
          <Button size="small" type="primary" className="bg-red text-white" onClick={() => { setEditingId(null); setForm(EMPTY_FORM); setFormOpen(true); }}>
            + 新增菜品
          </Button>
        </View>

        {formOpen && (
          <View className="mb-[32rpx] card bg-surface p-[24rpx]">
            <Text className="mb-[16rpx] block text-[28rpx] font-bold">{editingId != null ? "编辑菜品" : "新增菜品"}</Text>
            <Text className="mb-[8rpx] block text-[24rpx] text-muted">菜名</Text>
            <Input
              value={form.name}
              placeholder="如 蒜蓉空心菜"
              onInput={(e) => setForm((f) => ({ ...f, name: e.detail.value }))}
              className="mb-[16rpx] rounded-[12rpx] border border-line bg-white px-[16rpx] py-[12rpx] text-[28rpx]"
            />
            <Text className="mb-[8rpx] block text-[24rpx] text-muted">主料（可选）</Text>
            <Input
              value={form.mainIngredient}
              placeholder="如 青菜"
              onInput={(e) => setForm((f) => ({ ...f, mainIngredient: e.detail.value }))}
              className="mb-[16rpx] rounded-[12rpx] border border-line bg-white px-[16rpx] py-[12rpx] text-[28rpx]"
            />
            <Text className="mb-[8rpx] block text-[24rpx] text-muted">分类</Text>
            <View className="mb-[24rpx] flex gap-[16rpx]">
              {CATEGORIES.map((c) => (
                <Button
                  key={c.value}
                  size="small"
                  type={form.category === c.value ? "primary" : "default"}
                  className={form.category === c.value ? "bg-red text-white" : "bg-surface text-ink"}
                  onClick={() => setForm((f) => ({ ...f, category: c.value }))}
                >
                  {c.label}
                </Button>
              ))}
            </View>
            <View className="flex gap-[16rpx]">
              <Button size="small" type="primary" className="bg-red text-white" onClick={submit}>
                保存
              </Button>
              <Button size="small" className="bg-surface text-ink" onClick={closeForm}>
                取消
              </Button>
            </View>
          </View>
        )}

        {isEmpty ? (
          <Text className="block py-[24rpx] text-center text-[24rpx] text-muted">菜品池还是空的。</Text>
        ) : (
          groups.map((group) => (
            <View key={group.mainIngredient} className="mt-[32rpx] first:mt-0">
              <Text className="block text-[30rpx] font-bold text-amber">主料 · {group.mainIngredient}</Text>
              {group.offerings.map((offering) => (
                <View key={String(offering.id)} className="flex flex-wrap items-baseline gap-[12rpx] border-b border-line py-[14rpx] last:border-b-0">
                  <Text className="text-[32rpx]">{offering.name}</Text>
                  {offering.category ? (
                    <Text className="text-[24rpx] text-muted">{CATEGORIES.find((c) => c.value === offering.category)?.label}</Text>
                  ) : null}
                  <View className="ml-auto flex gap-[12rpx]">
                    <Button size="small" className="bg-surface text-ink" onClick={() => edit(offering)}>
                      编辑
                    </Button>
                    <Button size="small" className="bg-surface text-muted" onClick={() => del(offering)}>
                      删除
                    </Button>
                  </View>
                </View>
              ))}
            </View>
          ))
        )}

        {inactive.length > 0 && (
          <View className="mt-[48rpx] rounded-[16rpx] border border-dashed border-line bg-wash/50 p-[24rpx]">
            <Text className="mb-[16rpx] block text-[26rpx] font-bold text-muted">已停用（{inactive.length}）</Text>
            {inactive.map((offering) => (
              <View key={String(offering.id)} className="flex items-baseline gap-[12rpx] border-b border-line py-[12rpx] last:border-b-0">
                <Text className="text-[28rpx] text-muted line-through">{offering.name}</Text>
                <View className="ml-auto">
                  <Button size="small" type="primary" className="bg-amber text-white" onClick={() => restore(offering)}>
                    恢复
                  </Button>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
