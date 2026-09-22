import type { Adjustment, AdjustmentType, DataState, DayKey, Grade, ID, Operator, PayType, RateTier, SvBonusGrid, Track } from "./types";
import { type Index, type MonthCal, monthOperators, opTerms, sumRange, supervisedGroups, supervisedLeads } from "./calc";
import { addMonths, monthDays } from "./dates";
import { round2, safeDiv } from "./format";

/**
 * Расчёт зарплаты за месяц.
 *
 *   База:
 *     оклад        — оклад × min(1, часы / норма), если включена пропорция; иначе оклад
 *     почасовая    — часы × ставка
 *     по сетке     — по каждой смене своя ступень: ставка и бонус зависят от того,
 *                    сколько лидов оператор передал именно в этот день
 *     супервайзер  — полный оклад + бонус по сетке от объёма лидов его групп за
 *                    месяц, с поправкой на апрув заказчика и рост к прошлому месяцу
 *   Бонус за лиды  — лиды × бонус за лид (фиксированный или по ступени смены)
 *   Начислено      — база + бонус + доп.начисления + премии + компенсации + корректировки
 *   Удержание %    — (начислено − компенсации) × процент удержания
 *   К выплате всего— начислено − удержание % − удержания
 *   Остаток        — к выплате − аванс − выплаты
 *
 * Считается на лету из смен, лидов и корректировок: изменили график или число
 * лидов — ведомость пересчиталась сама.
 */

export interface PayRow {
  op: Operator;
  payType: PayType;
  salary: number;
  hourlyRate: number;
  leadBonus: number;
  tiers: RateTier[];
  /** Разбор по ступеням сетки (пусто для обычных схем). */
  tierUse: TierUse[];
  /** Расчёт бонуса супервайзера (только для схемы «оклад + объём группы»). */
  sv: SvBonus | null;
  normHours: number;
  hours: number;
  leads: number;
  /** Доля оклада (часы / норма, не больше 1). */
  salaryShare: number;
  base: number;
  leadPay: number;
  adj: Record<AdjustmentType, number>;
  adjustments: Adjustment[];
  gross: number;
  withholdBase: number;
  withhold: number;
  deductions: number;
  net: number;
  paid: number;
  toPay: number;
  explicitTerms: boolean;
}

const zeroAdj = (): Record<AdjustmentType, number> => ({
  accrual: 0, bonus: 0, compensation: 0, correction: 0, deduction: 0, advance: 0, payout: 0,
});

export const isTiered = (t: PayType) => t === "tiered" || t === "salary_tiered";
export const isSvVolume = (t: PayType) => t === "sv_volume";
export const hasBonus = (t: PayType) => t === "salary_bonus" || t === "hourly_bonus" || isTiered(t);
export const isSalary = (t: PayType) => t === "salary" || t === "salary_bonus" || t === "salary_tiered" || t === "sv_volume";
/** Почасовая часть считается по сетке (а не по фиксированной ставке). */
export const isHourlyTiered = (t: PayType) => t === "tiered";

export interface SvBonus {
  /** Лидов групп за месяц. */
  leads: number;
  /** Столько же за прошлый месяц — для проверки роста. */
  prevLeads: number;
  groups: number;
  grade: Grade;
  track: Track;
  /** Ступень сетки, от которой считаем. */
  step: number;
  /** База по сетке до коэффициентов. */
  base: number;
  approvePct: number;
  /** Коэффициент за апрув заказчика. */
  kApprove: number;
  growth: boolean;
  /** Коэффициент за отсутствие роста (у Junior не применяется). */
  kGrowth: number;
  /** Итоговый бонус: база × коэффициенты. */
  bonus: number;
  /** Объёма не хватает до нижней ступени. */
  belowMin: boolean;
  /** Сколько лидов до следующей ступени и сколько она даст. */
  next: { from: number; base: number } | null;
}

/**
 * Бонус супервайзера за месяц.
 *
 * Считается от объёма лидов его групп (где он указан руководителем):
 * ступень сетки × грейд × направление, затем поправки — апрув заказчика
 * (ниже порога бонус обнуляется) и отсутствие роста к прошлому месяцу.
 */
