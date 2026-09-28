import type { DataState, DayKey, Lead, MonthKey, Operator, Track } from "./types";
import { NO_GROUP, NO_GROUP_LABEL } from "./types";
import { employmentWindow, incomeBySegment, monthCal, monthModel, monthOperators, sumRange, type Index } from "./calc";
import { isSalary, isSvVolume, payrollRow } from "./payroll";
import { addDays, monthEnd, monthOf, monthStart, rangeDays } from "./dates";
import { reportRange, type ReportKind } from "./report";
import { LEADS, fmtInt, plural, safeDiv } from "./format";

/**
 * Отчёт РОП за день или неделю: деньги, лиды по сегментам и группам, себестоимость
 * лида, часы и табель, найм и ступень KPI по ран-рейту. Видит только РОП.
 *
 *   Выручка     — Σ цена × апрув по лидам периода (основа и регионы, как в зарплате).
 *   Операторы   — начислено по ведомости за дни периода: ведомость месяца на конец
 *                 периода минус ведомость на день до начала. Часы и бонусы — за
 *                 закрытые дни (как в зарплате), фиксированный оклад — долей рабочих дней.
 *   Связь, общие — примерные суммы в месяц из настроек, долей рабочих дней периода.
 *   % расхода   — все расходы ÷ выручка.
 *   СС лида     — затраты на операторов группы ÷ её лиды за те же закрытые дни.
 */

export type CitySeg = "msk" | "spb" | "reg" | "none";
export const CITY_SEG_LABEL: Record<CitySeg, string> = { msk: "МСК", spb: "СПб", reg: "Регионы", none: "Регион не указан" };

/** Сегмент по городу лида: Москва (и область) — МСК, Петербург — СПб, любой другой город — регионы. */
export function citySegment(region: string | undefined): CitySeg {
  const r = (region || "").trim().toLowerCase();
  if (!r) return "none";
  if (/моск|^мск/.test(r)) return "msk";
  if (/петерб|^спб|питер/.test(r)) return "spb";
  return "reg";
}

/** Направление группы: из настроек отчёта, иначе по карточке руководителя, иначе недвижимость. */
export function groupTrack(st: DataState, ix: Index, groupId: string): Track {
  const set = st.settings.rop.groupTrack[groupId];
  if (set) return set;
  const g = ix.groupById.get(groupId);
  const sv = g?.supervisorId ? ix.opById.get(g.supervisorId) : null;
  return sv?.track ?? "re";
}

const isSv = (op: Operator) => op.role === "supervisor" || isSvVolume(op.payType);
const gk = (id: string | null | undefined) => id || NO_GROUP;

export interface RopGroup {
  key: string;
  name: string;
  color: string;
  track: Track;
  /** Руководитель группы; пусто — группу ведёт РОП. */
  supervisor: string;
  leads: number;
  done: number;
  revenue: number;
  /** Затраты на операторов группы (часы + бонусы) за закрытые дни. */
  opCost: number;
  /** Лиды за закрытые дни — база себестоимости и конверсии. */
  leadsClosed: number;
  hours: number;
  /** Лидов на час. */
  conv: number | null;
  /** Себестоимость лида в затратах на операторов, ₽ (null — нет лидов). */
  costPerLead: number | null;
  cap: number;
  /** ФОТ группы ÷ её выручка (мотивация СВ), 0…1; null — выручки нет. */
  fotPct: number | null;
  /** Табель: смен проставлено из положенных рабочих дней. */
  sheet: { filled: number; expected: number; pct: number | null };
  hire: { plan: number; hired: number; out: number; period: number; fired: number; training: number; pipeline: number };
  kpi: { fact: number; plan: number; rr: number; reached: number | null; next: number | null };
}

export interface RopReport {
  kind: ReportKind;
  from: DayKey;
  to: DayKey;
  /** Лиды и выручка — по этот день (для недели в процессе — сегодня). */
  factTo: DayKey;
  /** Часы и затраты — по последний закрытый день; null — ни один день периода ещё не закрыт. */
  costTo: DayKey | null;
  month: MonthKey;
  money: {
    revenue: number;
    operators: number;
    supervisors: number;
    telecom: number;
    overhead: number;
    total: number;
    profit: number;
    /** Все расходы ÷ выручка, 0…1; null — выручки нет. */
    pct: number | null;
  };
  leads: { total: number; done: number; failed: number; re: number; auto: number };
  /** Сегменты по городу лида: МСК / Регионы / СПб / без региона — по всем лидам. */
  segments: Record<CitySeg, number>;
  groups: RopGroup[];
  /** Пороги ступеней KPI из сетки бонуса СВ. */
  steps: number[];
  /** Норма конверсии (лидов на час), доля. */
  convNorm: number;
  /** Чего не хватает в настройках, чтобы цифры были полными. */
  missing: string[];
}

