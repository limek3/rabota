import type { DataState, DayKey, Operator } from "./types";
import { NO_GROUP, NO_GROUP_LABEL } from "./types";
import { WORKED_TYPES, employmentWindow, monthModel, type Index, type MonthModel, type OpRow } from "./calc";
import { addDays, monthOf, rangeDays, weekStart } from "./dates";
import { safeDiv } from "./format";

/**
 * Готовые отчёты за день и за неделю — для супервайзеров: собрать ключевые
 * цифры и отправить картинкой в чат (рисует components/app/ReportCanvas.tsx).
 *
 * Факт — как везде в CRM: лиды «не доведён» в факт не идут. Часы и план — только
 * по сегодняшний день: неделя в процессе сравнивается с планом на прошедшие дни.
 */

export type ReportKind = "day" | "week";

export interface ReportRow {
  op: Operator;
  hours: number;
  /** В факт: «в работе» + «доведён». */
  leads: number;
  done: number;
  failed: number;
  work: number;
  plan: number;
  /** Факт / план (null — плана нет). */
  pct: number | null;
  /** Лидов на час (null — часов нет). */
  conv: number | null;
}

export interface Report {
  kind: ReportKind;
  from: DayKey;
  to: DayKey;
  /** До какого дня посчитан факт (для недели в процессе — сегодня). */
  factTo: DayKey;
  scope: string;
  total: { leads: number; done: number; failed: number; work: number; hours: number; plan: number; pct: number | null; conv: number | null; people: number };
  byDay: { day: DayKey; leads: number; plan: number; hours: number }[];
  rows: ReportRow[];
  month: { month: string; fact: number; plan: number; rr: number; rrPct: number };
  attention: { noShift: string[]; noLeads: string[]; lowConv: { name: string; conv: number }[] };
  convNorm: number;
}

export function reportRange(kind: ReportKind, anchor: DayKey): { from: DayKey; to: DayKey } {
  if (kind === "day") return { from: anchor, to: anchor };
  const from = weekStart(anchor);
  return { from, to: addDays(from, 6) };
}

