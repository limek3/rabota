import type { Candidate, DataState, DayKey, ID, MonthKey, Operator } from "./types";
import { probation, type Index, type Probation } from "./calc";
import { addDays, fromKey, monthEnd, monthStart } from "./dates";
import { safeDiv } from "./format";

/**
 * Найм и текучесть. Чистые функции, как calc.ts.
 *
 *   Воронка        — кандидаты с откликом в периоде: сколько дошло до собеседования,
 *                    обучения, приёма и закрыло стажировку. Этапы вложены: кандидат,
 *                    которого взяли без отметки собеседования, всё равно его прошёл.
 *   Принятые       — все, кого приняли в периоде (с кандидатом или без): стажировка,
 *                    кто работает, кто ушёл и как быстро.
 *   Текучесть      — по месяцам: было на начало, принято, уволено, стало, % оттока
 *                    (уволено ÷ средняя численность).
 *
 * Дата приёма — из карточки; если её нет, первый день с лидом или сменой. Уход —
 * дата увольнения; у уволенного без даты — последний день работы. Карточки, удалённые
 * без единого лида и смены (заведены по ошибке), в расчёт не идут.
 */

export const reachedInterview = (c: Candidate) => c.stage === "interview" || c.stage === "training" || c.stage === "hired" || !!c.interviewAt || !!c.trainingAt;
export const reachedTraining = (c: Candidate) => c.stage === "training" || c.stage === "hired" || !!c.trainingAt;
export const isOpenCandidate = (c: Candidate) => c.stage === "new" || c.stage === "interview" || c.stage === "training";

/** Дней от a до b (b − a), даты "YYYY-MM-DD". */
export function daysBetween(a: DayKey, b: DayKey): number {
  return Math.round((fromKey(b).getTime() - fromKey(a).getTime()) / 86_400_000);
}

export interface Stint {
  op: Operator;
  hire: DayKey;
  /** Последний рабочий день; null — работает. */
  fire: DayKey | null;
}

function activity(ix: Index, id: ID): { first: DayKey | null; last: DayKey | null } {
  let first: DayKey | null = null;
  let last: DayKey | null = null;
  for (const m of [ix.opDay.get(id), ix.hoursOpDay.get(id)]) {
    if (!m) continue;
    for (const d of m.keys()) {
      if (!first || d < first) first = d;
      if (!last || d > last) last = d;
    }
  }
  return { first, last };
}

/** Период работы каждого сотрудника (для стажа и текучести). */
export function stints(st: DataState, ix: Index): Stint[] {
  const out: Stint[] = [];
  for (const op of st.operators) {
    const act = activity(ix, op.id);
    if (op.deletedAt && !act.first) continue; // заведён по ошибке и удалён
    const hire = op.hireDate || act.first;
    if (!hire) continue; // ни даты приёма, ни одного рабочего дня — считать нечего
    let fire: DayKey | null = null;
    if (op.fireDate) fire = op.fireDate;
    else if (op.status === "fired") fire = act.last && act.last >= hire ? act.last : hire;
    out.push({ op, hire, fire: fire && fire < hire ? hire : fire });
  }
  return out;
}

/** В штате в этот день: принят не позже и не ушёл раньше (день увольнения — ещё рабочий). */
const employedOn = (s: Stint, d: DayKey) => s.hire <= d && (!s.fire || s.fire >= d);

/** Стаж в днях на дату (или на день ухода). */
export const tenureDays = (s: Stint, today: DayKey) => Math.max(0, daysBetween(s.hire, s.fire && s.fire < today ? s.fire : today));

/* ── воронка кандидатов ────────────────────────────────────────────── */

export interface FunnelStep {
  key: "applied" | "interview" | "training" | "hired" | "probation";
  label: string;
  count: number;
  /** Доля от откликов. */
  ofFirst: number;
  /** Переход с предыдущего этапа (null у первого). */
  ofPrev: number | null;
}

export interface HiringFunnel {
  candidates: Candidate[];
  steps: FunnelStep[];
  /** Ещё в работе (отклик / собеседование / обучение). */
  open: number;
  rejected: number;
  declined: number;
  /** Из принятых: работают сейчас / из них ещё на стажировке / ушли / ушли, не закрыв стажировку. */
  working: number;
  onProbation: number;
  fired: number;
  firedBeforeProbation: number;
  /** Стажировка включена в настройках (иначе этапа «прошли стажировку» нет). */
  probationOn: boolean;
  /** Среднее дней от отклика до приёма. */
  avgDaysToHire: number | null;
  sources: { source: string; candidates: number; hired: number; pct: number }[];
  reasons: { reason: string; count: number }[];
}

const NO_SOURCE = "Не указан";