export function svBonus(
  grid: SvBonusGrid,
  leads: number,
  prevLeads: number,
  opts: { grade: Grade; track: Track; approvePct: number; growth: boolean | null; groups?: number },
): SvBonus {
  const rows = grid.rows;
  let row = rows[0];
  for (const r of rows) if (leads >= r.from) row = r;
  const col = opts.grade === "jr" ? 0 : opts.grade === "mid" ? 1 : 2;
  const belowMin = leads < grid.minLeads;
  const base = belowMin || !row ? 0 : (opts.track === "auto" ? row.auto : row.re)[col];
  const kApprove = grid.approve.find((a) => opts.approvePct >= a.from)?.k ?? 0;
  const growth = opts.growth ?? leads > prevLeads;
  const kGrowth = growth || opts.grade === "jr" ? 1 : grid.noGrowthK;
  const nextRow = rows.find((r) => r.from > leads && ((opts.track === "auto" ? r.auto : r.re)[col] > base || r.from >= grid.minLeads));
  return {
    leads,
    prevLeads,
    groups: opts.groups ?? 0,
    grade: opts.grade,
    track: opts.track,
    step: row?.from ?? 0,
    base,
    approvePct: opts.approvePct,
    kApprove,
    growth,
    kGrowth,
    bonus: Math.round(base * kApprove * kGrowth),
    belowMin,
    next: nextRow ? { from: nextRow.from, base: (opts.track === "auto" ? nextRow.auto : nextRow.re)[col] } : null,
  };
}

/** Ступень по числу лидов за смену: последняя, чей порог не выше факта. */
export function tierFor(tiers: RateTier[], leads: number): RateTier {
  let cur: RateTier = tiers[0] ?? { from: 0, hourlyRate: 0, leadBonus: 0 };
  for (const t of tiers) if (leads >= t.from) cur = t;
  return cur;
}

export interface TierUse extends RateTier {
  /** Смен по этой ступени. */
  days: number;
  hours: number;
  leads: number;
  /** Начислено по ступени (часы × ставка + лиды × бонус). */
  sum: number;
}

/** Разбор месяца по сменам: какая ступень в какой день и сколько по ней вышло. */
export function tieredMonth(
  operatorId: ID,
  days: DayKey[],
  ix: Index,
  tiers: RateTier[],
  withHourly: boolean,
): { hourly: number; bonus: number; use: TierUse[] } {
  const leadMap = ix.opDay.get(operatorId);
  const hourMap = ix.hoursOpDay.get(operatorId);
  const use = new Map<number, TierUse>();
  let hourly = 0;
  let bonus = 0;
  for (const d of days) {
    const leads = leadMap?.get(d) ?? 0;
    const hours = hourMap?.get(d) ?? 0;
    if (!leads && !hours) continue;
    const t = tierFor(tiers, leads);
    const h = withHourly ? hours * t.hourlyRate : 0;
    const b = leads * t.leadBonus;
    hourly += h;
    bonus += b;
    const u = use.get(t.from) ?? { ...t, days: 0, hours: 0, leads: 0, sum: 0 };
    u.days += 1;
    u.hours += hours;
    u.leads += leads;
    u.sum += h + b;
    use.set(t.from, u);
  }
  return { hourly: round2(hourly), bonus: round2(bonus), use: Array.from(use.values()).sort((a, b) => a.from - b.from) };
}

