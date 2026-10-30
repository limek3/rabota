"use client";

import { supabase, supabaseReady } from "@/lib/supabase";
import { appStamp, nowMs } from "@/lib/crm/dates";
import type { Lead, MonthKey } from "@/lib/crm/types";

/**
 * «Холст» — общий пиксель-арт отдела. Один холст на месяц, SIZE×SIZE клеток.
 *
 * Краска: 1 одобренный лид (супервайзер перевёл в «доведён» в этом месяце) = 1 пиксель.
 * СВ и РОП красят ещё и за команду: 1 пиксель за каждые TEAM_RATE одобренных лидов своих
 * групп (у РОПа — всего отдела). Особые цвета (TIERS) оператору открывает грейд.
 * Баланс не хранится — считается: одобренные лиды месяца минус поставленные пиксели. Лид
 * ушёл из «доведён» — баланс уходит в минус, пока новые лиды его не закроют.
 *
 * Клетка показывает последний не стёртый пиксель. Чужой свежий пиксель PROTECT_MS не
 * перекрасить; свой можно отменить UNDO_MS — краска вернётся. РОП и супервайзер стирают
 * (модерация): запись остаётся с erasedAt, краска нарушителю не возвращается.
 *
 * Где хранится:
 *   • с Supabase — таблица pixels и функции crm_paint* (supabase/migrations/…_pixel_canvas.sql),
 *     правила проверяет база, обновления — Realtime;
 *   • без Supabase — localStorage этого браузера, вкладки синхронизирует BroadcastChannel.
 */

export const SIZE = 32;
export const PROTECT_MS = 5 * 60_000;
export const UNDO_MS = 10_000;

export interface Pixel {
  id: string;
  month: MonthKey;
  x: number;
  y: number;
  color: string;
  accountId: string;
  name: string;
  /** ISO-время, когда поставили. */
  at: string;
  erasedAt?: string | null;
}

export type PixelChange = { type: "put"; p: Pixel } | { type: "del"; id: string };

/* ── палитра: семейства цветов, в каждом оттенки от светлого к тёмному ── */

export interface Family {
  name: string;
  shades: string[];
}

