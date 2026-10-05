"use client";

import { supabase } from "@/lib/supabase";

/**
 * Часы в график из Скорозвона (функция shift-hours): доступен + гудки + разговор + заполняет
 * карточку. Сама функция запускается по расписанию в 21:01 МСК; отсюда — посмотреть и записать
 * вручную за любой прошедший день (только руководитель отдела).
 */

export interface ShiftHoursRow {
  name: string;
  from: number;
  to: number;
  /** Секунды по статусам: speaking, wrapup, ringing, normal. */
  parts: Record<string, number>;
}

export interface ShiftHoursResult {
  date: string;
  dry?: boolean;
  updated: ShiftHoursRow[];
  skipped: { name: string; why: string }[];
  note?: string;
}

export async function pullShiftHours(date: string, dry: boolean): Promise<ShiftHoursResult> {
  const { data, error } = await supabase().functions.invoke("shift-hours", { body: { date, dry } });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") msg = (await ctx.json()).error ?? msg;
    } catch {
      /* не JSON */
    }
    if (/not found|404|Failed to send|FunctionsFetchError|FunctionsRelayError/i.test(`${error.name} ${msg}`))
      msg = "Функция shift-hours не развёрнута в Supabase (см. supabase/README.md, пункт 13)";
    throw new Error(msg);
  }
  return data as ShiftHoursResult;
}
