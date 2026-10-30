"use client";

import { supabase, supabaseReady } from "@/lib/supabase";
import { nowMs } from "@/lib/crm/dates";

/**
 * Чат «Холста». С Supabase — таблица canvas_chat и функции crm_canvas_say / crm_canvas_unsay
 * (supabase/migrations/…_canvas_chat.sql): отличие автора (РОП, «СВ · Группа 1», грейд дня)
 * ставит база. Без Supabase — localStorage этого браузера, вкладки синхронизирует BroadcastChannel.
 */

export const MAX_LEN = 500;
/** Сколько последних сообщений показываем. */
const LIMIT = 200;

export interface ChatMsg {
  id: string;
  accountId: string;
  name: string;
  role: "head" | "supervisor" | "operator";
  grade?: number;
  team?: string;
  text: string;
  /** ISO-время. */
  at: string;
  deletedAt?: string | null;
}

export type ChatChange = { type: "put"; m: ChatMsg };

/** Кто пишет — для локального режима; с Supabase всё это знает база. */
export interface Speaker {
  accountId: string;
  name: string;
  role: ChatMsg["role"];
  grade?: number;
  team?: string;
  canModerate: boolean;
}

export interface ChatStore {
  load: () => Promise<ChatMsg[]>;
  say: (text: string, who: Speaker) => Promise<ChatMsg>;
  unsay: (id: string, who: Speaker) => Promise<boolean>;
  subscribe: (on: (c: ChatChange) => void) => () => void;
}

function fromRow(r: Record<string, unknown>): ChatMsg {
  return {
    id: String(r.id),
    accountId: String(r.account_id),
    name: String(r.author_name ?? ""),
    role: (r.role as ChatMsg["role"]) ?? "operator",
    grade: r.grade == null ? undefined : Number(r.grade),
    team: (r.team as string | null) ?? undefined,
    text: String(r.text ?? ""),
    at: String(r.created_at),
    deletedAt: (r.deleted_at as string | null) ?? null,
  };
}

const remoteStore: ChatStore = {
  async load() {
    const { data, error } = await supabase().from("canvas_chat").select("*").is("deleted_at", null).order("id", { ascending: false }).limit(LIMIT);
    if (error) throw new Error(error.message);
    return (data ?? []).map(fromRow).reverse();
  },
  async say(text) {
    const { data, error } = await supabase().rpc("crm_canvas_say", { p_text: text });
    if (error) throw new Error(error.message);
    return fromRow(data as Record<string, unknown>);
  },
  async unsay(id) {
    const { data, error } = await supabase().rpc("crm_canvas_unsay", { p_id: Number(id) });
    if (error) throw new Error(error.message);
    return !!data;
  },
  subscribe(on) {
    const ch = supabase().channel("canvas-chat");
    ch.on("postgres_changes", { event: "*", schema: "public", table: "canvas_chat" }, (p) => {
      if (p.eventType !== "DELETE") on({ type: "put", m: fromRow(p.new as Record<string, unknown>) });
    });
    ch.subscribe();
    return () => void supabase().removeChannel(ch);
  },
};

const LS_KEY = "leadup.canvas-chat";
const BC_NAME = "leadup-canvas-chat";

function lsRead(): ChatMsg[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    return Array.isArray(v) ? (v as ChatMsg[]) : [];
  } catch {
    return [];
  }
}

function lsWrite(rows: ChatMsg[], m: ChatMsg) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(rows.slice(-LIMIT)));
  } catch {
    throw new Error("Не получилось сохранить сообщение в этом браузере");
  }
  try {
    const bc = new BroadcastChannel(BC_NAME);
    bc.postMessage({ type: "put", m } satisfies ChatChange);
    bc.close();
  } catch {
    /* соседние вкладки увидят после перезагрузки */
  }
}

const localStore: ChatStore = {
  async load() {
    return lsRead().filter((m) => !m.deletedAt);
  },
  async say(text, who) {
    const t = text.trim();
    if (!t) throw new Error("Пустое сообщение");
    if (t.length > MAX_LEN) throw new Error(`Слишком длинно — до ${MAX_LEN} символов`);
    const all = lsRead();
    const m: ChatMsg = {
      id: String(Math.max(0, ...all.map((r) => Number(r.id) || 0)) + 1),
      accountId: who.accountId,
      name: who.name,
      role: who.role,
      grade: who.role === "operator" ? who.grade : undefined,
      team: who.role === "supervisor" ? who.team : undefined,
      text: t,
      at: new Date(nowMs()).toISOString(),
      deletedAt: null,
    };
    lsWrite([...all, m], m);
    return m;
  },
  async unsay(id, who) {
    const all = lsRead();
    const m = all.find((r) => r.id === id);
    if (!m || m.deletedAt || (m.accountId !== who.accountId && !who.canModerate)) return false;
    const gone = { ...m, deletedAt: new Date(nowMs()).toISOString() };
    lsWrite(all.map((r) => (r.id === id ? gone : r)), gone);
    return true;
  },
  subscribe(on) {
    if (typeof BroadcastChannel === "undefined") return () => {};
    const bc = new BroadcastChannel(BC_NAME);
    bc.onmessage = (e) => on(e.data as ChatChange);
    return () => bc.close();
  },
};

export const chatStore: ChatStore = supabaseReady ? remoteStore : localStore;