function hsl(h: number, s: number, l: number): string {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

const LIGHT = [93, 84, 74, 63, 52, 41, 31, 21];
const fam = (name: string, h: number, s: number, light = LIGHT): Family => ({ name, shades: light.map((l) => hsl(h, s, l)) });

export const PALETTE: Family[] = [
  { name: "Серый", shades: ["#ffffff", "#e2e4e9", "#c3c7cf", "#9aa0ab", "#6e7480", "#4a4f59", "#2b2f36", "#000000"] },
  fam("Красный", 356, 78),
  fam("Оранжевый", 22, 90),
  fam("Жёлтый", 46, 95),
  fam("Салатовый", 82, 65),
  fam("Зелёный", 138, 55),
  fam("Бирюзовый", 172, 62),
  fam("Голубой", 197, 80),
  fam("Синий", 222, 75),
  fam("Индиго", 248, 60),
  fam("Фиолетовый", 276, 58),
  fam("Розовый", 328, 75),
  fam("Коричневый", 24, 42),
  fam("Бежевый", 30, 55, [95, 89, 82, 75, 67, 58, 48, 38]),
];

/**
 * Особые цвета — открываются оператору лучшим грейдом дня за месяц (как у Vexi: 6 / 8 / 11
 * доведённых лидов за день). РОПу и супервайзеру открыто всё. Те же списки — в crm_paint.
 */
export const PASTEL = ["#ffd1dc", "#ffdac1", "#ffe5b4", "#fdfd96", "#e2f0cb", "#c1f0c1", "#b5ead7", "#d4f0f0", "#aec6cf", "#c7ceea", "#c3b1e1", "#e0bbe4", "#f8c8dc", "#fcd5ce", "#f1e3d3", "#dbe7c9"];
export const NEON = ["#ff073a", "#ff5f1f", "#fff01f", "#ccff00", "#39ff14", "#00ff9f", "#0ff0fc", "#1f51ff", "#bc13fe", "#ff00ff", "#fe019a", "#ff6ec7"];
/** Золотой пиксель — на холсте по нему пробегает блик. */
export const GOLD = "#e8b923";

export interface Tier {
  grade: 2 | 3 | 4;
  name: string;
  colors: string[];
}
export const TIERS: Tier[] = [
  { grade: 2, name: "Пастель", colors: PASTEL },
  { grade: 3, name: "Неон", colors: NEON },
  { grade: 4, name: "Золото", colors: [GOLD] },
];

/** Какой грейд нужен для цвета (1 — открыт всем). */
export function colorGrade(c: string): 1 | 2 | 3 | 4 {
  return TIERS.find((t) => t.colors.includes(c))?.grade ?? 1;
}

export const isColor = (c: unknown): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/.test(c);

/* ── правила ── */

/** СВ и РОП красят за одобренные лиды команды: 1 пиксель за каждые N. Те же числа — в crm_paint_earned. */
export const TEAM_RATE = { supervisor: 5, head: 10 } as const;

/** Месяц, в котором лид одобрен: по времени смены статуса (у старых лидов его нет — по дате лида). */
function approvedMonth(l: Lead): string {
  return (l.statusAt ? appStamp(l.statusAt) : l.at).slice(0, 7);
}

export interface Painter {
  role: "head" | "supervisor" | "operator";
  opId: string | null;
  /** Группы супервайзера. */
  groups: Set<string>;
}

export interface Earned {
  /** Свои одобренные лиды (у кого есть карточка оператора). */
  own: number;
  /** Одобренные лиды команды: групп СВ или всего отдела у РОПа. */
  team: number;
  /** Сколько лидов команды на 1 пиксель (0 — оператор, команды нет). */
  rate: number;
  total: number;
}

/** Сколько краски заработано за месяц: свои одобренные лиды + у СВ и РОПа доля одобренных лидов команды. */
export function paintEarned(leads: Lead[], who: Painter, month: MonthKey): Earned {
  const rate = who.role === "operator" ? 0 : TEAM_RATE[who.role];
  let own = 0;
  let team = 0;
  for (const l of leads) {
    if (l.status !== "done" || approvedMonth(l) !== month) continue;
    if (who.opId && l.operatorId === who.opId) own++;
    if (who.role === "head" || (who.role === "supervisor" && l.groupId && who.groups.has(l.groupId))) team++;
  }
  return { own, team, rate, total: own + (rate ? Math.floor(team / rate) : 0) };
}

/** Лучший грейд дня за месяц у оператора — по доведённым лидам, как у Vexi. РОП и СВ — 4. */
export function bestGrade(leads: Lead[], who: Painter, month: MonthKey): 1 | 2 | 3 | 4 {
  if (who.role !== "operator") return 4;
  if (!who.opId) return 1;
  const byDay = new Map<string, number>();
  for (const l of leads) {
    if (l.operatorId !== who.opId || l.status !== "done" || !l.at.startsWith(month)) continue;
    const d = l.at.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const n = Math.max(0, ...byDay.values());
  return n >= 11 ? 4 : n >= 8 ? 3 : n >= 6 ? 2 : 1;
}

/** Потрачено — все свои пиксели месяца, и стёртые модератором тоже (отменённые удаляются). */
export function paintSpent(rows: Pixel[], accountId: string): number {
  let n = 0;
  for (const p of rows) if (p.accountId === accountId) n++;
  return n;
}

const byTime = (a: Pixel, b: Pixel) => a.at.localeCompare(b.at) || Number(a.id) - Number(b.id);

/** Что видно в каждой клетке: последний не стёртый пиксель. Ключ — y * SIZE + x. */
export function topCells(rows: Pixel[]): Map<number, Pixel> {
  const m = new Map<number, Pixel>();
  for (const p of [...rows].sort(byTime)) {
    if (p.erasedAt) continue;
    m.set(p.y * SIZE + p.x, p);
  }
  return m;
}

/** Почему нельзя поставить пиксель (null — можно). Та же проверка в crm_paint. */
export function paintBlock(top: Pixel | undefined, color: string, accountId: string, left: number, grade: number, now = nowMs()): string | null {
  const need = colorGrade(color);
  if (need > grade) return `${TIERS.find((t) => t.grade === need)!.name} откроется на Грейде ${["I", "II", "III", "IV"][need - 1]}`;
  if (top?.color === color) return "Пиксель уже этого цвета";
  if (top && top.accountId !== accountId) {
    const rest = Date.parse(top.at) + PROTECT_MS - now;
    if (rest > 0) return `Пиксель только что поставили — перекрасить можно через ${Math.max(1, Math.ceil(rest / 60_000))} мин`;
  }
  if (left < 1) return "Краска закончилась: 1 пиксель — за 1 одобренный лид";
  return null;
}

export const sortByTime = (rows: Pixel[]) => [...rows].sort(byTime);

/* ── хранилище ── */

export interface PaintCtx {
  accountId: string;
  name: string;
  month: MonthKey;
  earned: number;
  grade: number;
  canModerate: boolean;
}

export interface PixelStore {
  load: (month: MonthKey) => Promise<Pixel[]>;
  paint: (x: number, y: number, color: string, ctx: PaintCtx) => Promise<Pixel>;
  undo: (id: string, ctx: PaintCtx) => Promise<boolean>;
  erase: (ids: string[], ctx: PaintCtx) => Promise<number>;
  subscribe: (month: MonthKey, on: (c: PixelChange) => void) => () => void;
}

function fromRow(r: Record<string, unknown>): Pixel {
  return {
    id: String(r.id),
    month: String(r.month),
    x: Number(r.x),
    y: Number(r.y),
    color: String(r.color),
    accountId: String(r.account_id),
    name: String(r.author_name ?? ""),
    at: String(r.created_at),
    erasedAt: (r.erased_at as string | null) ?? null,
  };
}

const remoteStore: PixelStore = {
  async load(month) {
    const out: Pixel[] = [];
    // журнал месяца может быть больше лимита одного запроса — читаем страницами
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase().from("pixels").select("*").eq("month", month).order("id").range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []).map(fromRow));
      if (!data || data.length < 1000) return out;
    }
  },
  async paint(x, y, color) {
    const { data, error } = await supabase().rpc("crm_paint", { p_x: x, p_y: y, p_color: color });
    if (error) throw new Error(error.message);
    return fromRow(data as Record<string, unknown>);
  },
  async undo(id) {
    const { data, error } = await supabase().rpc("crm_paint_undo", { p_id: Number(id) });
    if (error) throw new Error(error.message);
    return !!data;
  },
  async erase(ids) {
    const { data, error } = await supabase().rpc("crm_paint_erase", { p_ids: ids.map(Number) });
    if (error) throw new Error(error.message);
    return Number(data ?? 0);
  },
  subscribe(month, on) {
    const ch = supabase().channel(`pixels-${month}`);
    ch.on("postgres_changes", { event: "*", schema: "public", table: "pixels" }, (p) => {
      if (p.eventType === "DELETE") on({ type: "del", id: String((p.old as { id?: unknown })?.id ?? "") });
      else {
        const px = fromRow(p.new as Record<string, unknown>);
        if (px.month === month) on({ type: "put", p: px });
      }
    });
    ch.subscribe();
    return () => void supabase().removeChannel(ch);
  },
};

