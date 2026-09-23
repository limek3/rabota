import type {
  DataState,
  Grade,
  LeadStatus,
  RateTier,
  Track,
  DayKey,
  Group,
  ID,
  Lead,
  MonthKey,
  MonthPlan,
  Operator,
  PayType,
  Settings,
  Shift,
} from "./types";
import { NO_GROUP, NO_GROUP_LABEL } from "./types";
import {
  addDays,
  isWorkday,
  monthDays,
  monthEnd,
  monthOf,
  monthStart,
  rangeDays,
  todayKey,
  weekStart,
} from "./dates";
import { planId } from "./ids";
import { safeDiv } from "./format";

/**
 * Расчёты и аналитика. Чистые функции: на вход — исходные данные, на выход —
 * показатели. Ничего не пишут в хранилище, поэтому их можно вызывать сколько
 * угодно раз и в любом порядке.
 *
 * Основа всего — индекс (buildIndex): один проход по лидам и сменам
 * раскладывает их по дням/операторам/группам/проектам. Дальше любой показатель
 * за любой период — это сумма по нескольким дням из готовых карт, без повторного
 * перебора тысяч лидов.
 */

type DayMap = Map<DayKey, number>;

export interface Index {
  opById: Map<ID, Operator>;
  groupById: Map<ID, Group>;
  projectById: Map<ID, { id: ID; name: string; color: string; active: boolean; deletedAt?: string | null }>;
  planById: Map<ID, MonthPlan>;
  /** Лиды команды по дням. */
  day: DayMap;
  opDay: Map<ID, DayMap>;
  groupDay: Map<string, DayMap>;
  projectDay: Map<string, DayMap>;
  /** Отработанные часы (рабочий день + обучение). */
  hoursDay: DayMap;
  hoursOpDay: Map<ID, DayMap>;
  hoursGroupDay: Map<string, DayMap>;
  /** Смена по ключу `${дата}|${оператор}`. */
  shift: Map<string, Shift>;
  /** Месяцы, в которых у оператора есть лиды/смены/начисления. */
  opMonths: Map<ID, Set<MonthKey>>;
  /** Операторы, дававшие лиды в группе в месяце: `${month}|${groupKey}` → set. */
  groupMonthOps: Map<string, Set<ID>>;
  /** Месяцы, где вообще есть данные. */
  months: Set<MonthKey>;
  /** Последний день с лидом у оператора. */
  lastLead: Map<ID, DayKey>;
}

const gk = (groupId: ID | null | undefined) => groupId || NO_GROUP;

function bump(map: Map<string, DayMap>, key: string, day: DayKey, v: number) {
  let m = map.get(key);
  if (!m) map.set(key, (m = new Map()));
  m.set(day, (m.get(day) ?? 0) + v);
}

function addTo<K>(map: Map<K, Set<string>>, key: K, v: string) {
  let s = map.get(key);
  if (!s) map.set(key, (s = new Set()));
  s.add(v);
}

export const WORKED_TYPES = new Set(["work", "training"]);

export function buildIndex(st: DataState): Index {
  const ix: Index = {
    opById: new Map(st.operators.map((o) => [o.id, o])),
    groupById: new Map(st.groups.map((g) => [g.id, g])),
    projectById: new Map(st.projects.map((p) => [p.id, p])),
    planById: new Map(st.plans.map((p) => [p.id, p])),
    day: new Map(),
    opDay: new Map(),
    groupDay: new Map(),
    projectDay: new Map(),
    hoursDay: new Map(),
    hoursOpDay: new Map(),
    hoursGroupDay: new Map(),
    shift: new Map(),
    opMonths: new Map(),
    groupMonthOps: new Map(),
    months: new Set(),
    lastLead: new Map(),
  };
  for (const l of st.leads) {
    const d = l.at.slice(0, 10);
    const m = d.slice(0, 7);
    // «не доведён» не идёт ни в факт, ни в зарплату; «в работе» считается сразу, пока его не отклонили
    if (l.status === "failed") {
      addTo(ix.opMonths, l.operatorId, m);
      ix.months.add(m);
      continue;
    }
    ix.day.set(d, (ix.day.get(d) ?? 0) + 1);
    bump(ix.opDay, l.operatorId, d, 1);
    bump(ix.groupDay, gk(l.groupId), d, 1);
    bump(ix.projectDay, l.projectId || "__none__", d, 1);
    addTo(ix.opMonths, l.operatorId, m);
    addTo(ix.groupMonthOps, `${m}|${gk(l.groupId)}`, l.operatorId);
    ix.months.add(m);
    const last = ix.lastLead.get(l.operatorId);
    if (!last || d > last) ix.lastLead.set(l.operatorId, d);
  }
  for (const s of st.shifts) {
    ix.shift.set(`${s.date}|${s.operatorId}`, s);
    const m = s.date.slice(0, 7);
    addTo(ix.opMonths, s.operatorId, m);
    ix.months.add(m);
    if (WORKED_TYPES.has(s.type) && s.hours > 0) {
      ix.hoursDay.set(s.date, (ix.hoursDay.get(s.date) ?? 0) + s.hours);
      bump(ix.hoursOpDay, s.operatorId, s.date, s.hours);
      bump(ix.hoursGroupDay, gk(s.groupId), s.date, s.hours);
    }
  }
  for (const a of st.adjustments) {
    addTo(ix.opMonths, a.operatorId, a.month);
    ix.months.add(a.month);
  }
  return ix;
}

