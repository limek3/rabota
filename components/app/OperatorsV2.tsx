"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { useInsights, useMonthModel } from "@/lib/crm/hooks";
import { WORKED_TYPES, sumRange, workedDays, type OpRow } from "@/lib/crm/calc";
import { canManageOperator } from "@/lib/crm/access";
import { addDays, addMonths, fmtMonth, isoWeekday, isWorkday, monthEnd, monthOf, monthStart, rangeDays, weekEnd, weekStart } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct, plural, safeDiv, shortName, OPS } from "@/lib/crm/format";
import { EMPLOYMENT_LABEL, NO_GROUP, NO_GROUP_LABEL, ROLE_LABEL, type DayKey, type DayType, type Operator, type Shift } from "@/lib/crm/types";
import { Avatar, downloadText, toCsv } from "@/components/ui/kit";
import { Layer, Select, dot, usePopover, type Opt } from "@/components/ui/select";
import { useColumnDrag, useColumnOrder, useColumnVisibility } from "@/components/ui/ColumnOrder";
import { Icon, type IconName } from "@/components/ui/icons";
import { OperatorDrawer } from "@/components/app/OperatorDrawer";
import { OperatorNotes, useOpNotes } from "@/components/app/OperatorCoach";

/**
 * «Операторы» v2: показатели за день / неделю / месяц, баннер о проблемных, фильтры,
 * таблица и карточка выбранного оператора справа. Прежняя версия — OperatorsClassic,
 * переключатель — в app/(crm)/operators/page.tsx. Полная карточка — OperatorDrawer.
 */

type Mode = "day" | "week" | "month";
type StKey = "ahead" | "ontrack" | "lagging" | "critical" | "noshift" | "noplan" | "paused" | "fired";
type SortKey = "name" | "plan" | "fact" | "pct" | "left" | "hours" | "lph";
type Tab = "overview" | "shifts" | "plan" | "notes";

const ST: Record<StKey, { label: string; hue: string; icon: IconName }> = {
  ahead: { label: "Выше плана", hue: "green", icon: "check" },
  ontrack: { label: "По плану", hue: "amber", icon: "check" },
  lagging: { label: "Отстаёт", hue: "amber", icon: "alert" },
  critical: { label: "Сильно отстаёт", hue: "red", icon: "close" },
  noshift: { label: "Без смены", hue: "gray", icon: "clock" },
  noplan: { label: "Без плана", hue: "gray", icon: "target" },
  paused: { label: "На паузе", hue: "gray", icon: "pause" },
  fired: { label: "Уволен", hue: "gray", icon: "userMinus" },
};

const PERF: { value: string; label: string; test: (p: number) => boolean }[] = [
  { value: "100", label: "100% и выше", test: (p) => p >= 1 },
  { value: "80", label: "80–99%", test: (p) => p >= 0.8 && p < 1 },
  { value: "50", label: "50–79%", test: (p) => p >= 0.5 && p < 0.8 },
  { value: "0", label: "Меньше 50%", test: (p) => p < 0.5 },
];

const DAY_LABEL: Record<DayType, string> = { work: "смена", training: "обучение", off: "выходной", vacation: "отпуск", sick: "больничный", platform: "платформа" };
/** Короткая отметка нерабочего дня в «Продуктивности». */
const DAY_MARK: Partial<Record<DayType, string>> = { off: "вых", vacation: "отп", sick: "бол", platform: "пл" };
const DAY_HUE: Record<DayType, string> = { work: "green", training: "green", off: "gray", vacation: "amber", sick: "red", platform: "gray" };
const DOW = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const DOW_CAP = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const dShort = (d: DayKey) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;

const COLS = ["status", "group", "plan", "fact", "pct", "left", "hours", "lph", "spark"] as const;
const COL_LABEL: Record<(typeof COLS)[number], string> = {
  status: "Статус", group: "Группа", plan: "План", fact: "Факт", pct: "Выполнение", left: "Осталось", hours: "Часы", lph: "Конверсия", spark: "Динамика",
};

type Col = (typeof COLS)[number];
const COL_SORT: Partial<Record<Col, SortKey>> = { plan: "plan", fact: "fact", pct: "pct", left: "left", hours: "hours", lph: "lph" };
const COL_CENTER = new Set<Col>(["plan", "fact", "left", "hours", "lph"]);

/** Новый порядок видимых столбцов → полный порядок: скрытые остаются на своих местах (как на прежней странице). */
function mergeVisible(full: string[], visibleNext: string[]): string[] {
  const vis = new Set(visibleNext);
  let i = 0;
  return full.map((k) => (vis.has(k) ? visibleNext[i++] : k));
}

const worked = (s?: Shift) => !!s && WORKED_TYPES.has(s.type) && s.hours > 0;
const pctHue = (p: number) => (p >= 1 ? "green" : p >= 0.8 ? "amber" : "red");
const hueVar = (h: string) => `var(--c-${h}-fg)`;

interface PRow {
  r: OpRow;
  op: Operator;
  groupName: string;
  groupColor: string;
  plan: number;
  planToDate: number;
  fact: number;
  hours: number;
  shifts: number;
  lph: number | null;
  pct: number;
  left: number;
  st: StKey;
  /** Лиды за последние 7 рабочих смен (без выходных). */
  spark: number[];
  sparkDays: DayKey[];
  /** Последняя смена — сегодняшняя и ещё идёт. */
  sparkOpen: boolean;
  todayShift: Shift | undefined;
}

function employed(op: Operator, d: DayKey) {
  if (op.hireDate && d < op.hireDate) return false;
  if (op.fireDate && d > op.fireDate) return false;
  return !(op.status === "fired" && !op.fireDate);
}

function periodOf(mode: Mode, anchor: DayKey): { from: DayKey; to: DayKey } {
  if (mode === "day") return { from: anchor, to: anchor };
  if (mode === "week") return { from: weekStart(anchor), to: weekEnd(anchor) };
  return { from: monthStart(monthOf(anchor)), to: monthEnd(monthOf(anchor)) };
}

