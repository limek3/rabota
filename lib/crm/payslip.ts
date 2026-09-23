import type { Adjustment, DataState, DayKey, RateTier } from "./types";
import { ADJ_LABEL, GRADE_LABEL, NO_GROUP_LABEL, PAY_LABEL, TRACK_LABEL } from "./types";
import type { Index, MonthCal } from "./calc";
import { hasBonus, isHourlyTiered, isSalary, isSvVolume, isTiered, tierFor, type PayRow } from "./payroll";
import { monthDays } from "./dates";
import { fmtInt, fmtMoney, fmtNum, fmtPct, round2 } from "./format";

/**
 * Расчётный лист оператора за месяц — то же, что ведомость (payrollRow), только
 * разложенное по строкам для человека: откуда взялась каждая сумма, что удержано,
 * что уже выплачено. Картинку и PDF из этого рисует components/app/Payslip.tsx.
 *
 * Отдельных цифр здесь не считается: суммы берутся из PayRow, по сменам —
 * та же ступень, что в tieredMonth. Поэтому лист не может разойтись с ведомостью.
 */

export type SlipKind = "plus" | "minus" | "total" | "grand";

export interface SlipLine {
  label: string;
  /** Как посчитано: «176 ч × 200 ₽», дата и комментарий начисления. */
  note?: string;
  value: number;
  kind: SlipKind;
}

export interface SlipDay {
  day: DayKey;
  hours: number;
  leads: number;
  /** Ставка часа этой смены (0 — у схемы нет почасовой части). */
  rate: number;
  /** Бонус за лид этой смены (0 — бонуса нет). */
  bonus: number;
  /** Начислено за смену; null — у оклада сумма за день не считается. */
  sum: number | null;
}

export interface Payslip {
  row: PayRow;
  month: string;
  group: string;
  scheme: string;
  shifts: number;
  lines: SlipLine[];
  days: SlipDay[];
  /** Текущий месяц: цифры меняются до конца месяца. */
  preliminary: boolean;
  asOf: DayKey;
  withholdPct: number;
}

const adjNote = (a: Adjustment) => [a.date.slice(8, 10) + "." + a.date.slice(5, 7), a.comment.trim()].filter(Boolean).join(" · ");

function dayRows(row: PayRow, cal: MonthCal, ix: Index): SlipDay[] {
  if (isSvVolume(row.payType)) return [];
  const leadMap = ix.opDay.get(row.op.id);
  const hourMap = ix.hoursOpDay.get(row.op.id);
  const out: SlipDay[] = [];
  for (const d of monthDays(cal.month)) {
    if (d > cal.ref) break;
    const leads = leadMap?.get(d) ?? 0;
    const hours = hourMap?.get(d) ?? 0;
    if (!leads && !hours) continue;
    let rate = 0;
    let bonus = 0;
    let sum: number | null;
    if (isTiered(row.payType)) {
      const t: RateTier = tierFor(row.tiers, leads);
      rate = isHourlyTiered(row.payType) ? t.hourlyRate : 0;
      bonus = t.leadBonus;
      sum = round2(hours * rate + leads * bonus);
    } else if (isSalary(row.payType)) {
      bonus = hasBonus(row.payType) ? row.leadBonus : 0;
      sum = null; // оклад за месяц, по дням не делится
    } else {
      rate = row.hourlyRate;
      bonus = hasBonus(row.payType) ? row.leadBonus : 0;
      sum = round2(hours * rate + leads * bonus);
    }
    out.push({ day: d, hours, leads, rate, bonus, sum });
  }
  return out;
}

export function buildPayslip(st: DataState, ix: Index, cal: MonthCal, row: PayRow): Payslip {
  const s = st.settings;
  const r = row;
  const lines: SlipLine[] = [];

  // база
  if (isSvVolume(r.payType)) lines.push({ label: "Оклад", value: r.base, kind: "plus" });
  else if (isHourlyTiered(r.payType)) lines.push({ label: "Часы по ступеням смен", note: `${fmtNum(r.hours)} ч, ставка часа — по числу лидов в смене`, value: r.base, kind: "plus" });
  else if (isSalary(r.payType))
    lines.push({
      label: "Оклад",
      note:
        s.prorateSalary && r.salaryShare < 1
          ? `${fmtMoney(r.salary)} × ${fmtNum(r.hours)} ч из ${fmtNum(r.normHours)} ч нормы (${fmtPct(r.salaryShare)})`
          : `${fmtMoney(r.salary)} за месяц`,
      value: r.base,
      kind: "plus",
    });
  else lines.push({ label: "Почасовая оплата", note: `${fmtNum(r.hours)} ч × ${fmtMoney(r.hourlyRate)}`, value: r.base, kind: "plus" });

  // бонус
  if (r.sv) {
    const sv = r.sv;
    lines.push({
      label: "Бонус за объём групп",
      note: sv.belowMin
        ? `${fmtInt(sv.leads)} лидов — меньше порога ${fmtInt(s.svBonus.minLeads)}`
        : `${fmtInt(sv.leads)} лидов · ступень ${fmtInt(sv.step)} · ${GRADE_LABEL[sv.grade]} · ${TRACK_LABEL[sv.track]} · ${fmtMoney(sv.base)} × ${String(sv.kApprove).replace(".", ",")} (апрув ${fmtNum(sv.approvePct)}%)${sv.kGrowth < 1 ? ` × ${String(sv.kGrowth).replace(".", ",")} (нет роста)` : ""}`,
      value: r.leadPay,
      kind: "plus",
    });
  } else if (hasBonus(r.payType)) {
    lines.push({
      label: "Бонус за лиды",
      note: isTiered(r.payType) ? `${fmtInt(r.leads)} лидов, бонус — по ступени смены` : `${fmtInt(r.leads)} × ${fmtMoney(r.leadBonus)}`,
      value: r.leadPay,
      kind: "plus",
    });
  }

  // начисления по одному: у каждого своя дата и причина
  const adj = (types: Adjustment["type"][]) => r.adjustments.filter((a) => types.includes(a.type));
  for (const a of adj(["accrual", "bonus", "compensation", "correction"]))
    lines.push({ label: ADJ_LABEL[a.type], note: adjNote(a), value: Number(a.amount) || 0, kind: "plus" });
  lines.push({ label: "Начислено", value: r.gross, kind: "total" });

  if (r.withhold) lines.push({ label: `Удержание ${fmtNum(s.withholdPct)}%`, note: `с ${fmtMoney(r.withholdBase)}${r.adj.compensation ? " (компенсации не облагаются)" : ""}`, value: r.withhold, kind: "minus" });
  for (const a of adj(["deduction"])) lines.push({ label: ADJ_LABEL[a.type], note: adjNote(a), value: Number(a.amount) || 0, kind: "minus" });
  lines.push({ label: "К выплате за месяц", value: r.net, kind: "total" });

  for (const a of adj(["advance", "payout"])) lines.push({ label: ADJ_LABEL[a.type], note: adjNote(a), value: Number(a.amount) || 0, kind: "minus" });
  lines.push({ label: "Остаток к выплате", value: r.toPay, kind: "grand" });

  const days = dayRows(r, cal, ix);
  const group = r.op.groupId ? ix.groupById.get(r.op.groupId)?.name ?? NO_GROUP_LABEL : NO_GROUP_LABEL;
  return {
    row: r,
    month: cal.month,
    group,
    scheme: PAY_LABEL[r.payType],
    shifts: days.filter((d) => d.hours > 0).length,
    lines,
    days,
    preliminary: cal.phase !== "past",
    asOf: cal.ref,
    withholdPct: s.withholdPct,
  };
}
