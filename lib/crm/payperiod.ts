import type { Adjustment, DataState, DayKey, ID, MonthKey, Operator } from "./types";
import { WORKED_TYPES, type Index, monthCal, monthOperators, opTerms } from "./calc";
import { accrual, isSvVolume, rowsTotal, withAdjustments, type PayRow, type TierUse } from "./payroll";
import { addDays, addMonths, monthEnd, monthOf, monthStart } from "./dates";
import { round2 } from "./format";

/**
 * Выплаты по периодам: зарплата считается и выплачивается раз в несколько недель.
 *
 *   Период     — payPeriodDays дней подряд от payPeriodStart (по умолчанию 14 от 22.09.2026);
 *   Выплата    — через payDelayDays дней после конца периода (05.10 → 09.10);
 *   Реестр     — за REGISTRY_DAYS дня до выплаты подаём реестр сумм к переводу (вт → пт);
 *   Первый     — один раз длиннее: забирает всё отработанное до payPeriodStart (работать
 *                начали 16.09 — первая выплата 09.10 за 16.09–05.10).
 *
 * Начислено за период = начислено к концу периода − начислено к его началу, по каждому
 * месяцу, который он задевает (accrual в payroll.ts). Поэтому сумма периодов месяца равна
 * ведомости месяца, оклад с потолком не задваивается, а ступени сетки считаются по сменам.
 *
 * KPI супервайзера (бонус за объём групп) — месячный: он известен только после закрытия
 * месяца и попадает в выплату за период, в который входит 1-е число следующего месяца.
 *
 * Корректировки — по дате: начисления, премии, удержания и аванс — в период, куда попадает
 * дата; выплата («Выплата») — в период, закончившийся до неё (выплата 09.10 гасит 22.09–05.10).
 */

export interface PayPeriod {
  idx: number;
  /** Первый день периода (у первого — 22.09, хотя в него входит и всё раньше). */
  from: DayKey;
  to: DayKey;
  /** День выплаты. */
  pay: DayKey;
  /** День подачи реестра: суммы к переводу должны быть готовы. */
  registry: DayKey;
  /** Первый период: забирает дни до from. */
  first: boolean;
}

const MS_DAY = 86_400_000;
/** Реестр — за 3 дня до выплаты: выплата в пятницу, реестр во вторник. */
export const REGISTRY_DAYS = 3;
const registryOf = (to: DayKey, pay: DayKey): DayKey => {
  const d = addDays(pay, -REGISTRY_DAYS);
  return d > to ? d : addDays(to, 1) < pay ? addDays(to, 1) : pay;
};
const dayNum = (d: DayKey) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / MS_DAY);

/**
 * Период по номеру. Есть график выплат (paySchedule) — первые периоды из него, дальше по
 * правилу от конца последней строки; графика нет — всё по правилу от payPeriodStart.
 */
export function periodAt(s: DataState["settings"], idx: number): PayPeriod {
  const list = s.paySchedule;
  if (idx < list.length) return { idx, ...list[idx], registry: registryOf(list[idx].to, list[idx].pay), first: idx === 0 };
  const origin = list.length ? addDays(list[list.length - 1].to, 1) : s.payPeriodStart;
  const from = addDays(origin, (idx - list.length) * s.payPeriodDays);
  const to = addDays(from, s.payPeriodDays - 1);
  const pay = addDays(to, s.payDelayDays);
  return { idx, from, to, pay, registry: registryOf(to, pay), first: idx === 0 };
}

/** Номер периода, в который попадает день (всё до начала — первый период). */
export function periodIndexOf(s: DataState["settings"], d: DayKey): number {
  const list = s.paySchedule;
  if (!list.length) return Math.max(0, Math.floor((dayNum(d) - dayNum(s.payPeriodStart)) / s.payPeriodDays));
  const last = list[list.length - 1];
  if (d > last.to) return list.length + Math.floor((dayNum(d) - dayNum(last.to) - 1) / s.payPeriodDays);
  const i = list.findIndex((p) => d <= p.to);
  return Math.max(0, i);
}

/** Периоды от первого до того, в который попадает upTo. */
export function periodsUpTo(s: DataState["settings"], upTo: DayKey): PayPeriod[] {
  const n = periodIndexOf(s, upTo);
  return Array.from({ length: n + 1 }, (_, i) => periodAt(s, i));
}

