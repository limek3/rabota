"use client";

import { supabase } from "@/lib/supabase";
import { REMOTE, getKV } from "./db";
import type { DayKey, ID } from "./types";

/**
 * Лиды в Google Таблицу ОКК — через функцию leads-sheet на сервере: браузер не может прочитать
 * ответ Google после его переадресации (HTTP 404, хотя строки записались), а сервер может.
 * Функция же отмечает отправленные лиды (kv «leadSheetMarks») — по ним переключатель
 * «Только ещё не выгруженные» и автовыгрузка в 13:00 и 19:00.
 */

export interface LeadSheetResult {
  added: number;
  skipped: number;
  /** Отправлено, но Google не вернул ответ — строки, скорее всего, записаны. */
  unconfirmed: number;
  created: string[];
  note?: string;
}

/** Лиды, уже отправленные в таблицу: id → когда. Без Supabase — пусто. */
export async function loadSheetMarks(): Promise<Record<ID, string>> {
  if (!REMOTE) return {};
  const v = await getKV("leadSheetMarks");
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<ID, string>) : {};
}

export async function pushLeadsToSheet(ids: ID[], from: DayKey, to: DayKey): Promise<LeadSheetResult> {
  if (!REMOTE) throw new Error("В Google Таблицу выгружает сервер — нужна Supabase");
  const { data, error } = await supabase().functions.invoke("leads-sheet", { body: { ids, from, to } });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") msg = (await ctx.json()).error ?? msg;
    } catch {
      /* не JSON */
    }
    if (/not found|404|Failed to send|FunctionsFetchError|FunctionsRelayError/i.test(`${error.name} ${msg}`))
      msg = "Функция leads-sheet не развёрнута в Supabase (Edge Functions → leads-sheet)";
    throw new Error(msg);
  }
  const d = (data ?? {}) as Partial<LeadSheetResult> & { skipped?: number | string };
  if (typeof d.skipped === "string") throw new Error(d.skipped);
  return { added: d.added ?? 0, skipped: Number(d.skipped ?? 0), unconfirmed: d.unconfirmed ?? 0, created: d.created ?? [], note: d.note };
}
