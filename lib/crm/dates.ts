import type { DayKey, MonthKey, Settings } from "./types";

/**
 * Работа с датами без часовых поясов.
 *
 * Все ключи — локальные строки. Внутри Date создаём на полдень, чтобы переход
 * на летнее/зимнее время не сдвигал сутки.
 */

const pad = (n: number) => String(n).padStart(2, "0");

export function toKey(d: Date): DayKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromKey(k: DayKey): Date {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0, 0);
}

export function todayKey(): DayKey {
  return toKey(new Date());
}

export function nowStamp(): string {
  const d = new Date();
  return `${toKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function isDayKey(s: unknown): s is DayKey {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = fromKey(s);
  return toKey(d) === s;
}

export function isMonthKey(s: unknown): s is MonthKey {
  return typeof s === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function isStamp(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) && isDayKey(s.slice(0, 10));
}

export function addDays(k: DayKey, n: number): DayKey {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function monthOf(k: DayKey | string): MonthKey {
  return k.slice(0, 7);
}

export function currentMonth(): MonthKey {
  return monthOf(todayKey());
}

export function addMonths(m: MonthKey, n: number): MonthKey {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + n, 1, 12);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function monthStart(m: MonthKey): DayKey {
  return `${m}-01`;
}

export function daysInMonth(m: MonthKey): number {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm, 0).getDate();
}

export function monthEnd(m: MonthKey): DayKey {
  return `${m}-${pad(daysInMonth(m))}`;
}

export function monthDays(m: MonthKey): DayKey[] {
  const n = daysInMonth(m);
  const out: DayKey[] = [];
  for (let i = 1; i <= n; i++) out.push(`${m}-${pad(i)}`);
  return out;
}

/** Все дни в диапазоне включительно. Защита от перевёрнутого и гигантского диапазона. */
export function rangeDays(from: DayKey, to: DayKey): DayKey[] {
  if (from > to) [from, to] = [to, from];
  const out: DayKey[] = [];
  let k = from;
  let guard = 0;
  while (k <= to && guard < 4000) {
    out.push(k);
    k = addDays(k, 1);
    guard++;
  }
  return out;
}

/** 1 = пн … 7 = вс */
export function isoWeekday(k: DayKey): number {
  const w = fromKey(k).getDay();
  return w === 0 ? 7 : w;
}

export function weekStart(k: DayKey): DayKey {
  return addDays(k, 1 - isoWeekday(k));
}

export function weekEnd(k: DayKey): DayKey {
  return addDays(weekStart(k), 6);
}

export function isWorkday(k: DayKey, s: Pick<Settings, "workdays" | "holidays">): boolean {
  if (s.holidays.includes(k)) return false;
  const wd = s.workdays.length ? s.workdays : [1, 2, 3, 4, 5];
  return wd.includes(isoWeekday(k));
}

/* ── форматирование ────────────────────────────────────────────────── */

const MONTHS_NOM = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const MONTHS_GEN = [
  "января", "февраля", "марта", "апреля", "мая", "июня",
  "июля", "августа", "сентября", "октября", "ноября", "декабря",
];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
export const WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

export function fmtMonth(m: MonthKey): string {
  const [y, mm] = m.split("-").map(Number);
  return `${MONTHS_NOM[mm - 1] ?? "?"} ${y}`;
}

export function fmtMonthShort(m: MonthKey): string {
  const [y, mm] = m.split("-").map(Number);
  return `${MONTHS_SHORT[mm - 1] ?? "?"} ${String(y).slice(2)}`;
}

/** «19 сентября» (+ год, если не текущий) */
export function fmtDay(k: DayKey, withYear = false): string {
  const [y, m, d] = k.split("-").map(Number);
  const base = `${d} ${MONTHS_GEN[m - 1] ?? ""}`;
  const needYear = withYear || y !== new Date().getFullYear();
  return needYear ? `${base} ${y}` : base;
}

/** «19 сен» */
export function fmtDayShort(k: DayKey): string {
  const [, m, d] = k.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1] ?? ""}`;
}

/** «19.09.2026» */
export function fmtDate(k: DayKey): string {
  if (!k) return "—";
  const [y, m, d] = k.split("-");
  return `${d}.${m}.${y}`;
}

export function fmtStamp(at: string): string {
  if (!at) return "—";
  return `${fmtDate(at.slice(0, 10))} ${at.slice(11, 16)}`;
}

export function fmtWeekday(k: DayKey): string {
  return WEEKDAYS_SHORT[isoWeekday(k) - 1];
}

export function fmtRange(from: DayKey, to: DayKey): string {
  if (from === to) return fmtDayShort(from);
  if (from.slice(0, 7) === to.slice(0, 7)) {
    return `${Number(from.slice(8))}–${fmtDayShort(to)}`;
  }
  return `${fmtDayShort(from)} – ${fmtDayShort(to)}`;
}