/** Сумма по картам дней за диапазон. */
export function sumRange(map: DayMap | undefined, from: DayKey, to: DayKey): number {
  if (!map || from > to) return 0;
  let s = 0;
  // карта маленькая по сравнению с длинным диапазоном — идём по той, что короче
  const span = rangeDays(from, to);
  if (map.size < span.length) {
    for (const [d, v] of map) if (d >= from && d <= to) s += v;
  } else {
    for (const d of span) s += map.get(d) ?? 0;
  }
  return s;
}

/* ── календарь месяца ──────────────────────────────────────────────── */

export interface MonthCal {
  month: MonthKey;
  days: DayKey[];
  workdays: DayKey[];
  /** Число рабочих дней (≥ 1: при пустом графике считаем все дни рабочими). */
  W: number;
  phase: "past" | "current" | "future";
  today: DayKey;
  /** Опорный день: сегодня в текущем месяце, последний день — в прошедшем. */
  ref: DayKey;
  isWork: (d: DayKey) => boolean;
  /** Накопленное число рабочих дней на конец дня d (в пределах месяца). */
  wIdx: (d: DayKey) => number;
}

export function monthCal(month: MonthKey, s: Settings, today: DayKey): MonthCal {
  const days = monthDays(month);
  let workdays = days.filter((d) => isWorkday(d, s));
  const noWorkdays = workdays.length === 0;
  if (noWorkdays) workdays = days; // защита от деления на ноль при пустом графике
  const workSet = new Set(workdays);
  const cum = new Map<DayKey, number>();
  let c = 0;
  for (const d of days) {
    if (workSet.has(d)) c++;
    cum.set(d, c);
  }
  const first = days[0];
  const last = days[days.length - 1];
  const phase = today > last ? "past" : today < first ? "future" : "current";
  const ref = phase === "past" ? last : phase === "future" ? addDays(first, -1) : today;
  return {
    month,
    days,
    workdays,
    W: Math.max(1, workdays.length),
    phase,
    today,
    ref,
    isWork: (d) => workSet.has(d),
    wIdx: (d) => (d < first ? 0 : d > last ? c : cum.get(d) ?? 0),
  };
}

/* ── темп выполнения плана ─────────────────────────────────────────── */

export interface Pace {
  plan: number;
  fact: number;
  /** Факт / план. */
  pct: number;
  /** Сколько должно быть сделано к опорному дню. */
  planToDate: number;
  /** Факт − план на дату. */
  deviation: number;
  /** Факт / план на дату — основа статуса. */
  paceRatio: number;
  remaining: number;
  /** Run Rate: прогноз на конец месяца по фактическому темпу. */
  rr: number;
  rrPct: number;
  /** Средний темп: лидов в рабочий день. */
  avgPerDay: number;
  /** Сколько нужно в рабочий день до конца месяца (null — месяц закрыт). */
  needPerDay: number | null;
  dailyPlan: number;
  elapsedW: number;
  totalW: number;
  remainingW: number;
  today: number;
  yesterday: number;
  thisWeek: number;
  prevWeek: number;
  /** Изменение среднего темпа (лидов в рабочий день) к прошлой неделе. */
  weekChange: number | null;
  best: { day: DayKey; count: number } | null;
  worst: { day: DayKey; count: number } | null;
  /** Дней с выполненным дневным планом / из скольких завершённых рабочих дней. */
  daysMet: number;
  daysCounted: number;
}

/** Окно занятости внутри месяца (приём/увольнение посреди месяца). */
export interface Window {
  from: DayKey;
  to: DayKey;
}

function workdaysBetween(cal: MonthCal, from: DayKey, to: DayKey): number {
  if (from > to) return 0;
  return Math.max(0, cal.wIdx(to) - cal.wIdx(addDays(from, -1)));
}

