import type { DayKey, Lead } from "./types";
import { isoWeekday } from "./dates";
import { safeDiv } from "./format";

/**
 * Лиды по часам: по часам дня и по дням недели («день недели × час»).
 *
 * Время берётся из записи лида (at = момент передачи). «Не доведён» в основную
 * карту не идёт — как и везде в CRM, — но считается отдельно, чтобы видеть часы,
 * в которые лиды чаще срываются.
 *
 * Сырые суммы нечестно сравнивать между днями недели: в месяце может быть пять
 * понедельников и четыре пятницы. Поэтому есть среднее: сумма ÷ число дней этого
 * дня недели, в которые вообще были лиды (дни без работы среднее не размывают).
 */

export interface HourGrid {
  /** [день недели 0 = пн … 6 = вс][час 0…23] — лиды в факт. */
  leads: number[][];
  /** То же для «не доведён». */
  failed: number[][];
  /** Дней с лидами по дням недели — база среднего. */
  daysByWd: number[];
  byHour: number[];
  failedByHour: number[];
  byWd: number[];
  total: number;
  failedTotal: number;
  /** Диапазон часов для показа: от первого до последнего часа с лидами. */
  hourFrom: number;
  hourTo: number;
  /** Самая сильная клетка. */
  peak: { wd: number; hour: number; leads: number } | null;
}

const zeros = (n: number) => Array.from({ length: n }, () => 0);

export function hourGrid(leads: Lead[], from: DayKey, to: DayKey, keep?: (l: Lead) => boolean): HourGrid {
  const grid = Array.from({ length: 7 }, () => zeros(24));
  const bad = Array.from({ length: 7 }, () => zeros(24));
  const days = Array.from({ length: 7 }, () => new Set<DayKey>());
  let lo = 24;
  let hi = -1;
  for (const l of leads) {
    const d = l.at.slice(0, 10);
    if (d < from || d > to) continue;
    if (keep && !keep(l)) continue;
    const h = Number(l.at.slice(11, 13));
    if (!Number.isInteger(h) || h < 0 || h > 23 || l.at[10] !== "T") continue;
    const wd = isoWeekday(d) - 1;
    days[wd].add(d);
    if (l.status === "failed") bad[wd][h]++;
    else grid[wd][h]++;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  const byHour = zeros(24);
  const failedByHour = zeros(24);
  const byWd = zeros(7);
  let total = 0;
  let failedTotal = 0;
  let peak: HourGrid["peak"] = null;
  for (let wd = 0; wd < 7; wd++) {
    for (let h = 0; h < 24; h++) {
      const n = grid[wd][h];
      byHour[h] += n;
      failedByHour[h] += bad[wd][h];
      byWd[wd] += n;
      total += n;
      failedTotal += bad[wd][h];
      if (n > 0 && (!peak || n > peak.leads)) peak = { wd, hour: h, leads: n };
    }
  }
  return {
    leads: grid,
    failed: bad,
    daysByWd: days.map((s) => s.size),
    byHour,
    failedByHour,
    byWd,
    total,
    failedTotal,
    // пустой период — обычный рабочий день, чтобы сетка не схлопнулась
    hourFrom: hi < 0 ? 9 : lo,
    hourTo: hi < 0 ? 20 : hi,
    peak,
  };
}

/** Среднее за день: клетка ÷ число дней этого дня недели с лидами. */
export function perDay(g: HourGrid, wd: number, hour: number): number {
  return safeDiv(g.leads[wd][hour], g.daysByWd[wd]);
}

/**
 * Лучшее окно смены: непрерывные `len` часов, которые собирают больше всего лидов.
 * Ответ на вопрос «с какого часа ставить смену». null — лидов нет.
 */
export function bestWindow(byHour: number[], len: number): { from: number; to: number; leads: number; share: number } | null {
  const total = byHour.reduce((a, b) => a + b, 0);
  const L = Math.max(1, Math.min(24, Math.round(len)));
  if (total <= 0) return null;
  // при равенстве — окно ближе к середине часов с лидами: не «с 8 утра», когда первые лиды в 11
  const first = byHour.findIndex((n) => n > 0);
  const last = 23 - [...byHour].reverse().findIndex((n) => n > 0);
  const mid = (first + last + 1) / 2;
  let best = -1;
  let at = 0;
  for (let s = 0; s + L <= 24; s++) {
    let sum = 0;
    for (let h = s; h < s + L; h++) sum += byHour[h];
    if (sum > best || (sum === best && Math.abs(s + L / 2 - mid) < Math.abs(at + L / 2 - mid))) {
      best = sum;
      at = s;
    }
  }
  return { from: at, to: at + L, leads: best, share: best / total };
}

export const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
