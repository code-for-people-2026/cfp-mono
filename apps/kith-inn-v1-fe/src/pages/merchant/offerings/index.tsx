import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useEffect, useMemo, useRef, useState } from "react";
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
  previewSummaryText,
  setConflictAction
} from "@/logic/offeringsImport";
import {
  ImportDraftTracker,
  OfferingToggleTracker,
  mergeSavedOffering,
  partitionOfferingsPreservingOrder
} from "@/logic/offeringsView";
import { MerchantNav } from "@/components/MerchantNav";
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
  const toggleTracker = useRef(new OfferingToggleTracker());
  const importDraftTracker = useRef(new ImportDraftTracker(""));
  const importCommitGeneration = useRef(0);
  const commitBusy = useRef(false);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [name, setName] = useState("");
  const [mainIngredient, setMainIngredient] = useState("");
  const [category, setCategory] = useState<OfferingCategory>("veg");
  const [importText, setImportText] = useState("");
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  const [conflicts, setConflicts] = useState<ImportCommitInput["conflicts"]>([]);
  const [commit, setCommit] = useState<ImportCommitResponse | null>(null);
  const [togglingIds, setTogglingIds] = useState<string[]>([]);
  const [commitPending, setCommitPending] = useState(false);
  const groups = useMemo(() => partitionOfferingsPreservingOrder(offerings), [offerings]);

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
      const mode = editingId === null ? "create" : "edit";
      setOfferings((current) => mergeSavedOffering(current, doc, mode));
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
    const id = String(offering.id);
    const requestRevision = toggleTracker.current.begin(id);
    if (requestRevision === null) return;
    setTogglingIds((current) => current.includes(id) ? current : [...current, id]);
    try {
      const doc = await api.updateOffering(offering.id, { active });
      if (!toggleTracker.current.isCurrent(id, requestRevision)) return;
      setOfferings((current) => current.map((item) => String(item.id) === String(doc.id) ? doc : item));
    } catch (error) {
      if (toggleTracker.current.isCurrent(id, requestRevision) && !handledAuthFailure(error)) {
        await Taro.showToast({ title: active ? "恢复失败" : "停用失败", icon: "none" });
      }
    } finally {
      if (toggleTracker.current.finish(id, requestRevision)) {
        setTogglingIds((current) => current.filter((item) => item !== id));
      }
    }
  };

  const previewText = async () => {
    const snapshot = importDraftTracker.current.capture();
    const commitGeneration = importCommitGeneration.current;
    if (!snapshot.text.trim() || commitBusy.current) return;
    try {
      const result = await api.previewOfferingImport(snapshot.text);
      if (
        commitBusy.current
        || commitGeneration !== importCommitGeneration.current
        || !importDraftTracker.current.isCurrent(snapshot)
      ) return;
      setPreview(result);
      setPreviewRevision(snapshot.revision);
      setConflicts([]);
      setCommit(null);
    } catch (error) {
      if (importDraftTracker.current.isCurrent(snapshot) && !handledAuthFailure(error)) {
        await Taro.showToast({ title: "导入预览失败", icon: "none" });
      }
    }
  };

  const commitText = async () => {
    const snapshot = importDraftTracker.current.capture();
    if (commitBusy.current || previewRevision !== snapshot.revision) return;
    commitBusy.current = true;
    importCommitGeneration.current += 1;
    setPreviewRevision(null);
    setCommitPending(true);
    try {
      const result = await api.commitOfferingImport({ text: snapshot.text, conflicts });
      if (importDraftTracker.current.isCurrent(snapshot)) setCommit(result);
      await load();
    } catch (error) {
      if (importDraftTracker.current.isCurrent(snapshot) && !handledAuthFailure(error)) {
        await Taro.showToast({ title: "导入提交失败", icon: "none" });
      }
    } finally {
      commitBusy.current = false;
      setCommitPending(false);
    }
  };

  const changeImportText = (value: string) => {
    if (commitBusy.current) return;
    importDraftTracker.current.update(value);
    setImportText(value);
    setPreview(null);
    setPreviewRevision(null);
    setConflicts([]);
    setCommit(null);
  };

  return (
    <View className="page offerings-page">
      <Text className="title">菜品池</Text>

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
            <Button
              size="mini"
              aria-label={`停用 ${offering.name}`}
              disabled={togglingIds.includes(String(offering.id))}
              onClick={() => void toggleActive(offering, false)}
            >停用</Button>
          </View>
        ))}
      </View>

      <View className="card">
        <Text className="section-title">已停用菜品</Text>
        {groups.inactive.map((offering) => (
          <View className="offering-row" key={String(offering.id)}>
            <Text>{offering.name}</Text>
            <Button
              size="mini"
              aria-label={`恢复 ${offering.name}`}
              disabled={togglingIds.includes(String(offering.id))}
              onClick={() => void toggleActive(offering, true)}
            >恢复</Button>
          </View>
        ))}
      </View>

      <View className="card import-card">
        <Text className="section-title">批量导入</Text>
        <Textarea
          disabled={commitPending}
          maxlength={20_000}
          placeholder="每行一道菜"
          value={importText}
          onInput={(event) => changeImportText(event.detail.value)}
        />
        <Button disabled={!importText.trim() || commitPending} onClick={() => void previewText()}>预览导入</Button>
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
                    disabled={commitPending}
                    onClick={() => setConflicts((current) => setConflictAction(current, row.line, "overwrite"))}
                  >覆盖</Button>
                )}
              </View>
            ))}
            <Button
              className="primary"
              disabled={commitPending || previewRevision !== importDraftTracker.current.currentRevision}
              onClick={() => void commitText()}
            >确认导入</Button>
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
      <MerchantNav active="offerings" />
    </View>
  );
}