export function hiringFunnel(st: DataState, ix: Index, from: DayKey, to: DayKey, today: DayKey): HiringFunnel {
  const list = st.candidates.filter((c) => !c.deletedAt && c.appliedAt >= from && c.appliedAt <= to);
  const probOn = st.settings.probationHours > 0 || st.settings.probationLeads > 0;
  const hired = list.filter((c) => c.stage === "hired");
  const byOp = new Map<ID, Operator>(st.operators.map((o) => [o.id, o]));

  let passed = 0;
  let working = 0;
  let onProbation = 0;
  let fired = 0;
  let firedBefore = 0;
  const hireDays: number[] = [];
  for (const c of hired) {
    if (c.closedAt && c.closedAt >= c.appliedAt) hireDays.push(daysBetween(c.appliedAt, c.closedAt));
    const op = c.operatorId ? byOp.get(c.operatorId) : undefined;
    if (!op) continue;
    const p = probation(op, ix, st.settings, today);
    const done = !p.active || p.done;
    if (done) passed++;
    const gone = op.status === "fired" || !!op.deletedAt || (!!op.fireDate && op.fireDate < today);
    if (gone) {
      fired++;
      if (!done) firedBefore++;
    } else {
      working++;
      if (!done) onProbation++;
    }
  }

  const counts: [FunnelStep["key"], string, number][] = [
    ["applied", "Отклики", list.length],
    ["interview", "Собеседование", list.filter(reachedInterview).length],
    ["training", "Обучение", list.filter(reachedTraining).length],
    ["hired", "Приняты", hired.length],
  ];
  if (probOn) counts.push(["probation", "Прошли стажировку", passed]);
  const steps: FunnelStep[] = counts.map(([key, label, count], i) => ({
    key,
    label,
    count,
    ofFirst: safeDiv(count, list.length),
    ofPrev: i === 0 ? null : safeDiv(count, counts[i - 1][2]),
  }));

  const src = new Map<string, { candidates: number; hired: number }>();
  for (const c of list) {
    const key = c.source.trim() || NO_SOURCE;
    const r = src.get(key) ?? { candidates: 0, hired: 0 };
    r.candidates++;
    if (c.stage === "hired") r.hired++;
    src.set(key, r);
  }
  const sources = Array.from(src, ([source, r]) => ({ source, ...r, pct: safeDiv(r.hired, r.candidates) })).sort(
    (a, b) => b.hired - a.hired || b.candidates - a.candidates || a.source.localeCompare(b.source, "ru"),
  );

  const rs = new Map<string, number>();
  for (const c of list) {
    if (c.stage !== "rejected" && c.stage !== "declined") continue;
    const key = c.reason.trim() || "Без причины";
    rs.set(key, (rs.get(key) ?? 0) + 1);
  }
  const reasons = Array.from(rs, ([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, "ru"));

  return {
    candidates: list,
    steps,
    open: list.filter(isOpenCandidate).length,
    rejected: list.filter((c) => c.stage === "rejected").length,
    declined: list.filter((c) => c.stage === "declined").length,
    working,
    onProbation,
    fired,
    firedBeforeProbation: firedBefore,
    probationOn: probOn,
    avgDaysToHire: hireDays.length ? hireDays.reduce((a, b) => a + b, 0) / hireDays.length : null,
    sources,
    reasons,
  };
}

/* ── принятые за период ────────────────────────────────────────────── */

export interface HireRow {
  stint: Stint;
  prob: Probation;
  /** Стажировка: true — закрыта, false — нет, null — не нужна (пороги 0). */
  passed: boolean | null;
  /** Дней от приёма до закрытия стажировки. */
  daysToPass: number | null;
  /** Ушёл в первые 30 дней. */
  early: boolean;
  tenure: number;
  candidate: Candidate | null;
}

export const EARLY_DAYS = 30;

export function hiresIn(st: DataState, ix: Index, from: DayKey, to: DayKey, today: DayKey): HireRow[] {
  const byOp = new Map<ID, Candidate>();
  for (const c of st.candidates) if (c.operatorId && !c.deletedAt) byOp.set(c.operatorId, c);
  return stints(st, ix)
    .filter((s) => s.hire >= from && s.hire <= to && s.hire <= today)
    .map((s) => {
      const prob = probation(s.op, ix, st.settings, today);
      const passed = prob.active ? prob.done : null;
      return {
        stint: s,
        prob,
        passed,
        daysToPass: prob.done && prob.doneAt ? Math.max(0, daysBetween(s.hire, prob.doneAt)) : null,
        early: !!s.fire && s.fire <= today && daysBetween(s.hire, s.fire) < EARLY_DAYS,
        tenure: tenureDays(s, today),
        candidate: byOp.get(s.op.id) ?? null,
      };
    })
    .sort((a, b) => b.stint.hire.localeCompare(a.stint.hire) || a.stint.op.name.localeCompare(b.stint.op.name, "ru"));
}

/* ── текучесть по месяцам ──────────────────────────────────────────── */

export interface TurnoverRow {
  month: MonthKey;
  /** Было на первое число. */
  start: number;
  hired: number;
  fired: number;
  /** Стало на конец месяца (в текущем — на сегодня). */
  end: number;
  /** Уволено ÷ средняя численность; null — считать не из чего. */
  rate: number | null;
  /** Из уволенных — проработали меньше 30 дней. */
  early: number;
  /** Средний стаж уволенных в этом месяце, дней. */
  avgTenureFired: number | null;
  current: boolean;
}

export function turnoverByMonth(st: DataState, ix: Index, months: MonthKey[], today: DayKey): TurnoverRow[] {
  const all = stints(st, ix);
  const out: TurnoverRow[] = [];
  for (const month of months) {
    const first = monthStart(month);
    if (first > today) continue;
    const last = monthEnd(month) < today ? monthEnd(month) : today;
    // на начало: приняты до первого числа и не ушли раньше него
    const start = all.filter((s) => employedOn(s, first) && s.hire < first).length;
    const hired = all.filter((s) => s.hire >= first && s.hire <= last).length;
    const gone = all.filter((s) => s.fire && s.fire >= first && s.fire <= last);
    // на конец: в штате после последнего дня периода (ушедшие в этот день уже не в счёт)
    const end = all.filter((s) => s.hire <= last && (!s.fire || s.fire > last)).length;
    const avg = (start + end) / 2;
    out.push({
      month,
      start,
      hired,
      fired: gone.length,
      end,
      rate: avg > 0 ? gone.length / avg : gone.length > 0 ? 1 : null,
      early: gone.filter((s) => daysBetween(s.hire, s.fire!) < EARLY_DAYS).length,
      avgTenureFired: gone.length ? gone.reduce((a, s) => a + daysBetween(s.hire, s.fire!), 0) / gone.length : null,
      current: last === today && monthEnd(month) >= today,
    });
  }
  return out;
}

/* ── стаж и удержание ──────────────────────────────────────────────── */

export const TENURE_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: "до 1 мес.", from: 0, to: 29 },
  { label: "1–3 мес.", from: 30, to: 89 },
  { label: "3–6 мес.", from: 90, to: 179 },
  { label: "6–12 мес.", from: 180, to: 364 },
  { label: "больше года", from: 365, to: Infinity },
];