export function OperatorsV2() {
  const { data, ix, month, setMonth, today, access, openOperator } = useCrm();
  const router = useRouter();
  const m = useMonthModel();
  const ins = useInsights(m);
  const s = data.settings;
  const convNorm = s.convNormPct / 100;

  /* ── период ─────────────────────────────────────────────────────── */
  const [mode, setMode] = useState<Mode>("week");
  // опорный день — внутри выбранного в приложении месяца: сегодня или его первое число
  const [anchor, setAnchor] = useState<DayKey>(() => (monthOf(today) === month ? today : monthStart(month)));
  useEffect(() => {
    if (monthOf(anchor) !== month) setMonth(monthOf(anchor));
  }, [anchor, month, setMonth]);
  // месяц переключили в другом месте — встаём на его начало (или на сегодня)
  useEffect(() => {
    if (monthOf(anchor) !== month) setAnchor(monthOf(today) === month ? today : monthStart(month));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);
  const { from, to } = periodOf(mode, anchor);
  const last = to < today ? to : today; // факт — по сегодня
  const started = from <= today;
  const shift = (dir: 1 | -1) =>
    setAnchor(mode === "day" ? addDays(anchor, dir) : mode === "week" ? addDays(anchor, 7 * dir) : monthStart(addMonths(monthOf(anchor), dir)));
  const periodLabel =
    mode === "day"
      ? `${anchor === today ? "Сегодня, " : anchor === addDays(today, -1) ? "Вчера, " : `${DOW_CAP[isoWeekday(anchor) - 1]}, `}${dShort(anchor)} ${anchor.slice(0, 4)}`
      : mode === "week"
        ? `${Number(from.slice(8))}${from.slice(5, 7) === to.slice(5, 7) ? "" : ` ${MON[Number(from.slice(5, 7)) - 1]}`}–${dShort(to)} ${to.slice(0, 4)}`
        : fmtMonth(monthOf(anchor));
  const vsLabel = mode === "day" ? "ко вчера" : mode === "week" ? "к прошлой неделе" : "к прошлому месяцу";
  const forLabel = mode === "day" ? (anchor === today ? "на сегодня" : "на день") : mode === "week" ? "на неделю" : "на месяц";

  /* ── фильтры ────────────────────────────────────────────────────── */
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [stF, setStF] = useState<"" | StKey>("");
  const [perfF, setPerfF] = useState("");
  const [shiftF, setShiftF] = useState<"" | "on" | "off">("");
  const [showPaused, setShowPaused] = useState(true);
  const [showFired, setShowFired] = useState(false);
  const [onlyTrainees, setOnlyTrainees] = useState(false);
  const [alertHidden, setAlertHidden] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "pct", dir: -1 });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selId, setSelId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const vis = useColumnVisibility("operators2", COLS, COLS);
  // свой порядок столбцов у каждого аккаунта; перетаскивание за заголовок — как на прежней странице
  const colOrder = useColumnOrder("operators2", COLS);
  const shown = useMemo(() => colOrder.order.filter((k) => vis.shown.has(k)) as Col[], [colOrder.order, vis.shown]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const colDrag = useColumnDrag({ wrapRef, order: shown, onChange: (next) => colOrder.save(mergeVisible(colOrder.order, next)) });

  // /operators?id=… — сразу выбрать оператора
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setSelId(id);
  }, []);

  /* ── строки за период ───────────────────────────────────────────── */
  const base = useMemo(
    () => m.ops.filter((r) => !r.op.deletedAt && r.status !== "sv" && !ix.svIds.has(r.op.id)),
    [m.ops, ix],
  );

  const rows: PRow[] = useMemo(() => {
    const days = rangeDays(from, to);
    const doneDays = started ? rangeDays(from, last) : [];
    const closedTo = last < ix.workedTo ? last : ix.workedTo;
    return base.map((r) => {
      const op = r.op;
      const work = (d: DayKey) => isWorkday(d, s) && employed(op, d);
      const daily = r.pace.dailyPlan;
      const plan = daily * days.filter(work).length;
      const planToDate = daily * doneDays.filter(work).length;
      const opDay = ix.opDay.get(op.id);
      const fact = started ? sumRange(opDay, from, last) : 0;
      // часы — по закрытым дням; сегодняшняя смена — по графику, пока день не закрыт
      const hMap = ix.hoursOpDay.get(op.id);
      let hours = started ? sumRange(hMap, from, closedTo) : 0;
      let shifts = doneDays.filter((d) => d <= closedTo && (hMap?.get(d) ?? 0) > 0).length;
      const todayShift = ix.shift.get(`${today}|${op.id}`);
      if (today >= from && today <= to && today > ix.workedTo && worked(todayShift)) {
        hours += todayShift!.hours;
        shifts += 1;
      }
      // конверсия = факт ÷ часы — ровно те числа, что стоят в таблице рядом
      const lph = hours > 0 ? fact / hours : null;
      const pct = planToDate > 0 ? fact / planToDate : 0;
      let st: StKey;
      if (op.status === "fired") st = "fired";
      else if (op.status === "pause") st = "paused";
      else if (shifts === 0 && fact === 0) st = "noshift";
      else if (plan <= 0) st = "noplan";
      else if (pct * 100 >= s.aheadPct) st = "ahead";
      else if (pct * 100 >= s.normalPct) st = "ontrack";
      else if (pct * 100 >= s.lagPct) st = "lagging";
      else st = "critical";
      const g = op.groupId ? ix.groupById.get(op.groupId) : null;
      return {
        r,
        op,
        groupName: g ? g.name : NO_GROUP_LABEL,
        groupColor: g?.color ?? "gray",
        plan,
        planToDate,
        fact,
        hours,
        shifts,
        lph,
        pct,
        left: Math.max(0, Math.round(plan) - fact),
        st,
        ...(() => {
          const wd = workedDays(ix, op.id, started ? last : to);
          return { spark: wd.map((d) => opDay?.get(d) ?? 0), sparkDays: wd, sparkOpen: wd.length > 0 && wd[wd.length - 1] === today && today > ix.workedTo };
        })(),
        todayShift,
      };
    });
  }, [base, from, to, last, started, ix, s, today]);

  // общая выборка (группа, сотрудники) — от неё считаются показатели и баннер
  const pool = useMemo(
    () =>
      rows.filter((x) => {
        if (x.op.status === "fired" && !showFired) return false;
        if (x.op.status === "pause" && !showPaused) return false;
        if (onlyTrainees && x.op.role !== "trainee") return false;
        if (group && (x.op.groupId || NO_GROUP) !== group) return false;
        return true;
      }),
    [rows, showFired, showPaused, onlyTrainees, group],
  );

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const perf = PERF.find((p) => p.value === perfF);
    const out = pool.filter((x) => {
      if (stF && x.st !== stF) return false;
      if (perf && (x.planToDate <= 0 || !perf.test(x.pct))) return false;
      if (shiftF === "on" && !worked(x.todayShift)) return false;
      if (shiftF === "off" && worked(x.todayShift)) return false;
      if (t && !x.op.name.toLowerCase().includes(t) && !x.groupName.toLowerCase().includes(t) && !x.op.contact.toLowerCase().includes(t)) return false;
      return true;
    });
    const v = (x: PRow): number | string =>
      sort.key === "name" ? x.op.name : sort.key === "plan" ? x.plan : sort.key === "fact" ? x.fact : sort.key === "pct" ? (x.planToDate > 0 ? x.pct : -1) : sort.key === "left" ? x.left : sort.key === "hours" ? x.hours : x.lph ?? -1;
    out.sort((a, b) => {
      const x = v(a);
      const y = v(b);
      const c = typeof x === "string" ? x.localeCompare(y as string, "ru") : (x as number) - (y as number);
      return Number(a.op.status === "fired") - Number(b.op.status === "fired") || c * sort.dir || a.op.name.localeCompare(b.op.name, "ru");
    });
    return out;
  }, [pool, q, stF, perfF, shiftF, sort]);

  /* ── показатели и сравнение с прошлым периодом ──────────────────── */
  const kpi = useMemo(() => {
    const live = pool.filter((x) => x.op.status !== "fired");
    const span = started ? rangeDays(from, last).length : 0;
    const pFrom = mode === "month" ? monthStart(addMonths(monthOf(from), -1)) : addDays(from, mode === "day" ? -1 : -7);
    const pLast = addDays(pFrom, Math.max(0, span - 1));
    const sumOps = (f: DayKey, t: DayKey, kind: "leads" | "hours") => {
      let leads = 0;
      let hours = 0;
      let shifts = 0;
      let leadsClosed = 0;
      const closed = t < ix.workedTo ? t : ix.workedTo;
      for (const x of live) {
        const id = x.op.id;
        leads += sumRange(ix.opDay.get(id), f, t);
        leadsClosed += sumRange(ix.opDay.get(id), f, closed);
        const h = ix.hoursOpDay.get(id);
        if (kind === "hours" && h) for (const [d, v] of h) if (d >= f && d <= closed && v > 0) { hours += v; shifts++; }
      }
      return { leads, hours, shifts, lph: hours > 0 ? leadsClosed / hours : null };
    };
    const cur = started ? sumOps(from, last, "hours") : { leads: 0, hours: 0, shifts: 0, lph: null };
    // конверсия команды — как в таблице: факт ÷ часы (с идущей сменой)
    const fSum = live.reduce((a, x) => a + x.fact, 0);
    const hSum = live.reduce((a, x) => a + x.hours, 0);
    const lphNow = hSum > 0 ? fSum / hSum : null;
    const prev = started ? sumOps(pFrom, pLast, "hours") : null;
    const headNow = live.filter((x) => x.op.status !== "fired" && employed(x.op, last)).length;
    const headPrev = live.filter((x) => employed(x.op, started ? pLast : addDays(from, -1))).length;
    const avgH = safeDiv(cur.hours, cur.shifts);
    const avgHPrev = prev ? safeDiv(prev.hours, prev.shifts) : 0;
    const withPlan = live.filter((x) => x.planToDate > 0 && x.op.status === "active");
    const meet = withPlan.filter((x) => x.pct * 100 >= s.normalPct).length;
    const crit = live.filter((x) => x.st === "critical");
    return {
      head: headNow,
      headDelta: headNow - headPrev,
      meet,
      meetOf: withPlan.length,
      avgH,
      avgHDelta: prev && prev.shifts > 0 && cur.shifts > 0 ? avgH - avgHPrev : null,
      leads: cur.leads,
      leadsDelta: prev && prev.leads > 0 ? cur.leads / prev.leads - 1 : null,
      lph: lphNow,
      lphDelta: prev?.lph != null && lphNow != null ? lphNow - prev.lph : null,
      crit,
    };
  }, [pool, started, from, last, mode, ix, s]);

  const sel = selId ? rows.find((x) => x.op.id === selId) ?? null : null;
  const drawerRow = drawerId ? m.ops.find((r) => r.op.id === drawerId) ?? null : null;
  const groups = data.groups.filter((g) => !g.deletedAt);
  const moreCount = Number(!showPaused) + Number(showFired) + Number(onlyTrainees);
  const activeFilters = Number(!!group) + Number(!!stF) + Number(!!perfF) + Number(!!shiftF) + moreCount;
  const toggleSort = (key: SortKey) => setSort((p) => (p.key === key ? { key, dir: p.dir === 1 ? -1 : 1 } : { key, dir: key === "name" ? 1 : -1 }));
  const allChecked = list.length > 0 && list.every((x) => checked.has(x.op.id));

  const exportCsv = () => {
    const src = checked.size ? list.filter((x) => checked.has(x.op.id)) : list;
    const head = ["ФИО", "Группа", "Роль", "Оформление", "Статус", "План", "Должно быть к дате", "Факт", "Выполнение, %", "Осталось", "Часы", "Конверсия, %"];
    const body = src.map((x) => [
      x.op.name,
      x.groupName,
      ROLE_LABEL[x.op.role],
      EMPLOYMENT_LABEL[x.op.employment ?? "none"],
      ST[x.st].label,
      Math.round(x.plan * 10) / 10,
      Math.round(x.planToDate * 10) / 10,
      x.fact,
      x.planToDate > 0 ? Math.round(x.pct * 1000) / 10 : "",
      x.left,
      Math.round(x.hours * 10) / 10,
      x.lph == null ? "" : Math.round(x.lph * 100),
    ]);
    downloadText(`operators_${from}_${to}.csv`, toCsv([head, ...body]), "text/csv;charset=utf-8");
  };

  const headCell = (c: Col) => {
    const hp = colDrag.headProps(c);
    const k = COL_SORT[c];
    const cls = `${hp.className}${k ? " s" : ""}${COL_CENTER.has(c) ? " c" : ""}`;
    return (
      <th key={c} {...hp} className={cls} onClick={k ? () => toggleSort(k) : undefined} title={c === "spark" ? "Лиды за последние 7 рабочих смен — выходные не считаются. Перетащите, чтобы переставить столбец" : "Перетащите, чтобы переставить столбец"}>
        {c === "lph" ? <span title="Конверсия, лид/ч: факт ÷ часы, в процентах (0,6 лид/ч = 60%)">Конв.</span> : COL_LABEL[c]}
        {k && <span className="ar">{sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>}
      </th>
    );
  };
  const cell = (c: Col, x: PRow) => {
    const hue = pctHue(x.pct);
    switch (c) {
      case "status":
        return (
          <td key={c} data-col={c}>
            <StatusPill st={x.st} />
          </td>
        );
      case "group":
        return <td key={c} data-col={c} className="o2-muted">{x.op.role === "trainee" ? "Стажёр" : x.groupName}</td>;
      case "plan":
        return <td key={c} data-col={c} className="c">{x.plan > 0 ? fmtNum(x.plan, x.plan % 1 ? 1 : 0) : "—"}</td>;
      case "fact":
        return <td key={c} data-col={c} className="c" style={{ fontWeight: 600 }}>{fmtInt(x.fact)}</td>;
      case "pct":
        return (
          <td key={c} data-col={c}>
            {x.planToDate > 0 ? (
              <div className="o2-pct">
                <span className={`o2-${hue[0]}`}>{fmtPct(x.pct)}</span>
                <div className="t">
                  <b style={{ width: `${Math.min(100, x.pct * 100)}%`, background: hueVar(hue) }} />
                </div>
              </div>
            ) : (
              <div className="o2-pct">
                <span className="o2-muted">—</span>
                <div className="t" />
              </div>
            )}
          </td>
        );
      case "left":
        return <td key={c} data-col={c} className={`c${x.left > 0 ? " o2-r" : ""}`}>{x.plan > 0 ? fmtInt(x.left) : "—"}</td>;
      case "hours":
        return <td key={c} data-col={c} className="c">{x.hours > 0 ? fmtNum(x.hours) : "0"}</td>;
      case "lph":
        return (
          <td key={c} data-col={c} className="c" title={x.lph == null ? undefined : `${fmtInt(x.fact)} ${plural(x.fact, ["лид", "лида", "лидов"])} ÷ ${fmtNum(x.hours)} ч = ${fmtNum(x.lph, 2)} лид/ч`}>
            {x.lph == null ? <span className="o2-muted">—</span> : <span className={convNorm > 0 ? (x.lph >= convNorm ? "o2-g" : "o2-r") : undefined} style={{ fontWeight: 600 }}>{fmtPct(x.lph)}</span>}
          </td>
        );
      case "spark":
        return (
          <td key={c} data-col={c}>
            <Spark values={x.spark} days={x.sparkDays} open={x.sparkOpen} hue={x.st === "ahead" ? "green" : x.st === "ontrack" ? "amber" : x.st === "lagging" || x.st === "critical" ? "red" : "gray"} />
          </td>
        );
    }
  };

  return (
    <div className="stack" style={{ gap: 0 }}>
      {/* ── заголовок ─────────────────────────────────────────────── */}
      <div className="o2-head">
        <div>
          <h1 className="o2-title">Операторы</h1>
          <div className="o2-sub">
            {access.isHead ? "Команда" : access.scopeLabel}
            <i>·</i>
            {fmtMonth(month)}
            <i>·</i>к плану {mode === "day" && anchor === today ? "на сегодня" : "на дату"}
          </div>
        </div>
        <div className="o2-tools">
          <div className="o2-date">
            <button className="o2-ib" onClick={() => shift(-1)} aria-label="Назад">
              <Icon name="chevL" size={15} />
            </button>
            <span className="lbl">
              <Icon name="calendar" size={14} />
              {periodLabel}
            </span>
            <button className="o2-ib" onClick={() => shift(1)} aria-label="Вперёд">
              <Icon name="chevR" size={15} />
            </button>
          </div>
          <div className="o2-seg" role="group">
            {(["day", "week", "month"] as Mode[]).map((k) => (
              <button
                key={k}
                className={mode === k ? "on" : ""}
                onClick={() => {
                  setMode(k);
                  if (!(from <= today && today <= to)) return;
                  setAnchor(today);
                }}
              >
                {k === "day" ? "День" : k === "week" ? "Неделя" : "Месяц"}
              </button>
            ))}
          </div>
          {!(from <= today && today <= to) && (
            <button className="o2-btn" onClick={() => setAnchor(today)}>
              {mode === "day" ? "Сегодня" : mode === "week" ? "Эта неделя" : "Этот месяц"}
            </button>
          )}
          <button className="o2-btn" onClick={exportCsv} title={checked.size ? `Выгрузить отмеченных: ${checked.size}` : "Выгрузить список"}>
            <Icon name="download" size={14} />
            CSV{checked.size ? ` · ${checked.size}` : ""}
          </button>
          {access.can.manageOperators && (
            <button className="o2-btn pri" onClick={() => openOperator()}>
              <Icon name="plus" size={14} />
              Оператор
            </button>
          )}
        </div>
      </div>

      <div className="o2-body has-side">
        <div className="o2-main">
          {/* ── показатели ───────────────────────────────────────── */}
          <div className="card o2-kpis">
            <Kpi icon="users" label="Операторов" value={fmtInt(kpi.head)} delta={kpi.headDelta === 0 ? null : { text: `${kpi.headDelta > 0 ? "+" : "−"}${Math.abs(kpi.headDelta)}`, up: kpi.headDelta > 0, good: kpi.headDelta > 0 }} sub={vsLabel} />
            <Kpi icon="check" label="Выполняют план" value={fmtInt(kpi.meet)} line={kpi.meetOf ? fmtPct(kpi.meet / kpi.meetOf) : "—"} sub={`из ${kpi.meetOf} ${plural(kpi.meetOf, OPS)}`} />
            <Kpi icon="clock" label="Средние часы" value={kpi.avgH > 0 ? fmtNum(kpi.avgH) : "—"} delta={kpi.avgHDelta == null || Math.abs(kpi.avgHDelta) < 0.05 ? null : { text: `${kpi.avgHDelta > 0 ? "+" : "−"}${fmtNum(Math.abs(kpi.avgHDelta))}`, up: kpi.avgHDelta > 0, good: kpi.avgHDelta > 0 }} sub={kpi.avgH > 0 ? vsLabel : "смены не закрыты"} title="Средние часы за смену" />
            <Kpi icon="phone" label="Всего лидов" value={fmtInt(kpi.leads)} delta={kpi.leadsDelta == null ? null : { text: `${kpi.leadsDelta >= 0 ? "+" : "−"}${fmtPct(Math.abs(kpi.leadsDelta))}`, up: kpi.leadsDelta >= 0, good: kpi.leadsDelta >= 0 }} sub={vsLabel} />
            <Kpi icon="target" label="Конверсия" value={kpi.lph == null ? "—" : fmtPct(kpi.lph, 1)} delta={kpi.lphDelta == null || Math.abs(kpi.lphDelta) < 0.0005 ? null : { text: `${kpi.lphDelta >= 0 ? "+" : "−"}${fmtNum(Math.abs(kpi.lphDelta) * 100)} п.п.`, up: kpi.lphDelta >= 0, good: kpi.lphDelta >= 0 }} sub={kpi.lph == null ? "смен ещё нет" : vsLabel} title="Конверсия: факт ÷ часы, лид/ч в процентах" />
            <div className="o2-kpi crit" onClick={() => setStF(stF === "critical" ? "" : "critical")} title="Показать только сильно отстающих">
              <span className="ic">
                <Icon name="alert" size={18} />
              </span>
              <div className="o2-kpi-b">
                <div className="l">Критичные</div>
                <div className="v">{fmtInt(kpi.crit.length)}</div>
                <div className="d">{kpi.crit.length ? "требуют внимания" : "никого"}</div>
                <div className="s">{kpi.crit.length > 0 ? <>показать <Icon name="arrowR" size={12} /></> : "все в норме"}</div>
              </div>
            </div>
          </div>

          {/* ── баннер ───────────────────────────────────────────── */}
          {kpi.crit.length > 0 && !alertHidden && (
            <div className="o2-alert">
              <Icon name="alert" size={22} />
              <div style={{ minWidth: 0 }}>
                <div className="t">
                  {kpi.crit.length} {plural(kpi.crit.length, OPS)} сильно {kpi.crit.length === 1 ? "отстаёт" : "отстают"} от плана
                </div>
                <div className="x">
                  План {forLabel} выполнен менее чем на {s.lagPct}%: {kpi.crit.slice(0, 4).map((x) => shortName(x.op.name)).join(", ")}
                  {kpi.crit.length > 4 ? ` и ещё ${kpi.crit.length - 4}` : ""}.
                  <br />
                  Проверьте загрузку и проведите короткие 1:1.
                </div>
              </div>
              <button className="go" onClick={() => setStF(stF === "critical" ? "" : "critical")}>
                {stF === "critical" ? "Показать всех" : "Показать только проблемных"}
              </button>
              <button className="cl" onClick={() => setAlertHidden(true)} aria-label="Скрыть">
                <Icon name="close" size={16} />
              </button>
            </div>
          )}

          {/* ── фильтры ──────────────────────────────────────────── */}
          <div className="card o2-filters">
            <label className="o2-search">
              <Icon name="search" size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени, контакту или группе…" />
            </label>
            {groups.length > 0 && (
              <Select
                value={group}
                onChange={setGroup}
                width={150}
                ariaLabel="Группа"
                options={[{ value: "", label: "Все группы" }, ...groups.map<Opt>((g) => ({ value: g.id, label: g.name, icon: dot(g.color) })), { value: NO_GROUP, label: NO_GROUP_LABEL }]}
              />
            )}
            <Select
              value={stF}
              onChange={(v) => setStF(v as "" | StKey)}
              width={150}
              ariaLabel="Статус"
              options={[{ value: "", label: "Статус: все" }, ...(Object.keys(ST) as StKey[]).filter((k) => k !== "fired").map<Opt>((k) => ({ value: k, label: ST[k].label, icon: dot(ST[k].hue) }))]}
            />
            <Select
              value={perfF}
              onChange={setPerfF}
              width={180}
              ariaLabel="Выполнение плана"
              options={[{ value: "", label: "Выполнение плана" }, ...PERF.map<Opt>((p) => ({ value: p.value, label: p.label }))]}
            />
            <Select
              value={shiftF}
              onChange={(v) => setShiftF(v as "" | "on" | "off")}
              width={120}
              ariaLabel="Смена сегодня"
              options={[
                { value: "", label: "Смена" },
                { value: "on", label: "На смене сегодня" },
                { value: "off", label: "Без смены сегодня" },
              ]}
            />
            <Popover
              button={(open, toggle, ref) => (
                <button ref={ref} className="o2-btn" onClick={toggle} aria-expanded={open}>
                  <Icon name="funnel" size={14} />
                  Ещё фильтры
                </button>
              )}
            >
              <div className="tt">Сотрудники</div>
              <label>
                <input type="checkbox" className="o2-cb" checked={showPaused} onChange={(e) => setShowPaused(e.target.checked)} />
                Показывать на паузе
              </label>
              <label>
                <input type="checkbox" className="o2-cb" checked={showFired} onChange={(e) => setShowFired(e.target.checked)} />
                Показывать уволенных
              </label>
              <label>
                <input type="checkbox" className="o2-cb" checked={onlyTrainees} onChange={(e) => setOnlyTrainees(e.target.checked)} />
                Только стажёры
              </label>
              {activeFilters > 0 && (
                <>
                  <div className="sep" />
                  <button
                    className="it"
                    onClick={() => {
                      setGroup("");
                      setStF("");
                      setPerfF("");
                      setShiftF("");
                      setShowPaused(true);
                      setShowFired(false);
                      setOnlyTrainees(false);
                    }}
                  >
                    <Icon name="close" size={13} />
                    Сбросить все фильтры
                  </button>
                </>
              )}
            </Popover>
            {activeFilters > 0 && <span className="o2-badge" title="Включено фильтров">{activeFilters}</span>}
            <span className="o2-found">Найдено: {list.length}</span>
            <Popover
              align="right"
              button={(open, toggle, ref) => (
                <button ref={ref} className="o2-ib" onClick={toggle} aria-expanded={open} title="Столбцы">
                  <Icon name="dashboard" size={15} />
                </button>
              )}
            >
              <div className="tt">Столбцы</div>
              {COLS.map((k) => (
                <label key={k}>
                  <input type="checkbox" className="o2-cb" checked={vis.shown.has(k)} onChange={() => vis.toggle(k)} />
                  {COL_LABEL[k]}
                </label>
              ))}
              <div className="sep" />
              <div className="tt">Порядок — перетащите заголовок столбца</div>
              {vis.custom && (
                <button className="it" onClick={vis.reset}>
                  <Icon name="check" size={13} /> Показать все
                </button>
              )}
              {colOrder.custom && (
                <button className="it" onClick={colOrder.reset}>
                  <Icon name="refresh" size={13} /> Вернуть порядок столбцов
                </button>
              )}
            </Popover>
          </div>

          {/* ── таблица ──────────────────────────────────────────── */}
          <div className="card o2-card">
            {list.length === 0 ? (
              <div style={{ padding: 28, textAlign: "center", color: "var(--dim)", fontSize: 13 }}>Никого не нашли — поменяйте фильтры.</div>
            ) : (
              <div className="o2-scroll" ref={wrapRef}>
                <table className="o2-tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <input
                          type="checkbox"
                          className="o2-cb"
                          checked={allChecked}
                          // отмечены не все — черта вместо галочки
                          ref={(el) => {
                            if (el) el.indeterminate = !allChecked && list.some((x) => checked.has(x.op.id));
                          }}
                          onChange={() => setChecked(allChecked ? new Set() : new Set(list.map((x) => x.op.id)))}
                          aria-label="Отметить всех"
                        />
                      </th>
                      <th className="s" onClick={() => toggleSort("name")}>
                        Оператор
                        <span className="ar">{sort.key === "name" ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>
                      </th>
                      {shown.map(headCell)}
                      <th style={{ width: 40 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((x) => {
                      return (
                        <tr key={x.op.id} className={sel?.op.id === x.op.id ? "sel" : undefined} onClick={() => setSelId(sel?.op.id === x.op.id ? null : x.op.id)}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="o2-cb"
                              checked={checked.has(x.op.id)}
                              onChange={() =>
                                setChecked((p) => {
                                  const n = new Set(p);
                                  if (n.has(x.op.id)) n.delete(x.op.id);
                                  else n.add(x.op.id);
                                  return n;
                                })
                              }
                              aria-label={`Отметить ${x.op.name}`}
                            />
                          </td>
                          <td>
                            <span className="row" style={{ gap: 10 }}>
                              <Avatar name={x.op.name} id={x.op.id} size={26} />
                              <span>{shortName(x.op.name)}</span>
                            </span>
                          </td>
                          {shown.map((c) => cell(c, x))}
                          <td onClick={(e) => e.stopPropagation()}>
                            <Popover
                              align="right"
                              button={(open, toggle, ref) => (
                                <button ref={ref} className="o2-kebab" onClick={toggle} aria-expanded={open} aria-label="Действия">
                                  <Icon name="list" size={15} />
                                </button>
                              )}
                            >
                              {(close) => (
                                <>
                                  <button className="it" onClick={() => { close(); setDrawerId(x.op.id); }}>
                                    <Icon name="user" size={14} /> Открыть карточку
                                  </button>
                                  {canManageOperator(access, x.op) && (
                                    <button className="it" onClick={() => { close(); openOperator(ix.opById.get(x.op.id) ?? x.op); }}>
                                      <Icon name="edit" size={14} /> Изменить данные
                                    </button>
                                  )}
                                  <button className="it" onClick={() => { close(); router.push("/schedule"); }}>
                                    <Icon name="calendar" size={14} /> График смен
                                  </button>
                                  <button className="it" onClick={() => { close(); router.push("/leads"); }}>
                                    <Icon name="leads" size={14} /> Лиды
                                  </button>
                                </>
                              )}
                            </Popover>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* панель закреплена: пока никто не выбран — заглушка */}
        {sel ? (
          <Side key={sel.op.id} x={sel} mode={mode} forLabel={forLabel} onClose={() => setSelId(null)} onOpenCard={() => setDrawerId(sel.op.id)} insight={ins.byOp.get(sel.op.id)} />
        ) : (
          <SideEmpty />
        )}
      </div>

      {drawerRow && <OperatorDrawer row={drawerRow} onClose={() => setDrawerId(null)} />}
    </div>
  );
}

/* ── мелкие части ───────────────────────────────────────────────────── */

function Kpi({ icon, label, value, delta, line, sub, title }: { icon: IconName; label: string; value: string; delta?: { text: string; up: boolean; good: boolean } | null; line?: string; sub: string; title?: string }) {
  return (
    <div className="o2-kpi" title={title}>
      <span className="ic">
        <Icon name={icon} size={18} />
      </span>
      <div className="o2-kpi-b">
        <div className="l">{label}</div>
        <div className="v">{value}</div>
        {delta ? (
          <div className={`d ${delta.good ? "o2-up" : "o2-down"}`}>
            {delta.up ? "▲" : "▼"} {delta.text}
          </div>
        ) : line ? (
          <div className="d" style={{ color: "var(--text)" }}>
            {line}
          </div>
        ) : (
          <div className="d o2-muted">—</div>
        )}
        <div className="s">{sub}</div>
      </div>
    </div>
  );
}

function StatusPill({ st }: { st: StKey }) {
  const v = ST[st];
  return (
    <span className="o2-st" data-hue={v.hue}>
      <span className="ic">
        <Icon name={v.icon} size={9} stroke={3} />
      </span>
      {v.label}
    </span>
  );
}

/** Лиды по последним рабочим сменам; идущая сегодня смена — полым кружком. Смен не было — пунктир. */
function Spark({ values, days, open, hue }: { values: number[]; days: DayKey[]; open?: boolean; hue: string }) {
  const W = 72;
  const H = 22;
  if (!values.length)
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <title>Смен не было</title>
        <line x1={3} x2={W - 3} y1={H - 4} y2={H - 4} stroke="var(--ink-15)" strokeDasharray="2 3" />
      </svg>
    );
  const max = Math.max(...values, 1);
  // меньше 7 смен — точки прижаты вправо, шаг тот же
  const step = (W - 6) / 6;
  const x0 = W - 3 - step * (values.length - 1);
  const pts = values.map((v, i) => [x0 + i * step, H - 4 - (v / max) * (H - 8)] as const);
  const c = hue === "gray" ? "var(--dim)" : hueVar(hue);
  const tip = days.map((d, i) => `${dShort(d)}, ${DOW[isoWeekday(d) - 1]}: ${values[i]}${open && i === days.length - 1 ? " — смена идёт" : ""}`).join("\n");
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <title>{`Лиды за последние ${values.length} ${plural(values.length, ["смену", "смены", "смен"])} (без выходных)\n${tip}`}</title>
      {pts.length > 1 && <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={c} strokeWidth="1.3" />}
      {pts.map((p, i) =>
        open && i === pts.length - 1 ? (
          <circle key={i} cx={p[0]} cy={p[1]} r="2" fill="var(--bg-panel)" stroke={c} strokeWidth="1.2" />
        ) : (
          <circle key={i} cx={p[0]} cy={p[1]} r="1.6" fill={c} />
        ),
      )}
    </svg>
  );
}

/** Кнопка с выпадающим меню в стиле приложения (позиционирование — usePopover из select). */
export function Popover({
  button,
  children,
  align = "left",
}: {
  button: (open: boolean, toggle: () => void, ref: React.RefObject<HTMLButtonElement>) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  const { style } = usePopover(open, ref, pop, close);
  return (
    <>
      {button(open, () => setOpen((v) => !v), ref)}
      {open && (
        <Layer>
          <div ref={pop} className="o2-pop" style={{ ...style, ...(align === "right" ? { minWidth: 200 } : null) }}>
            {typeof children === "function" ? children(close) : children}
          </div>
        </Layer>
      )}
    </>
  );
}

/* ── карточка справа ────────────────────────────────────────────────── */

function SideEmpty() {
  return (
    <aside className="card o2-side o2-side-empty">
      <div className="o2-empty">
        <span className="ic">
          <Icon name="user" size={22} />
        </span>
        <b>Выберите оператора</b>
        <span>Нажмите на строку в таблице — здесь появятся план, смены, продуктивность и заметки.</span>
      </div>
      {["План", "График смен", "Продуктивность (7 дней)", "Последние заметки"].map((t) => (
        <div key={t} className="o2-box o2-ghost">
          <b>{t}</b>
          <i style={{ width: "72%" }} />
          <i style={{ width: "48%" }} />
        </div>
      ))}
    </aside>
  );
}

function Side({ x, mode, forLabel, onClose, onOpenCard, insight }: { x: PRow; mode: Mode; forLabel: string; onClose: () => void; onOpenCard: () => void; insight?: ReturnType<typeof useInsights>["byOp"] extends Map<string, infer V> ? V : never }) {
  const { ix, today, data } = useCrm();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [metric, setMetric] = useState<"leads" | "hours" | "conv">("leads");
  const notes = useOpNotes(x.op.id);
  const op = x.op;
  const r = x.r;
  const g = op.groupId ? ix.groupById.get(op.groupId) : null;
  const ts = x.todayShift;
  const leadsToday = ix.opDay.get(op.id)?.get(today) ?? 0;
  const now = worked(ts) ? { hue: leadsToday > 0 ? "green" : "red", label: `На смене (${leadsToday} ${plural(leadsToday, ["лид", "лида", "лидов"])})` } : ts ? { hue: "gray", label: DAY_LABEL[ts.type][0].toUpperCase() + DAY_LABEL[ts.type].slice(1) } : { hue: "amber", label: "Без смены" };
  // последние дни со сменами (по сегодня)
  const shifts = useMemo(() => {
    const out: { d: DayKey; s: Shift }[] = [];
    for (let i = 0; i < 45 && out.length < 5; i++) {
      const d = addDays(today, -i);
      const s = ix.shift.get(`${d}|${op.id}`);
      if (s) out.push({ d, s });
    }
    return out;
  }, [ix, op.id, today]);

  const week = rangeDays(addDays(today, -6), today);
  const bars = week.map((d) => {
    const leads = ix.opDay.get(op.id)?.get(d) ?? 0;
    const h = ix.hoursOpDay.get(op.id)?.get(d) ?? 0;
    // не рабочий день — не «0», а отметка: выходной, отпуск, больничный или смены не было
    const sh = ix.shift.get(`${d}|${op.id}`);
    const workedDay = (ix.plannedOpDay.get(op.id)?.get(d) ?? 0) > 0 || leads > 0;
    const calOff = !isWorkday(d, data.settings);
    const mark = workedDay ? null : sh ? DAY_MARK[sh.type] ?? "вых" : calOff ? "вых" : "—";
    return { d, v: metric === "leads" ? leads : metric === "hours" ? h : h > 0 ? leads / h : 0, mark, why: sh ? DAY_LABEL[sh.type] : calOff ? "выходной" : "смены не было" };
  });
  const bMax = Math.max(...bars.map((b) => b.v), metric === "conv" ? 1 : 1);

  const needDay = mode === "month" ? r.pace.needPerDay : x.left;
  const rec = insight?.signals[0];
  const recHue = rec ? (rec.hue === "red" ? "red" : rec.hue === "amber" ? "amber" : "green") : x.left > 0 && x.planToDate > 0 && x.pct < 0.8 ? "amber" : "green";
  const recText = rec
    ? `${rec.title}. ${rec.todo}`
    : x.plan <= 0
      ? "План не задан — задайте личный план, чтобы считать темп."
      : x.left > 0
        ? `Осталось ${fmtInt(x.left)} ${plural(x.left, ["лид", "лида", "лидов"])} до плана ${forLabel}.${x.lph != null ? ` Текущая конверсия — ${fmtPct(x.lph)}.` : ""}${x.pct >= 0.8 ? " Всё в пределах нормы." : " Темп ниже нормы — стоит обсудить загрузку."}`
        : "План выполнен — держим темп.";

  return (
    <aside className="card o2-side">
      <div className="o2-side-h">
        <Avatar name={op.name} id={op.id} size={52} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="o2-nm-row">
            <button className="nm" onClick={onOpenCard} title="Открыть полную карточку оператора">
              {op.name}
            </button>
            <button className="o2-card-btn" onClick={onOpenCard} title="Полная карточка оператора: зарплата, план, история, лиды">
              <Icon name="user" size={12} />
              Карточка
              <Icon name="external" size={11} />
            </button>
          </div>
          <div className="gr">
            {g ? g.name : NO_GROUP_LABEL} · {ROLE_LABEL[op.role]}
            {op.employment && op.employment !== "none" ? ` · ${EMPLOYMENT_LABEL[op.employment]}` : ""}
          </div>
          <span className="o2-st" data-hue={now.hue} style={{ marginTop: 8 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
            {now.label}
          </span>
        </div>
        <button className="x" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="o2-tabs">
        {(
          [
            ["overview", "Обзор"],
            ["shifts", "Смены"],
            ["plan", "План"],
            ["notes", "Заметки"],
          ] as [Tab, string][]
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div className="o2-box">
            <div className="o2-box-h">
              <b><Icon name="target" size={13} className="mi" />План {forLabel}</b>
              <button className="o2-link" onClick={() => setTab("plan")}>
                Смотреть план <Icon name="arrowR" size={12} />
              </button>
            </div>
            <div className="o2-big">
              <div className="n">
                {fmtInt(x.fact)} <small>/ {x.plan > 0 ? fmtInt(Math.round(x.plan)) : "—"}</small>
                <em>лидов</em>
              </div>
              <div className="t">
                <b style={{ width: `${x.plan > 0 ? Math.min(100, (x.fact / x.plan) * 100) : 0}%`, background: hueVar(pctHue(x.pct)) }} />
              </div>
            </div>
            <div className="o2-mini">
              <div>
                <b>{x.plan > 0 ? fmtInt(x.left) : "—"}</b>
                <span>осталось</span>
              </div>
              <div>
                <b>{needDay == null ? "—" : fmtNum(needDay)}</b>
                <span>нужно в день</span>
              </div>
              <div>
                <b>{fmtNum(x.hours)} ч</b>
                <span>отработано</span>
              </div>
              <div>
                <b>{x.lph == null ? "—" : fmtPct(x.lph)}</b>
                <span>конверсия</span>
              </div>
            </div>
          </div>

          <div className="o2-box">
            <div className="o2-box-h">
              <b><Icon name="calendar" size={13} className="mi" />График смен</b>
              <button className="o2-link" onClick={() => router.push("/schedule")}>
                Все смены <Icon name="arrowR" size={12} />
              </button>
            </div>
            <ShiftList shifts={shifts} opId={op.id} />
          </div>

          <div className="o2-box">
            <div className="o2-box-h">
              <b><Icon name="chart" size={13} className="mi" />Продуктивность (7 дней)</b>
              <Select
                size="sm"
                width={110}
                value={metric}
                onChange={(v) => setMetric(v as "leads" | "hours" | "conv")}
                ariaLabel="Показатель"
                options={[
                  { value: "leads", label: "Лиды" },
                  { value: "hours", label: "Часы" },
                  { value: "conv", label: "Конверсия" },
                ]}
              />
            </div>
            <svg viewBox="0 0 330 120" width="100%" style={{ display: "block" }}>
              {bars.map((b, i) => {
                const cw = 330 / 7;
                const cx = cw * i + cw / 2;
                const h = (b.v / bMax) * 70;
                const td = b.d === today;
                const txt = metric === "conv" ? (b.v > 0 ? fmtPct(b.v) : "—") : metric === "hours" ? fmtNum(b.v) : String(b.v);
                return (
                  <g key={b.d}>
                    <title>{b.mark ? `${dShort(b.d)}: ${b.why}` : `${dShort(b.d)}: ${txt}`}</title>
                    {b.mark ? (
                      <>
                        <rect x={cx - 7} y={83} width={14} height={3} rx={1.5} fill="var(--ink-15)" />
                        <text x={cx} y={77} textAnchor="middle" fontSize="9.5" fill="var(--dim)">
                          {b.mark}
                        </text>
                      </>
                    ) : (
                      <>
                        <rect x={cx - 13} y={86 - Math.max(h, 1)} width={26} height={Math.max(h, 1)} rx={2} fill={td ? "var(--c-green-fg)" : "var(--ink-10)"} />
                        <text x={cx} y={80 - h} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--text)">
                          {txt}
                        </text>
                      </>
                    )}
                    <text x={cx} y={100} textAnchor="middle" fontSize="9.5" fill="var(--text-sub)">
                      {DOW_CAP[isoWeekday(b.d) - 1]}
                    </text>
                    <text x={cx} y={112} textAnchor="middle" fontSize="9" fill={td ? "var(--text)" : "var(--dim)"} fontWeight={td ? 700 : 400}>
                      {dShort(b.d)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div className="o2-box">
            <div className="o2-box-h">
              <b><Icon name="note" size={13} className="mi" />Последние заметки</b>
              <button className="o2-link" style={{ textDecoration: "none" }} onClick={() => setTab("notes")}>
                <Icon name="plus" size={12} /> Добавить
              </button>
            </div>
            {notes.length === 0 ? (
              <div style={{ fontSize: 12, color: "var(--dim)" }}>Заметок пока нет.</div>
            ) : (
              notes.slice(0, 2).map((n) => (
                <div key={n.id} className="o2-note">
                  <Avatar name={n.authorName || "?"} id={n.authorId || n.id} size={28} />
                  <div>{n.text}</div>
                  <div className="when">{dShort(n.date)}</div>
                </div>
              ))
            )}
          </div>

          <div className="o2-rec" data-hue={recHue}>
            <Icon name="bulb" size={18} />
            <div>
              <b>Рекомендации</b>
              <div>{recText}</div>
            </div>
            <button className="o2-kebab" onClick={onOpenCard} aria-label="Подробнее">
              <Icon name="arrowR" size={15} />
            </button>
          </div>
        </>
      )}

      {tab === "shifts" && (
        <div className="o2-box">
          <div className="o2-box-h">
            <b><Icon name="calendar" size={13} className="mi" />Смены за 2 недели</b>
            <button className="o2-link" onClick={() => router.push("/schedule")}>
              Открыть график <Icon name="arrowR" size={12} />
            </button>
          </div>
          <ShiftList
            shifts={rangeDays(addDays(today, -13), today)
              .reverse()
              .map((d) => ({ d, s: ix.shift.get(`${d}|${op.id}`) }))
              .filter((v): v is { d: DayKey; s: Shift } => !!v.s)}
            opId={op.id}
          />
        </div>
      )}

      {tab === "plan" && (
        <div className="o2-box">
          <div className="o2-box-h">
            <b><Icon name="target" size={13} className="mi" />План на месяц</b>
          </div>
          <div className="o2-kv">
            <span>Личный план</span>
            <b>{r.terms.plan > 0 ? `${fmtInt(r.terms.plan)} лидов` : "не задан"}</b>
            <span>Факт за месяц</span>
            <b>{fmtInt(r.pace.fact)}</b>
            <span>Должно быть к сегодня</span>
            <b>{fmtNum(r.pace.planToDate)}</b>
            <span>Выполнение к дате</span>
            <b className={`o2-${pctHue(r.pace.paceRatio)[0]}`}>{r.pace.planToDate > 0 ? fmtPct(r.pace.paceRatio) : "—"}</b>
            <span>Дневной план</span>
            <b>{fmtNum(r.pace.dailyPlan)}</b>
            <span>Нужно в день до конца</span>
            <b>{r.pace.needPerDay == null ? "—" : fmtNum(r.pace.needPerDay)}</b>
            <span>Прогноз по темпу</span>
            <b>
              {fmtInt(r.pace.rr)} ({fmtPct(r.pace.rrPct)})
            </b>
            <span>Часы / норма к дате</span>
            <b>
              {fmtNum(r.hours)} / {fmtNum(r.normToDate)}
            </b>
          </div>
        </div>
      )}

      {tab === "notes" && <OperatorNotes opId={op.id} />}
    </aside>
  );
}

/** Смены по дням; справа — конверсия дня (лиды ÷ часы), цвет — относительно нормы из настроек. */
/**
 * Смены по дням: дата | часы | конверсия дня (лиды ÷ часы) | тип дня. Колонки фиксированной
 * ширины — значения стоят ровными столбцами. Цвет конверсии — относительно нормы из настроек.
 */
function ShiftList({ shifts, opId }: { shifts: { d: DayKey; s: Shift }[]; opId: string }) {
  const { ix, today, data } = useCrm();
  const norm = data.settings.convNormPct / 100;
  if (!shifts.length) return <div style={{ fontSize: 12, color: "var(--dim)" }}>Смен в графике нет.</div>;
  const yesterday = addDays(today, -1);
  return (
    <div className="o2-shifts">
      {shifts.map(({ d, s }) => {
        const leads = ix.opDay.get(opId)?.get(d) ?? 0;
        const w = worked(s);
        const h = s.hours;
        const conv = w && h > 0 ? leads / h : null;
        const hue = conv == null ? "gray" : norm > 0 ? (conv >= norm ? "green" : conv >= norm * 0.8 ? "amber" : "red") : "gray";
        const pill =
          d === today && w && d > ix.workedTo
            ? { hue: "amber", t: "Сейчас", tip: `Смена идёт: ${leads} ${plural(leads, ["лид", "лида", "лидов"])}` }
            : conv != null
              ? { hue, t: fmtPct(conv), tip: `Конверсия: ${leads} ${plural(leads, ["лид", "лида", "лидов"])} за ${fmtNum(h)} ч${norm > 0 ? ` · норма ${fmtPct(norm)}` : ""}` }
              : { hue: "gray", t: "—", tip: w ? "Часы не закрыты" : "" };
        return (
          <div key={d} className="o2-shift">
            <span className="dt">
              <b>{dShort(d)}</b>
              <em className={d === today || d === yesterday ? "rel" : undefined}>{d === today ? "сегодня" : d === yesterday ? "вчера" : DOW[isoWeekday(d) - 1]}</em>
            </span>
            <span className="hr">{s.hours > 0 ? `${fmtNum(s.hours)} ч` : ""}</span>
            <span className="o2-pill" data-hue={pill.hue} title={pill.tip || undefined}>
              {pill.t}
            </span>
            <span className="w" title={s.comment || undefined}>
              <i style={{ background: hueVar(DAY_HUE[s.type]) }} />
              {DAY_LABEL[s.type]}
              {s.comment && <Icon name="note" size={11} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}
