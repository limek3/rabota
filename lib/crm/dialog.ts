"use client";

import { supabase, supabaseReady } from "@/lib/supabase";

/**
 * Расшифровка разговора по лиду и её разбор (таблица lead_dialogs, функция lead-dialog).
 * Звонок берётся из ссылки Скорозвона: число после /answer/ — id звонка.
 * Работает только с Supabase: ключи Скорозвона и Memo AI живут в секретах функции.
 */

export type DialogStatus = "pending" | "waiting" | "processing" | "done" | "failed";
/** none — не запрашивали; missing — в Memo AI нет шаблона разбора (или колонок в базе). */
export type ReportStatus = "none" | "processing" | "done" | "failed" | "missing";

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
  reportStatus: ReportStatus;
  /** Разбор от Memo AI как есть — строки «ПУНКТ: …», разбирает parseReport. */
  report: string;
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
    // нет колонки — миграция разбора не выполнена
    reportStatus: "report_status" in r ? ((r.report_status as ReportStatus) ?? "none") : "missing",
    report: String(r.report ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

/* ── кэш: открытый раз диалог показывается сразу, база только освежает ───── */

const CACHE_KEY = "leadup.dialogs";
const CACHE_MAX = 80;
const mem = new Map<string, LeadDialog>();
let loaded = false;

function loadCache() {
  if (loaded) return;
  loaded = true;
  try {
    const list = JSON.parse(localStorage.getItem(CACHE_KEY) || "[]") as LeadDialog[];
    for (const d of list) if (d?.leadId) mem.set(d.leadId, d);
  } catch {
    /* нет доступа к хранилищу — работаем без кэша */
  }
}

function remember(d: LeadDialog) {
  loadCache();
  mem.delete(d.leadId);
  mem.set(d.leadId, d);
  // в браузере храним только готовое: незаконченное всё равно спросим у базы
  try {
    const done = [...mem.values()].filter((x) => x.status === "done").slice(-CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(done));
  } catch {
    /* переполнено или запрещено — не страшно */
  }
}

/** Последнее, что знаем о разговоре лида, без запроса. */
export function cachedDialog(leadId: string): LeadDialog | null {
  loadCache();
  return mem.get(leadId) ?? null;
}

/** Что уже лежит в базе. null — расшифровку ещё не запускали. */
export async function readDialog(leadId: string): Promise<LeadDialog | null> {
  const { data, error } = await supabase().from("lead_dialogs").select("*").eq("lead_id", leadId).maybeSingle();
  if (error) {
    if (/lead_dialogs|relation|schema cache/i.test(error.message))
      throw new Error("В базе нет таблицы для диалогов — руководителю нужно выполнить supabase/migrations/20261005000001_lead_dialogs.sql");
    throw new Error(error.message);
  }
  if (!data) return null;
  const d = fromRow(data as Record<string, unknown>);
  remember(d);
  return d;
}

/**
 * Следующий шаг на сервере: sync — взять запись / спросить Memo, готово ли; retry — заново;
 * swap — поменять местами оператора и клиента; report — запросить разбор ещё раз.
 */
export async function syncDialog(leadId: string, action: "sync" | "retry" | "swap" | "report" = "sync"): Promise<LeadDialog> {
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
  const d = fromRow(data as Record<string, unknown>);
  remember(d);
  return d;
}

/* ── разбор от Memo AI ──────────────────────────────────────────────────── */

export interface ReportCheck {
  label: string;
  /** Выяснил ли оператор этот пункт. */
  ok: boolean;
  value: string;
  /** Секунда записи, где это прозвучало; null — не нашли. */
  at: number | null;
}

export interface ParsedReport {
  summary: string;
  checks: ReportCheck[];
  verdict: { kind: "done" | "failed" | "unsure"; text: string } | null;
}

const toSec = (s: string): number | null => {
  const m = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return m[3] ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
};

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

/**
 * Шаблон в Memo отвечает строками «ПУНКТ: да | значение | мм:сс», плюс «СВОДКА:» и «ИТОГ:».
 * Пункты не зашиты: что написано в шаблоне, то и покажем. Время не указано — ищем реплику
 * клиента, где прозвучало значение.
 */
export function parseReport(text: string, segments: DialogSeg[]): ParsedReport | null {
  if (!text.trim()) return null;
  let summary = "";
  let verdict: ParsedReport["verdict"] = null;
  const checks: ReportCheck[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s>*#\-•]+/, "").replace(/\*\*/g, "").trim();
    const m = line.match(/^([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё /]{1,40}?)\s*:\s*(.+)$/);
    if (!m) {
      if (summary && !checks.length && line) summary += ` ${line}`;
      continue;
    }
    const key = m[1].trim().toUpperCase();
    const rest = m[2].trim();
    if (key === "СВОДКА") {
      summary = rest;
      continue;
    }
    if (key === "ИТОГ") {
      const kind = /не\s*довед/i.test(rest) ? "failed" : /довед/i.test(rest) ? "done" : "unsure";
      verdict = { kind, text: rest.replace(/^(не\s*)?доведён\s*[—–-]?\s*|^под вопросом\s*[—–-]?\s*/i, "").trim() || rest };
      continue;
    }
    const parts = rest.split("|").map((p) => p.trim());
    const ok = /^(да|yes|✓|\+)/i.test(parts[0] ?? "");
    const value = (parts.length > 1 ? parts[1] : parts[0].replace(/^(да|нет)\s*[,—–-]?\s*/i, "")) || "";
    let at = toSec(parts[2] ?? "");
    if (at == null && ok && value) {
      const words = value.toLowerCase().split(/[^a-zа-яё0-9]+/i).filter((w) => w.length >= 4);
      const hit = words.length ? segments.find((s) => words.some((w) => s.t.toLowerCase().includes(w))) : undefined;
      at = hit ? hit.s : null;
    }
    checks.push({ label: cap(m[1].trim()), ok, value: value || (ok ? "" : "не выяснили"), at });
  }
  if (!summary && !checks.length) return { summary: text.trim(), checks: [], verdict: null };
  return { summary, checks, verdict };
}