/* без Supabase: всё в localStorage, изменения — соседним вкладкам */
const LS_KEY = "leadup.pixels";
const BC_NAME = "leadup-pixels";

function lsRead(): Pixel[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    return Array.isArray(v) ? (v as Pixel[]) : [];
  } catch {
    return [];
  }
}

function lsWrite(rows: Pixel[], changes: PixelChange[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(rows));
  } catch {
    throw new Error("Не получилось сохранить холст в этом браузере");
  }
  try {
    const bc = new BroadcastChannel(BC_NAME);
    for (const c of changes) bc.postMessage(c);
    bc.close();
  } catch {
    /* соседние вкладки увидят после перезагрузки */
  }
}

const localStore: PixelStore = {
  async load(month) {
    return lsRead().filter((p) => p.month === month);
  },
  async paint(x, y, color, ctx) {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) throw new Error("Мимо холста");
    if (!isColor(color)) throw new Error("Непонятный цвет");
    const all = lsRead();
    const mine = all.filter((p) => p.month === ctx.month);
    const why = paintBlock(topCells(mine).get(y * SIZE + x), color, ctx.accountId, ctx.earned - paintSpent(mine, ctx.accountId), ctx.grade);
    if (why) throw new Error(why);
    const p: Pixel = { id: String(Math.max(0, ...all.map((r) => Number(r.id) || 0)) + 1), month: ctx.month, x, y, color, accountId: ctx.accountId, name: ctx.name, at: new Date(nowMs()).toISOString(), erasedAt: null };
    lsWrite([...all, p], [{ type: "put", p }]);
    return p;
  },
  async undo(id, ctx) {
    const all = lsRead();
    const p = all.find((r) => r.id === id);
    if (!p || p.accountId !== ctx.accountId || p.erasedAt || nowMs() - Date.parse(p.at) > UNDO_MS + 5000) return false;
    lsWrite(all.filter((r) => r.id !== id), [{ type: "del", id }]);
    return true;
  },
  async erase(ids, ctx) {
    if (!ctx.canModerate) throw new Error("Стирать чужие пиксели могут РОП и супервайзер");
    const set = new Set(ids);
    const at = new Date(nowMs()).toISOString();
    let n = 0;
    const all = lsRead().map((r) => {
      if (!set.has(r.id) || r.erasedAt) return r;
      n++;
      return { ...r, erasedAt: at };
    });
    if (n) lsWrite(all, all.filter((r) => set.has(r.id)).map((p): PixelChange => ({ type: "put", p })));
    return n;
  },
  subscribe(month, on) {
    if (typeof BroadcastChannel === "undefined") return () => {};
    const bc = new BroadcastChannel(BC_NAME);
    bc.onmessage = (e) => {
      const c = e.data as PixelChange;
      if (c.type === "del" || c.p.month === month) on(c);
    };
    return () => bc.close();
  },
};

export const pixelStore: PixelStore = supabaseReady ? remoteStore : localStore;
