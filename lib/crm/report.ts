import type { DataState, DayKey, ID, Operator } from "./types";
import { NO_GROUP, NO_GROUP_LABEL } from "./types";
import { WORKED_TYPES, employmentWindow, goneLast, isGone, monthModel, probation, type Index, type MonthModel, type OpRow } from "./calc";
import { daysBetween } from "./hiring";
import { addDays, monthEnd, monthOf, monthStart, rangeDays, weekStart } from "./dates";
import { safeDiv } from "./format";

/**
 * Готовые отчёты за день, неделю и месяц — для супервайзеров: собрать ключевые
 * цифры и отправить картинкой в чат (рисует components/app/ReportCanvas.tsx).
 * Месяц — свой вид: разбивка по группам, прогноз к концу месяца, лучшие и отстающие.
 *
 * Факт — как везде в CRM: все переданные лиды, «не доведён» тоже (в зарплату он не идёт). Часы и план — только
 * по сегодняшний день: неделя в процессе сравнивается с планом на прошедшие дни.
 */

export type ReportKind = "day" | "week" | "month";

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
  /** Смен с отработанными часами. */
  shifts: number;
  /** Супервайзер: не на линии — в «Лучших» и норме конверсии не участвует. */
  sv: boolean;
  /** План на весь месяц и прогноз к его концу (RR) — из модели месяца, как в сводке. */
  monthPlan: number;
  rr: number;
}

/** Итоги группы в отчёте — те же столбцы, что у операторов. */
export interface ReportGroup {
  key: string;
  name: string;
  color: string;
  rows: ReportRow[];
  hours: number;
  leads: number;
  failed: number;
  plan: number;
  pct: number | null;
  conv: number | null;
  /** Операторов на линии с часами в периоде. */
  people: number;
  monthPlan: number;
  rr: number;
  rrPct: number | null;
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
  /** Разбивка по группам (порядок — как в сводке, «без группы» в конце). */
  groups: ReportGroup[];
  /** Лучший день периода по лидам. */
  bestDay: { day: DayKey; leads: number } | null;
  month: { month: string; fact: number; plan: number; rr: number; rrPct: number };
  attention: { noLeads: string[]; lowConv: { name: string; conv: number }[]; lagging: { name: string; pct: number }[] };
  /** Кадровые события периода — отдельно от цифр: приём, увольнение, закрытая стажировка. */
  events: ReportEvent[];
  convNorm: number;
}

export interface ReportEvent {
  kind: "hired" | "fired" | "passed";
  day: DayKey;
  name: string;
  /** «в штате 23 дн., стажировка не закрыта», «за 5 дн.» */
  note: string;
}

