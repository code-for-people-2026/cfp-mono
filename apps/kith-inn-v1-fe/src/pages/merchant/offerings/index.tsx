import { Button, Input, Switch, Text, Textarea, View } from "@tarojs/components";
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
  CATEGORY_FILTERS,
  ImportDraftTracker,
  OfferingToggleTracker,
  filterOfferingsByCategory,
  mergeSavedOffering,
  partitionOfferingsPreservingOrder,
  type CategoryFilter
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
  const previewRequestGeneration = useRef(0);
  const importCommitGeneration = useRef(0);
  const commitBusy = useRef(false);
  const [offerings, setOfferings] = useState<Offering[]>([]);
  const [view, setView] = useState<"browse" | "manage">("browse");
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [savePending, setSavePending] = useState(false);
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
  const browseOfferings = useMemo(
    () => filterOfferingsByCategory(groups.active, filter),
    [filter, groups.active]
  );

  const loadOfferings = async (initial: boolean): Promise<boolean> => {
    if (initial) {
      setLoading(true);
      setLoadError(false);
    }
    try {
      setOfferings(await api.listOfferings("all"));
      setLoadError(false);
      setRefreshMessage("");
      return true;
    } catch (error) {
      if (handledAuthFailure(error)) return false;
      if (initial) setLoadError(true);
      else {
        setRefreshMessage("菜品刷新失败，已保留当前列表");
        await Taro.showToast({ title: "菜品刷新失败", icon: "none" });
      }
      return false;
    } finally {
      if (initial) setLoading(false);
    }
  };

  useEffect(() => {
    if (merchantRoute(sessions.getSession()) === "login") {
      void Taro.redirectTo({ url: "/pages/merchant/login/index" });
    } else {
      void loadOfferings(true);
    }
  }, []);

  const resetForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setName("");
    setMainIngredient("");
    setCategory("veg");
  };

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setMainIngredient("");
    setCategory("veg");
    setFormOpen(true);
  };

  const save = async () => {
    if (savePending || !name.trim()) return;
    setSavePending(true);
    try {
      const input = { name, mainIngredient: mainIngredient.trim() || null, category };
      const doc = editingId === null
        ? await api.createOffering(input)
        : await api.updateOffering(editingId, input);
      const mode = editingId === null ? "create" : "edit";
      setOfferings((current) => mergeSavedOffering(current, doc, mode));
      resetForm();
      await Taro.showToast({ title: mode === "create" ? "菜品已新增" : "菜品已保存", icon: "success" });
    } catch (error) {
      if (handledAuthFailure(error)) return;
      await Taro.showToast({ title: "菜品保存失败", icon: "none" });
    } finally {
      setSavePending(false);
    }
  };

  const edit = (offering: Offering) => {
    setEditingId(offering.id);
    setName(offering.name);
    setMainIngredient(offering.mainIngredient ?? "");
    setCategory(offering.category);
    setFormOpen(true);
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
    const previewGeneration = ++previewRequestGeneration.current;
    try {
      const result = await api.previewOfferingImport(snapshot.text);
      if (
        commitBusy.current
        || previewGeneration !== previewRequestGeneration.current
        || commitGeneration !== importCommitGeneration.current
        || !importDraftTracker.current.isCurrent(snapshot)
      ) return;
      setPreview(result);
      setPreviewRevision(snapshot.revision);
      setConflicts([]);
      setCommit(null);
    } catch (error) {
      if (
        previewGeneration === previewRequestGeneration.current
        && commitGeneration === importCommitGeneration.current
        && importDraftTracker.current.isCurrent(snapshot)
        && !handledAuthFailure(error)
      ) {
        await Taro.showToast({ title: "导入预览失败", icon: "none" });
      }
    }
  };

  const commitText = async () => {
    const snapshot = importDraftTracker.current.capture();
    if (commitBusy.current || previewRevision !== snapshot.revision) return;
    commitBusy.current = true;
    previewRequestGeneration.current += 1;
    importCommitGeneration.current += 1;
    setPreviewRevision(null);
    setCommitPending(true);
    try {
      const result = await api.commitOfferingImport({ text: snapshot.text, conflicts });
      if (importDraftTracker.current.isCurrent(snapshot)) setCommit(result);
      await loadOfferings(false);
    } catch (error) {
      if (importDraftTracker.current.isCurrent(snapshot) && !handledAuthFailure(error)) {
        setPreview(null);
        setPreviewRevision(null);
        setConflicts([]);
        await Taro.showToast({ title: "导入提交失败", icon: "none" });
      }
    } finally {
      commitBusy.current = false;
      setCommitPending(false);
    }
  };

  const changeImportText = (value: string) => {
    if (commitBusy.current) return;
    previewRequestGeneration.current += 1;
    importDraftTracker.current.update(value);
    setImportText(value);
    setPreview(null);
    setPreviewRevision(null);
    setConflicts([]);
    setCommit(null);
  };

  const toggleView = () => {
    if (savePending || loading || loadError) return;
    if (view === "manage") {
      setView("browse");
      setImportOpen(false);
      resetForm();
    } else {
      setView("manage");
    }
  };

  const renderOffering = (offering: Offering, manageable: boolean) => (
    <View
      className={`offering-row offering-card${offering.active ? "" : " inactive"}`}
      key={String(offering.id)}
    >
      <View className={`offering-icon ${offering.category}`}>
        <Text>{offering.category === "meat" ? "荤" : offering.category === "veg" ? "素" : "汤"}</Text>
      </View>
      <View className="offering-copy">
        <Text className="offering-name">{offering.name}</Text>
        <Text className="meta">
          {offering.mainIngredient ? `主料：${offering.mainIngredient}` : "未填写主料"}
        </Text>
      </View>
      {manageable && (
        <Button size="mini" aria-label={`编辑 ${offering.name}`} onClick={() => edit(offering)}>
          编辑
        </Button>
      )}
      <Switch
        aria-label={`${offering.active ? "停用" : "恢复"} ${offering.name}`}
        checked={offering.active}
        disabled={togglingIds.includes(String(offering.id))}
        onChange={(event) => void toggleActive(offering, event.detail.value)}
      />
    </View>
  );

  return (
    <View className="page offerings-page">
      <View className="offerings-header">
        <View>
          <Text className="title">菜品库</Text>
          <Text className="subtitle">
            {view === "browse" ? "常做的菜，随用随选" : "维护启用状态与菜品资料"}
          </Text>
        </View>
        <Button
          className="offerings-manage-toggle"
          disabled={savePending || loading || loadError}
          onClick={toggleView}
        >
          {view === "manage" ? "完成" : "管理"}
        </Button>
      </View>

      {refreshMessage && (
        <View className="card page-state notice">
          <Text>{refreshMessage}</Text>
        </View>
      )}

      {loading ? (
        <View className="card page-state">
          <Text>菜品加载中</Text>
        </View>
      ) : loadError ? (
        <View className="card page-state">
          <Text>菜品加载失败</Text>
          <Button onClick={() => void loadOfferings(true)}>重试</Button>
        </View>
      ) : view === "browse" ? (
        <View className="card offerings-browse">
          <Text className="section-title">常做的菜</Text>
          <View className="offering-filters">
            {CATEGORY_FILTERS.map((item) => (
              <Button
                key={item.value}
                className={filter === item.value ? "offering-filter selected" : "offering-filter"}
                onClick={() => setFilter(item.value)}
              >
                {item.label}
              </Button>
            ))}
          </View>
          {browseOfferings.map((offering) => renderOffering(offering, false))}
          {browseOfferings.length === 0 && (
            <Text className="offerings-empty">
              {groups.active.length === 0 ? "还没有启用菜品" : "这个分类还没有菜品"}
            </Text>
          )}
        </View>
      ) : (
        <>
          <View className="offerings-manage-actions">
            <Button onClick={() => setImportOpen((current) => !current)}>
              {importOpen ? "收起导入" : "批量导入"}
            </Button>
          </View>

          {importOpen && (
            <View className="card import-card">
              <Text className="section-title">批量导入菜品</Text>
              <Textarea
                disabled={commitPending}
                maxlength={20_000}
                placeholder="每行一道菜"
                value={importText}
                onInput={(event) => changeImportText(event.detail.value)}
              />
              <Button disabled={!importText.trim() || commitPending} onClick={() => void previewText()}>
                预览导入
              </Button>
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
                        >
                          覆盖
                        </Button>
                      )}
                    </View>
                  ))}
                  <Button
                    className="primary"
                    disabled={commitPending || previewRevision !== importDraftTracker.current.currentRevision}
                    onClick={() => void commitText()}
                  >
                    确认导入
                  </Button>
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
          )}

          <View className="card offerings-manage-group">
            <Text className="section-title">启用中</Text>
            {groups.active.map((offering) => renderOffering(offering, true))}
            {groups.active.length === 0 && <Text className="offerings-empty">暂无启用菜品</Text>}
          </View>

          <View className="card offerings-manage-group inactive-group">
            <Text className="section-title">已停用</Text>
            {groups.inactive.map((offering) => renderOffering(offering, true))}
            {groups.inactive.length === 0 && <Text className="offerings-empty">暂无停用菜品</Text>}
          </View>
        </>
      )}

      {!loading && !loadError && view === "manage" && !formOpen && (
        <Button className="offering-add-fixed primary" onClick={openCreate}>新增菜品</Button>
      )}

      {formOpen && (
        <View className="offering-sheet-backdrop">
          <View className="offering-sheet card form-card">
            <Text className="section-title">{editingId === null ? "新增菜品" : "编辑菜品"}</Text>
            <Input
              disabled={savePending}
              placeholder="菜名"
              value={name}
              onInput={(event) => setName(event.detail.value)}
            />
            <Input
              disabled={savePending}
              placeholder="主料（可不填）"
              value={mainIngredient}
              onInput={(event) => setMainIngredient(event.detail.value)}
            />
            <View className="category-row">
              {CATEGORIES.map((item) => (
                <Button
                  key={item.value}
                  className={category === item.value ? "category selected" : "category"}
                  disabled={savePending}
                  onClick={() => setCategory(item.value)}
                >
                  {item.label}
                </Button>
              ))}
            </View>
            <View className="offering-form-actions">
              <Button disabled={savePending} onClick={resetForm}>取消</Button>
              <Button
                className="primary"
                disabled={savePending || !name.trim()}
                onClick={() => void save()}
              >
                {savePending ? "保存中…" : editingId === null ? "新增菜品" : "保存修改"}
              </Button>
            </View>
          </View>
        </View>
      )}
      <MerchantNav active="offerings" />
    </View>
  );
}
