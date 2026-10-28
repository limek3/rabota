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
 *   bye   — закрыл вкладку или скрыл свой курсор.
 * sid — вкладка (у одного аккаунта их может быть несколько).
 */
export type LiveMsg =
  | { t: "hello"; sid: string; id: string; name: string; path: string }
  | { t: "cur"; sid: string; path: string; x: number; y: number }
  | { t: "out"; sid: string }
  | { t: "msg"; sid: string; path: string; text: string }
  | { t: "bye"; sid: string };

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

/** Цвет человека — по id аккаунта, у всех одинаковый. Яркие, чтобы курсоры не путались. */
const LIVE_COLORS = ["#ef4444", "#f59e0b", "#10b981", "#06b6d4", "#3b82f6", "#ec4899", "#f97316", "#14b8a6", "#a855f7", "#84cc16"];
export function liveColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return LIVE_COLORS[h % LIVE_COLORS.length];
}