export function payrollRow(
  op: Operator,
  cal: MonthCal,
  st: DataState,
  ix: Index,
  adjustments: Adjustment[],
): PayRow {
  const t = opTerms(op, cal, st, ix);
  // по факту: смены по сегодняшний день включительно; запланированные наперёд не оплачиваются
  const days = monthDays(cal.month).filter((d) => d <= cal.ref);
  const hours = days.length ? round2(sumRange(ix.hoursOpDay.get(op.id), days[0], days[days.length - 1])) : 0;
  const leads = days.length ? sumRange(ix.opDay.get(op.id), days[0], days[days.length - 1]) : 0;

  let base = 0;
  let leadPay = 0;
  let salaryShare = 0;
  let tierUse: TierUse[] = [];
  let sv: SvBonus | null = null;
  if (isSvVolume(t.payType)) {
    // оклад + бонус за объём лидов его групп; оклад супервайзера не режется по
    // часам — это управленческая ставка, а не почасовая работа на линии
    salaryShare = 1;
    base = t.salary;
    const gLeads = supervisedLeads(st, ix, op.id, cal.month);
    const prev = supervisedLeads(st, ix, op.id, addMonths(cal.month, -1));
    sv = svBonus(st.settings.svBonus, gLeads, prev, {
      grade: t.grade,
      track: t.track,
      approvePct: t.approvePct,
      growth: t.growth,
      groups: supervisedGroups(st, op.id).length,
    });
    leadPay = sv.bonus;
  } else if (isTiered(t.payType)) {
    // ставка часа и бонус за лид — по ступени каждой смены
    const tm = tieredMonth(op.id, days, ix, t.tiers, isHourlyTiered(t.payType));
    tierUse = tm.use;
    leadPay = tm.bonus;
    if (isHourlyTiered(t.payType)) base = tm.hourly;
    else {
      salaryShare = st.settings.prorateSalary ? (t.normHours > 0 ? Math.min(1, hours / t.normHours) : 1) : 1;
      base = t.salary * salaryShare;
    }
  } else if (isSalary(t.payType)) {
    salaryShare = st.settings.prorateSalary ? (t.normHours > 0 ? Math.min(1, hours / t.normHours) : 1) : 1;
    base = t.salary * salaryShare;
    leadPay = hasBonus(t.payType) ? leads * t.leadBonus : 0;
  } else {
    base = hours * t.hourlyRate;
    leadPay = hasBonus(t.payType) ? leads * t.leadBonus : 0;
  }

  const adj = zeroAdj();
  for (const a of adjustments) adj[a.type] += Number(a.amount) || 0;

  const gross = base + leadPay + adj.accrual + adj.bonus + adj.compensation + adj.correction;
  const withholdBase = Math.max(0, gross - adj.compensation);
  const withhold = (withholdBase * st.settings.withholdPct) / 100;
  const deductions = adj.deduction;
  const net = gross - withhold - deductions;
  const paid = adj.advance + adj.payout;

  return {
    op,
    payType: t.payType,
    salary: t.salary,
    hourlyRate: t.hourlyRate,
    leadBonus: t.leadBonus,
    tiers: t.tiers,
    tierUse,
    sv,
    normHours: t.normHours,
    hours,
    leads,
    salaryShare,
    base: round2(base),
    leadPay: round2(leadPay),
    adj,
    adjustments,
    gross: round2(gross),
    withholdBase: round2(withholdBase),
    withhold: round2(withhold),
    deductions: round2(deductions),
    net: round2(net),
    paid: round2(paid),
    toPay: round2(net - paid),
    explicitTerms: t.explicit,
  };
}

export interface Payroll {
  rows: PayRow[];
  total: Omit<
    PayRow,
    "op" | "payType" | "salary" | "hourlyRate" | "leadBonus" | "normHours" | "salaryShare" | "adjustments" | "explicitTerms" | "tiers" | "tierUse" | "sv"
  >;
}

export function payroll(st: DataState, ix: Index, cal: MonthCal): Payroll {
  const byOp = new Map<ID, Adjustment[]>();
  for (const a of st.adjustments) {
    if (a.month !== cal.month) continue;
    const list = byOp.get(a.operatorId) ?? [];
    list.push(a);
    byOp.set(a.operatorId, list);
  }
  const ops = monthOperators(st, ix, cal.month);
  const rows = ops.map((op) => payrollRow(op, cal, st, ix, (byOp.get(op.id) ?? []).sort((a, b) => a.date.localeCompare(b.date))));
  rows.sort((a, b) => a.op.name.localeCompare(b.op.name, "ru"));

  const total = {
    hours: 0, leads: 0, base: 0, leadPay: 0, adj: zeroAdj(), gross: 0, withholdBase: 0, withhold: 0,
    deductions: 0, net: 0, paid: 0, toPay: 0,
  };
  for (const r of rows) {
    total.hours += r.hours;
    total.leads += r.leads;
    total.base += r.base;
    total.leadPay += r.leadPay;
    total.gross += r.gross;
    total.withholdBase += r.withholdBase;
    total.withhold += r.withhold;
    total.deductions += r.deductions;
    total.net += r.net;
    total.paid += r.paid;
    total.toPay += r.toPay;
    for (const k of Object.keys(total.adj) as AdjustmentType[]) total.adj[k] += r.adj[k];
  }
  return { rows, total };
}

