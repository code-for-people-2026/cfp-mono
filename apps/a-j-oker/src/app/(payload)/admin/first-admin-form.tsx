"use client";

import { useState, type FormEvent } from "react";

export function FirstAdminForm() {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const confirmPassword = String(form.get("confirmPassword") || "");
    try {
      const registration = await fetch("/api/first-admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, confirmPassword }),
      });
      if (!registration.ok) {
        const result = await registration.json().catch(() => ({}));
        throw new Error(result.error || "管理员初始化失败");
      }

      const login = await fetch("/api/admins/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!login.ok) throw new Error("管理员已创建，请刷新页面后登录");
      window.location.assign("/admin");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "管理员初始化失败");
      setSubmitting(false);
    }
  }

  const field = { display: "grid", gap: 6 } as const;
  const input = { font: "inherit", padding: "10px 12px" } as const;
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
      <label style={field}>
        邮箱
        <input name="email" type="email" autoComplete="username" required style={input} />
      </label>
      <label style={field}>
        密码（至少 12 位）
        <input name="password" type="password" autoComplete="new-password" minLength={12} required style={input} />
      </label>
      <label style={field}>
        确认密码
        <input name="confirmPassword" type="password" autoComplete="new-password" minLength={12} required style={input} />
      </label>
      {error && <p role="alert" style={{ color: "#b42318", margin: 0 }}>{error}</p>}
      <button type="submit" disabled={submitting} style={{ font: "inherit", padding: "11px 16px" }}>
        {submitting ? "正在创建…" : "创建首位管理员"}
      </button>
    </form>
  );
}
