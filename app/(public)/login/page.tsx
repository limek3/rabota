"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { HOME_ROUTE } from "@/lib/appMode";
import { authErrorText, demoMode, resetPassword, signIn } from "@/lib/auth";
import { AuthBackdrop, authDisplay, Field, LockIcon, MailIcon, Mascot, type Mood, PasswordField } from "@/components/auth/authKit";

const C = { bg: "var(--bg)", panel: "var(--bg-modal)", text: "var(--text)", sub: "var(--text-sub)", dim: "var(--dim)", brand: "var(--brand)", line: "var(--ink-08)" };

// Запоминаем последнюю введённую почту, чтобы при следующем заходе поле уже было
// заполнено. Только почта — пароль здесь не хранится намеренно.
const REMEMBER_EMAIL_KEY = "leadupLoginEmail";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  // Подставляем сохранённую почту при заходе на страницу.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_EMAIL_KEY);
      if (saved) setEmail(saved);
    } catch {
      /* ignore */
    }
  }, []);

  const onEmail = (v: string) => {
    setEmail(v);
    try {
      if (v.trim()) localStorage.setItem(REMEMBER_EMAIL_KEY, v.trim());
      else localStorage.removeItem(REMEMBER_EMAIL_KEY);
    } catch {
      /* ignore */
    }
  };

  const mood: Mood = loading ? "happy" : err ? "sad" : pwFocused ? "peek" : "idle";

  const go = async () => {
    if (loading) return;
    setErr(null);
    setResetMsg(null);
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.push(HOME_ROUTE);
    } catch (e) {
      setErr(authErrorText(e));
      setLoading(false);
    }
  };

  const forgot = async () => {
    if (resetting) return;
    setErr(null);
    setResetMsg(null);
    const mail = email.trim();
    if (!mail) {
      setErr("Введите почту в поле выше и нажмите «Забыли пароль?» ещё раз");
      return;
    }
    if (demoMode) {
      setResetMsg("Демо-режим: сброс пароля недоступен.");
      return;
    }
    setResetting(true);
    try {
      await resetPassword(mail);
      setResetMsg(`Письмо для сброса отправлено на ${mail}. Проверьте почту.`);
    } catch (e) {
      setErr(authErrorText(e));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, position: "relative", fontFamily: authDisplay }}>
      <AuthBackdrop />

      <div className="auth-rise" style={{ position: "relative", width: 400, maxWidth: "100%", zIndex: 1 }}>
        <div style={{ marginBottom: -30, position: "relative", zIndex: 2 }}>
          <Mascot mood={mood} />
        </div>

        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 20, boxShadow: "var(--shadow-xl)", padding: "44px 32px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 style={{ margin: 0, fontFamily: authDisplay, fontSize: 25, fontWeight: 700, letterSpacing: "-.02em" }}>С возвращением</h1>
            <span style={{ fontSize: 13, color: C.sub }}>Вход в CRM отдела — по рабочей почте</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
            <Field icon={MailIcon} value={email} onChange={(e) => onEmail(e.target.value)} placeholder="Почта" type="email" autoComplete="email" />
            <PasswordField
              icon={LockIcon}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setPwFocused(true)}
              onBlur={() => setPwFocused(false)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              placeholder="Пароль"
              autoComplete="current-password"
            />
          </div>

          {err && <span style={{ fontSize: 12.5, color: "var(--red)", textAlign: "center", lineHeight: 1.45 }}>{err}</span>}
          {resetMsg && <span style={{ fontSize: 12.5, color: C.sub, textAlign: "center", lineHeight: 1.45 }}>{resetMsg}</span>}

          <button onClick={go} disabled={loading} className="auth-btn" style={{ opacity: loading ? 0.85 : 1 }}>
            {loading && <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "vexaSpin .7s linear infinite" }} />}
            {loading ? "Входим…" : "Войти"}
          </button>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 12.5, whiteSpace: "nowrap" }}>
            <span style={{ color: C.sub }}>Нет входа? Спросите руководителя</span>
            <button
              type="button"
              onClick={forgot}
              disabled={resetting}
              style={{ background: "none", border: "none", padding: 0, font: "inherit", color: C.dim, cursor: resetting ? "default" : "pointer", opacity: resetting ? 0.6 : 1 }}
              className="auth-forgot"
            >
              {resetting ? "Отправляем…" : "Забыли пароль?"}
            </button>
          </div>
        </div>

        <div style={{ textAlign: "center", marginTop: 20, fontSize: 9, color: C.dim, letterSpacing: ".06em" }}>
          {demoMode ? "ДЕМО — ЛЮБОЙ ВХОД ОТКРЫВАЕТ ПРОТОТИП" : "ЗАЩИЩЁННЫЙ ВХОД · SUPABASE AUTH"}
        </div>
      </div>
    </div>
  );
}
