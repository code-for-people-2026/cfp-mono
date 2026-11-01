import { Button, Input, Text, View } from "@tarojs/components";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { AuthContext } from "../model";

type SetupMode = "create" | "bind" | "invite";
type Props = { context: AuthContext; onComplete: (context: AuthContext) => void; settings?: boolean };

/** Identity actions never infer an account or a baby's authorization from a nickname. */
export function IdentitySetup({ context, onComplete, settings = false }: Props) {
  const [mode, setMode] = useState<SetupMode>(settings || context.legacyLinked ? "invite" : "create");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (context.legacyLinked && mode !== "invite") setMode("invite"); }, [context.legacyLinked, mode]);

  const submit = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const next = mode === "create" ? await api.createFamily({ name })
        : mode === "bind" ? await api.bindLegacy({ username, password })
        : await api.acceptInvitation({ code });
      // Refresh the home context even if this settings page closed while saving.
      onComplete(next);
      if (mounted.current) { setCode(""); setName(""); }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "暂时无法完成，请重试。");
    } finally {
      inFlight.current = false;
      if (mounted.current) { setPassword(""); setBusy(false); }
    }
  };
  const select = (next: SetupMode) => { if (!busy) { setMode(next); setError(""); setPassword(""); } };
  return <View className="login-card identity-setup">
    <Text className="section-title">{settings ? "账号与家人" : context.legacyLinked ? "原账号尚未关联宝宝" : "开始记录宝宝的日常"}</Text>
    {context.legacyLinked && !context.hasBaby && <Text className="muted">账号已关联。请在原宝宝日记中关联宝宝，或联系服务人员；也可以使用家人的照护邀请码。</Text>}
    <Text className="muted">{mode === "create" ? "第一次使用，先告诉我们宝宝的昵称。" : mode === "bind" ? "验证原宝宝日记账号后，继续查看已有记录。" : "输入家人提供的照护邀请码，加入同一个宝宝。"}</Text>
    <View className="identity-choices">
      {!settings && !context.legacyLinked && <Button className={`text-button ${mode === "create" ? "identity-choice-current" : ""}`} disabled={busy || undefined} onClick={() => select("create")}>创建宝宝</Button>}
      {!context.legacyLinked && <Button className={`text-button ${mode === "bind" ? "identity-choice-current" : ""}`} disabled={busy || undefined} onClick={() => select("bind")}>绑定已有账号</Button>}
      <Button className={`text-button ${mode === "invite" ? "identity-choice-current" : ""}`} disabled={busy || undefined} onClick={() => select("invite")}>使用邀请码</Button>
    </View>
    {mode === "create" ? <>
      <Text className="field-label">宝宝昵称（小名）</Text>
      <Input className="login-input" ariaLabel="新宝宝昵称" value={name} maxlength={30} placeholder="怎么称呼宝宝" disabled={busy || undefined} onInput={(event) => setName(event.detail.value)} />
    </> : mode === "bind" ? <>
      <Text className="field-label">原账号用户名或邮箱</Text>
      <Input className="login-input" ariaLabel="原账号用户名或邮箱" value={username} placeholder="原宝宝日记账号" disabled={busy || undefined} onInput={(event) => setUsername(event.detail.value)} />
      <Text className="field-label">原账号密码</Text>
      <Input className="login-input" ariaLabel="原账号密码" value={password} password placeholder="请输入原账号密码" disabled={busy || undefined} onInput={(event) => setPassword(event.detail.value)} />
    </> : <>
      <Text className="field-label">照护邀请码</Text>
      <Input className="login-input" ariaLabel="照护邀请码" value={code} placeholder="粘贴家人提供的邀请码" disabled={busy || undefined} onInput={(event) => setCode(event.detail.value)} />
    </>}
    {error && <Text className="error-text">{error}</Text>}
    <Button className="primary-button" loading={busy} disabled={busy || undefined} onClick={() => { void submit(); }}>{mode === "create" ? "创建宝宝" : mode === "bind" ? "验证并绑定" : "加入照护"}</Button>
    {context.legacyLinked && settings && <Text className="login-note">已关联原宝宝日记账号</Text>}
  </View>;
}