export function reportRange(kind: ReportKind, anchor: DayKey): { from: DayKey; to: DayKey } {
  if (kind === "day") return { from: anchor, to: anchor };
  if (kind === "month") return { from: monthStart(monthOf(anchor)), to: monthEnd(monthOf(anchor)) };
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

  // план оператора на день: месячный план ÷ рабочие дни его окна работы в месяце — только в день
  // рабочей смены с часами. Без смены (пустая клетка — в графике это тоже выходной), выходной,
  // отпуск, больничный — плана нет: иначе отдыхающий висит в отчёте с «0% плана» и тянет вниз итог.
  const dayPlan = (op: Operator, d: DayKey): number => {
    const mm = model(d);
    const r = rowOf(d, op.id);
    const win = employmentWindow(op, mm.cal.month);
    // у супервайзера личного плана на линии нет: его лиды идут в факт, но план дня не тянут
    if (!r || !win || d < win.from || d > win.to || !mm.cal.isWork(d) || ix.svIds.has(op.id)) return 0;
    const sh = ix.shift.get(`${d}|${op.id}`);
    if (!sh || !WORKED_TYPES.has(sh.type) || !(sh.hours > 0)) return 0;
    const wd = mm.cal.workdays.filter((x) => x >= win.from && x <= win.to).length;
    return wd > 0 ? r.terms.plan / wd : 0;
  };

  const rows: ReportRow[] = [];
  const byDay = days.map((day) => ({ day, leads: 0, plan: 0, hours: 0 }));
  // числитель конверсии (как dayConv): идущий день — только у тех, чьи часы уже пришли из Скорозвона
  const convLeadsOf = new Map<ID, number>();
  for (const id of ids) {
    const op = ix.opById.get(id) ?? st.operators.find((o) => o.id === id);
    if (!op) continue;
    const mr = rowOf(factTo, id);
    const row: ReportRow = { op, hours: 0, leads: 0, done: 0, failed: 0, work: 0, plan: 0, pct: null, conv: null, shifts: 0, sv: ix.svIds.has(id), monthPlan: ix.svIds.has(id) ? 0 : mr?.terms.plan ?? 0, rr: ix.svIds.has(id) ? 0 : mr?.pace.rr ?? 0 };
    const counts = byOpDay.get(id);
    // супервайзер: часы не идут в итоги и конверсию
    const sv = ix.svIds.has(id);
    factDays.forEach((d) => {
      const c = counts?.get(d);
      const h = inGroup(op.groupId) || c ? ix.hoursOpDay.get(id)?.get(d) ?? 0 : 0;
      const p = inGroup(op.groupId) ? dayPlan(op, d) : 0;
      // все переданные — и «не доведён»: он в факте, плане и конверсии (не в зарплате); сколько их — колонкой рядом
      const n = c ? c.done + c.work + c.failed : 0;
      row.hours += h;
      if (h > 0) row.shifts++;
      row.plan += p;
      row.leads += n;
      if (!(d === ix.openDay && !h)) convLeadsOf.set(id, (convLeadsOf.get(id) ?? 0) + n);
      row.done += c?.done ?? 0;
      row.failed += c?.failed ?? 0;
      row.work += c?.work ?? 0;
      const b = byDay[days.indexOf(d)];
      b.leads += n;
      b.plan += p;
      if (!sv) b.hours += h;
    });
    if (!row.hours && !row.leads && !row.failed && !row.plan) continue;
    // супервайзер не на линии: строку показываем, только если он сам передавал лиды — иначе итог лидов не сойдётся
    if (sv && !row.leads && !row.failed && !row.work) continue;
    row.pct = row.plan > 0 ? row.leads / row.plan : null;
    row.conv = !sv && row.hours > 0 ? (convLeadsOf.get(id) ?? 0) / row.hours : null;
    rows.push(row);
  }
  rows.sort((a, b) => goneLast(a.op, b.op) || b.leads - a.leads || (b.conv ?? 0) - (a.conv ?? 0) || a.op.name.localeCompare(b.op.name, "ru"));

  const sum = (f: (r: ReportRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  // часы и «на смене» — по операторам на линии, без супервайзеров
  const line = rows.filter((r) => !ix.svIds.has(r.op.id));
  const total = {
    leads: sum((r) => r.leads),
    done: sum((r) => r.done),
    failed: sum((r) => r.failed),
    work: sum((r) => r.work),
    hours: Math.round(line.reduce((a, r) => a + r.hours, 0) * 10) / 10,
    plan: sum((r) => r.plan),
    pct: null as number | null,
    conv: null as number | null,
    people: line.filter((r) => r.hours > 0).length,
  };
  total.pct = total.plan > 0 ? total.leads / total.plan : null;
  // конверсия итога — лиды линии (без супервайзеров и без ждущих часов) ÷ часы линии, как в сводке
  const convLeads = line.reduce((a, r) => a + (convLeadsOf.get(r.op.id) ?? 0), 0);
  total.conv = total.hours > 0 ? convLeads / total.hours : null;

  // месяц для контекста: факт, план и RR — группы или всего отдела
  const mm = model(factTo);
  const g = groupId ? mm.groups.find((x) => x.key === groupId) : null;
  const pace = g ? g.pace : mm.team.pace;
  const monthPlan = g ? g.plan : mm.team.plan;

  const convNorm = st.settings.convNormPct / 100;
  const attention: Report["attention"] = { noLeads: [], lowConv: [], lagging: [] };
  if (kind === "day" && anchor <= today) {
    for (const d of days) {
      if (!model(d).cal.isWork(d)) continue;
      for (const r of model(d).ops) {
        const op = r.op;
        // супервайзер лиды не обязан передавать — в «без лидов» его не ставим
        if (!inGroup(op.groupId) || op.deletedAt || op.status !== "active" || ix.svIds.has(op.id)) continue;
        const win = employmentWindow(op, monthOf(d));
        if (!win || d < win.from || d > win.to) continue;
        // смена по графику (не только закрытая): «на смене без лидов» видно ещё до конца дня;
        // без смены — выходной, в отчёт не попадает
        const h = ix.plannedOpDay.get(op.id)?.get(d) ?? 0;
        const n = (byOpDay.get(op.id)?.get(d)?.done ?? 0) + (byOpDay.get(op.id)?.get(d)?.work ?? 0);
        if (h > 0 && n === 0) attention.noLeads.push(op.name);
      }
    }
  }
  // за месяц конверсию судим по набранным часам: пара коротких смен — ещё не вывод
  const minHours = kind === "month" ? 16 : 4;
  for (const r of rows) if (r.conv != null && r.hours >= minHours && r.conv < convNorm && r.leads > 0) attention.lowConv.push({ name: r.op.name, conv: r.conv });
  attention.lowConv.sort((a, b) => a.conv - b.conv);
  // месяц: кто идёт ниже порога «отстаёт» к плану на сегодня (уволенные — уже не про это)
  if (kind === "month") {
    const lag = st.settings.lagPct / 100;
    for (const r of rows) if (r.pct != null && r.plan >= 1 && r.pct < lag && !isGone(r.op)) attention.lagging.push({ name: r.op.name, pct: r.pct });
    attention.lagging.sort((a, b) => a.pct - b.pct);
  }

  // кадровые события периода: в таблице цифр им не место, но РОПу важно их видеть
  const events: ReportEvent[] = [];
  for (const op of st.operators) {
    if (!inGroup(op.groupId) || (op.deletedAt && !byOpDay.has(op.id) && !ix.hoursOpDay.has(op.id))) continue;
    const inPeriod = (d: string) => !!d && d >= from && d <= factTo;
    if (inPeriod(op.hireDate)) events.push({ kind: "hired", day: op.hireDate, name: op.name, note: "принят(а) в штат" });
    const pr = probation(op, ix, st.settings, factTo);
    if (pr.active && pr.doneAt && inPeriod(pr.doneAt)) {
      const days = op.hireDate ? daysBetween(op.hireDate, pr.doneAt) : null;
      events.push({ kind: "passed", day: pr.doneAt, name: op.name, note: `закрыл(а) стажировку${days != null ? ` за ${days} дн.` : ""}` });
    }
    if (op.status === "fired" && inPeriod(op.fireDate)) {
      const days = op.hireDate ? daysBetween(op.hireDate, op.fireDate) : null;
      const bits = [days != null ? `в штате ${days} дн.` : "", pr.active && !(pr.doneAt && pr.doneAt <= op.fireDate) ? "стажировку не закрыл(а)" : ""].filter(Boolean);
      events.push({ kind: "fired", day: op.fireDate, name: op.name, note: `уволен(а)${bits.length ? ` · ${bits.join(", ")}` : ""}` });
    }
  }
  events.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name, "ru"));

  // группы: порядок — как в сводке, «без группы» в конце
  const order = new Map(mm.groups.map((x, i) => [x.key, i]));
  const byGroup = new Map<string, ReportRow[]>();
  for (const r of rows) {
    const k = r.op.groupId || NO_GROUP;
    byGroup.set(k, [...(byGroup.get(k) ?? []), r]);
  }
  const groups: ReportGroup[] = [...byGroup.entries()]
    .map(([key, list]) => {
      const gr = ix.groupById.get(key);
      const mg = mm.groups.find((x) => x.key === key);
      const ln = list.filter((r) => !ix.svIds.has(r.op.id));
      const hours = Math.round(ln.reduce((a, r) => a + r.hours, 0) * 10) / 10;
      const leads = list.reduce((a, r) => a + r.leads, 0);
      const plan = list.reduce((a, r) => a + r.plan, 0);
      const cl = ln.reduce((a, r) => a + (convLeadsOf.get(r.op.id) ?? 0), 0);
      const mPlan = mg ? mg.plan : list.reduce((a, r) => a + r.monthPlan, 0);
      const rr = mg ? mg.pace.rr : list.reduce((a, r) => a + r.rr, 0);
      return {
        key,
        name: key === NO_GROUP ? NO_GROUP_LABEL : gr?.name ?? "Группа",
        color: gr?.color ?? "gray",
        rows: list,
        hours,
        leads,
        failed: list.reduce((a, r) => a + r.failed, 0),
        plan,
        pct: plan > 0 ? leads / plan : null,
        conv: hours > 0 ? cl / hours : null,
        people: ln.filter((r) => r.hours > 0).length,
        monthPlan: mPlan,
        rr,
        rrPct: mPlan > 0 ? rr / mPlan : null,
      };
    })
    .sort((a, b) => (a.key === NO_GROUP ? 1 : 0) - (b.key === NO_GROUP ? 1 : 0) || (order.get(a.key) ?? 1e6) - (order.get(b.key) ?? 1e6) || a.name.localeCompare(b.name, "ru"));

  let bestDay: Report["bestDay"] = null;
  for (const b of byDay) if (b.day <= factTo && b.leads > 0 && (!bestDay || b.leads > bestDay.leads)) bestDay = { day: b.day, leads: b.leads };

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
    groups,
    bestDay,
    month: { month: mm.cal.month, fact: pace.fact, plan: monthPlan, rr: pace.rr, rrPct: safeDiv(pace.rr, monthPlan) },
    attention,
    events,
    convNorm,
  };
}