export function pace(cal: MonthCal, plan: number, counts: DayMap | undefined, s: Settings, win?: Window | null): Pace {
  const first = cal.days[0];
  const last = cal.days[cal.days.length - 1];
  const wFrom = win && win.from > first ? win.from : first;
  const wTo = win && win.to < last ? win.to : last;
  // 0 возможно (приняли в последний выходной месяца) — все деления ниже защищены
  const totalW = workdaysBetween(cal, wFrom, wTo);

  const fact = sumRange(counts, first, last);
  const elapsedTo = cal.ref < wTo ? cal.ref : wTo;
  const elapsedW = cal.phase === "future" ? 0 : workdaysBetween(cal, wFrom, elapsedTo);

  const planToDate = totalW > 0 ? (plan * elapsedW) / totalW : 0;
  const rr = cal.phase === "past" ? fact : elapsedW > 0 ? (fact / elapsedW) * totalW : 0;

  let remainingW = 0;
  let needBase = fact;
  if (cal.phase === "future") {
    remainingW = totalW;
  } else if (cal.phase === "current") {
    const todayWork = cal.isWork(cal.today) && cal.today >= wFrom && cal.today <= wTo;
    const startFrom = cal.today > wFrom ? cal.today : wFrom;
    remainingW = workdaysBetween(cal, startFrom, wTo);
    // сегодняшние лиды идут в зачёт сегодняшней нормы
    if (todayWork) needBase = fact - (counts?.get(cal.today) ?? 0);
  }
  const needPerDay =
    cal.phase === "past" ? null : remainingW > 0 ? Math.max(0, plan - needBase) / remainingW : plan - fact > 0 ? null : 0;

  const dailyPlan = totalW > 0 ? plan / totalW : 0;

  // оперативные показатели относительно опорного дня
  const ref = cal.phase === "future" ? cal.today : cal.ref;
  const ws = weekStart(ref);
  const today = counts?.get(ref) ?? 0;
  const yesterday = counts?.get(addDays(ref, -1)) ?? 0;
  const thisWeek = sumRange(counts, ws, ref);
  const prevWeek = sumRange(counts, addDays(ws, -7), addDays(ws, -1));
  const wdThis = rangeDays(ws, ref).filter((d) => isWorkday(d, s)).length;
  const wdPrev = rangeDays(addDays(ws, -7), addDays(ws, -1)).filter((d) => isWorkday(d, s)).length;
  const tempoThis = safeDiv(thisWeek, Math.max(1, wdThis));
  const tempoPrev = safeDiv(prevWeek, Math.max(1, wdPrev));
  const weekChange = tempoPrev > 0 ? tempoThis / tempoPrev - 1 : null;

  // лучший/худший день и дни с выполненным дневным темпом
  let best: Pace["best"] = null;
  let worst: Pace["worst"] = null;
  let daysMet = 0;
  let daysCounted = 0;
  if (cal.phase !== "future") {
    for (const d of cal.days) {
      if (d > cal.ref) break;
      const c = counts?.get(d) ?? 0;
      if (c > 0 && (!best || c > best.count)) best = { day: d, count: c };
      const inWin = d >= wFrom && d <= wTo;
      if (!cal.isWork(d) || !inWin) continue;
      const isToday = cal.phase === "current" && d === cal.today;
      const met = dailyPlan > 0 && c >= dailyPlan;
      if (isToday) {
        if (met) {
          daysMet++;
          daysCounted++;
        }
        continue; // незавершённый день не может быть «худшим»
      }
      daysCounted++;
      if (met) daysMet++;
      if (!worst || c < worst.count) worst = { day: d, count: c };
    }
  }

  return {
    plan,
    fact,
    pct: safeDiv(fact, plan),
    planToDate,
    deviation: fact - planToDate,
    paceRatio: planToDate > 0 ? fact / planToDate : fact > 0 ? 1 : 0,
    remaining: Math.max(0, plan - fact),
    rr,
    rrPct: safeDiv(rr, plan),
    avgPerDay: safeDiv(fact, elapsedW),
    needPerDay,
    dailyPlan,
    elapsedW,
    totalW,
    remainingW,
    today,
    yesterday,
    thisWeek,
    prevWeek,
    weekChange,
    best,
    worst,
    daysMet,
    daysCounted,
  };
}

/* ── статусы ───────────────────────────────────────────────────────── */

export type PaceStatus = "ahead" | "ontrack" | "lagging" | "critical" | "idle" | "paused" | "fired" | "noplan" | "nodata";

export const PACE_LABEL: Record<PaceStatus, string> = {
  ahead: "Выше плана",
  ontrack: "По плану",
  lagging: "Отстаёт",
  critical: "Сильно отстаёт",
  idle: "Не работает",
  paused: "На паузе",
  fired: "Уволен",
  noplan: "Без плана",
  nodata: "Нет данных",
};

export const PACE_HUE: Record<PaceStatus, string> = {
  ahead: "green",
  ontrack: "blue",
  lagging: "amber",
  critical: "red",
  idle: "gray",
  paused: "indigo",
  fired: "gray",
  noplan: "gray",
  nodata: "gray",
};

/** Статус по темпу: факт относительно плана на дату. */
export function paceStatus(p: Pace, s: Settings, cal: MonthCal): PaceStatus {
  if (cal.phase === "future") return "nodata";
  if (p.plan <= 0) return "noplan";
  if (p.planToDate <= 0) return p.fact > 0 ? "ahead" : "nodata";
  const r = p.paceRatio * 100;
  if (r >= s.aheadPct) return "ahead";
  if (r >= s.normalPct) return "ontrack";
  if (r >= s.lagPct) return "lagging";
  return "critical";
}

/* ── планы и условия месяца ────────────────────────────────────────── */

export function employmentWindow(op: Operator, month: MonthKey): Window | null {
  const f = monthStart(month);
  const t = monthEnd(month);
  const from = op.hireDate && op.hireDate > f ? op.hireDate : f;
  const to = op.fireDate && op.fireDate < t ? op.fireDate : t;
  if (from > t || to < f || from > to) return null;
  return { from, to };
}

/** Работал ли оператор в штате в этом месяце (по датам приёма/увольнения и статусу). */
export function employedIn(op: Operator, month: MonthKey): boolean {
  if (op.status === "fired" && !op.fireDate) return false;
  return employmentWindow(op, month) !== null;
}

export interface OpTerms {
  plan: number;
  normHours: number;
  payType: PayType;
  salary: number;
  hourlyRate: number;
  leadBonus: number;
  /** Ступени оплаты за смену (для схем «по сетке»). */
  tiers: RateTier[];
  /** Схема супервайзера: грейд, направление и условия месяца. */
  grade: Grade;
  track: Track;
  approvePct: number;
  /** null — рост считается автоматически по прошлому месяцу. */
  growth: boolean | null;
  /** Откуда взят план: записи месяца или значения по умолчанию. */
  explicit: boolean;
}

