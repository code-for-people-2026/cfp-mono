import { useEffect, useState } from "react";
import Taro, { useDidShow } from "@tarojs/taro";
import { Image, Input, ScrollView, Switch, Text, Textarea, View } from "@tarojs/components";
import { DishUpdateInputSchema, type Dish, type DishInput } from "@cfp/kith-inn-contracts";
import { ClientError, getKithInnClient, type WriteResult } from "../../lib/api";
import { cycleCategory, labels, previewDishes } from "../../lib/classify";
import { Button } from "../../lib/button";
import { DishName, DishNameProvider } from "../../lib/dish-name";
import { MainNav } from "../../lib/main-nav";
import refreshIcon from "../../assets/refresh-cw.svg";


export default function DishesPage() {
  const [client] = useState(() => { try { return getKithInnClient(); } catch { return null; } });
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
  const deleting = pending?.kind === "delete";

  useDidShow(() => setPending(client?.pendingWrite() ?? null));
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
      if (issue.code === "VERSION_CONFLICT" || issue.code === "NOT_FOUND") { setConflict(true); setReviewed(false); }
      if (issue.retryAt) { setRetryAt(issue.retryAt); setNow(Date.now()); }
    }
  }
  async function run(action: () => Promise<void>) {
    if (busy || !client) return;
    setBusy(true); setError(""); setReviewed(false);
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
    if (result.kind === "week") { await Taro.navigateTo({ url: `/pages/week/index?weekStart=${result.week.weekStart}` }); return; }
    clearDraft();
    setLoaded(false);
    setNotice(result.kind === "batch" ? `已新增 ${result.items.length} 道菜` : result.kind === "delete" ? "菜品已删除" : "菜品修改已保存");
    // The write is confirmed even if refreshing the latest list subsequently fails.
    try { await read(); }
    catch { throw new Error(`${result.kind === "delete" ? "删除" : "保存"}已确认，但菜品池暂时读取失败，请重试。`); }
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
    const answer = await Taro.showModal({ title: deleting ? "已核对删除结果？" : "已核对保存结果？",
      content: "请对照当前菜品池与保留的草稿确认实际结果。继续后不会自动再次提交。" });
    if (answer.confirm) {
      try {
        client!.discardPendingAfterReview(); setPending(null); setReviewed(false); setError("");
        if (deleting) {
          if (!latest) { clearDraft(); setNotice("菜品已删除"); }
          else { setEdit({ ...latest }); setOriginal(latest); setConflict(false); }
        }
      }
      catch (value) { failure(value); }
    }
  }
  const activeCount = items.filter((dish) => dish.active).length;

  const showInput = stage === "input" || signedIn && loaded && !items.length && stage === "list" && !edit;
  const showList = signedIn && stage === "list" && !edit && !showInput;

  return <DishNameProvider><View className="dish-app dishes-app flow-page">
    {process.env.TARO_ENV === "h5" && <View className="app-heading"><Text>菜品池</Text></View>}
    <View className="dish-page">
    <ScrollView scrollY className="flow-scroll">
    {!client ? <View className="alert">尚未配置街坊味服务，请联系维护者配置后再使用。</View> : <>
      {error && <View className="alert" ariaRole="alert">{error}</View>}
      {notice && <View className="success" ariaRole="status"><Text className="success-title">{notice}</Text>
        {notice !== "菜品已删除" && <Text className="success-description">菜名和荤、素、汤分类已经保存。以后想到新菜，可以随时继续添加。</Text>}</View>}
      {cooling && <View className="hint">请等待 {Math.ceil((retryAt - now) / 1000)} 秒后重试。</View>}
      {blocked && pending?.kind === "week" && <View className="recovery"><Text>周菜单保存结果尚未确认，请回到对应周核对。</Text><Button disabled={busy} onClick={() => void Taro.navigateTo({ url: `/pages/week/index?weekStart=${pending.weekStart}` })}>核对周菜单保存</Button></View>}
      {blocked && pending?.kind !== "week" && <View className="recovery">
        <Text className="section-title">{deleting ? "删除" : "保存"}结果尚未确认</Text>
        <Text>{needsReview ? "安全重试期限已过或请求标识需核对。请重新读取菜品池，核对本次草稿。" : `可能已经${deleting ? "删除" : "保存"}。请重试原请求，结果确认前暂不能修改或放弃。`}</Text>
        {needsReview && reviewed && <ScrollView className="review-list" scrollY><Text className="section-title">本次读取的菜品池</Text>
          {!items.length ? <Text>当前没有已保存菜品。</Text> : items.map((dish) => <DishName key={dish.id} name={`${dish.name} · ${labels[dish.category]} · ${dish.active ? "已启用" : "已停用"}`} />)}
          <Text>请与下方保留的草稿对照，确认是否已经{deleting ? "删除" : "保存"}。</Text></ScrollView>}
        <View className="actions">
          {!needsReview && <Button disabled={busy || cooling || !signedIn} onClick={() => void run(async () => saved(await client.retryPendingWrite()))}>重试原请求</Button>}
          <Button disabled={busy || cooling || !signedIn} onClick={() => void run(read)}>重新读取</Button>
          {needsReview && <Button disabled={busy || !reviewed} onClick={() => void acknowledge()}>已核对，继续编辑</Button>}
        </View>
      </View>}
      {!signedIn && <View className="login-panel">
        <View className="detail-head"><View><Text className="detail-kicker">街坊味 · 桃子的厨房</Text><Text className="detail-title">欢迎回到自己的厨房</Text></View></View>
        <Text className="muted">仅桃子绑定的微信账号可使用。登录后可找回已保存的菜品。</Text>
        {process.env.TARO_ENV === "h5" && <Text className="hint">请在微信小程序中登录，浏览器不能完成微信登录。</Text>}
        <Button className="primary" disabled={busy || cooling} onClick={() => void run(async () => { await client.login(); await read(); })}>微信登录</Button>
      </View>}
      {showList && <>
        <View className="detail-head"><View><Text className="detail-title">我的菜品池</Text></View>
          <Text className="detail-meta">{loaded ? `${activeCount} 道已启用` : busy ? "读取中" : "尚未读取"}</Text></View>
        {!loaded ? <View className="hint">{busy ? "正在读取菜品池…" : "暂未读取到菜品池。"}</View> :
          <View className="dish-list">{items.map((dish) => <View className={`dish dish-card ${dish.active ? "" : "inactive"}`} key={dish.id}>
            <View className="dish-info"><DishName className="dish-name" name={dish.name} /><Text className="dish-status">{dish.active ? "已启用" : "已停用"}</Text></View>
            <View className="dish-controls"><Text className={`kind ${dish.category}`}>{labels[dish.category]}</Text>
              <Button className="tiny-action" disabled={disabled || cooling} onClick={() => {
                setEdit({ ...dish }); setOriginal(dish); setNotice(""); setError(""); setConflict(false);
              }}>编辑</Button></View></View>)}</View>}
        {!loaded && error && !blocked && <Button className="secondary" disabled={busy || cooling} onClick={() => void run(read)}>重试</Button>}
      </>}
      {(showInput || stage === "preview") && <View className="import-panel">
        <View className="detail-head"><View>
          <Text className="detail-kicker">{stage === "preview" ? "从菜名自动判断" : items.length ? "日常维护 · 随时添加" : "首次使用 · 约 2 分钟"}</Text>
          <Text className="detail-title">{stage === "preview" ? `${preview.length} 道菜待加入` : items.length ? "添加我的拿手菜" : "建立我的菜品池"}</Text></View>
          <Text className="detail-meta">{stage === "preview" ? "未写入" : `${items.length} 道`}</Text></View>
        {stage !== "preview" ? <>
          <View className="menu-rule"><Text className="rule-title">每行一道菜，整段粘贴</Text>
            <Text>可以从微信、备忘录或旧菜单复制；不用填写复杂配方。</Text></View>
          <Text className="input-label">菜名清单</Text>
          <Textarea className="prototype-textarea" placeholder="每行一道菜，例如：红烧排骨" ariaLabel="菜名清单" maxlength={-1}
            value={source} disabled={disabled} onInput={(event) => setSource(event.detail.value)} />
          <Button className="primary" disabled={disabled || !source.trim()} onClick={previewInput}>自动分成荤 / 素 / 汤</Button>
          <Text className="evidence-note">按菜名给出分类候选；确认后保存，日后仍可改名、停用或改分类。每次最多 200 道。</Text>
        </> : <>
          <View className="menu-rule"><Text className="rule-title">请确认荤、素、汤分类</Text>
            <Text>系统先判断；分类不对就点右侧更换图标，按“荤 → 素 → 汤”循环。</Text></View>
          <View className="import-list">{preview.map((dish, index) => <View className="import-row" key={dish.name}>
            <DishName className="import-name" name={dish.name} /><View className="category-switch"><Text className={`kind ${dish.category}`}>{labels[dish.category]}</Text>
              <Button className="rotate-dish" disabled={disabled} ariaLabel={`更改${dish.name}分类，当前${labels[dish.category]}`}
                onClick={() => setPreview(preview.map((value, at) => at === index ? { ...value, category: cycleCategory(value.category) } : value))}>
                <Image className="refresh-icon" src={refreshIcon} mode="scaleToFill" /></Button></View></View>)}</View>
          <Button className="primary" disabled={disabled || cooling || !signedIn} onClick={() => void run(async () => saved(await client.addDishes({ items: preview })))}>确认加入菜品池</Button>
          <Button className="secondary" disabled={disabled} onClick={() => setStage("input")}>返回修改菜名</Button>
          <Text className="evidence-note">系统先判断，最终以桃子确认的分类为准。</Text>
        </>}
        <Button className="text-button cancel" disabled={disabled} onClick={() => void cancel()}>取消添加</Button>
      </View>}
      {edit && <View className="edit-panel">
        <View className="detail-head"><View><Text className="detail-kicker">菜品维护</Text><Text className="detail-title">编辑菜品</Text></View>
          <Text className="detail-meta">{dirty ? "未保存" : "修改后请保存"}</Text></View>
        <Text className="input-label">菜名</Text><Input className="dish-input" placeholder="菜名" ariaLabel="菜名" maxlength={-1}
          disabled={disabled} value={edit.name} onInput={(event) => setEdit({ ...edit, name: event.detail.value })} />
        <View className="setting-row"><Text>分类</Text><View className="category-switch"><Text className={`kind ${edit.category}`}>{labels[edit.category]}</Text>
          <Button className="rotate-dish" ariaLabel="更改单菜分类" disabled={disabled}
            onClick={() => setEdit({ ...edit, category: cycleCategory(edit.category) })}><Image className="refresh-icon" src={refreshIcon} mode="scaleToFill" /></Button></View></View>
        <View className="setting-row"><Text>用于新菜单</Text><Switch checked={edit.active} disabled={disabled} color="#287557"
          ariaLabel="用于新菜单" onChange={(event) => setEdit({ ...edit, active: event.detail.value })} /></View>
        <Text className="evidence-note">停用后仍保留菜名，随时可以恢复；已保存的菜单不受影响。</Text>
        {conflict && <View className="recovery"><Text>草稿已保留。请重新读取，再核对当前菜品。</Text>
          <Button disabled={busy || cooling} onClick={() => void run(read)}>重新读取</Button>
          {reviewed && latest && <><DishName name={`服务器最新：${latest.name} · ${labels[latest.category]} · ${latest.active ? "已启用" : "已停用"}`} />
            <Button disabled={disabled} onClick={() => void loadLatest()}>载入最新版本</Button></>}
          {reviewed && !latest && <Text>该菜品已删除，请取消编辑返回菜品池。</Text>}</View>}
        <Button className="primary" disabled={disabled || cooling || conflict || !signedIn} onClick={() => void run(async () => {
          const body = { name: edit.name.trim().normalize("NFC"), category: edit.category, active: edit.active, baseVersion: edit.version };
          if (!DishUpdateInputSchema.safeParse(body).success) throw new Error("请填写 1～60 个字的菜名，不含控制字符");
          await saved(await client.updateDish(edit.id, body));
        })}>保存修改</Button>
        <Button className="secondary" disabled={disabled} onClick={() => void cancel()}>取消编辑</Button>
        <Button className="text-button delete-dish" disabled={disabled || cooling || conflict || !signedIn} onClick={() => void run(async () => {
          const target = original ?? edit;
          const answer = await Taro.showModal({ title: "删除菜品？", content: `“${target.name}”删除后不可恢复，已保存的菜单不受影响。`, confirmText: "删除", confirmColor: "#b64131", cancelText: "取消" });
          if (answer.confirm) await saved(await client.deleteDish(target.id, { baseVersion: target.version }));
        })}>删除菜品</Button>
      </View>}
      {(dirty || blocked) && <Text className="evidence-note">草稿只保留在当前页面。离开或关闭前，请先确认保存结果。</Text>}
      {signedIn && notice && notice !== "菜品已删除" && !dirty && <Button className="primary" disabled={disabled} onClick={() => void Taro.reLaunch({ url: "/pages/week/index" })}>下一步：安排本周菜单</Button>}

    </>}
    </ScrollView>
    {client && showList && <View className="flow-dock">
      <Button className="primary" disabled={disabled || cooling} onClick={() => {
        setStage("input"); setNotice(""); setError("");
      }}>添加菜品</Button>
    </View>}
    </View>
    <MainNav active="dishes" disabled={!client || disabled} onNavigate={(page) => void run(async () => {
      if (await confirmDiscard()) await Taro.reLaunch({ url: `/pages/${page}/index` });
    })} />
  </View></DishNameProvider>;
}
