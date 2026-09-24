"use client";

import { setClockSkew } from "@/lib/crm/dates";

/**
 * Сверка часов с сервером. Время лида, «сегодня» и отметки в журнале не должны
 * зависеть от того, как выставлены часы на компьютере оператора.
 *
 * Источник — заголовок Date ответа сервера: сначала сайт, откуда открыта CRM
 * (Railway, тот же адрес — заголовок читается без ограничений), затем Supabase.
 * Локальный сервер (десктоп, разработка) живёт на том же компьютере — его часы не
 * лучше локальных, поэтому его пропускаем. Date — с точностью до секунды, поэтому
 * расхождение меньше 3 секунд не трогаем.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function serverOffset(url: string, headers?: Record<string, string>): Promise<number | null> {
  try {
    const t0 = Date.now();
    const res = await fetch(url, { method: "GET", cache: "no-store", headers });
    const t1 = Date.now();
    const date = res.headers.get("date");
    const server = date ? Date.parse(date) : NaN;
    if (!Number.isFinite(server)) return null;
    // заголовок округлён до секунды вниз — берём середину этой секунды и середину запроса
    return server + 500 - (t0 + t1) / 2;
  } catch {
    return null;
  }
}

/** Возвращает поправку в мс (0 — часы в порядке или сверить не с чем). */
export async function syncClock(): Promise<number> {
  const local = typeof location === "undefined" || location.protocol === "file:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  let off: number | null = null;
  if (!local) off = await serverOffset(`${location.origin}/?clock=${Date.now()}`);
  if (off == null && SUPABASE_URL && SUPABASE_KEY) off = await serverOffset(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/health`, { apikey: SUPABASE_KEY });
  const skew = off != null && Math.abs(off) >= 3000 ? Math.round(off) : 0;
  setClockSkew(skew);
  return skew;
}