/** Доля рабочих дней отрезка [a, b] внутри месяца m от всех рабочих дней месяца. */
function workShare(st: DataState, m: MonthKey, a: DayKey, b: DayKey): number {
  const cal = monthCal(m, st.settings, b);
  return safeDiv(cal.wIdx(b) - cal.wIdx(addDays(a, -1)), cal.W);
}

/** Месяцы, которые задевает отрезок, с границами внутри каждого. */
function monthSpans(from: DayKey, to: DayKey): { m: MonthKey; a: DayKey; b: DayKey }[] {
  const out: { m: MonthKey; a: DayKey; b: DayKey }[] = [];
  let m = monthOf(from);
  while (monthStart(m) <= to) {
    const a = from > monthStart(m) ? from : monthStart(m);
    const b = to < monthEnd(m) ? to : monthEnd(m);
    out.push({ m, a, b });
    m = monthOf(addDays(monthEnd(m), 1));
  }
  return out;
}

/** Начислено сотруднику за дни [from, to] — разница ведомостей месяца. */
function opCost(st: DataState, ix: Index, op: Operator, from: DayKey, to: DayKey, inMonth: (m: MonthKey) => Set<string>): number {
  let sum = 0;
  for (const { m, a, b } of monthSpans(from, to)) {
    if (!inMonth(m).has(op.id)) continue;
    const adj = st.adjustments.filter((x) => x.month === m && x.operatorId === op.id);
    const at = (d: DayKey) => payrollRow(op, monthCal(m, st.settings, d), st, ix, adj.filter((x) => x.date <= d));
    const hi = at(b);
    const lo = a > monthStart(m) ? at(addDays(a, -1)) : null;
    sum += hi.gross - hi.base - (lo ? lo.gross - lo.base : 0);
    // оклад, не зависящий от часов, начисляется весь сразу — берём его долей рабочих дней
    const fixed = isSvVolume(hi.payType) || (isSalary(hi.payType) && !st.settings.prorateSalary);
    sum += fixed ? hi.base * workShare(st, m, a, b) : hi.base - (lo?.base ?? 0);
  }
  return sum;
}