/** Период, который показываем по умолчанию: тот, что ждёт выплаты, иначе текущий. */
export function defaultPeriod(s: DataState["settings"], today: DayKey): PayPeriod {
  const cur = periodAt(s, periodIndexOf(s, today));
  if (cur.idx > 0) {
    const prev = periodAt(s, cur.idx - 1);
    if (today <= prev.pay) return prev;
  }
  return cur;
}

/** К какому периоду относится корректировка. */
export function adjustmentPeriod(s: DataState["settings"], a: Adjustment): number {
  const i = periodIndexOf(s, a.date);
  return a.type === "payout" ? Math.max(0, i - 1) : i;
}

/** Кусок периода внутри одного месяца — для разбора «откуда сумма». */
export interface PeriodSegment {
  month: MonthKey;
  from: DayKey;
  to: DayKey;
  hours: number;
  leads: number;
  base: number;
  leadPay: number;
  /** Дни сегмента, которые ещё не закрыты (идут или впереди): с какого числа. null — всё закрыто. */
  openFrom: DayKey | null;
  /** Оклад: доля месячного оклада за дни сегмента. */
  salaryShare: number;
}

export interface PeriodRow extends PayRow {
  segments: PeriodSegment[];
  /** KPI супервайзера за закрытые месяцы, выплачиваемый в этом периоде. */
  kpi: { month: MonthKey; amount: number }[];
  /** KPI за месяц, который ещё не закрыт, — придёт в следующую выплату. */
  kpiPending: MonthKey | null;
}

export interface PeriodPayroll {
  period: PayPeriod;
  /** Фактический первый день расчёта (у первого периода — начало данных). */
  start: DayKey;
  rows: PeriodRow[];
  total: ReturnType<typeof rowsTotal>;
}

/**
 * С какого дня считается первый период: с первого рабочего дня — самой ранней смены с часами
 * или лида (кто вышел 16.09, получит с 16.09 в первую выплату). Данных раньше начала
 * периода нет — с начала периода.
 */
export function dataStart(st: DataState, periodStart: DayKey = st.settings.payPeriodStart): DayKey {
  let m = periodStart;
  for (const sh of st.shifts) if (sh.date < m && sh.hours > 0 && WORKED_TYPES.has(sh.type)) m = sh.date;
  for (const l of st.leads) {
    const d = l.at.slice(0, 10);
    if (d < m && l.status !== "failed") m = d;
  }
  return m;
}

