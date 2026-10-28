"use client";

import { useSyncExternalStore } from "react";

/**
 * Общий плеер записей разговоров — один на всё приложение.
 * Сам <audio> живёт вне React и не привязан к карточке лида: ушли на другую страницу — запись
 * играет дальше, а снизу её подхватывает мини-плеер (components/app/MiniPlayer.tsx).
 * Карточка лида (CallReview) только управляет плеером и показывает его состояние.
 */
export type PlayerMeta = {
  leadId: string;
  /** Клиент — крупно в мини-плеере. */
  title: string;
  /** Оператор и когда передан. */
  sub: string;
};

export type PlayerState = {
  src: string | null;
  meta: PlayerMeta | null;
  playing: boolean;
  t: number;
  dur: number;
  speed: number;
  vol: number;
  /** Сколько открытых карточек сейчас показывают эту запись — тогда мини-плеер не нужен. */
  views: Record<string, number>;
  /** Где стоял плеер карточки, когда её закрыли (экранные координаты) — мини-плеер «прилетает» оттуда. */
  origin: { x: number; y: number; w: number; h: number; at: number } | null;
};

const VOL_KEY = "leadup.playerVolume";
function savedVolume(): number {
  try {
    const raw = localStorage.getItem(VOL_KEY);
    const v = Number(raw);
    return raw != null && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  } catch {
    return 1;
  }
}

const EMPTY: PlayerState = { src: null, meta: null, playing: false, t: 0, dur: 0, speed: 1, vol: 1, views: {}, origin: null };
let st: PlayerState = EMPTY;
let inited = false;
const subs = new Set<() => void>();
let audio: HTMLAudioElement | null = null;

function set(p: Partial<PlayerState>) {
  st = { ...st, ...p };
  subs.forEach((f) => f());
}

function el(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = "metadata";
  a.addEventListener("play", () => set({ playing: true }));
  a.addEventListener("pause", () => set({ playing: false }));
  a.addEventListener("ended", () => set({ playing: false }));
  a.addEventListener("timeupdate", () => set({ t: a.currentTime }));
  a.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(a.duration)) set({ dur: a.duration });
    a.playbackRate = st.speed;
    a.volume = st.vol;
  });
  audio = a;
  return a;
}

function init() {
  if (inited || typeof window === "undefined") return;
  inited = true;
  st = { ...st, vol: savedVolume() };
}

export const player = {
  get: (): PlayerState => {
    init();
    return st;
  },
  subscribe(f: () => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
  /** Поставить запись (не запуская): другая — сначала, та же — без изменений. */
  load(src: string, meta: PlayerMeta) {
    init();
    const a = el();
    if (st.src !== src) {
      a.src = src;
      a.playbackRate = st.speed;
      a.volume = st.vol;
      set({ src, meta, t: 0, dur: 0, playing: false });
    } else set({ meta });
  },
  play(src: string, meta: PlayerMeta) {
    player.load(src, meta);
    void el().play().catch(() => {});
  },
  toggle() {
    if (!st.src) return;
    const a = el();
    if (a.paused) void a.play().catch(() => {});
    else a.pause();
  },
  seek(src: string, meta: PlayerMeta, sec: number) {
    player.load(src, meta);
    const a = el();
    a.currentTime = sec;
    set({ t: sec });
    void a.play().catch(() => {});
  },
  setSpeed(v: number) {
    el().playbackRate = v;
    set({ speed: v });
  },
  setVol(v: number) {
    el().volume = v;
    set({ vol: v });
    try {
      localStorage.setItem(VOL_KEY, String(v));
    } catch {
      /* не запомнили — до перезагрузки */
    }
  },
  /** Закрыть мини-плеер: остановить и забыть запись. */
  stop() {
    const a = el();
    a.pause();
    a.removeAttribute("src");
    a.load();
    set({ src: null, meta: null, playing: false, t: 0, dur: 0 });
  },
  /**
   * Карточка показывает запись src — пока открыта, мини-плеер для неё не нужен. Возвращает «закрыли»;
   * box — где плеер карточки на экране в момент закрытия (оттуда мини-плеер прилетит).
   */
  view(src: string, box?: () => DOMRect | null) {
    set({ views: { ...st.views, [src]: (st.views[src] ?? 0) + 1 } });
    return () => {
      const n = (st.views[src] ?? 1) - 1;
      const views = { ...st.views };
      if (n > 0) views[src] = n;
      else delete views[src];
      const r = box?.();
      set({ views, origin: r && r.width > 0 ? { x: r.left, y: r.top, w: r.width, h: r.height, at: Date.now() } : st.origin });
    };
  },
};

export function usePlayer(): PlayerState {
  return useSyncExternalStore(player.subscribe, player.get, () => EMPTY);
}
