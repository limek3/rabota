"use client";

import { supabase, supabaseReady } from "./supabase";

/**
 * Auth на Supabase. Приложение — статический экспорт (нет сервера, нет middleware),
 * поэтому сессия живёт в localStorage и обновляется SDK.
 *
 * isAuthed() остался синхронным: это зеркало реальной сессии, которое мы держим
 * в localStorage. Так гварды на маунте не мигают редиректом, пока SDK
 * восстанавливает сессию из сети.
 */

const KEY = "leadup_auth";

export function isAuthed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setAuthed(v: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (v) window.localStorage.setItem(KEY, "1");
    else window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Демо-режим: .env.local не заполнен — вход пускает в прототип как раньше. */
export const demoMode = !supabaseReady;

export interface AuthUser {
  id: string;
  email: string;
}

export async function getUser(): Promise<AuthUser | null> {
  if (demoMode) return null;
  const { data } = await supabase().auth.getSession();
  const u = data.session?.user;
  setAuthed(Boolean(u));
  return u ? { id: u.id, email: u.email ?? "" } : null;
}

// Регистрации нет: вход сотруднику создаёт руководитель в CRM (supabase/functions/crm-users).

export async function signIn(email: string, password: string): Promise<void> {
  if (demoMode) {
    setAuthed(true);
    return;
  }
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw error;
  setAuthed(true);
}

export async function signOut(): Promise<void> {
  setAuthed(false);
  if (demoMode) return;
  await supabase().auth.signOut();
}

/**
 * Смена пароля из настроек.
 *
 * Supabase позволяет updateUser по живой сессии без старого пароля — но тогда
 * любой, кто сел за незалоченный ноутбук, меняет пароль и забирает аккаунт.
 * Поэтому сначала переподтверждаем текущий пароль через signInWithPassword и
 * только потом меняем.
 */
export async function changePassword(email: string, current: string, next: string): Promise<void> {
  if (demoMode) {
    // прототип без бэкенда: проверять нечего, но и врать «сохранено» нельзя
    throw new Error("demo-mode");
  }
  const { error: reauth } = await supabase().auth.signInWithPassword({ email, password: current });
  if (reauth) throw reauth;
  const { error } = await supabase().auth.updateUser({ password: next });
  if (error) throw error;
}

/**
 * «Забыли пароль» — шлём письмо со ссылкой на восстановление.
 *
 * Supabase кладёт в ссылку recovery-токен и возвращает пользователя на
 * redirectTo (/reset). Там SDK (detectSessionInUrl) поднимает временную сессию,
 * и страница даёт задать новый пароль через updateUser.
 */
export async function resetPassword(email: string): Promise<void> {
  if (demoMode) throw new Error("demo-mode");
  const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/reset` : undefined;
  const { error } = await supabase().auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

/** Задать новый пароль внутри recovery-сессии (страница /reset). */
export async function updatePassword(next: string): Promise<void> {
  if (demoMode) throw new Error("demo-mode");
  const { error } = await supabase().auth.updateUser({ password: next });
  if (error) throw error;
}

/** Выйти на всех устройствах — глобальный scope гасит все refresh-токены. */
export async function signOutEverywhere(): Promise<void> {
  setAuthed(false);
  if (demoMode) return;
  await supabase().auth.signOut({ scope: "global" });
}

/** Держит зеркало флага в актуальном состоянии (логин в другой вкладке, протухший токен). */
export function watchAuth(cb: (user: AuthUser | null) => void): () => void {
  if (demoMode) return () => {};
  const { data } = supabase().auth.onAuthStateChange((_e, session) => {
    const u = session?.user;
    setAuthed(Boolean(u));
    cb(u ? { id: u.id, email: u.email ?? "" } : null);
  });
  return () => data.subscription.unsubscribe();
}

/** Человеческий текст вместо сырых кодов Supabase. */
export function authErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/invalid login credentials/i.test(msg)) return "Неверная почта или пароль";
  if (/user already registered/i.test(msg)) return "Аккаунт с такой почтой уже есть";
  if (/password should be at least/i.test(msg)) return "Пароль слишком короткий — минимум 6 символов";
  if (/email.*invalid|invalid.*email/i.test(msg)) return "Некорректный адрес почты";
  if (/rate limit|too many/i.test(msg)) return "Слишком много попыток — подождите минуту";
  return msg;
}