export interface StaffStat {
  /** Работают сейчас. */
  staff: Stint[];
  avgTenure: number | null;
  buckets: { label: string; count: number }[];
  /** Доля доработавших до 30 / 90 дней среди принятых не позже, чем 30 / 90 дней назад. */
  retention30: { kept: number; base: number; pct: number | null };
  retention90: { kept: number; base: number; pct: number | null };
}

function retention(all: Stint[], days: number, today: DayKey) {
  const cutoff = addDays(today, -days);
  const base = all.filter((s) => s.hire <= cutoff);
  const kept = base.filter((s) => !s.fire || daysBetween(s.hire, s.fire) >= days).length;
  return { kept, base: base.length, pct: base.length ? kept / base.length : null };
}

export function staffStat(st: DataState, ix: Index, today: DayKey): StaffStat {
  const all = stints(st, ix);
  const staff = all.filter((s) => s.op.status !== "fired" && !s.op.deletedAt && s.hire <= today && (!s.fire || s.fire >= today));
  const ten = staff.map((s) => tenureDays(s, today));
  return {
    staff,
    avgTenure: ten.length ? ten.reduce((a, b) => a + b, 0) / ten.length : null,
    buckets: TENURE_BUCKETS.map((b) => ({ label: b.label, count: ten.filter((d) => d >= b.from && d <= b.to).length })),
    retention30: retention(all, 30, today),
    retention90: retention(all, 90, today),
  };
}

/** Ушедшие за период — для списка «кто ушёл и сколько проработал». */
export function leaversIn(st: DataState, ix: Index, from: DayKey, to: DayKey, today: DayKey): (Stint & { days: number; passed: boolean | null })[] {
  return stints(st, ix)
    .filter((s) => s.fire && s.fire >= from && s.fire <= to && s.fire <= today)
    .map((s) => {
      const p = probation(s.op, ix, st.settings, s.fire!);
      return { ...s, days: daysBetween(s.hire, s.fire!), passed: p.active ? p.done : null };
    })
    .sort((a, b) => b.fire!.localeCompare(a.fire!));
}

/** «3 мес.», «1 г. 2 мес.», «12 дн.» — стаж по-человечески. */
export function fmtTenure(days: number | null): string {
  if (days == null) return "—";
  const d = Math.round(days);
  if (d < 30) return `${d} дн.`;
  const months = Math.floor(d / 30.44);
  if (months < 12) return `${months} мес.`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return m ? `${y} г. ${m} мес.` : `${y} г.`;
}
