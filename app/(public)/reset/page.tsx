"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authErrorText, demoMode, updatePassword } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { AuthBackdrop, authDisplay, LockIcon, Mascot, type Mood, PasswordField } from "@/components/auth/authKit";

const C = { bg: "var(--bg)", panel: "var(--bg-modal)", text: "var(--text)", sub: "var(--text-sub)", dim: "var(--dim)", line: "var(--ink-08)" };

export default function ResetPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [pwFocused, setPwFocused] = useState(false);
  // recovery-сессию SDK поднимает из ссылки в письме (detectSessionInUrl)
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (demoMode) return;
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    const { data } = sb.auth.onAuthStateChange((_e, session) => {
      if (session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const mood: Mood = done || loading ? "happy" : err ? "sad" : pwFocused ? "peek" : "idle";

  const go = async () => {
    if (loading) return;
    setErr(null);
    if (pw.length < 6) {
      setErr("Пароль слишком короткий — минимум 6 символов");
      return;
    }
    if (pw !== pw2) {
      setErr("Пароли не совпадают");
      return;
    }
    if (demoMode) {
      setErr("Демо-режим: смена пароля недоступна.");
      return;
    }
    if (!ready) {
      setErr("Откройте страницу по ссылке из письма о сбросе пароля.");
      return;
    }
    setLoading(true);
    try {
      await updatePassword(pw);
      setDone(true);
      setTimeout(() => router.push("/login"), 2200);
    } catch (e) {
      setErr(authErrorText(e));
      setLoading(false);
    }
  };

  const canEdit = ready || demoMode;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, position: "relative", fontFamily: authDisplay }}>
      <AuthBackdrop />

      <div className="auth-rise" style={{ position: "relative", width: 400, maxWidth: "100%", zIndex: 1 }}>
        <div style={{ marginBottom: -30, position: "relative", zIndex: 2 }}>
          <Mascot mood={mood} />
        </div>

        <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, boxShadow: "var(--shadow-xl)", padding: "44px 32px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 6 }}>
            <h1 style={{ margin: 0, fontFamily: authDisplay, fontSize: 25, fontWeight: 700, letterSpacing: "-.02em" }}>Новый пароль</h1>
            <span style={{ fontSize: 13, color: C.sub }}>Задайте новый пароль для входа</span>
          </div>

          {done ? (
            <>
              <span style={{ fontSize: 13, color: C.sub, textAlign: "center", lineHeight: 1.5 }}>
                Пароль обновлён. Открываю вход…
              </span>
              <Link href="/login" className="auth-btn-2">Войти</Link>
            </>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                <PasswordField
                  icon={LockIcon}
                  value={pw}
                  onChange={(e) => setPw(e.target.value)}
                  onFocus={() => setPwFocused(true)}
                  onBlur={() => setPwFocused(false)}
                  placeholder="Новый пароль (мин. 6 символов)"
                  autoComplete="new-password"                />
                <PasswordField
                  icon={LockIcon}
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  onFocus={() => setPwFocused(true)}
                  onBlur={() => setPwFocused(false)}
                  onKeyDown={(e) => e.key === "Enter" && go()}
                  placeholder="Повторите пароль"
                  autoComplete="new-password"                />
              </div>

              {err && <span style={{ fontSize: 12.5, color: "var(--red)", textAlign: "center", lineHeight: 1.45 }}>{err}</span>}
              {!canEdit && (
                <span style={{ fontSize: 12.5, color: C.sub, textAlign: "center", lineHeight: 1.45 }}>
                  Откройте эту страницу по ссылке из письма о сбросе пароля.
                </span>
              )}

              <button onClick={go} disabled={loading} className="auth-btn" style={{ opacity: loading ? 0.85 : 1 }}>
                {loading && <span style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "vexaSpin .7s linear infinite" }} />}
                {loading ? "Сохраняю…" : "Сохранить пароль"}
              </button>

              <div style={{ textAlign: "center", fontSize: 12.5 }}>
                <Link href="/login" style={{ color: C.sub, textDecoration: "none" }}>
                  Вспомнили? <span className="auth-link">Войти</span>
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
