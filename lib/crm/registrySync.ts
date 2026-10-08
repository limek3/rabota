"use client";

import { supabase } from "@/lib/supabase";
import { REMOTE } from "./db";
import type { RegistryPayload, RegistryReply } from "./registry";

/** Реестр YouDo → таблица бухгалтера через функцию registry-sheet (см. lib/crm/registry.ts). */
export async function pushRegistry(payload: RegistryPayload): Promise<RegistryReply> {
  if (!REMOTE) throw new Error("Реестры отправляет сервер — нужна Supabase");
  const { data, error } = await supabase().functions.invoke("registry-sheet", { body: payload });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") msg = (await ctx.json()).error ?? msg;
    } catch {
      /* не JSON */
    }
    if (/not found|404|Failed to send|FunctionsFetchError|FunctionsRelayError/i.test(`${error.name} ${msg}`))
      msg = "Функция registry-sheet не развёрнута в Supabase (Edge Functions → registry-sheet)";
    throw new Error(msg);
  }
  return (data ?? { ok: false, error: "Пустой ответ" }) as RegistryReply;
}

export interface AutoCheck {
  today: string;
  configured: boolean;
  auto: boolean;
  jobs: { kind: string; project: string; tab: string | null; rows: number; sum: number; skip: string | null }[];
  notSmz: { name: string; net: number; tab: string }[];
}

export interface AutoRun {
  today: string;
  results?: { tab?: string; kind: string; project: string; skip?: string; error?: string; reply?: RegistryReply }[];
  notSmz?: { name: string; net: number }[];
  telegram?: string | null;
  note?: string;
}

/** Автомат реестров: dry — что он сделал бы сегодня, без отправки. */
export async function runRegistryAuto(dry: true): Promise<AutoCheck>;
/** test — тестовый прогон сейчас: «ТЕСТ План» на следующий период, «ТЕСТ Факт» на текущий. */
export async function runRegistryAuto(dry: false, test: true): Promise<AutoRun>;
export async function runRegistryAuto(dry: boolean, test = false): Promise<AutoCheck | AutoRun> {
  if (!REMOTE) throw new Error("Автомат работает на сервере — нужна Supabase");
  const { data, error } = await supabase().functions.invoke("registry-sheet", { body: { auto: true, dry, test } });
  if (error) {
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") msg = (await ctx.json()).error ?? msg;
    } catch {
      /* не JSON */
    }
    if (/not found|404|Failed to send|FunctionsFetchError|FunctionsRelayError/i.test(`${error.name} ${msg}`))
      msg = "Функция registry-sheet не развёрнута в Supabase (Edge Functions → registry-sheet)";
    throw new Error(msg);
  }
  return data;
}
