"use client";

import { supabase, supabaseReady } from "@/lib/supabase";

/**
 * «Живые курсоры»: кто ещё сейчас на этой странице, где у него мышь, короткие сообщения.
 * Ничего не пишется в базу — только рассылка в реальном времени:
 *   • с Supabase — канал Realtime «leadup-live» (broadcast, свои сообщения себе не приходят);
 *   • без Supabase — BroadcastChannel между вкладками этого браузера (для проверки локально).
 *
 * Протокол один для обоих:
 *   hello — «я здесь»: аккаунт, имя, страница; раз в несколько секунд и при смене страницы;
 *   cur   — положение мыши в координатах содержимого страницы (x — доля ширины, y — пиксели от верха);
 *   out   — мышь ушла со страницы (на меню, из окна, вкладка свернута);
 *   msg   — короткое сообщение у курсора;
 *   react — реакция на сообщение (из мини-чата страницы);
 *   bye   — закрыл вкладку или скрыл свой курсор;
 *   rps   — камень-ножницы-бумага между двумя (с Грейда III; СВ и РОП — всегда);
 *   party — праздник у всех: кто-то взял Грейд IV или отдел выполнил план дня (конфетти).
 * sid — вкладка (у одного аккаунта их может быть несколько).
 */
export type LiveMsg =
  // grade — грейд дня оператора (1–4, как тег Vexi): считает сам отправитель по своим доведённым лидам;
  // role — роль аккаунта; у СВ ещё gids — его группы и team — как их подписать («Группа 1», «2 группы»)
  | { t: "hello"; sid: string; id: string; name: string; path: string; grade?: number; role?: "head" | "supervisor" | "operator"; gids?: string[]; team?: string }
  | { t: "cur"; sid: string; path: string; x: number; y: number }
  | { t: "out"; sid: string }
  // mid — id сообщения, чтобы на него можно было отреагировать
  | { t: "msg"; sid: string; path: string; text: string; mid?: string }
  // реакция на сообщение mid: on — поставил, иначе снял; id/name — кто
  | { t: "react"; sid: string; mid: string; emoji: string; on: boolean; id: string; name: string }
  | { t: "bye"; sid: string }
  // камень-ножницы-бумага: to — вкладка соперника (у show нет: облачко с рукой видят все на странице);
  // hand — r камень, s ножницы, p бумага; busy — отказ, потому что уже играет
  | { t: "rps"; sid: string; kind: "invite" | "accept" | "decline" | "pick" | "bye" | "show"; gid: string; to?: string; id?: string; name?: string; hand?: "r" | "p" | "s"; round?: number; busy?: boolean }
  // праздник у всех: g4 — человек взял Грейд IV, plan — отдел выполнил план дня; key — один раз за день
  | { t: "party"; sid: string; key: string; kind: "g4" | "plan"; name?: string; n?: number; plan?: number };

/* ── праздники: какие уже показали сегодня (в этом браузере), чтобы не повторять ── */
const PARTY_KEY = "leadup.live.party";

export function partySeen(key: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(PARTY_KEY) || "[]") as string[]).includes(key);
  } catch {
    return false;
  }
}

/** Отметить показанным; ключи держим только за последние дни. */
export function markParty(key: string, today: string) {
  try {
    const keep = (JSON.parse(localStorage.getItem(PARTY_KEY) || "[]") as string[]).filter((k) => k.endsWith(today)).slice(-50);
    localStorage.setItem(PARTY_KEY, JSON.stringify([...keep, key]));
  } catch {
    /* не запомнили — в худшем случае покажем ещё раз */
  }
}

export interface LiveLink {
  send: (m: LiveMsg) => void;
  close: () => void;
}

export function openLive(onMsg: (m: LiveMsg) => void): LiveLink {
  if (supabaseReady) {
    const ch = supabase().channel("leadup-live", { config: { broadcast: { self: false } } });
    let ready = false;
    // до подключения копим только последнее «я здесь» — движения мыши без него никому не нужны
    let pending: LiveMsg | null = null;
    ch.on("broadcast", { event: "live" }, ({ payload }) => onMsg(payload as LiveMsg));
    ch.subscribe((status) => {
      if (status !== "SUBSCRIBED") return;
      ready = true;
      if (pending) void ch.send({ type: "broadcast", event: "live", payload: pending });
      pending = null;
    });
    return {
      send: (m) => {
        if (ready) void ch.send({ type: "broadcast", event: "live", payload: m });
        else if (m.t === "hello") pending = m;
      },
      close: () => void supabase().removeChannel(ch),
    };
  }
  if (typeof BroadcastChannel === "undefined") return { send: () => {}, close: () => {} };
  const bc = new BroadcastChannel("leadup-live");
  bc.onmessage = (e) => onMsg(e.data as LiveMsg);
  return { send: (m) => bc.postMessage(m), close: () => bc.close() };
}

/* ── «скрывать мой курсор»: в этом браузере ── */
const HIDE_KEY = "leadup.live.hidden";
export const LIVE_HIDE_EVENT = "leadup:live-hidden";

export function liveHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLiveHidden(v: boolean) {
  try {
    localStorage.setItem(HIDE_KEY, v ? "1" : "0");
  } catch {
    /* не запомнили — до перезагрузки */
  }
  window.dispatchEvent(new Event(LIVE_HIDE_EVENT));
}

/* ── «не показывать курсоры коллег»: в этом браузере; свой курсор при этом коллеги видят ── */
const OTHERS_KEY = "leadup.live.others-off";

export function liveOthersOff(): boolean {
  try {
    return localStorage.getItem(OTHERS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setLiveOthersOff(v: boolean) {
  try {
    localStorage.setItem(OTHERS_KEY, v ? "1" : "0");
  } catch {
    /* не запомнили — до перезагрузки */
  }
  window.dispatchEvent(new Event(LIVE_HIDE_EVENT));
}

/** Цвет человека — по id аккаунта, у всех одинаковый. Яркие, чтобы курсоры не путались. */
const LIVE_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#06b6d4", "#3b82f6", "#ec4899", "#f97316", "#14b8a6", "#a855f7", "#84cc16"];
export function liveColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return LIVE_COLORS[h % LIVE_COLORS.length];
}
