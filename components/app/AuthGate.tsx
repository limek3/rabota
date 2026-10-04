"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AUTH_ENABLED, HOME_ROUTE } from "@/lib/appMode";
import { demoMode, getUser, isAuthed, watchAuth } from "@/lib/auth";
import { getVexaBridge } from "@/lib/electron";

/**
 * Гейт входа в CRM.
 *
 * AUTH_ENABLED (lib/appMode.ts) включается сам, когда в .env.local есть проект
 * Supabase: без сессии — на /login. Без Supabase пропускает всех (данные в браузере).
 */
/** fallback — что показать, пока проверяется вход (вместо пустого экрана). */
export function AuthGate({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  const router = useRouter();
  const [ok, setOk] = useState(!AUTH_ENABLED);

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    if (!isAuthed()) {
      router.replace("/login");
      return;
    }
    if (demoMode) {
      setOk(true);
      return;
    }
    getUser().then((u) => {
      if (!u) router.replace("/login");
      else setOk(true);
    });
  }, [router]);

  // вышли в другой вкладке или сессия кончилась — обратно на вход
  useEffect(() => {
    if (!AUTH_ENABLED) return;
    return watchAuth((u) => {
      if (!u) router.replace("/login");
    });
  }, [router]);

  // Electron: главный процесс может попросить открыть экран
  useEffect(() => {
    const b = getVexaBridge();
    if (!b?.onNavigate) return;
    return b.onNavigate((path) => router.push(path));
  }, [router]);

  return ok ? <>{children}</> : <>{fallback}</>;
}

/** Страницы входа/регистрации: без Supabase вход выключен — уводят в CRM. */
export function AuthPagesGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    if (!AUTH_ENABLED) router.replace(HOME_ROUTE);
  }, [router]);
  return AUTH_ENABLED ? <>{children}</> : null;
}
