"use client";

import { supabase, supabaseReady } from "@/lib/supabase";

/**
 * Расшифровка разговора по лиду (таблица lead_dialogs, функция lead-dialog).
 * Звонок берётся из ссылки Скорозвона: число после /answer/ — id звонка.
 * Работает только с Supabase: ключи Скорозвона и Memo AI живут в секретах функции.
 */

export type DialogStatus = "pending" | "waiting" | "processing" | "done" | "failed";

export interface DialogSeg {
  /** Начало и конец реплики, секунды от начала записи. */
  s: number;
  e: number;
  /** speaker_id из Memo AI. */
  who: string;
  t: string;
}

export interface LeadDialog {
  leadId: string;
  callId: string;
  status: DialogStatus;
  error: string;
  operatorSpeaker: string | null;
  segments: DialogSeg[];
  callAt: string | null;
  callSec: number | null;
  callUser: string;
  recordUrl: string;
  updatedAt: string;
}

/** Ссылка лида ведёт на конкретный звонок — тогда расшифровку можно получить. */
export function dialogCallId(link: string): string {
  return link.match(/\/answer\/(\d+)/)?.[1] ?? "";
}

export const dialogAvailable = (link: string) => supabaseReady && !!dialogCallId(link);

export const DIALOG_BUSY: DialogStatus[] = ["pending", "waiting", "processing"];

function fromRow(r: Record<string, unknown>): LeadDialog {
  return {
    leadId: String(r.lead_id),
    callId: String(r.call_id ?? ""),
    status: (r.status as DialogStatus) ?? "pending",
    error: String(r.error ?? ""),
    operatorSpeaker: (r.operator_speaker as string | null) ?? null,
    segments: Array.isArray(r.segments) ? (r.segments as DialogSeg[]) : [],
    callAt: (r.call_at as string | null) ?? null,
    callSec: r.call_sec == null ? null : Number(r.call_sec),
    callUser: String(r.call_user ?? ""),
    recordUrl: String(r.record_url ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

/** Что уже лежит в базе. null — расшифровку ещё не запускали. */
export async function readDialog(leadId: string): Promise<LeadDialog | null> {
  const { data, error } = await supabase().from("lead_dialogs").select("*").eq("lead_id", leadId).maybeSingle();
  if (error) {
    if (/lead_dialogs|relation|schema cache/i.test(error.message))
      throw new Error("В базе нет таблицы для диалогов — руководителю нужно выполнить supabase/migrations/20261005000001_lead_dialogs.sql");
    throw new Error(error.message);
  }
  return data ? fromRow(data as Record<string, unknown>) : null;
}

/**
 * Следующий шаг на сервере: sync — взять запись / спросить Memo, готово ли; retry — заново;
 * swap — поменять местами оператора и клиента.
 */
export async function syncDialog(leadId: string, action: "sync" | "retry" | "swap" = "sync"): Promise<LeadDialog> {
  const { data, error } = await supabase().functions.invoke("lead-dialog", { body: { leadId, action } });
  if (error) {
    let msg = error.message;
    let row: Record<string, unknown> | null = null;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") {
        const j = await ctx.json();
        msg = j.error ?? msg;
        if (j.lead_id) row = j;
      }
    } catch {
      /* не JSON */
    }
    // временный сбой (сеть, Скорозвон / Memo ответили 5xx) — шаг повторится, показываем то, что есть
    if (row) return fromRow(row);
    if (/not found|404|Failed to send|FunctionsFetchError|FunctionsRelayError/i.test(`${error.name} ${msg}`) && !/Лид не найден/.test(msg))
      msg = "Функция lead-dialog не развёрнута в Supabase (см. supabase/README.md)";
    throw new Error(msg);
  }
  return fromRow(data as Record<string, unknown>);
}