export function periodPayroll(st: DataState, ix: Index, today: DayKey, period: PayPeriod): PeriodPayroll {
  const s = st.settings;
  const start = period.first ? dataStart(st, period.from) : period.from;
  // месяцы, которые задевает период
  const months: MonthKey[] = [];
  for (let m = monthOf(start); m <= monthOf(period.to); m = addMonths(m, 1)) months.push(m);

  // корректировки этого периода
  const adjByOp = new Map<ID, Adjustment[]>();
  for (const a of st.adjustments) {
    if (adjustmentPeriod(s, a) !== period.idx) continue;
    adjByOp.set(a.operatorId, [...(adjByOp.get(a.operatorId) ?? []), a]);
  }

  // кто в расчёте: работал в одном из месяцев периода или у кого есть корректировки периода
  const ops = new Map<ID, Operator>();
  for (const m of months) for (const op of monthOperators(st, ix, m)) ops.set(op.id, op);
  for (const id of adjByOp.keys()) {
    const op = ix.opById.get(id);
    if (op) ops.set(id, op);
  }

  // KPI: месяцы, у которых 1-е число следующего месяца попадает в период (у первого — и всё раньше)
  const kpiMonths: MonthKey[] = [];
  for (let m = monthOf(start); m <= monthOf(period.to); m = addMonths(m, 1)) {
    const next = monthStart(addMonths(m, 1));
    if (next <= period.to && (period.first || next >= period.from)) kpiMonths.push(m);
  }

  const cals = new Map(months.map((m) => [m, monthCal(m, s, today)]));
  const rows: PeriodRow[] = [];
  for (const op of ops.values()) {
    const segments: PeriodSegment[] = [];
    let base = 0;
    let leadPay = 0;
    let hours = 0;
    let leads = 0;
    let terms: ReturnType<typeof accrual>["t"] | null = null;
    const tiers = new Map<string, TierUse>();
    let salaryShare = 0;
    const sv = isSvVolume(opTermsType(op, st, ix, cals, months));
    for (const m of months) {
      const cal = cals.get(m)!;
      const segFrom = start > monthStart(m) ? start : monthStart(m);
      const segTo = period.to < monthEnd(m) ? period.to : monthEnd(m);
      if (segFrom > segTo) continue;
      const end = accrual(op, cal, st, ix, segTo);
      const before = segFrom > monthStart(m) ? accrual(op, cal, st, ix, addDays(segFrom, -1)) : null;
      terms = end.t;
      const seg: PeriodSegment = {
        month: m,
        from: segFrom,
        to: segTo,
        hours: round2(end.hours - (before?.hours ?? 0)),
        leads: end.leads - (before?.leads ?? 0),
        base: round2(end.base - (before?.base ?? 0)),
        // у супервайзера leadPay в accrual — месячный KPI: в периоде его нет, он приходит отдельно
        leadPay: sv ? 0 : round2(end.leadPay - (before?.leadPay ?? 0)),
        openFrom: null,
        salaryShare: 0,
      };
      // ступени сетки: смена оплачивается по своей ступени, поэтому разбор периода = разбор к концу − к началу
      for (const u of end.tierUse) {
        const k = `${u.from}|${u.hourlyRate}|${u.leadBonus}`;
        const b = before?.tierUse.find((x) => x.from === u.from && x.hourlyRate === u.hourlyRate && x.leadBonus === u.leadBonus);
        const d = { ...u, days: u.days - (b?.days ?? 0), hours: round2(u.hours - (b?.hours ?? 0)), leads: u.leads - (b?.leads ?? 0), sum: round2(u.sum - (b?.sum ?? 0)) };
        if (!d.days) continue;
        const prev = tiers.get(k);
        tiers.set(k, prev ? { ...prev, days: prev.days + d.days, hours: round2(prev.hours + d.hours), leads: prev.leads + d.leads, sum: round2(prev.sum + d.sum) } : d);
      }
      seg.salaryShare = round2(end.salaryShare - (before?.salaryShare ?? 0));
      salaryShare += seg.salaryShare;
      // закрыто по: прошедшие и закрытые дни (как в accrual)
      const closedTo = [segTo, cal.ref, ix.workedTo].sort()[0];
      seg.openFrom = closedTo < segTo ? (closedTo < segFrom ? segFrom : addDays(closedTo, 1)) : null;
      if (seg.hours || seg.leads || seg.base || seg.leadPay || seg.openFrom) segments.push(seg);
      base += seg.base;
      leadPay += seg.leadPay;
      hours += seg.hours;
      leads += seg.leads;
    }
    const kpi: PeriodRow["kpi"] = [];
    let kpiPending: MonthKey | null = null;
    if (sv) {
      for (const m of kpiMonths) {
        const cal = monthCal(m, s, today);
        if (cal.phase !== "past") {
          kpiPending = m;
          continue;
        }
        const a = accrual(op, cal, st, ix);
        if (a.sv && a.sv.bonus) kpi.push({ month: m, amount: round2(a.sv.bonus) });
      }
      // KPI текущего месяца придёт после его закрытия — покажем, в какую выплату
      if (!kpiPending && months.some((m) => cals.get(m)!.phase === "current")) kpiPending = months.find((m) => cals.get(m)!.phase === "current") ?? null;
    }
    const kpiSum = kpi.reduce((a, k) => a + k.amount, 0);
    const adjustments = (adjByOp.get(op.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    if (!segments.some((g) => g.hours || g.leads || g.base || g.leadPay) && !kpiSum && !adjustments.length) continue;
    const t = terms ?? accrual(op, cals.get(months[months.length - 1])!, st, ix).t;
    const row = withAdjustments(
      {
        op,
        payType: t.payType,
        salary: t.salary,
        hourlyRate: t.hourlyRate,
        leadBonus: t.leadBonus,
        tiers: t.tiers,
        tierUse: Array.from(tiers.values()).sort((a, b) => a.from - b.from),
        sv: null,
        normHours: t.normHours,
        hours: round2(hours),
        leads,
        salaryShare,
        base,
        leadPay: leadPay + kpiSum,
        explicitTerms: false,
      },
      adjustments,
      st,
    );
    rows.push({ ...row, segments, kpi, kpiPending });
  }
  rows.sort((a, b) => a.op.name.localeCompare(b.op.name, "ru"));
  return { period, start, rows, total: rowsTotal(rows) };
}

/** Схема оплаты оператора в последнем месяце периода (для KPI супервайзера). */
function opTermsType(op: Operator, st: DataState, ix: Index, cals: Map<MonthKey, ReturnType<typeof monthCal>>, months: MonthKey[]) {
  return opTerms(op, cals.get(months[months.length - 1])!, st, ix).payType;
}