export function buildRopReport(st: DataState, ix: Index, kind: ReportKind, anchor: DayKey, today: DayKey): RopReport {
  const s = st.settings;
  const { from, to } = reportRange(kind, anchor);
  const factTo = to < today ? to : today;
  const lastClosed = factTo < ix.workedTo ? factTo : ix.workedTo;
  const costTo = lastClosed >= from ? lastClosed : null;
  const month = monthOf(factTo);

  const inFact = (l: Lead) => {
    const d = l.at.slice(0, 10);
    return d >= from && d <= factTo;
  };

  // ── группы: живые + те, где в периоде есть лиды или часы ──
  const keys = new Set<string>();
  for (const g of st.groups) if (!g.deletedAt && g.active) keys.add(g.id);
  for (const l of st.leads) if (inFact(l)) keys.add(gk(l.groupId));
  for (const [k, m] of ix.hoursGroupDay) if (sumRange(m, from, factTo) > 0) keys.add(k);

  // ── затраты по сотрудникам (за закрытые дни) ──
  const opCostBy = new Map<string, number>();
  let operators = 0;
  let supervisors = 0;
  if (costTo) {
    const cache = new Map<MonthKey, Set<string>>();
    const inMonth = (m: MonthKey) => {
      let set = cache.get(m);
      if (!set) cache.set(m, (set = new Set(monthOperators(st, ix, m).map((o) => o.id))));
      return set;
    };
    for (const op of st.operators) {
      const c = opCost(st, ix, op, from, costTo, inMonth);
      if (!c) continue;
      if (isSv(op)) supervisors += c;
      else {
        operators += c;
        opCostBy.set(gk(op.groupId), (opCostBy.get(gk(op.groupId)) ?? 0) + c);
      }
    }
  }

  // ── лиды и сегменты ──
  const leads = { total: 0, done: 0, failed: 0, re: 0, auto: 0 };
  const segments: Record<CitySeg, number> = { msk: 0, spb: 0, reg: 0, none: 0 };
  const trackOf = new Map<string, Track>();
  for (const k of keys) trackOf.set(k, k === NO_GROUP ? "re" : groupTrack(st, ix, k));
  const byGroup = new Map<string, { leads: number; done: number }>();
  for (const l of st.leads) {
    if (!inFact(l)) continue;
    if (l.status === "failed") {
      leads.failed++;
      continue;
    }
    const k = gk(l.groupId);
    const g = byGroup.get(k) ?? { leads: 0, done: 0 };
    g.leads++;
    if (l.status === "done") g.done++;
    byGroup.set(k, g);
    leads.total++;
    if (l.status === "done") leads.done++;
    if ((trackOf.get(k) ?? "re") === "auto") leads.auto++;
    else leads.re++;
    segments[citySegment(l.region)]++;
  }

  // ── выручка ──
  const revenueWhere = (keep: (l: Lead) => boolean) =>
    monthSpans(from, factTo).reduce((sum, { m }) => {
      const r = incomeBySegment(st, m, (l) => inFact(l) && keep(l));
      return sum + r.main.revenue + r.regional.revenue;
    }, 0);
  const revenue = revenueWhere(() => true);

  // ── связь и общие: доля месячной суммы по рабочим дням периода ──
  let telecom = 0;
  let overhead = 0;
  for (const { m, a, b } of monthSpans(from, factTo)) {
    const share = workShare(st, m, a, b);
    telecom += s.rop.telecomMonth * share;
    overhead += s.rop.overheadMonth * share;
  }
  const total = operators + supervisors + telecom + overhead;

  // ── ран-рейт месяца и ступени KPI ──
  const mm = monthModel(st, ix, month, factTo);
  const steps = Array.from(new Set(s.svBonus.rows.map((r) => r.from).filter((f) => f > 0 && f >= s.svBonus.minLeads))).sort((a, b) => a - b);
  if (!steps.length && s.svBonus.minLeads > 0) steps.push(s.svBonus.minLeads);

  const groups: RopGroup[] = [];
  for (const key of keys) {
    const group = key === NO_GROUP ? null : ix.groupById.get(key) ?? null;
    const cnt = byGroup.get(key) ?? { leads: 0, done: 0 };
    const hours = costTo ? sumRange(ix.hoursGroupDay.get(key), from, costTo) : 0;
    const leadsClosed = costTo ? sumRange(ix.groupDay.get(key), from, costTo) : 0;
    const cost = opCostBy.get(key) ?? 0;
    const track = trackOf.get(key) ?? "re";
    const rev = revenueWhere((l) => gk(l.groupId) === key);
    const members = st.operators.filter((o) => gk(o.groupId) === key && !isSv(o));
    if (!group && !cnt.leads && !hours && !members.some((o) => !o.deletedAt && o.status === "active")) continue;

    // табель: у активных операторов группы каждый рабочий день периода должен быть в графике
    let expected = 0;
    let filled = 0;
    if (costTo) {
      for (const op of members) {
        if (op.deletedAt || op.status !== "active") continue;
        for (const d of rangeDays(from, costTo)) {
          const win = employmentWindow(op, monthOf(d));
          if (!win || d < win.from || d > win.to || !monthCal(monthOf(d), s, d).isWork(d)) continue;
          expected++;
          if (ix.shift.has(`${d}|${op.id}`)) filled++;
        }
      }
    }

    // найм: принятые в группу в месяце и кто из них уже вышел на линию (есть отработанные часы)
    const hiredOps = members.filter((o) => o.hireDate && monthOf(o.hireDate) === month && !(o.deletedAt && !ix.opMonths.has(o.id)));
    const cands = st.candidates.filter((c) => !c.deletedAt && gk(c.groupId) === key);
    const hire = {
      plan: group ? s.rop.hirePlan[group.id] ?? 0 : 0,
      hired: hiredOps.length,
      out: hiredOps.filter((o) => Array.from(ix.hoursOpDay.get(o.id)?.keys() ?? []).some((d) => d >= o.hireDate)).length,
      period: hiredOps.filter((o) => o.hireDate >= from && o.hireDate <= factTo).length,
      fired: members.filter((o) => o.status === "fired" && o.fireDate && monthOf(o.fireDate) === month).length,
      training: cands.filter((c) => c.stage === "training").length,
      pipeline: cands.filter((c) => c.stage === "new" || c.stage === "interview").length,
    };

    const gm = mm.groups.find((g) => g.key === key);
    const rr = gm ? Math.round(gm.pace.rr) : 0;
    const reached = steps.filter((x) => x <= rr).pop() ?? null;
    const next = steps.find((x) => x > rr) ?? null;
    const svOp = group?.supervisorId ? ix.opById.get(group.supervisorId) : null;

    groups.push({
      key,
      name: group ? group.name : NO_GROUP_LABEL,
      color: group?.color ?? "gray",
      track,
      supervisor: svOp?.name ?? group?.supervisorName ?? "",
      leads: cnt.leads,
      done: cnt.done,
      revenue: rev,
      opCost: cost,
      leadsClosed,
      hours,
      conv: hours > 0 ? leadsClosed / hours : null,
      costPerLead: leadsClosed > 0 && cost > 0 ? cost / leadsClosed : null,
      cap: track === "auto" ? s.rop.capAuto : s.rop.capRe,
      fotPct: rev > 0 ? cost / rev : null,
      sheet: { filled, expected, pct: expected > 0 ? filled / expected : null },
      hire,
      kpi: { fact: gm?.pace.fact ?? 0, plan: gm?.plan ?? 0, rr, reached, next },
    });
  }
  groups.sort((a, b) => (a.key === NO_GROUP ? 1 : b.key === NO_GROUP ? -1 : a.name.localeCompare(b.name, "ru")));

  const missing: string[] = [];
  if (s.leadRevenue <= 0) missing.push("цена лида основы — выручка неполная");
  if (s.rop.telecomMonth <= 0) missing.push("расходы на связь");
  if (s.rop.overheadMonth <= 0) missing.push("общие расходы");

  return {
    kind,
    from,
    to,
    factTo,
    costTo,
    month,
    money: { revenue, operators, supervisors, telecom, overhead, total, profit: revenue - total, pct: revenue > 0 ? total / revenue : null },
    leads,
    segments,
    groups,
    steps,
    convNorm: s.convNormPct / 100,
    missing,
  };
}