/** Доля рабочих дней месяца, когда оператор был в штате (для пропорции плана/нормы). */
export function employmentShare(op: Operator, cal: MonthCal): number {
  const w = employmentWindow(op, cal.month);
  if (!w) return 0;
  return Math.min(1, workdaysBetween(cal, w.from, w.to) / cal.W);
}

/**
 * Стажировка: пока новичок не набрал норму лидов за норму часов, он «на стажировке».
 * Считаем с даты приёма по всем месяцам, а не за текущий — иначе переход через
 * первое число обнулял бы прогресс.
 */
export interface Probation {
  needHours: number;
  needLeads: number;
  hours: number;
  leads: number;
  /** Доля выполнения: минимальная из двух, 0…1. */
  pct: number;
  done: boolean;
  /** День, когда стажировка закрылась. */
  doneAt: DayKey | null;
  /** Стажировка вообще нужна (пороги заданы). */
  active: boolean;
}

export function probation(op: Operator, ix: Index, s: Settings, today: DayKey = todayKey()): Probation {
  const needHours = Math.max(0, s.probationHours);
  const needLeads = Math.max(0, s.probationLeads);
  const empty: Probation = { needHours, needLeads, hours: 0, leads: 0, pct: 0, done: false, doneAt: null, active: needHours > 0 || needLeads > 0 };
  if (!empty.active) return empty;
  const hoursMap = ix.hoursOpDay.get(op.id);
  const leadsMap = ix.opDay.get(op.id);
  const days = new Set<DayKey>([...(hoursMap?.keys() ?? []), ...(leadsMap?.keys() ?? [])]);
  const from = op.hireDate || "";
  const sorted = Array.from(days)
    .filter((d) => (!from || d >= from) && d <= today)
    .sort();
  let hours = 0;
  let leads = 0;
  let doneAt: DayKey | null = null;
  for (const d of sorted) {
    hours += hoursMap?.get(d) ?? 0;
    leads += leadsMap?.get(d) ?? 0;
    if (!doneAt && hours >= needHours && leads >= needLeads) doneAt = d;
  }
  const pct = Math.min(1, Math.min(needHours ? hours / needHours : 1, needLeads ? leads / needLeads : 1));
  return { needHours, needLeads, hours, leads, pct, done: !!doneAt, doneAt, active: true };
}

/**
 * Апрув заказчика за месяц.
 *
 * Берём проставленные проценты по проектам и взвешиваем по числу переданных
 * лидов: месяц, где 80% лидов — «Авто» с апрувом 30%, не должен усредняться
 * с редким проектом на 15%. Если по проекту процента нет — берём общий на
 * месяц, а если и его нет — значение по умолчанию из сетки супервайзера.
 */
const approveCache = new WeakMap<Index, Map<MonthKey, number>>();

export function approvePctFor(st: DataState, ix: Index, month: MonthKey): number {
  let cache = approveCache.get(ix);
  if (!cache) {
    cache = new Map();
    approveCache.set(ix, cache);
  }
  const hit = cache.get(month);
  if (hit != null) return hit;

  const fallback = st.approves.find((a) => a.month === month && !a.projectId)?.pct ?? st.settings.svBonus.defaultApprovePct;
  const byProject = new Map(st.approves.filter((a) => a.month === month && a.projectId).map((a) => [a.projectId, a.pct]));
  let sum = 0;
  let weight = 0;
  for (const [projectId, days] of ix.projectDay) {
    let leads = 0;
    for (const [d, n] of days) if (d.slice(0, 7) === month) leads += n;
    if (!leads) continue;
    sum += (byProject.get(projectId) ?? fallback) * leads;
    weight += leads;
  }
  const out = weight > 0 ? Math.round((sum / weight) * 10) / 10 : fallback;
  cache.set(month, out);
  return out;
}

/**
 * Апрув для части лидов месяца (группа, зона супервайзера): те же проценты по проектам,
 * что в approvePctFor, но взвешенные по лидам именно этой части. Лиды — как в расчётах
 * (без «не доведён»).
 */
export function approvePctWhere(st: DataState, month: MonthKey, keep: (l: Lead) => boolean): number {
  const fallback = st.approves.find((a) => a.month === month && !a.projectId)?.pct ?? st.settings.svBonus.defaultApprovePct;
  const byProject = new Map(st.approves.filter((a) => a.month === month && a.projectId).map((a) => [a.projectId, a.pct]));
  let sum = 0;
  let weight = 0;
  for (const l of st.leads) {
    if (l.status === "failed" || l.at.slice(0, 7) !== month || !keep(l)) continue;
    sum += (l.projectId ? byProject.get(l.projectId) : undefined) ?? fallback;
    weight++;
  }
  return weight > 0 ? Math.round((sum / weight) * 10) / 10 : fallback;
}

/** Доход с одного лида для ФОТ: цена лида × апрув заказчика (%). */
export const leadIncome = (leadRevenue: number, approvePct: number) => (leadRevenue * approvePct) / 100;

