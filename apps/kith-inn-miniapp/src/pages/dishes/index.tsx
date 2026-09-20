import { useEffect, useState, type ReactNode } from "react";
import Taro from "@tarojs/taro";
import { Button as TaroButton, Input, ScrollView, Switch, Text, Textarea, View } from "@tarojs/components";
import { DishUpdateInputSchema, type Dish, type DishInput } from "@cfp/kith-inn-contracts";
import { ClientError, createKithInnClient, type WriteResult } from "../../lib/api";
import { cycleCategory, labels, previewDishes } from "../../lib/classify";

function Button(props: { children: ReactNode; onClick: () => void; disabled?: boolean; className?: string; ariaLabel?: string }) {
  // H5's Taro button custom element lacks native keyboard and disabled semantics.
  const className = `action-button ${props.className ?? ""}`;
  return process.env.TARO_ENV === "h5"
    ? <button type="button" className={className} disabled={props.disabled} aria-label={props.ariaLabel} onClick={props.onClick}>{props.children}</button>
    : <TaroButton {...props} className={className} />;
}

export default function DishesPage() {
  const [client] = useState(() => { try { return createKithInnClient(); } catch { return null; } });
  const [items, setItems] = useState<Dish[]>([]), [loaded, setLoaded] = useState(false);
  const [signedIn, setSignedIn] = useState(() => client?.restoreSession() ?? false);
  const [stage, setStage] = useState<"list" | "input" | "preview">("list");
  const [source, setSource] = useState(""), [preview, setPreview] = useState<DishInput[]>([]);
  const [edit, setEdit] = useState<Dish | null>(null), [original, setOriginal] = useState<Dish | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [conflict, setConflict] = useState(false), [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(() => client?.pendingWrite() ?? null);
  const [now, setNow] = useState(Date.now), [retryAt, setRetryAt] = useState(0);
  const blocked = !!pending && pending.state !== "rejected";
  const needsReview = !!pending && (pending.state === "review" || now - pending.createdAt >= 86_400_000);
  const cooling = now < retryAt, disabled = busy || blocked;
  const dirty = !!source.trim() || !!preview.length || !!edit &&
    (edit.name !== original?.name || edit.category !== original?.category || edit.active !== original?.active);
  const latest = edit ? items.find((dish) => dish.id === edit.id) : undefined;

  useEffect(() => {
    if (blocked || cooling) {
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(timer);
    }
  }, [blocked, cooling]);
  useEffect(() => {
    if (!dirty && !blocked) return;
    if (process.env.TARO_ENV === "weapp") {
      Taro.enableAlertBeforeUnload({ message: "还有未保存或未确认的修改，离开后不会保留草稿" });
      return () => Taro.disableAlertBeforeUnload();
    }
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, blocked]);

  function failure(value: unknown) {
    const issue = value instanceof Error ? value : new Error("操作未完成，请重试");
    setError(issue.message + (issue instanceof ClientError && issue.details?.names ? `：${issue.details.names.join("、")}` : ""));
    if (issue instanceof ClientError) {
      if (issue.code === "VERSION_CONFLICT") { setConflict(true); setReviewed(false); }
      if (issue.retryAt) { setRetryAt(issue.retryAt); setNow(Date.now()); }
    }
  }
  async function run(action: () => Promise<void>) {
    if (busy || !client) return;
    setBusy(true); setError("");
    try { await action(); } catch (value) { failure(value); }
    finally {
      setPending(client.pendingWrite()); setSignedIn(client.restoreSession()); setBusy(false);
    }
  }
  async function read() {
    const started = Date.now(), operation = client!.pendingWrite();
    const result = await client!.getDishes();
    setItems(result); setLoaded(true);
    setReviewed(!operation || operation.state !== "unknown" || started - operation.createdAt >= 86_400_000);
  }
  useEffect(() => { if (client?.restoreSession()) void run(read); }, [client]);

  function clearDraft() {
    setSource(""); setPreview([]); setEdit(null); setOriginal(null); setStage("list");
    setConflict(false); setReviewed(false);
  }
  async function confirmDiscard() {
    return !dirty || (await Taro.showModal({ title: "放弃未保存修改？",
      content: "当前草稿还没有保存，放弃后需要重新填写。", confirmText: "放弃修改", cancelText: "继续编辑" })).confirm;
  }
  async function cancel() {
    if (disabled) return;
    if (await confirmDiscard()) { clearDraft(); setError(""); }
  }
  async function saved(result: WriteResult) {
    clearDraft();
    setNotice(result.kind === "batch" ? `已新增 ${result.items.length} 道菜` : "菜品修改已保存");
    // The write is confirmed even if refreshing the latest list subsequently fails.
    try { await read(); }
    catch { throw new Error("保存已确认，但菜品池暂时读取失败。请重新读取查看最新内容。"); }
  }
  function previewInput() {
    try { setPreview(previewDishes(source, preview)); setStage("preview"); setError(""); }
    catch (value) { failure(value); }
  }
  async function loadLatest() {
    if (!latest || !reviewed || disabled) return;
    const answer = await Taro.showModal({ title: "载入最新版本？", content: "这会替换当前未保存修改，请先核对服务器最新内容。" });
    if (answer.confirm) { setEdit({ ...latest }); setOriginal(latest); setConflict(false); setError(""); }
  }
  async function acknowledge() {
    if (!reviewed || !needsReview) return;
    const answer = await Taro.showModal({ title: "已核对保存结果？",
      content: "请对照当前菜品池与保留的草稿确认实际结果。继续后可重新编辑，不会自动再保存。" });
    if (answer.confirm) {
      try { client!.discardPendingAfterReview(); setPending(null); setReviewed(false); setError(""); }
      catch (value) { failure(value); }
    }
  }
  const activeCount = items.filter((dish) => dish.active).length;

  return <View className="dish-page">
    <View className="brand"><Text className="brand-mark">味</Text><Text>街坊味</Text><Text className="merchant-label">桃子的厨房</Text></View>
    <View className="page-heading"><Text className="eyebrow">从熟悉的拿手菜开始</Text><Text className="title">我的菜品池</Text>
      <Text className="muted">先存好菜名，排一周的饭就轻松些。</Text></View>
    {!client ? <View className="alert">尚未配置街坊味服务，请联系维护者配置后再使用。</View> : <>
      <View className="toolbar">
        <Text className="muted">{loaded && signedIn ? `${activeCount} 道已启用 · 共 ${items.length} 道` : "菜品和分类由桃子确认"}</Text>
        {signedIn && <Button className="text-button" disabled={busy || blocked} onClick={() => void run(async () => {
          if (await confirmDiscard()) { await client.logout(); clearDraft(); setItems([]); setLoaded(false); }
        })}>退出登录</Button>}
      </View>
      {error && <View className="alert" ariaRole="alert">{error}</View>}
      {notice && <View className="success" ariaRole="status">{notice}</View>}
      {cooling && <View className="hint">请等待 {Math.ceil((retryAt - now) / 1000)} 秒后重试。</View>}
      {blocked && <View className="recovery">
        <Text className="section-title">保存结果尚未确认</Text>
        <Text>{needsReview ? "安全重试期限已过或请求标识需核对。请重新读取菜品池，核对本次草稿。" : "可能已经保存。请重试原请求，结果确认前暂不能修改或放弃。"}</Text>
        {needsReview && reviewed && <ScrollView className="review-list" scrollY><Text className="section-title">本次读取的菜品池</Text>
          {!items.length ? <Text>当前没有已保存菜品。</Text> : items.map((dish) => <Text key={dish.id}>
            {dish.name} · {labels[dish.category]} · {dish.active ? "已启用" : "已停用"}</Text>)}
          <Text>请与下方保留的草稿对照，确认是否已经保存。</Text></ScrollView>}
        <View className="actions">
          {!needsReview && <Button disabled={busy || cooling || !signedIn} onClick={() => void run(async () => saved(await client.retryPendingWrite()))}>重试原请求</Button>}
          <Button disabled={busy || cooling || !signedIn} onClick={() => void run(read)}>重新读取</Button>
          {needsReview && <Button disabled={busy || !reviewed} onClick={() => void acknowledge()}>已核对，继续编辑</Button>}
        </View>
      </View>}
      {!signedIn && <View className="panel login-panel">
        <Text className="section-title">欢迎回到自己的厨房</Text>
        <Text className="muted">仅桃子绑定的微信账号可使用。登录后可找回已保存的菜品。</Text>
        {process.env.TARO_ENV === "h5" && <Text className="hint">请在微信小程序中登录，浏览器不能完成微信登录。</Text>}
        <Button className="primary" disabled={busy || cooling} onClick={() => void run(async () => { await client.login(); await read(); })}>微信登录</Button>
      </View>}
      {signedIn && stage === "list" && !edit && <>
        <View className="list-actions"><Button className="primary" disabled={disabled || cooling} onClick={() => {
          setStage("input"); setNotice(""); setError("");
        }}>批量添加</Button><Button disabled={busy || cooling} onClick={() => void run(read)}>重新读取</Button></View>
        {!loaded ? <View className="empty">{busy ? "正在读取菜品池…" : "还未读取到菜品池，请重新读取。"}</View> : !items.length ?
          <View className="empty"><Text className="empty-icon">一菜一味</Text><Text className="section-title">把拿手菜收进来</Text>
            <Text className="muted">从微信或备忘录复制菜名，每行一道；确认分类后就能保存。</Text></View> :
          <View className="dish-list">{items.map((dish) => <View className={`dish-card ${dish.active ? "" : "inactive"}`} key={dish.id}>
            <View className="dish-info"><Text className="dish-name">{dish.name}</Text><View className="dish-meta">
              <Text className={`category ${dish.category}`}>{labels[dish.category]}</Text><Text>{dish.active ? "已启用" : "已停用"}</Text></View></View>
            <Button className="text-button" disabled={disabled || cooling} onClick={() => {
              setEdit({ ...dish }); setOriginal(dish); setNotice(""); setError(""); setConflict(false);
            }}>编辑</Button></View>)}</View>}
      </>}
      {stage !== "list" && <View className="panel">
        <View className="section-heading"><Text className="section-title">{stage === "input" ? "批量添加菜名" : `${preview.length} 道菜待加入`}</Text><Text className="unsaved">未保存</Text></View>
        {stage === "input" ? <><Text className="muted">每行一道菜，最多 200 道。先看看建议分类，确认后才会保存。</Text>
          <Textarea className="dish-source" placeholder="每行一道菜，例如：红烧排骨" ariaLabel="菜名清单" maxlength={-1}
            value={source} disabled={disabled} onInput={(event) => setSource(event.detail.value)} />
          <Button className="primary" disabled={disabled || !source.trim()} onClick={previewInput}>预览分类</Button></> : <>
          <Text className="muted">分类只是建议，点击右侧按钮按 荤 → 素 → 汤 循环纠正。</Text>
          <View className="preview-list">{preview.map((dish, index) => <View className="preview-row" key={dish.name}>
            <Text>{dish.name}</Text><Button className={`category-button ${dish.category}`} disabled={disabled}
              ariaLabel={`更改${dish.name}分类，当前${labels[dish.category]}`} onClick={() => setPreview(preview.map((value, at) =>
                at === index ? { ...value, category: cycleCategory(value.category) } : value))}>{labels[dish.category]} ↻</Button></View>)}</View>
          <Button className="primary" disabled={disabled || cooling || !signedIn} onClick={() => void run(async () => saved(await client.addDishes({ items: preview })))}>确认加入菜品池</Button>
          <Button disabled={disabled} onClick={() => setStage("input")}>返回修改菜名</Button></>}
        <Button className="text-button cancel" disabled={disabled} onClick={() => void cancel()}>取消添加</Button>
      </View>}
      {edit && <View className="panel">
        <View className="section-heading"><Text className="section-title">编辑菜品</Text><Text className="unsaved">{dirty ? "未保存" : "修改后请保存"}</Text></View>
        <Text className="field-label">菜名</Text><Input className="dish-input" placeholder="菜名" ariaLabel="菜名" maxlength={-1}
          disabled={disabled} value={edit.name} onInput={(event) => setEdit({ ...edit, name: event.detail.value })} />
        <View className="setting-row"><Text>分类</Text><Button className={`category-button ${edit.category}`} ariaLabel="更改单菜分类"
          disabled={disabled} onClick={() => setEdit({ ...edit, category: cycleCategory(edit.category) })}>{labels[edit.category]} ↻</Button></View>
        <View className="setting-row"><Text>用于新菜单</Text><Switch checked={edit.active} disabled={disabled} color="#287557"
          ariaLabel="用于新菜单" onChange={(event) => setEdit({ ...edit, active: event.detail.value })} /></View>
        <Text className="muted">停用后仍保留菜名，随时可以恢复；已保存的菜单不受影响。</Text>
        {conflict && <View className="recovery"><Text>草稿已保留。请重新读取，再核对当前菜品。</Text>
          <Button disabled={busy || cooling} onClick={() => void run(read)}>重新读取</Button>
          {reviewed && latest && <><Text>服务器最新：{latest.name} · {labels[latest.category]} · {latest.active ? "已启用" : "已停用"}</Text>
            <Button disabled={disabled} onClick={() => void loadLatest()}>载入最新版本</Button></>}</View>}
        <Button className="primary" disabled={disabled || cooling || conflict || !signedIn} onClick={() => void run(async () => {
          const body = { name: edit.name.trim().normalize("NFC"), category: edit.category, active: edit.active, baseVersion: edit.version };
          if (!DishUpdateInputSchema.safeParse(body).success) throw new Error("请填写 1～60 个字的菜名，不含控制字符");
          await saved(await client.updateDish(edit.id, body));
        })}>保存修改</Button>
        <Button disabled={disabled} onClick={() => void cancel()}>取消编辑</Button>
      </View>}
      {(dirty || blocked) && <Text className="footer-note">草稿只保留在当前页面。离开或关闭前，请先确认保存结果。</Text>}
    </>}
  </View>;
}
