import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useMemo, useState } from "react";
import type {
  ImportCommitInput,
  ImportCommitResponse,
  ImportPreviewResponse,
  Offering,
  OfferingCategory
} from "@cfp/kith-inn-v1-shared";
import {
  commitResultText,
  commitSummaryText,
  partitionOfferings,
  previewSummaryText,
  setConflictAction
} from "@/logic/offeringsImport";
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

const CATEGORIES: Array<{ value: OfferingCategory; label: string }> = [
  { value: "meat", label: "荤" },
  { value: "veg", label: "素" },
  { value: "soup", label: "汤" }
];

export default function MerchantOfferings() {
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [name, setName] = useState("");
  const [mainIngredient, setMainIngredient] = useState("");
  const [category, setCategory] = useState<OfferingCategory>("veg");
  const [importText, setImportText] = useState("");
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [conflicts, setConflicts] = useState<ImportCommitInput["conflicts"]>([]);
  const [commit, setCommit] = useState<ImportCommitResponse | null>(null);
  const groups = useMemo(() => partitionOfferings(offerings), [offerings]);

  const load = async () => setOfferings(await api.listOfferings("all"));

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "login") {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
    } else {
      void load().catch((error: unknown) => {
        if (handledAuthFailure(error)) return;
        return Taro.showToast({ title: "菜品加载失败", icon: "none" });
      });
    }
  }, []);

  const resetForm = () => {
    setEditingId(null);
    setName("");
    setMainIngredient("");
    setCategory("veg");
  };

  const save = async () => {
    try {
      const input = { name, mainIngredient: mainIngredient.trim() || null, category };
      const doc = editingId === null
        ? await api.createOffering(input)
        : await api.updateOffering(editingId, input);
      setOfferings((current) => [...current.filter((item) => String(item.id) !== String(doc.id)), doc]);
      resetForm();
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: "菜品保存失败", icon: "none" });
    }
  };

  const edit = (offering: Offering) => {
    setEditingId(offering.id);
    setName(offering.name);
    setMainIngredient(offering.mainIngredient ?? "");
    setCategory(offering.category);
  };

  const toggleActive = async (offering: Offering, active: boolean) => {
    try {
      const doc = await api.updateOffering(offering.id, { active });
      setOfferings((current) => current.map((item) => String(item.id) === String(doc.id) ? doc : item));
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: active ? "恢复失败" : "停用失败", icon: "none" });
    }
  };

  const previewText = async () => {
    try {
      setPreview(await api.previewOfferingImport(importText));
      setConflicts([]);
      setCommit(null);
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: "导入预览失败", icon: "none" });
    }
  };

  const commitText = async () => {
    try {
      const result = await api.commitOfferingImport({ text: importText, conflicts });
      setCommit(result);
      await load();
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: "导入提交失败", icon: "none" });
    }
  };

  const changeImportText = (value: string) => {
    setImportText(value);
    setPreview(null);
    setConflicts([]);
    setCommit(null);
  };

  return (
    <View className="page offerings-page">
      <Text className="title">菜品池</Text>
      <Button onClick={() => void Taro.navigateTo({ url: "/pages/merchant/menu/index" })}>菜单</Button>

      <View className="card form-card">
        <Text className="section-title">{editingId === null ? "新增菜品" : "编辑菜品"}</Text>
        <Input placeholder="菜名" value={name} onInput={(event) => setName(event.detail.value)} />
        <Input placeholder="主料（可不填）" value={mainIngredient} onInput={(event) => setMainIngredient(event.detail.value)} />
        <View className="category-row">
          {CATEGORIES.map((item) => (
            <Button
              key={item.value}
              className={category === item.value ? "category selected" : "category"}
              onClick={() => setCategory(item.value)}
            >
              {item.label}
            </Button>
          ))}
        </View>
        <Button className="primary" disabled={!name.trim()} onClick={() => void save()}>
          {editingId === null ? "新增菜品" : "保存修改"}
        </Button>
      </View>

      <View className="card">
        <Text className="section-title">启用菜品</Text>
        {groups.active.map((offering) => (
          <View className="offering-row" key={String(offering.id)}>
            <View className="offering-copy">
              <Text>{offering.name}</Text>
              <Text className="meta">{offering.mainIngredient ?? "无主料"}</Text>
            </View>
            <Button size="mini" aria-label={`编辑 ${offering.name}`} onClick={() => edit(offering)}>编辑</Button>
            <Button size="mini" aria-label={`停用 ${offering.name}`} onClick={() => void toggleActive(offering, false)}>停用</Button>
          </View>
        ))}
      </View>

      <View className="card">
        <Text className="section-title">已停用菜品</Text>
        {groups.inactive.map((offering) => (
          <View className="offering-row" key={String(offering.id)}>
            <Text>{offering.name}</Text>
            <Button size="mini" aria-label={`恢复 ${offering.name}`} onClick={() => void toggleActive(offering, true)}>恢复</Button>
          </View>
        ))}
      </View>

      <View className="card import-card">
        <Text className="section-title">批量导入</Text>
        <Textarea
          maxlength={20_000}
          placeholder="每行一道菜"
          value={importText}
          onInput={(event) => changeImportText(event.detail.value)}
        />
        <Button onClick={() => void previewText()}>预览导入</Button>
        {preview && (
          <View>
            <Text>{previewSummaryText(preview)}</Text>
            {preview.rows.map((row) => (
              <View className="preview-row" key={row.line}>
                <Text>第 {row.line} 行：{row.status === "invalid" ? row.error : row.parsed.name}</Text>
                {row.status === "conflict" && (
                  <Button
                    size="mini"
                    aria-label={`覆盖第 ${row.line} 行`}
                    onClick={() => setConflicts((current) => setConflictAction(current, row.line, "overwrite"))}
                  >覆盖</Button>
                )}
              </View>
            ))}
            <Button className="primary" onClick={() => void commitText()}>确认导入</Button>
          </View>
        )}
        {commit && (
          <View>
            <Text>{commitSummaryText(commit)}</Text>
            {commit.results.map((result) => (
              <Text key={`${result.line}-${result.status}`}>
                第 {result.line} 行：{commitResultText(result)}
              </Text>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}