export function opTerms(op: Operator, cal: MonthCal, st: DataState, ix: Index): OpTerms {
  const rec = ix.planById.get(planId(cal.month, "operator", op.id));
  const s = st.settings;
  const share = employmentShare(op, cal);
  const basePlan = op.monthlyPlan ?? s.defaultOperatorPlan;
  const baseNorm = op.normHours ?? s.defaultNormHours;
  const grid = s.rateGrids.find((g) => g.id === (op.rateGridId ?? s.defaultGridId)) ?? s.rateGrids.find((g) => g.id === s.defaultGridId) ?? s.rateGrids[0];
  return {
    plan: rec ? rec.plan : Math.round(basePlan * share),
    normHours: rec?.normHours ?? Math.round(baseNorm * share * 10) / 10,
    payType: rec?.payType ?? op.payType,
    salary: rec?.salary ?? (op.payType === "sv_volume" && !op.salary ? s.svBonus.salary : op.salary),
    hourlyRate: rec?.hourlyRate ?? op.hourlyRate,
    leadBonus: rec?.leadBonus ?? op.leadBonus ?? s.defaultLeadBonus,
    tiers: rec?.tiers ?? grid?.tiers ?? [],
    grade: rec?.grade ?? op.grade ?? "mid",
    track: rec?.track ?? op.track ?? "re",
    approvePct: rec?.approvePct ?? approvePctFor(st, ix, cal.month),
    growth: rec?.growth ?? null,
    explicit: !!rec,
  };
}

/** Операторы, относящиеся к месяцу: в штате или с любой активностью (история). */
export function monthOperators(st: DataState, ix: Index, month: MonthKey): Operator[] {
  return st.operators.filter((op) => {
    const active = ix.opMonths.get(op.id)?.has(month);
    if (active) return true;
    if (op.deletedAt) return false;
    return employedIn(op, month);
  });
}

export function groupPlan(g: { key: string; group: Group | null }, cal: MonthCal, st: DataState, ix: Index, opPlans: Map<ID, number>): { plan: number; explicit: boolean } {
  if (g.group) {
    const rec = ix.planById.get(planId(cal.month, "group", g.group.id));
    if (rec) return { plan: rec.plan, explicit: true };
    if (g.group.monthlyPlan > 0) return { plan: g.group.monthlyPlan, explicit: false };
  }
  // план группы не задан — сумма планов текущих участников
  let sum = 0;
  for (const op of st.operators) {
    if (op.deletedAt) continue;
    if (gk(op.groupId) !== g.key) continue;
    sum += opPlans.get(op.id) ?? 0;
  }
  return { plan: sum, explicit: false };
}

/** Группы, где этот сотрудник указан руководителем. */
export function supervisedGroups(st: DataState, operatorId: ID): ID[] {
  return st.groups.filter((g) => g.supervisorId === operatorId).map((g) => g.id);
}

/** Лиды всех его групп за месяц — база бонуса супервайзера. */
export function supervisedLeads(st: DataState, ix: Index, operatorId: ID, month: MonthKey): number {
  const from = monthStart(month);
  const to = monthEnd(month);
  let n = 0;
  for (const g of supervisedGroups(st, operatorId)) n += sumRange(ix.groupDay.get(g), from, to);
  return n;
}

/* ── модель месяца ─────────────────────────────────────────────────── */

export interface OpRow {
  op: Operator;
  groupKey: string;
  terms: OpTerms;
  pace: Pace;
  status: PaceStatus;
  hours: number;
  hoursToday: number;
  hoursWeek: number;
  norm: number;
  normToDate: number;
  /** Часы − норма (к дате в текущем месяце, к концу в прошедшем). */
  hoursDelta: number;
  normPct: number;
  /** Лидов на отработанный час (null — часов нет). */
  lph: number | null;
  daysWorked: number;
  hasShifts: boolean;
  avgPerWorkday: number;
  lastLead: DayKey | null;
  absentDays: number;
  isLeader: boolean;
  inWindow: boolean;
}

export interface GroupRow {
  key: string;
  group: Group | null;
  name: string;
  color: string;
  plan: number;
  planExplicit: boolean;
  pace: Pace;
  status: PaceStatus;
  hours: number;
  lph: number | null;
  /** Активные сотрудники группы сейчас. */
  headcount: number;
  /** Кто давал лиды в группе в этом месяце. */
  contributors: number;
  avgPerOp: number;
  members: OpRow[];
}

export interface MonthModel {
  cal: MonthCal;
  team: {
    plan: number;
    planSource: "record" | "settings" | "sum";
    pace: Pace;
    status: PaceStatus;
    hours: number;
    hoursToday: number;
    hoursWeek: number;
    lph: number | null;
    lphToday: number | null;
    lphWeek: number | null;
    headcount: number;
    contributors: number;
    avgPerOp: number;
    /** Средняя выработка оператора за отработанную смену. */
    perOpDay: number;
    opDays: number;
    /** Сколько операторов в смену нужно при текущей выработке для выполнения плана. */
    neededOps: number | null;
  };
  ops: OpRow[];
  groups: GroupRow[];
  statusCount: Record<PaceStatus, number>;
}

function absentOn(ix: Index, opId: ID, d: DayKey) {
  const sh = ix.shift.get(`${d}|${opId}`);
  return !!sh && (sh.type === "vacation" || sh.type === "sick" || sh.type === "off");
}