/* ── текстом — для чата: разделы, числа с пробелами, деньги в тыс. ₽ ── */

const MONTHS_PREP = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
const WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];

/** 900 000 → «900 тыс. ₽», 1 250 000 → «1,25 млн ₽». */
function money(n: number): string {
  const v = Math.round(n);
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} млн ₽`;
  if (a >= 1000) return `${sign}${fmtInt(Math.round(a / 1000))} тыс. ₽`;
  return `${sign}${fmtInt(a)} ₽`;
}
const dm = (d: DayKey) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const pc = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const leadsN = (n: number) => `${fmtInt(n)} ${plural(n, LEADS)}`;
const opsN = (n: number) => `${n} ${plural(n, ["оператор", "оператора", "операторов"])}`;

export function ropText(r: RopReport, company = ""): string {
  const L: string[] = [];
  const blank = () => L.push("");
  const year = r.to.slice(0, 4);
  const dow = WEEKDAYS[(new Date(`${r.from}T12:00:00`).getDay() + 6) % 7];
  const title =
    r.kind === "day"
      ? `📊 Отчёт РОП · ${dm(r.from)}.${year}, ${dow}`
      : `📊 Отчёт РОП · неделя ${dm(r.from)}–${dm(r.to)}.${year}${r.factTo < r.to ? ` (данные по ${dm(r.factTo)})` : ""}`;
  L.push(title);
  if (company) L.push(company);
  if (!r.costTo) L.push("День ещё не закрыт — часы и затраты на операторов появятся после закрытия.");

  // деньги
  const m = r.money;
  blank();
  L.push("💰 Финансы");
  L.push(`Выручка — ${money(m.revenue)}`);
  L.push(`Расходы — ${money(m.total)}`);
  L.push(`  • операторы (часы и бонусы) — ${money(m.operators)}`);
  if (m.supervisors) L.push(`  • супервайзеры — ${money(m.supervisors)}`);
  L.push(m.telecom ? `  • связь ≈ ${money(m.telecom)}` : "  • связь — не задано");
  L.push(m.overhead ? `  • общие ≈ ${money(m.overhead)}` : "  • общие — не задано");
  L.push(`Прибыль — ${money(m.profit)}`);
  L.push(`Доля расходов — ${pc(m.pct)}`);

  // лиды
  blank();
  L.push(`📞 Лиды — ${fmtInt(r.leads.total)}`);
  // регион у лидов не указан вовсе — нули по МСК/СПб/регионам ничего не говорят
  if (r.segments.msk + r.segments.reg + r.segments.spb > 0) {
    L.push(`  • МСК — ${fmtInt(r.segments.msk)}`);
    L.push(`  • Регионы — ${fmtInt(r.segments.reg)}`);
    L.push(`  • СПб — ${fmtInt(r.segments.spb)}`);
  }
  if (r.segments.none) L.push(`  • регион не указан — ${fmtInt(r.segments.none)}`);
  if (r.leads.auto && r.leads.re) L.push(`Недвижимость — ${fmtInt(r.leads.re)}, авто — ${fmtInt(r.leads.auto)}`);
  if (r.leads.failed) L.push(`Не доведено — ${fmtInt(r.leads.failed)} (в факт не входят)`);

  // группы
  blank();
  L.push("👥 Группы · себестоимость лида");
  for (const g of r.groups) {
    let cc = "сс — нет данных";
    if (g.costPerLead != null) {
      const v = Math.round(g.costPerLead);
      cc = v > g.cap ? `сс ≈ ${fmtInt(v)} ₽ ⚠️ выше лимита ${fmtInt(g.cap)} ₽` : `сс ≈ ${fmtInt(v)} ₽ (лимит ${fmtInt(g.cap)} ₽)`;
    }
    L.push(`${g.name} — ${leadsN(g.leads)}, ${cc}`);
  }

  // часы и табель
  blank();
  L.push("⏱ Часы в оплату и табель");
  for (const g of r.groups) {
    const sheet = g.sheet.pct == null ? "табель —" : `табель заполнен на ${pc(g.sheet.pct)}`;
    L.push(`${g.name} — ${fmtInt(Math.round(g.hours))} ч, конверсия ${pc(g.conv)}, ${sheet}`);
  }

  // подбор
  blank();
  L.push(`🧲 Подбор в ${MONTHS_PREP[Number(r.month.slice(5, 7)) - 1]}`);
  for (const g of r.groups) {
    const h = g.hire;
    const main = h.plan ? `вышло ${h.out} из ${h.plan}${h.out >= h.plan ? " ✅" : ""}` : `вышло ${opsN(h.out)}, план не задан`;
    const extra = [h.training ? `на обучении ${h.training}` : "", h.pipeline ? `в воронке ${h.pipeline}` : "", h.fired ? `уволено ${h.fired}` : ""].filter(Boolean);
    L.push(`${g.name} — ${main}${extra.length ? `; ${extra.join(", ")}` : ""}`);
  }

  // KPI
  blank();
  L.push("🎯 KPI · ран-рейт на конец месяца");
  for (const g of r.groups) {
    const k = g.kpi;
    const step = k.reached ? `ступень от ${fmtInt(k.reached)}` : "ниже первой ступени";
    const next = k.next ? `, до ${fmtInt(k.next)} не хватает ${fmtInt(k.next - k.rr)}` : "";
    L.push(`${g.name} — ${leadsN(k.rr)} (факт ${fmtInt(k.fact)}), ${step}${next}`);
  }

  // супервайзеры
  const svs = r.groups.filter((g) => g.supervisor);
  if (svs.length) {
    blank();
    L.push("🧑‍💼 Супервайзеры");
    for (const g of svs) L.push(`${g.supervisor} (${g.name}) — ФОТ группы ${pc(g.fotPct)}, ${leadsN(g.leads)}, доведено ${fmtInt(g.done)}`);
  }

  if (r.missing.length) {
    blank();
    L.push(`ℹ️ Не заполнено в параметрах отчёта: ${r.missing.join(", ")}.`);
  }
  return L.join("\n");
}
