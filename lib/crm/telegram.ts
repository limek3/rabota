"use client";

import { supabase } from "@/lib/supabase";

/**
 * Привязка Telegram оператора к Vexi (supabase/migrations/20260923000001_telegram_link.sql).
 *
 * Сервера у приложения нет (статический экспорт), поэтому всё — через RPC базы от имени
 * вошедшего: код генерирует и хэширует сама база, Telegram ID наружу не отдаётся.
 * Ключ service_role здесь не нужен и не должен появляться.
 */

export type TgChatStatus = "unknown" | "member" | "not_member" | "admin" | "no_chat" | "no_rights" | "error";

export interface TgStatus {
  operatorId: string | null;
  linked: boolean;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  linkedAt: string | null;
  /** Тег, который Vexi подтвердил в рабочем чате ('' — снят, null — ещё не ставил). */
  tag: string | null;
  chatStatus: TgChatStatus;
  pendingCodeExpiresAt: string | null;
  botUsername: string | null;
  chatConnected: boolean;
  tagRights: string | null;
}

export interface TgCode {
  code: string;
  expiresAt: string;
  botUsername: string | null;
}

/** Грейд дня по числу доведённых лидов — те же пороги, что у Vexi (telegram-bot/leadup_bot/grades.py). */
export function gradeTag(doneToday: number): string {
  return doneToday >= 11 ? "Грейд IV" : doneToday >= 8 ? "Грейд III" : doneToday >= 6 ? "Грейд II" : "Грейд I";
}

/** Имя бота: из базы (его пишет сам Vexi при старте), запасной вариант — переменная сборки. */
function botName(fromDb: unknown): string | null {
  const v = typeof fromDb === "string" && fromDb.trim() ? fromDb : process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "";
  const clean = v.trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{3,64}$/.test(clean) ? clean : null;
}

export function deepLink(bot: string, code: string): string {
  return `https://t.me/${bot}?start=link_${code}`;
}

export function linkCommand(code: string): string {
  return `/link ${code}`;
}

function errText(e: { message: string; code?: string } | null): Error {
  const msg = e?.message ?? "Ошибка базы";
  if (e?.code === "PGRST202" || /could not find the function|schema cache/i.test(msg))
    return new Error("В базе нет привязки Telegram — выполните supabase/migrations/20260923000001_telegram_link.sql");
  return new Error(msg);
}

const str = (v: unknown) => (typeof v === "string" && v ? v : null);

export async function fetchTgStatus(operatorId?: string): Promise<TgStatus> {
  const { data, error } = await supabase().rpc("crm_telegram_status", { p_operator_id: operatorId ?? null });
  if (error) throw errText(error);
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    operatorId: str(r.operator_id),
    linked: r.linked === true,
    username: str(r.username),
    firstName: str(r.first_name),
    lastName: str(r.last_name),
    linkedAt: str(r.linked_at),
    tag: typeof r.tag === "string" ? r.tag : null,
    chatStatus: (str(r.chat_status) ?? "unknown") as TgChatStatus,
    pendingCodeExpiresAt: str(r.pending_code_expires_at),
    botUsername: botName(r.bot_username),
    chatConnected: r.chat_connected === true,
    tagRights: str(r.tag_rights),
  };
}

export async function createTgCode(): Promise<TgCode> {
  const { data, error } = await supabase().rpc("crm_telegram_link_create");
  if (error) throw errText(error);
  const r = (data ?? {}) as Record<string, unknown>;
  const code = str(r.code);
  const expiresAt = str(r.expires_at);
  if (!code || !expiresAt) throw new Error("База не вернула код");
  return { code, expiresAt, botUsername: botName(r.bot_username) };
}

export async function unlinkTg(operatorId?: string): Promise<void> {
  const { error } = await supabase().rpc("crm_telegram_unlink", { p_operator_id: operatorId ?? null });
  if (error) throw errText(error);
}

/**
 * Изменения своей строки привязки в реальном времени (RLS: оператор видит только себя).
 * Колбэк без данных — после него статус перечитывается через RPC.
 */
export function watchTgLink(operatorId: string, onChange: () => void): () => void {
  const ch = supabase()
    .channel(`tg-link-${operatorId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "operator_telegram", filter: `operator_id=eq.${operatorId}` }, () => onChange())
    .subscribe();
  return () => {
    void supabase().removeChannel(ch);
  };
}