/** «Практически не работает»: N последних завершённых рабочих дней без лидов (отпуск/больничный не в счёт). */
function isIdle(op: Operator, cal: MonthCal, ix: Index, s: Settings, win: Window | null): boolean {
  if (cal.phase !== "current" || op.status !== "active" || !win) return false;
  const counts = ix.opDay.get(op.id);
  if ((counts?.get(cal.today) ?? 0) > 0) return false; // сегодня уже передал лид — работает
  let d = addDays(cal.today, -1);
  let got = 0;
  let guard = 0;
  while (got < s.idleDays && guard < 62) {
    guard++;
    if (d < win.from) return false; // данных меньше, чем порог — рано судить
    if (isWorkday(d, s) && !absentOn(ix, op.id, d)) {
      if ((counts?.get(d) ?? 0) > 0) return false;
      got++;
    }
    d = addDays(d, -1);
  }
  return got >= s.idleDays;
}

export function monthModel(st: DataState, ix: Index, month: MonthKey, today: DayKey): MonthModel {
  const s = st.settings;
  const cal = monthCal(month, s, today);
  const first = cal.days[0];
  const last = cal.days[cal.days.length - 1];
  // часы — только отработанные: смены, запланированные наперёд, в факт не идут
  const factTo = cal.ref < last ? cal.ref : last;
  const ref = cal.phase === "future" ? first : cal.ref;
  const ws = weekStart(ref);

  const opsList = monthOperators(st, ix, month);
  const opPlans = new Map<ID, number>();
  const rows: OpRow[] = opsList.map((op) => {
    const terms = opTerms(op, cal, st, ix);
    opPlans.set(op.id, terms.plan);
    const win = employmentWindow(op, month);
    const p = pace(cal, terms.plan, ix.opDay.get(op.id), s, win);
    const hMap = ix.hoursOpDay.get(op.id);
    const hours = sumRange(hMap, first, factTo);
    const elapsedTo = win && cal.ref > win.to ? win.to : cal.ref;
    const workedToDate = win && cal.phase !== "future" ? workdaysBetween(cal, win.from, elapsedTo) : 0;
    const winW = win ? Math.max(1, workdaysBetween(cal, win.from, win.to)) : 1;
    const norm = terms.normHours;
    const normToDate = cal.phase === "past" ? norm : (norm * workedToDate) / winW;

    let daysWorked = 0;
    let absentDays = 0;
    let hasShifts = false;
    for (const d of cal.days) {
      const sh = ix.shift.get(`${d}|${op.id}`);
      if (!sh) continue;
      hasShifts = true;
      if (d > cal.ref) continue;
      if (WORKED_TYPES.has(sh.type) && sh.hours > 0) daysWorked++;
      if (sh.type === "vacation" || sh.type === "sick") absentDays++;
    }
    const dayBase = hasShifts ? daysWorked : workedToDate;

    let status: PaceStatus;
    if (op.status === "fired" && (!op.fireDate || op.fireDate <= last)) status = "fired";
    else if (op.status === "pause") status = "paused";
    else if (isIdle(op, cal, ix, s, win)) status = "idle";
    else status = paceStatus(p, s, cal);

    return {
      op,
      groupKey: gk(op.groupId),
      terms,
      pace: p,
      status,
      hours,
      hoursToday: hMap?.get(ref) ?? 0,
      hoursWeek: sumRange(hMap, ws, ref),
      norm,
      normToDate,
      hoursDelta: hours - normToDate,
      normPct: safeDiv(hours, norm),
      lph: hours > 0 ? p.fact / hours : null,
      daysWorked,
      hasShifts,
      avgPerWorkday: safeDiv(p.fact, dayBase),
      lastLead: ix.lastLead.get(op.id) ?? null,
      absentDays,
      isLeader: false,
      inWindow: !!win,
    };
  });

  // лучший результат месяца — по факту, при равенстве — по выработке в час
  let leader: OpRow | null = null;
  for (const r of rows) {
    if (r.pace.fact <= 0) continue;
    if (!leader || r.pace.fact > leader.pace.fact || (r.pace.fact === leader.pace.fact && (r.lph ?? 0) > (leader.lph ?? 0))) leader = r;
  }
  if (leader) leader.isLeader = true;

  // группы: все живые + удалённые/«Без группы», если в месяце есть их данные
  const keys = new Set<string>();
  for (const g of st.groups) if (!g.deletedAt) keys.add(g.id);
  for (const k of ix.groupDay.keys()) if (sumRange(ix.groupDay.get(k), first, last) > 0) keys.add(k);
  for (const k of ix.hoursGroupDay.keys()) if (sumRange(ix.hoursGroupDay.get(k), first, last) > 0) keys.add(k);
  for (const r of rows) if (!r.op.deletedAt && r.op.status !== "fired") keys.add(r.groupKey);

  const groups: GroupRow[] = Array.from(keys).map((key) => {
    const group = key === NO_GROUP ? null : ix.groupById.get(key) ?? null;
    const gp = groupPlan({ key, group }, cal, st, ix, opPlans);
    const p = pace(cal, gp.plan, ix.groupDay.get(key), s);
    const hours = sumRange(ix.hoursGroupDay.get(key), first, factTo);
    const members = rows.filter((r) => r.groupKey === key && !r.op.deletedAt);
    const headcount = members.filter((r) => r.op.status === "active").length;
    const contributors = ix.groupMonthOps.get(`${month}|${key}`)?.size ?? 0;
    return {
      key,
      group,
      name: group ? group.name + (group.deletedAt ? " (удалена)" : "") : NO_GROUP_LABEL,
      color: group?.color ?? "gray",
      plan: gp.plan,
      planExplicit: gp.explicit,
      pace: p,
      status: paceStatus(p, s, cal),
      hours,
      lph: hours > 0 ? p.fact / hours : null,
      headcount,
      contributors,
      avgPerOp: safeDiv(p.fact, contributors || headcount),
      members,
    };
  });
  groups.sort((a, b) => {
    if (a.key === NO_GROUP) return 1;
    if (b.key === NO_GROUP) return -1;
    return (a.group?.name ?? "").localeCompare(b.group?.name ?? "", "ru");
  });
  // «Без группы» без людей и без данных не показываем
  const groupsShown = groups.filter((g) => g.key !== NO_GROUP || g.members.length > 0 || g.pace.fact > 0 || g.hours > 0);

  // команда
  const teamRec = ix.planById.get(planId(month, "team", null));
  let teamPlan: number;
  let planSource: MonthModel["team"]["planSource"];
  if (teamRec) {
    teamPlan = teamRec.plan;
    planSource = "record";
  } else if (s.teamPlan > 0) {
    teamPlan = s.teamPlan;
    planSource = "settings";
  } else {
    teamPlan = groupsShown.reduce((a, g) => a + g.plan, 0);
    planSource = "sum";
  }
  const tp = pace(cal, teamPlan, ix.day, s);
  const hours = sumRange(ix.hoursDay, first, factTo);
  const hoursToday = ix.hoursDay.get(ref) ?? 0;
  const hoursWeek = sumRange(ix.hoursDay, ws, ref);
  const live = rows.filter((r) => !r.op.deletedAt && r.op.status === "active");
  const contributors = rows.filter((r) => r.pace.fact > 0).length;
  const opDays = rows.reduce((a, r) => a + (r.hasShifts ? r.daysWorked : r.pace.fact > 0 ? r.pace.elapsedW : 0), 0);
  const perOpDay = safeDiv(tp.fact, opDays);
  const neededOps = tp.needPerDay != null && perOpDay > 0 ? tp.needPerDay / perOpDay : null;

  const statusCount = {
    ahead: 0, ontrack: 0, lagging: 0, critical: 0, idle: 0, paused: 0, fired: 0, noplan: 0, nodata: 0,
  } as Record<PaceStatus, number>;
  for (const r of rows) if (!r.op.deletedAt) statusCount[r.status]++;

  return {
    cal,
    team: {
      plan: teamPlan,
      planSource,
      pace: tp,
      status: paceStatus(tp, s, cal),
      hours,
      hoursToday,
      hoursWeek,
      lph: hours > 0 ? tp.fact / hours : null,
      lphToday: hoursToday > 0 ? tp.today / hoursToday : null,
      lphWeek: hoursWeek > 0 ? tp.thisWeek / hoursWeek : null,
      headcount: live.length,
      contributors,
      avgPerOp: safeDiv(tp.fact, contributors || live.length),
      perOpDay,
      opDays,
      neededOps,
    },
    ops: rows,
    groups: groupsShown,
    statusCount,
  };
}