export function buildReport(st: DataState, ix: Index, kind: ReportKind, anchor: DayKey, groupId: string, today: DayKey): Report {
  const { from, to } = reportRange(kind, anchor);
  const days = rangeDays(from, to);
  const factTo = to < today ? to : today;
  const factDays = days.filter((d) => d <= factTo);

  // модели месяцев, которые задевает период (неделя может перейти через месяц)
  const models = new Map<string, MonthModel>();
  const model = (d: DayKey) => {
    const m = monthOf(d);
    let mm = models.get(m);
    if (!mm) models.set(m, (mm = monthModel(st, ix, m, today)));
    return mm;
  };
  days.forEach(model);

  const inGroup = (g: string | null | undefined) => !groupId || (groupId === NO_GROUP ? !g : g === groupId);

  // лиды периода по оператору и дню, с разбивкой по статусам
  type Cnt = { done: number; failed: number; work: number };
  const byOpDay = new Map<string, Map<DayKey, Cnt>>();
  for (const l of st.leads) {
    const d = l.at.slice(0, 10);
    if (d < from || d > factTo || !inGroup(l.groupId)) continue;
    let m = byOpDay.get(l.operatorId);
    if (!m) byOpDay.set(l.operatorId, (m = new Map()));
    const c = m.get(d) ?? { done: 0, failed: 0, work: 0 };
    c[l.status]++;
    m.set(d, c);
  }

  // кто в отчёте: работал в периоде в этой группе или дал в ней лиды
  const rowOf = (d: DayKey, id: string): OpRow | undefined => model(d).ops.find((r) => r.op.id === id);
  const ids = new Set<string>();
  for (const d of days) for (const r of model(d).ops) if (inGroup(r.op.groupId) && employmentWindow(r.op, monthOf(d)) && !(r.op.deletedAt && !byOpDay.has(r.op.id))) ids.add(r.op.id);
  for (const id of byOpDay.keys()) ids.add(id);

  // план оператора на день: месячный план ÷ рабочие дни его окна работы в месяце.
  // Смена в графике есть, но без отработанных часов (выходной, отпуск, больничный) — плана
  // на этот день нет: иначе отдыхающий висит в отчёте с «0% плана» и тянет вниз итог дня.
  // Смены нет вовсе — план остаётся: человек должен был работать (он в «Нет смены в графике»).
  const dayPlan = (op: Operator, d: DayKey): number => {
    const mm = model(d);
    const r = rowOf(d, op.id);
    const win = employmentWindow(op, mm.cal.month);
    if (!r || !win || d < win.from || d > win.to || !mm.cal.isWork(d)) return 0;
    const sh = ix.shift.get(`${d}|${op.id}`);
    if (sh && !(WORKED_TYPES.has(sh.type) && sh.hours > 0)) return 0;
    const wd = mm.cal.workdays.filter((x) => x >= win.from && x <= win.to).length;
    return wd > 0 ? r.terms.plan / wd : 0;
  };

  const rows: ReportRow[] = [];
  const byDay = days.map((day) => ({ day, leads: 0, plan: 0, hours: 0 }));
  for (const id of ids) {
    const op = ix.opById.get(id) ?? st.operators.find((o) => o.id === id);
    if (!op) continue;
    const row: ReportRow = { op, hours: 0, leads: 0, done: 0, failed: 0, work: 0, plan: 0, pct: null, conv: null };
    const counts = byOpDay.get(id);
    factDays.forEach((d) => {
      const c = counts?.get(d);
      const h = inGroup(op.groupId) || c ? ix.hoursOpDay.get(id)?.get(d) ?? 0 : 0;
      const p = inGroup(op.groupId) ? dayPlan(op, d) : 0;
      const n = c ? c.done + c.work : 0;
      row.hours += h;
      row.plan += p;
      row.leads += n;
      row.done += c?.done ?? 0;
      row.failed += c?.failed ?? 0;
      row.work += c?.work ?? 0;
      const b = byDay[days.indexOf(d)];
      b.leads += n;
      b.plan += p;
      b.hours += h;
    });
    if (!row.hours && !row.leads && !row.failed && !row.plan) continue;
    row.pct = row.plan > 0 ? row.leads / row.plan : null;
    row.conv = row.hours > 0 ? row.leads / row.hours : null;
    rows.push(row);
  }
  rows.sort((a, b) => b.leads - a.leads || (b.conv ?? 0) - (a.conv ?? 0) || a.op.name.localeCompare(b.op.name, "ru"));

  const sum = (f: (r: ReportRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const total = {
    leads: sum((r) => r.leads),
    done: sum((r) => r.done),
    failed: sum((r) => r.failed),
    work: sum((r) => r.work),
    hours: Math.round(sum((r) => r.hours) * 10) / 10,
    plan: sum((r) => r.plan),
    pct: null as number | null,
    conv: null as number | null,
    people: rows.filter((r) => r.hours > 0).length,
  };
  total.pct = total.plan > 0 ? total.leads / total.plan : null;
  total.conv = total.hours > 0 ? total.leads / total.hours : null;

  // месяц для контекста: факт, план и RR — группы или всего отдела
  const mm = model(factTo);
  const g = groupId ? mm.groups.find((x) => x.key === groupId) : null;
  const pace = g ? g.pace : mm.team.pace;
  const monthPlan = g ? g.plan : mm.team.plan;

  const convNorm = st.settings.convNormPct / 100;
  const attention: Report["attention"] = { noShift: [], noLeads: [], lowConv: [] };
  if (kind === "day" && anchor <= today) {
    for (const d of days) {
      if (!model(d).cal.isWork(d)) continue;
      for (const r of model(d).ops) {
        const op = r.op;
        if (!inGroup(op.groupId) || op.deletedAt || op.status !== "active") continue;
        const win = employmentWindow(op, monthOf(d));
        if (!win || d < win.from || d > win.to) continue;
        const sh = ix.shift.get(`${d}|${op.id}`);
        const h = ix.hoursOpDay.get(op.id)?.get(d) ?? 0;
        const n = (byOpDay.get(op.id)?.get(d)?.done ?? 0) + (byOpDay.get(op.id)?.get(d)?.work ?? 0);
        if (!sh) attention.noShift.push(op.name);
        else if (h > 0 && n === 0) attention.noLeads.push(op.name);
      }
    }
  }
  for (const r of rows) if (r.conv != null && r.hours >= 4 && r.conv < convNorm && r.leads > 0) attention.lowConv.push({ name: r.op.name, conv: r.conv });
  attention.lowConv.sort((a, b) => a.conv - b.conv);

  const scope = !groupId ? "Весь отдел" : groupId === NO_GROUP ? NO_GROUP_LABEL : ix.groupById.get(groupId)?.name ?? "Группа";
  return {
    kind,
    from,
    to,
    factTo,
    scope,
    total,
    byDay,
    rows,
    month: { month: mm.cal.month, fact: pace.fact, plan: monthPlan, rr: pace.rr, rrPct: safeDiv(pace.rr, monthPlan) },
    attention,
    convNorm,
  };
}
