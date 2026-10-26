"use client";

import { supabase, supabaseReady } from "@/lib/supabase";

/**
 * Запись разговора по лиду из Скорозвона (таблица lead_dialogs, функция lead-dialog).
 * Звонок берётся из ссылки Скорозвона: число после /answer/ — id звонка; в ссылке «…/leads/<лид>/call/+7…»
 * звонка нет — функция находит его по лиду Скорозвона.
 * Работает только с Supabase: ключи Скорозвона живут в секретах функции.
 * Реплики (segments) — только у старых разговоров, расшифрованных Memo AI; у новых их нет.
 */

/** processing — только у старых строк времён Memo AI: функция берёт им запись заново. */
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

/**
 * Ключ звонка по ссылке лида: id звонка из «…/answer/<звонок>/…» или «@<лид>» для «…/leads/<лид>/call/…» —
 * тогда звонок ищет функция и пишет в callId «<звонок>@<лид>». "" — ссылка не из Скорозвона.
 */
export function dialogCallId(link: string): string {
  const answer = link.match(/\/answer\/(\d+)/)?.[1];
  if (answer) return answer;
  const lead = link.match(/#\/leads\/(\d+)/)?.[1];
  return lead ? `@${lead}` : "";
}

/** Расшифровка в базе — по звонку из этой ссылки. */
export const sameDialogCall = (callId: string, key: string) => callId === key || (key.startsWith("@") && callId.endsWith(key));

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
 * Следующий шаг на сервере: sync — взять запись из Скорозвона; retry — заново;
 * swap — поменять местами оператора и клиента (старые разговоры с репликами).
 */
export function syncDialog(leadId: string, action: "sync" | "retry" | "swap" = "sync"): Promise<LeadDialog> {
  // запись лида и открытая карточка зовут шаг одновременно — второй ждёт первый, а не спрашивает Скорозвон ещё раз
  if (action !== "sync") return callSync(leadId, action);
  const running = inflight.get(leadId);
  if (running) return running;
  const p = callSync(leadId, action).finally(() => inflight.delete(leadId));
  inflight.set(leadId, p);
  return p;
}

const inflight = new Map<string, Promise<LeadDialog>>();

async function callSync(leadId: string, action: string): Promise<LeadDialog> {
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
    // временный сбой (сеть, Скорозвон ответил 5xx) — шаг повторится, показываем то, что есть
    if (row) return fromRow(row);
    if (/not found|404|Failed to send|FunctionsFetchError|FunctionsRelayError/i.test(`${error.name} ${msg}`) && !/Лид не найден/.test(msg))
      msg = "Функция lead-dialog не развёрнута в Supabase (см. supabase/README.md)";
    throw new Error(msg);
  }
  const d = fromRow(data as Record<string, unknown>);
  remember(d);
  return d;
}