/** Стоимость одного лида по ведомости: всё начисленное / число лидов. */
/**
 * ФОТ и норматив: фонд оплаты труда против дохода за переданные лиды.
 * Доход = лиды × цена лида для заказчика; норматив — доля фонда от дохода,
 * которую превышать нельзя (в мотивации супервайзера это 24%).
 */
export interface FundStat {
  /** Доход по лидам. */
  revenue: number;
  /** Сам фонд (начислено). */
  fund: number;
  /** Доля фонда в доходе, 0…1. */
  pct: number;
  /** Норматив, 0…1. */
  cap: number;
  /** Сколько начислено сверх норматива, ₽ (0 — в пределах). */
  over: number;
  /** Норматив соблюдён (или считать не из чего). */
  ok: boolean;
}

export function fundStat(fund: number, leads: number, leadRevenue: number, capPct: number): FundStat {
  const revenue = leads * leadRevenue;
  const cap = capPct / 100;
  const pct = safeDiv(fund, revenue);
  return {
    revenue,
    fund,
    pct,
    cap,
    over: revenue > 0 ? Math.max(0, fund - revenue * cap) : 0,
    ok: revenue <= 0 || pct <= cap,
  };
}

/**
 * Прогноз ФОТ на конец месяца по текущему темпу.
 *
 * Фонд растёт пропорционально отработанным дням, доход — по Run Rate лидов.
 * `crossDay` — рабочий день, когда накопленный ФОТ перевалит за норматив,
 * если темп не изменится (null — не перевалит или уже за ним).
 */
export interface FundForecast {
  fund: number;
  revenue: number;
  pct: number;
  cap: number;
  ok: boolean;
  /** Сколько лидов нужно к концу месяца, чтобы уложиться в норматив. */
  leadsNeeded: number;
  crossDay: string | null;
  /** Норматив уже превышен по факту. */
  alreadyOver: boolean;
}

export function fundForecast(
  gross: number,
  leads: number,
  rrLeads: number,
  elapsedWorkdays: number,
  totalWorkdays: number,
  leadRevenue: number,
  capPct: number,
  futureWorkdays: string[],
): FundForecast {
  const cap = capPct / 100;
  const fund = elapsedWorkdays > 0 && totalWorkdays > 0 ? (gross / elapsedWorkdays) * totalWorkdays : gross;
  const revenue = rrLeads * leadRevenue;
  const pct = safeDiv(fund, revenue);
  const leadsNeeded = cap > 0 && leadRevenue > 0 ? Math.ceil(fund / (cap * leadRevenue)) : 0;
  const alreadyOver = leads > 0 && gross > cap * leads * leadRevenue;

  let crossDay: string | null = null;
  if (!alreadyOver && elapsedWorkdays > 0 && leadRevenue > 0 && cap > 0) {
    const perDayFund = gross / elapsedWorkdays;
    const perDayRevenue = (leads / elapsedWorkdays) * leadRevenue;
    const slope = perDayFund - cap * perDayRevenue;
    if (slope > 0) {
      const gap = cap * (leads * leadRevenue) - gross;
      const days = Math.ceil(gap / slope);
      if (days >= 0 && days < futureWorkdays.length) crossDay = futureWorkdays[days];
    }
  }
  return { fund, revenue, pct, cap, ok: revenue <= 0 || pct <= cap, leadsNeeded, crossDay, alreadyOver };
}

export function costPerLead(p: Payroll): number {
  return safeDiv(p.total.gross, p.total.leads);
}