/* ── динамика ──────────────────────────────────────────────────────── */

export interface DayRow {
  day: DayKey;
  isWork: boolean;
  future: boolean;
  count: number;
  cum: number;
  cumPlan: number;
  deviation: number;
  avgPace: number | null;
  needPace: number | null;
  hours: number;
}

export interface WeekRow {
  from: DayKey;
  to: DayKey;
  plan: number;
  fact: number;
  pct: number;
  workdays: number;
  elapsedW: number;
  avgPerDay: number | null;
  change: number | null;
  future: boolean;
}

export function dailyRows(cal: MonthCal, plan: number, counts: DayMap | undefined, hours?: DayMap): DayRow[] {
  let cum = 0;
  return cal.days.map((d) => {
    const future = cal.phase === "future" || d > cal.ref;
    const c = future ? 0 : counts?.get(d) ?? 0;
    cum += c;
    const w = cal.wIdx(d);
    const cumPlan = (plan * w) / cal.W;
    const left = cal.W - w;
    return {
      day: d,
      isWork: cal.isWork(d),
      future,
      count: c,
      cum,
      cumPlan,
      deviation: cum - cumPlan,
      avgPace: w > 0 ? cum / w : null,
      needPace: left > 0 ? Math.max(0, plan - cum) / left : null,
      hours: hours?.get(d) ?? 0,
    };
  });
}

export function weeklyRows(cal: MonthCal, plan: number, counts: DayMap | undefined): WeekRow[] {
  const out: WeekRow[] = [];
  let cur: DayKey[] = [];
  const flush = () => {
    if (!cur.length) return;
    const from = cur[0];
    const to = cur[cur.length - 1];
    const workdays = cur.filter((d) => cal.isWork(d)).length;
    const elapsed = cur.filter((d) => cal.isWork(d) && cal.phase !== "future" && d <= cal.ref).length;
    const future = cal.phase === "future" || from > cal.ref;
    const fact = future ? 0 : sumRange(counts, from, to < cal.ref ? to : cal.ref);
    const wplan = (plan * workdays) / cal.W;
    const avg = elapsed > 0 ? fact / elapsed : null;
    const prev = out[out.length - 1];
    out.push({
      from,
      to,
      plan: wplan,
      fact,
      pct: safeDiv(fact, wplan),
      workdays,
      elapsedW: elapsed,
      avgPerDay: avg,
      change: prev && prev.avgPerDay && avg != null ? avg / prev.avgPerDay - 1 : null,
      future,
    });
    cur = [];
  };
  for (const d of cal.days) {
    if (cur.length && weekStart(d) !== weekStart(cur[0])) flush();
    cur.push(d);
  }
  flush();
  return out;
}

/* ── лиды: фильтр и разрезы ────────────────────────────────────────── */

export interface LeadFilter {
  from: DayKey;
  to: DayKey;
  operatorId?: ID | "";
  groupId?: string; // id | NO_GROUP | ""
  projectId?: string; // id | "__none__" | ""
  /** Статус лида; "counted" — всё, что идёт в факт (кроме «не доведён»). */
  status?: LeadStatus | "counted" | "";
  q?: string;
}

export function filterLeads(leads: Lead[], f: LeadFilter): Lead[] {
  const q = (f.q || "").trim().toLowerCase();
  const qDigits = q.replace(/\D+/g, "");
  return leads.filter((l) => {
    const d = l.at.slice(0, 10);
    if (d < f.from || d > f.to) return false;
    if (f.operatorId && l.operatorId !== f.operatorId) return false;
    if (f.groupId && gk(l.groupId) !== f.groupId) return false;
    if (f.projectId && (l.projectId || "__none__") !== f.projectId) return false;
    if (f.status && (f.status === "counted" ? l.status === "failed" : l.status !== f.status)) return false;
    if (q) {
      const hitName = l.client.toLowerCase().includes(q);
      const hitPhone = qDigits.length >= 3 && l.phone.includes(qDigits);
      const hitText = l.comment.toLowerCase().includes(q) || l.direction.toLowerCase().includes(q);
      if (!hitName && !hitPhone && !hitText) return false;
    }
    return true;
  });
}

/** Сводная таблица: строки × проекты. */
export function pivot(leads: Lead[], rowKey: (l: Lead) => string): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const l of leads) {
    const r = rowKey(l);
    let m = out.get(r);
    if (!m) out.set(r, (m = new Map()));
    const p = l.projectId || "__none__";
    m.set(p, (m.get(p) ?? 0) + 1);
  }
  return out;
}

/** Повтор телефона за последние N дней (кроме самого лида). */
export function findDuplicate(leads: Lead[], phone: string, at: string, days: number, exceptId?: ID): Lead | null {
  if (!phone || phone.length < 6 || days <= 0) return null;
  const since = addDays(at.slice(0, 10), -days);
  let hit: Lead | null = null;
  for (const l of leads) {
    if (l.id === exceptId || l.phone !== phone) continue;
    const d = l.at.slice(0, 10);
    if (d < since) continue;
    if (!hit || l.at > hit.at) hit = l;
  }
  return hit;
}

/* ── фиксация прошедших месяцев ────────────────────────────────────── */

/**
 * Для каждого завершённого месяца с данными один раз записывает планы и условия
 * оплаты, действовавшие на тот момент. Потом их можно менять в карточках
 * сколько угодно — прошлые месяцы не пересчитаются задним числом.
 * Явно заданные записи месяца не трогаются.
 */
export function freezePastMonths(st: DataState, ix: Index, today: DayKey): { plans: MonthPlan[]; months: MonthKey[] } {
  const cur = monthOf(today);
  const done = new Set(st.frozenMonths);
  const months = Array.from(ix.months).filter((m) => m < cur && !done.has(m)).sort();
  const plans: MonthPlan[] = [];
  const stamp = new Date().toISOString();
  for (const m of months) {
    const cal = monthCal(m, st.settings, today);
    for (const op of monthOperators(st, ix, m)) {
      const id = planId(m, "operator", op.id);
      if (ix.planById.has(id)) continue;
      const t = opTerms(op, cal, st, ix);
      plans.push({
        id, month: m, scope: "operator", targetId: op.id, plan: t.plan, normHours: t.normHours,
        payType: t.payType, salary: t.salary, hourlyRate: t.hourlyRate, leadBonus: t.leadBonus, tiers: t.tiers,
        grade: t.grade, track: t.track, approvePct: t.approvePct, growth: t.growth ?? undefined,
        auto: true, updatedAt: stamp,
      });
    }
    for (const g of st.groups) {
      if (g.monthlyPlan <= 0) continue; // авто-сумма и так опирается на зафиксированных операторов
      const id = planId(m, "group", g.id);
      if (ix.planById.has(id)) continue;
      plans.push({ id, month: m, scope: "group", targetId: g.id, plan: g.monthlyPlan, auto: true, updatedAt: stamp });
    }
    if (st.settings.teamPlan > 0 && !ix.planById.has(planId(m, "team", null))) {
      plans.push({ id: planId(m, "team", null), month: m, scope: "team", targetId: null, plan: st.settings.teamPlan, auto: true, updatedAt: stamp });
    }
  }
  return { plans, months };
}
