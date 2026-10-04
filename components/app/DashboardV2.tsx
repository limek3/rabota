"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel, usePeriodModel } from "@/lib/crm/hooks";
import { dailyRows, pace, sumRange, workedDays, WORKED_TYPES, type DayRow, type GroupRow, type Index, type MonthCal, type MonthModel, type OpRow, type Pace } from "@/lib/crm/calc";
import { addDays, fmtDay, fmtMonth, fmtRange, isoWeekday, isWorkday, monthOf, monthStart, nowHour, rangeDays, weekEnd, weekStart } from "@/lib/crm/dates";
import { DAYS, fmtInt, fmtNum, fmtPct, fmtSigned, LEADS, OPS, plural, safeDiv, shortName } from "@/lib/crm/format";
import { NO_GROUP, NO_GROUP_LABEL, type DayKey, type DayType, type Settings } from "@/lib/crm/types";
import { Avatar, Collapse, Conv, MonthSwitcher, PageHead, StatusChip, foldRow, useConvNorm, useFoldGroups } from "@/components/ui/kit";
import { Icon, type IconName } from "@/components/ui/icons";
import { dot, Select, uiZoom, type Opt } from "@/components/ui/select";
import { ColumnPicker, useColumnDrag, useColumnOrder, useColumnVisibility } from "@/components/ui/ColumnOrder";
import { Onboarding } from "@/components/app/DashboardClassic";
import { StickyHead } from "@/components/app/StickyHead";
import { buildInsights, LAG_HINT, LAG_LABEL } from "@/lib/crm/insights";

/**
 * «Сводка» v2: один вывод вместо россыпи плиток, список действий наверху,
 * разрыв с планом вместо накопительного итога, таблица операторов и тепловая карта.
 * Прежняя версия — DashboardClassic, переключатель — в app/(crm)/dashboard/page.tsx.
 */

const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dow = (d: DayKey) => DOW[isoWeekday(d) - 1];
const dayNum = (d: DayKey) => Number(d.slice(8));
const MON_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function names(list: OpRow[], max = 3): string {
  const n = list.map((r) => r.op.name.trim().split(/\s+/)[0]);
  return n.length > max ? `${n.slice(0, max).join(", ")} +${n.length - max}` : n.join(", ");
}

/**
 * Общая рамка графиков «Разрыв» и «Неделя»: одна высота, одни поля и ровно `parts` делений
 * сетки — линии обеих карточек в ряду совпадают по высоте до пикселя.
 */
const CH = { H: 236, L: 34, R: 8, T: 24, B: 36, parts: 4 };

/** 1px-линия ровно по пикселю, без размытия на два ряда. */
const crisp = (v: number) => Math.round(v) + 0.5;

/**
 * Плавность графиков: у <text> и <line> координаты — атрибуты, браузер их не анимирует.
 * Подписи ставим через transform, линии и ломаные рисуем путями (d) — при смене периода
 * или группы они перетекают в новое положение (переходы — в dash2.css, .d2-plot).
 */
const tr = (x: number, y: number): CSSProperties => ({ transform: `translate(${x}px, ${y}px)` });
const ptsD = (pts: string, close = false) => (pts ? `M${pts.trim().split(/\s+/).join("L")}${close ? "Z" : ""}` : "");

/** Наименьший «круглый» шаг оси не меньше `min`: 1 · 1.5 · 2 · 2.5 · 3 · 4 · 5 · 7.5 × 10ⁿ, только целые. */
const AXIS_K = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5];
function axisStep(min: number): number {
  let p = 10 ** Math.floor(Math.log10(Math.max(min, 1e-6)));
  for (;;) {
    for (const k of AXIS_K) {
      const s = Math.round(k * p * 1e6) / 1e6;
      if (Number.isInteger(s) && s >= min - 1e-9) return s;
    }
    p *= 10;
  }
}

/** Ось с нулём на линии сетки: ровно CH.parts делений, свободные — запасом над нулём и в сторону данных. */
function zeroScale(lo: number, hi: number): { min: number; max: number; step: number } {
  const P = CH.parts;
  let s = axisStep((hi - lo) / P);
  for (;;) {
    let up = hi > 1e-9 ? Math.ceil(hi / s - 1e-9) : 0;
    let dn = lo < -1e-9 ? Math.ceil(-lo / s - 1e-9) : 0;
    if (up + dn <= P) {
      let spare = P - up - dn;
      if (spare && up === 0) {
        up++;
        spare--;
      }
      if (-lo >= hi) dn += spare;
      else up += spare;
      return { min: -dn * s, max: up * s, step: s };
    }
    s = axisStep(s * 1.001);
  }
}

/** Плашка-подпись на графике; ширину считаем по числу символов (Inter 10px ≈ 5.6px на знак с запасом). */
function Pill({ x, cy, text, color, anchor }: { x: number; cy: number; text: string; color: string; anchor: "start" | "end" | "middle" }) {
  const w = Math.round(text.length * 5.6 + 14);
  const x0 = Math.round(anchor === "end" ? x - w : anchor === "middle" ? x - w / 2 : x);
  const top = Math.round(cy - 8);
  return (
    <g>
      <rect x={x0 + 0.5} y={top + 0.5} width={w} height={16} rx={8} fill="var(--bg-panel)" stroke={color} strokeOpacity={0.45} />
      <text style={tr(x0 + w / 2 + 0.5, top + 12)} textAnchor="middle" fontSize="10" fontWeight="600" fill={color}>
        {text}
      </text>
    </g>
  );
}

/** Подсказка дня при наведении — внутри области графика, справа от столбца или слева у края. */
function ChartTip({ x, W, half = 6, children }: { x: number; W: number; half?: number; children: ReactNode }) {
  const TW = 188;
  const right = x + half + 8;
  const left = right + TW <= W ? right : x - half - 8 - TW;
  return (
    <div className="d2-ctip" role="status" style={{ left: Math.max(0, Math.round(left)), top: CH.T, width: TW }}>
      {children}
    </div>
  );
}
const useIsoLayout = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Ширина контейнера графика в px: SVG рисуется 1:1 с экраном, без растягивания viewBox —
 * тогда подписи в обеих карточках одного размера, а высота не зависит от ширины колонки.
 */
function useChartWidth(fallback = 600) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(fallback);
  useIsoLayout(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => {
      const v = Math.round(el.clientWidth);
      if (v > 0) setW((o) => (o === v ? o : v));
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Столбик со скруглённым верхом. */
function barPath(x: number, y: number, w: number, h: number, r = 3): string {
  if (h <= 0) return "";
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

const isWorked = (t?: DayType, h = 0) => !!t && WORKED_TYPES.has(t) && h > 0;

/**
 * Область сводки: весь отдел или набор групп. РОП выбирает в списке; супервайзер и
 * наставник видят только свои группы — даже если доступ «весь отдел» открыт в настройках.
 */
interface Scope {
  plan: number;
  p: Pace;
  counts: Map<DayKey, number> | undefined;
  hoursMap: Map<DayKey, number> | undefined;
  hours: number;
  lph: number | null;
  headcount: number;
  attendance: number;
  line: OpRow[];
  groups: GroupRow[];
}

function mergeDays(maps: (Map<DayKey, number> | undefined)[]): Map<DayKey, number> {
  const out = new Map<DayKey, number>();
  for (const m of maps) if (m) for (const [d, v] of m) out.set(d, (out.get(d) ?? 0) + v);
  return out;
}

/** Показатели области по модели (месяц, неделя или день): весь отдел (keys = null) или выбранные группы. */
function buildScope(m: MonthModel, keys: string[] | null, ix: Index, s: Settings): Scope {
  const cal = m.cal;
  // операторы на линии: без супервайзеров и удалённых; уволенные — если работали в периоде:
  // их лиды и часы уже в факте и конверсии команды, иначе строки не сходятся с «Итого»
  const allLine = m.ops.filter((r) => !r.op.deletedAt && !ix.svIds.has(r.op.id) && (r.status !== "fired" || r.pace.fact > 0 || r.hours > 0));
  if (!keys) {
    const t = m.team;
    return {
      plan: t.plan,
      p: t.pace,
      counts: ix.day,
      hoursMap: ix.hoursDay,
      hours: t.hours,
      lph: t.lph,
      headcount: t.headcount,
      attendance: safeDiv(t.opDays, t.pace.elapsedW),
      line: allLine,
      groups: m.groups,
    };
  }
  const set = new Set(keys);
  const groups = m.groups.filter((g) => set.has(g.key));
  const plan = groups.reduce((a, g) => a + g.plan, 0);
  const counts = mergeDays(keys.map((k) => ix.groupDay.get(k)));
  const hoursMap = mergeDays(keys.map((k) => ix.hoursGroupDay.get(k)));
  const p = pace(cal, plan, counts, s);
  const first = cal.days[0];
  const last = cal.days[cal.days.length - 1];
  const factTo = cal.ref < last ? cal.ref : last;
  const closedTo = factTo < ix.workedTo ? factTo : ix.workedTo;
  const hours = sumRange(hoursMap, first, factTo);
  const line = allLine.filter((r) => set.has(r.groupKey));
  const opDays = line.reduce((a, r) => a + (r.hasShifts ? r.daysWorked : r.pace.fact > 0 ? r.pace.elapsedW : 0), 0);
  return {
    plan,
    p,
    counts,
    hoursMap,
    hours,
    lph: hours > 0 ? sumRange(counts, first, closedTo) / hours : null,
    headcount: line.filter((r) => r.op.status === "active").length,
    attendance: safeDiv(opDays, p.elapsedW),
    line,
    groups,
  };
}

const SCOPE_KEY = "leadup.dashboard.scope";

/** Период сводки: день, неделя (пн–вс) или месяц — как в «Лидах». */
/** range — произвольный период (карточка оператора). */
export type Span = "day" | "week" | "month" | "range";
/** Слова периода: «за месяц», «к концу недели», «Месяц закрыт». */
const SPAN_W: Record<Span, { acc: string; gen: string; closed: string; notYet: string }> = {
  day: { acc: "день", gen: "дня", closed: "День закрыт", notYet: "День ещё не начался" },
  week: { acc: "неделю", gen: "недели", closed: "Неделя закрыта", notYet: "Неделя ещё не началась" },
  month: { acc: "месяц", gen: "месяца", closed: "Месяц закрыт", notYet: "Месяц ещё не начался" },
  range: { acc: "период", gen: "периода", closed: "Период закрыт", notYet: "Период ещё не начался" },
};
const dayShort = (d: DayKey) => `${dayNum(d)} ${MON_SHORT[Number(d.slice(5, 7)) - 1]}`;

export function DashboardV2() {
  const { data, ix, month, setMonth, today, access } = useCrm();
  const s = data.settings;
  const mm = useMonthModel();

  // период: месяц — общий для приложения (переключатель месяцев), день и неделя — свои, от опорного дня
  const [span, setSpan] = useState<Span>("month");
  const [anchor, setAnchor] = useState<DayKey>(today);
  const week = useMemo(() => ({ from: weekStart(anchor), to: weekEnd(anchor) }), [anchor]);
  const pm = usePeriodModel(span === "day" ? { from: anchor, to: anchor } : span === "week" ? week : null);
  // в режиме «день» график недели и тепловая карта показывают его неделю
  const wm = usePeriodModel(span === "day" ? week : null);
  const m = pm ?? mm;
  const cal = m.cal;

  const setMode = (k: Span) => {
    if (k === span) return;
    if (k === "month") setMonth(monthOf(anchor));
    else if (span === "month") setAnchor(monthOf(today) === month ? today : monthStart(month));
    setSpan(k);
  };
  const shift = (dir: 1 | -1) => setAnchor((a) => addDays(a, span === "day" ? dir : 7 * dir));
  const spanLabel = span === "day" ? `${anchor === today ? "Сегодня" : dow(anchor)}, ${dayShort(anchor)}` : `${dayShort(week.from)} – ${dayShort(week.to)}`;

  // какие группы можно выбрать: РОП — все, остальные — только свои
  const own = access.isHead ? null : access.ownGroups;
  const choices = useMemo(() => mm.groups.filter((g) => (own ? own.has(g.key) : true)), [mm.groups, own]);
  const [pick, setPick] = useState<string>("all");
  useEffect(() => {
    try {
      const v = localStorage.getItem(SCOPE_KEY);
      if (v) setPick(v);
    } catch {
      /* без хранилища — просто «все» */
    }
  }, []);
  const choose = (v: string) => {
    setPick(v);
    try {
      localStorage.setItem(SCOPE_KEY, v);
    } catch {
      /* не запомнили — не страшно */
    }
  };
  // выбранной группы нет среди доступных (удалили, другой аккаунт) — показываем всё доступное
  const picked = pick !== "all" ? choices.find((g) => g.key === pick) ?? null : null;
  const keys = useMemo(() => (picked ? [picked.key] : own ? choices.map((g) => g.key) : null), [picked, own, choices]);

  const sc = useMemo(() => buildScope(m, keys, ix, s), [m, keys, ix, s]);
  // «что сделать сейчас» — про сегодня и неделю вперёд, люди и группы — из месяца
  const msc = useMemo(() => (m === mm ? sc : buildScope(mm, keys, ix, s)), [m, mm, sc, keys, ix, s]);
  const wsc = useMemo(() => (wm ? buildScope(wm, keys, ix, s) : null), [wm, keys, ix, s]);
  const p = sc.p;
  const rows = useMemo(() => dailyRows(cal, sc.plan, sc.counts, sc.hoursMap), [cal, sc]);
  const wRows = useMemo(() => (wm && wsc ? dailyRows(wm.cal, wsc.plan, wsc.counts, wsc.hoursMap) : null), [wm, wsc]);

  const empty = data.operators.filter((o) => !o.deletedAt).length === 0 && data.leads.length === 0;
  const cur = cal.phase === "current";
  const ref = cal.phase === "future" ? cal.days[0] : cal.ref;
  const wd = cal.workdays.length;
  const name = span === "month" ? fmtMonth(month) : fmtRange(week.from, week.to);

  const sub =
    span === "day"
      ? `${dow(anchor)}, ${dayShort(anchor)} · ${wd ? "рабочий день" : "выходной по графику"}${cal.phase === "future" ? " · ещё впереди" : ""}`
      : cal.phase === "future"
        ? `${name} · ${SPAN_W[span].notYet.split(" ").slice(1).join(" ")} · ${wd} ${plural(wd, ["рабочий день", "рабочих дня", "рабочих дней"])}`
        : cal.phase === "past"
          ? `${name} · ${SPAN_W[span].closed.toLowerCase()}`
          : `${dow(today)}, ${dayShort(today)} · рабочий день ${p.elapsedW} из ${wd}${span === "week" ? " на неделе" : ""}`;

  // на смене в опорный день — для блока «сегодня» и для показателей дня
  const onShift = useMemo(
    () =>
      sc.line.filter((r) => {
        const sh = ix.shift.get(`${ref}|${r.op.id}`);
        return !!sh && isWorked(sh.type, sh.hours);
      }).length,
    [sc.line, ix, ref],
  );
  // сегодня: лиды за день, вчера, кто на смене — крупно рядом с фактом (в режиме «день» это и есть факт)
  const todayInfo = useMemo<HeroToday | null>(() => {
    // конверсия дня — лиды ÷ часы смен по графику тех же операторов
    const convOn = (d: DayKey) => {
      let leads = 0;
      let hours = 0;
      for (const r of sc.line) {
        leads += ix.opDay.get(r.op.id)?.get(d) ?? 0;
        hours += ix.plannedOpDay.get(r.op.id)?.get(d) ?? 0;
      }
      return hours > 0 ? leads / hours : null;
    };
    if (span === "day") {
      const d = addDays(anchor, -7);
      const n = sc.counts?.get(d) ?? 0;
      const diff = cal.phase === "future" ? null : p.fact - n;
      return {
        n,
        yesterday: 0,
        dayPlan: 0,
        onShift: 0,
        conv: convOn(d),
        title: "Неделю назад",
        icon: "clock",
        lines: [
          `${dow(d)}, ${dayShort(d)}`,
          diff == null ? "день ещё впереди" : diff === 0 ? "столько же, сколько сейчас" : `сейчас ${diff > 0 ? "больше" : "меньше"} на ${fmtInt(Math.abs(diff))}${n > 0 ? ` (${diff > 0 ? "+" : "−"}${fmtPct(Math.abs(diff) / n)})` : ""}`,
        ],
      };
    }
    if (!cur) return null;
    return {
      n: sc.counts?.get(today) ?? 0,
      yesterday: sc.counts?.get(addDays(today, -1)) ?? 0,
      dayPlan: cal.isWork(today) ? p.dailyPlan : 0,
      onShift,
      conv: convOn(today),
    };
  }, [cur, span, anchor, sc, ix, today, cal, p.dailyPlan, p.fact, onShift]);

  const ownNames = choices.map((g) => g.name).join(", ");
  const title = access.isHead ? "Сводка" : `Сводка · ${ownNames || "группы не назначены"}`;
  const showPicker = access.isHead ? choices.length > 0 : choices.length > 1;

  // липкая шапка: главный блок ушёл вверх — сверху остаются период, группа и три главных числа
  const heroRef = useRef<HTMLDivElement>(null);
  const stickGap = span === "day" || cal.phase === "past" ? p.fact - p.plan : p.deviation;
  // задачи на сегодня — про людей и группы месяца, от выбранного периода не зависят
  const tasks = useTasks(mm, msc.line, msc.groups);
  // выбор отдела/группы — одни и те же варианты в шапке страницы и в липкой шапке
  const scopeOpts: Opt[] = [
    { value: "all", label: access.isHead ? "Весь отдел" : "Все мои группы", icon: <Icon name={access.isHead ? "users" : "groups"} size={14} /> },
    ...choices.map<Opt>((g) => ({ value: g.key, label: g.name, group: "Группы", icon: dot(g.color), hint: g.plan > 0 ? `план ${fmtInt(g.plan)}` : "без плана" })),
  ];
  const spanOpts: Opt<Span>[] = [
    { value: "day", label: "День" },
    { value: "week", label: "Неделя" },
    { value: "month", label: "Месяц" },
  ];

  return (
    <div className="stack">
      {!empty && (
        <StickyHead
          title={title}
          ctx={
            <span className="sh-ctl">
              <Select<Span> size="sm" value={span} onChange={setMode} options={spanOpts} ariaLabel="Период" width={104} minPopWidth={140} />
              <span className="sh-per">{span === "month" ? fmtMonth(month) : spanLabel}</span>
              {showPicker ? (
                <Select size="sm" value={picked ? picked.key : "all"} onChange={choose} options={scopeOpts} ariaLabel="Чья сводка" width={180} minPopWidth={250} />
              ) : (
                <span className="sh-per">{picked ? picked.name : access.isHead ? "Весь отдел" : "Все мои группы"}</span>
              )}
            </span>
          }
          anchor={heroRef}
          items={[
            { l: "Факт", v: fmtInt(p.fact) },
            ...(p.plan > 0 ? [{ l: "Разрыв", v: fmtSigned(Math.round(stickGap)), tone: stickGap < -0.5 ? ("red" as const) : ("green" as const) }] : []),
            {
              l: "Конв.",
              v: sc.lph == null ? "—" : fmtPct(sc.lph),
              tone: sc.lph == null || s.convNormPct <= 0 ? undefined : sc.lph >= s.convNormPct / 100 ? ("green" as const) : ("red" as const),
            },
          ]}
        />
      )}
      <PageHead
        title={
          <span className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
            {title}
            {!empty && <TasksChip tasks={tasks} />}
          </span>
        }
        sub={sub}
        actions={
          <>
            {showPicker && (
              <Select
                value={picked ? picked.key : "all"}
                onChange={choose}
                ariaLabel="Чья сводка"
                width={210}
                minPopWidth={250}
                options={scopeOpts}
              />
            )}
            {span === "month" ? (
              <MonthSwitcher value={month} onChange={setMonth} />
            ) : (
              <div className="o2-date">
                <button type="button" className="o2-ib" onClick={() => shift(-1)} aria-label={span === "day" ? "Предыдущий день" : "Предыдущая неделя"}>
                  <Icon name="chevL" size={15} />
                </button>
                <span className="lbl d2-span-lbl">{spanLabel}</span>
                <button type="button" className="o2-ib" onClick={() => shift(1)} aria-label={span === "day" ? "Следующий день" : "Следующая неделя"}>
                  <Icon name="chevR" size={15} />
                </button>
              </div>
            )}
            <div className="o2-seg d2-seg" role="group" aria-label="Период">
              {(["day", "week", "month"] as Span[]).map((k) => (
                <button key={k} type="button" className={span === k ? "on" : ""} onClick={() => setMode(k)} aria-pressed={span === k}>
                  {k === "day" ? "День" : k === "week" ? "Неделя" : "Месяц"}
                </button>
              ))}
            </div>
          </>
        }
      />
      {empty ? (
        <Onboarding />
      ) : (
        <div className="d2">
          <div ref={heroRef}>
            <Hero cal={cal} plan={sc.plan} p={p} today={todayInfo} span={span} conv={sc.lph} hours={sc.hours} onShift={onShift} />
          </div>
          <PeopleCard m={m} line={sc.line} span={span} />
          <div className="d2-charts">
            {span === "day" ? <HourCard day={anchor} keys={keys} plan={p.plan} /> : <GapCard rows={rows} cal={cal} p={p} span={span} />}
            {span === "day" && wm && wsc ? (
              <WeekCard cal={wm.cal} p={wsc.p} ref_={wm.cal.phase === "future" ? wm.cal.days[0] : wm.cal.ref} counts={wsc.counts} focus={anchor} />
            ) : (
              <WeekCard cal={cal} p={p} ref_={ref} counts={sc.counts} />
            )}
          </div>
          {/* весь отдел (или несколько своих групп) — таблица и карта разбиты по группам */}
          <OpsCard m={m} line={sc.line} settings={s} ref_={ref} groups={picked ? null : sc.groups} span={span} />
          {span === "day" && wm && wsc && wRows ? (
            <HeatCard m={wm} sc={wsc} rows={wRows} groups={picked ? null : wsc.groups} focus={anchor} />
          ) : (
            <HeatCard m={m} sc={sc} rows={rows} groups={picked ? null : sc.groups} />
          )}
        </div>
      )}
    </div>
  );
}

/* ── главное: факт, вывод, показатели, шкала ───────────────────────── */

/** who="op" — вывод про одного оператора (карточка): «отстаёт», «идёт», «выйдет». */
/** Сегодня в «Сводке»: сколько лидов передали за день — крупно рядом с фактом месяца. */
export interface HeroToday {
  n: number;
  yesterday: number;
  dayPlan: number;
  onShift: number;
  /** Конверсия дня: лиды ÷ часы смен по графику (как столбец дня в тепловой карте). */
  conv: number | null;
  /** Свой заголовок и строки под числом — в режиме «день» блок показывает тот же день неделей раньше. */
  title?: string;
  icon?: IconName;
  lines?: ReactNode[];
}

export function Hero({
  cal,
  plan,
  p,
  who = "team",
  today,
  span = "month",
  conv,
  hours,
  onShift,
  tools,
}: {
  cal: MonthCal;
  plan: number;
  p: Pace;
  who?: "team" | "op";
  today?: HeroToday | null;
  span?: Span;
  /** Конверсия периода (лиды ÷ часы); undefined — показатель не выводим. */
  conv?: number | null;
  hours?: number;
  onShift?: number;
  /** Справа от факта, когда блока «сегодня» нет: переключатель периода (карточка оператора). */
  tools?: ReactNode;
}) {
  const one = who === "op";
  const cur = cal.phase === "current";
  const past = cal.phase === "past";
  const w = SPAN_W[span];
  const isDay = span === "day";
  const norm = useConvNorm();

  let hue = "gray";
  let text: ReactNode;
  if (plan <= 0) {
    hue = "amber";
    text = (
      <>
        {isDay && !cal.workdays.length ? "Выходной по графику — плана на этот день нет." : <>План на {w.acc} не задан — темп и прогноз не посчитать.</>} <Link href="/plans">Задать план →</Link>
      </>
    );
  } else if (cal.phase === "future") {
    text = (
      <>
        {w.notYet}. План <em>{fmtNum(plan, 0)}</em>{!isDay && <> — это <em>{fmtNum(p.dailyPlan)}</em> в рабочий день</>}.
      </>
    );
  } else if (past) {
    hue = p.pct >= 1 ? "green" : "red";
    text = p.pct >= 1 ? (
      <>
        {w.closed}: план выполнен на <em>{fmtPct(p.pct)}</em>, сверх плана <em>{fmtInt(Math.round(p.fact - plan))}</em>.
      </>
    ) : (
      <>
        {w.closed}: <em>{fmtPct(p.pct)}</em> плана, не хватило <em>{fmtInt(Math.round(p.remaining))} {plural(Math.round(p.remaining), LEADS)}</em>.
      </>
    );
  } else if (isDay) {
    const left = Math.ceil(p.remaining);
    hue = left > 0 ? "amber" : "green";
    text =
      left > 0 ? (
        <>
          Передали <em>{fmtInt(p.fact)}</em> из <em>{fmtNum(plan, 0)}</em> — до дневного плана ещё <em>{fmtInt(left)} {plural(left, LEADS)}</em>
          {onShift ? <>, на смене {fmtInt(onShift)} {plural(onShift, ["человек", "человека", "человек"])}</> : null}.
        </>
      ) : (
        <>
          Дневной план выполнен: <em>{fmtInt(p.fact)}</em> из <em>{fmtNum(plan, 0)}</em> ({fmtPct(p.pct)}).
        </>
      );
  } else if (p.deviation < -0.5) {
    hue = "red";
    const behind = Math.round(-p.deviation);
    const daysBehind = safeDiv(-p.deviation, p.dailyPlan);
    const k = p.needPerDay != null && p.avgPerDay > 0 ? p.needPerDay / p.avgPerDay : null;
    text = (
      <>
        {one ? "Отстаёт" : "Отстаём"} от плана на <em>{fmtInt(behind)} {plural(behind, LEADS)}</em>
        {p.dailyPlan > 0 && <>, это около <em>{fmtNum(daysBehind)} {Number.isInteger(Math.round(daysBehind * 10) / 10) ? plural(Math.round(daysBehind), DAYS) : "дня"}</em> дневного плана</>}.{" "}
        {k != null && k > 1.05 ? (
          <>
            Нужно увеличить темп в <em>{fmtNum(k)} раза</em>.
          </>
        ) : p.needPerDay != null ? (
          <>
            Нужно <em>{fmtNum(p.needPerDay)}</em> в рабочий день.
          </>
        ) : null}
      </>
    );
  } else {
    hue = "green";
    text = (
      <>
        {one ? "Идёт" : "Идём"} {p.deviation > 0.5 ? <>с опережением на <em>{fmtInt(Math.round(p.deviation))} {plural(Math.round(p.deviation), LEADS)}</em></> : "по плану"}. При текущем темпе{" "}
        {one ? "выйдет" : "выйдем"} на <em>{fmtInt(Math.round(p.rr))}</em> ({fmtPct(p.rrPct)} плана){span === "week" ? " к концу недели" : ""}.
      </>
    );
  }

  const planR = Math.round(plan);
  const gapV = past ? p.fact - plan : p.deviation;
  const kpis: { l: string; ic: IconName; v: string; u: string; tone?: "red" | "green" }[] = [
    { l: "План", ic: "target", v: fmtInt(planR), u: plural(planR, LEADS) },
    { l: "Факт", ic: "leads", v: fmtInt(p.fact), u: plural(p.fact, LEADS) },
  ];
  if (isDay) {
    // день: темп и прогноз по одному дню ничего не говорят — вместо них выполнение, часы и смена
    kpis.push(
      { l: "Разрыв", ic: "move", v: fmtSigned(Math.round(p.fact - plan)), u: plural(Math.abs(Math.round(p.fact - plan)), LEADS), tone: plan > 0 ? (p.fact - plan < -0.5 ? "red" : "green") : undefined },
      { l: "Выполнение", ic: "chart", v: plan > 0 ? fmtPct(p.pct) : "—", u: "дневного плана", tone: plan > 0 ? (p.pct >= 1 ? "green" : undefined) : undefined },
      { l: "Часы", ic: "clock", v: hours != null ? fmtNum(hours, 1) : "—", u: "отработано" },
      { l: "На смене", ic: "users", v: fmtInt(onShift ?? 0), u: plural(onShift ?? 0, ["человек", "человека", "человек"]) },
      { l: "На человека", ic: "leads", v: onShift ? fmtNum(p.fact / onShift) : "—", u: "лидов за смену" },
    );
  } else {
    kpis.push(
      { l: past ? "Должно было быть" : "Должно быть", ic: "calendar", v: fmtInt(Math.round(past ? plan : p.planToDate)), u: past ? `к концу ${w.gen}` : "к сегодня" },
      { l: "Разрыв", ic: "move", v: fmtSigned(Math.round(gapV)), u: plural(Math.abs(Math.round(gapV)), LEADS), tone: plan > 0 ? (gapV < -0.5 ? "red" : "green") : undefined },
      { l: "Темп", ic: "bolt", v: p.elapsedW > 0 ? fmtNum(p.avgPerDay) : "—", u: "в рабочий день" },
      { l: "Нужно", ic: "route", v: p.needPerDay == null ? "—" : fmtNum(p.needPerDay), u: p.needPerDay == null ? (past ? w.closed.toLowerCase() : "дней не осталось") : "в рабочий день", tone: p.needPerDay != null && p.elapsedW > 0 && p.needPerDay > p.avgPerDay ? "red" : undefined },
      { l: "Прогноз", ic: "trend", v: p.elapsedW > 0 || past ? fmtInt(Math.round(p.rr)) : "—", u: plan > 0 && (p.elapsedW > 0 || past) ? `(${fmtPct(p.rrPct)})` : "по темпу" },
    );
  }
  const convTag = (v: number | null | undefined, hint: string) =>
    v == null ? null : (
      <span className="d2-conv" data-ok={norm <= 0 ? undefined : String(v >= norm)} title={`Конверсия ${hint}: лиды ÷ часы смен${norm > 0 ? ` · норма ${fmtPct(norm)}` : ""}`}>
        {fmtPct(v)}
        <i>конв.</i>
      </span>
    );

  // шкала: всё в одном масштабе — до плана или прогноза, что больше
  const max = Math.max(plan, p.rr, p.fact, 1);
  const pos = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));
  const pf = pos(p.fact);
  const ps = pos(p.planToDate);
  const pp = pos(plan);
  const showShould = cur && plan > 0;
  const showRr = cur && p.elapsedW > 0 && p.rr > p.fact;
  const close = showShould && Math.abs(pf - ps) < 9;
  // подписи рядом не влезают: «должно быть» уходит над шкалой, если там нет прогноза
  const shouldAbove = close && (!showRr || Math.abs(pos(p.rr) - ps) > 16);
  const near = close && !shouldAbove;
  const factLeft = pf <= ps;
  const labStyle = (x: number, side: "c" | "l" | "r"): CSSProperties => ({
    left: `${x}%`,
    transform: side === "c" ? "translateX(-50%)" : side === "r" ? "translateX(-100%)" : "translateX(-4px)",
    textAlign: side === "r" ? "right" : side === "c" ? "center" : "left",
  });
  const okFill = plan > 0 && (past ? p.pct >= 1 : p.deviation >= -0.5);

  return (
    <section className="card d2-hero">
      <div className="d2-hero-top">
        <div className="d2-fact">
          <div>
            <div className="d2-fact-l"><Icon name="leads" size={13} className="mi" />Факт{past || span !== "month" ? ` за ${w.acc}` : ""}</div>
            <div className="d2-fact-n num">
              {fmtInt(p.fact)}
              <small>{plural(p.fact, LEADS)}</small>
              {convTag(conv, `за ${w.acc}`)}
            </div>
          </div>
          {today && (
            <div className="d2-now" title={today.title ? undefined : "Лиды, переданные сегодня (по Москве)"}>
              <div className="d2-fact-l"><Icon name={today.icon ?? "phone"} size={13} className="mi" />{today.title ?? "Сегодня передали"}</div>
              <div className="d2-fact-n num">
                {fmtInt(today.n)}
                <small>{plural(today.n, LEADS)}</small>
                {convTag(today.conv, today.title ? "неделей раньше" : "за сегодня")}
              </div>
              <div className="d2-now-s">
                {today.lines ? (
                  today.lines.map((l, i) => <span key={i}>{l}</span>)
                ) : (
                  <>
                    {today.dayPlan > 0 && (
                      <span className={today.n >= today.dayPlan ? "d2-green" : undefined}>
                        {fmtPct(today.n / today.dayPlan)} дневного плана ({fmtNum(today.dayPlan)})
                      </span>
                    )}
                    <span>
                      вчера {fmtInt(today.yesterday)} · на смене {fmtInt(today.onShift)}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}
          {!today && tools && <div className="d2-hero-tools">{tools}</div>}
          <div className="d2-alert" data-hue={hue}>
            <Icon name={hue === "green" ? "check" : hue === "red" ? "alert" : "info"} size={22} />
            <div>{text}</div>
          </div>
        </div>
        <div className="d2-kpis" style={{ "--n": kpis.length } as CSSProperties}>
          {kpis.map((k) => (
            <div key={k.l} className="d2-kpi">
              <div className="d2-kpi-l">
                <Icon name={k.ic} size={12} className="mi" />
                {k.l}
              </div>
              <div className={`d2-kpi-v${k.tone === "red" ? " d2-red" : k.tone === "green" ? " d2-green" : ""}`}>{k.v}</div>
              <div className="d2-kpi-u">{k.u}</div>
            </div>
          ))}
        </div>
      </div>
      {plan > 0 && (
        <div className="d2-bar">
          <div className="trk" />
          {showRr && <div className="hatch" style={{ left: `${pf}%`, width: `${pos(p.rr) - pf}%` }} />}
          <div className="fill" data-ok={String(okFill)} style={{ width: `${pf}%` }} />
          <div className="dot" style={{ left: `${pf}%`, width: 11, height: 11, background: okFill ? "var(--c-green-fg)" : "var(--c-red-fg)", border: "2px solid var(--bg-panel)" }} />
          {showShould && (
            <>
              <div className="tick" style={{ left: `${ps}%`, top: 15, height: 10, width: 1.5 }} />
              <div className="dot" style={{ left: `${ps}%`, width: 7, height: 7, background: "var(--text)" }} />
            </>
          )}
          {showRr && (
            <>
              <div className="pill" style={{ left: `${Math.min(92, Math.max(8, pos(p.rr)))}%` }}>
                Прогноз: {fmtInt(p.rr)} ({fmtPct(p.rrPct)})
              </div>
              <div className="tick" style={{ left: `${pos(p.rr)}%`, top: 16, height: 6, width: 1, background: "var(--dim)" }} />
              <div className="dot" style={{ left: `${pos(p.rr)}%`, width: 9, height: 9, background: "var(--bg-panel)", border: "1.5px solid var(--dim)" }} />
            </>
          )}
          <div className="tick" style={{ left: `${pp}%`, top: 18, height: 17, width: 2 }} />

          {pf > 4 && (
            <div className="lab" style={labStyle(0, "l")}>
              <b>0</b>
            </div>
          )}
          <div className={`lab ${okFill ? "d2-green" : "d2-red"}`} style={labStyle(pf, near ? (factLeft ? "r" : "l") : pf < 3 ? "l" : pf > 92 ? "r" : "c")}>
            <b style={{ color: "inherit" }}>{fmtInt(p.fact)}</b>факт
          </div>
          {showShould && (
            <div className="lab" style={{ ...labStyle(ps, near ? (factLeft ? "l" : "r") : "l"), ...(shouldAbove ? { top: -4, display: "flex", gap: 5, alignItems: "baseline" } : null) }}>
              <b>{fmtInt(Math.round(p.planToDate))}</b>должно быть
            </div>
          )}
          {pp - Math.max(pf, showShould ? ps : 0) > 9 && (
            <div className="lab" style={labStyle(pp, pp > 95 ? "r" : "c")}>
              <b>{fmtInt(plan)}</b>план
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ── задачи на сегодня: значок у заголовка, список по клику ─────────── */

interface Task {
  hue: "red" | "amber";
  icon: IconName;
  title: string;
  n: number;
  who: string;
  href: string;
  btn: string;
}

/** Что требует действия сегодня: на смене без лидов, без смен на неделю, без смены сегодня, группа без плана. */
function useTasks(m: MonthModel, line: OpRow[], groups: GroupRow[]): Task[] {
  const { ix, today } = useCrm();
  const workday = m.cal.isWork(today);
  return useMemo(() => {
    const zero: OpRow[] = [];
    const noToday: OpRow[] = [];
    const noWeek: OpRow[] = [];
    const ahead = rangeDays(addDays(today, 1), addDays(today, 6));
    for (const r of line) {
      const op = r.op;
      if (op.status !== "active") continue;
      if (op.hireDate && op.hireDate > today) continue;
      if (op.fireDate && op.fireDate < today) continue;
      const sh = ix.shift.get(`${today}|${op.id}`);
      if (sh && isWorked(sh.type, sh.hours)) {
        if ((ix.opDay.get(op.id)?.get(today) ?? 0) === 0) zero.push(r);
        continue;
      }
      if (sh) continue; // выходной, отпуск или больничный отмечены в графике
      // одна задача на человека: без смен на неделю вперёд важнее, чем «нет смены сегодня»
      if (!ahead.some((d) => ix.shift.has(`${d}|${op.id}`))) noWeek.push(r);
      else if (workday) noToday.push(r);
    }
    const noPlan = groups.filter((g) => g.group && !g.group.deletedAt && g.plan <= 0);
    const people = (n: number) => `${n} ${plural(n, ["человек", "человека", "человек"])}`;
    const all: Task[] = [
      { hue: "red", icon: "phone", title: "На смене, но 0 лидов", n: zero.length, who: `${people(zero.length)} · ${names(zero)}`, href: "/operators", btn: "Проверить" },
      { hue: "amber", icon: "calendar", title: "Нет смен на неделю", n: noWeek.length, who: `${people(noWeek.length)} · ${names(noWeek)}`, href: "/schedule", btn: "Назначить смены" },
      { hue: "red", icon: "clock", title: "Без смены сегодня", n: noToday.length, who: `${people(noToday.length)} · ${names(noToday)}`, href: "/schedule", btn: "Закрыть слот" },
      { hue: "amber", icon: "target", title: "Группа без плана", n: noPlan.length, who: noPlan.map((g) => g.name).join(", "), href: "/plans", btn: "Поставить план" },
    ];
    return all.filter((t) => t.n > 0);
  }, [line, ix, today, workday, groups]);
}

function TasksChip({ tasks }: { tasks: Task[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);
  if (!tasks.length)
    return (
      <span className="d2-tasks" data-ok="true" title="Все проверки на сегодня в порядке">
        <Icon name="check" size={13} />
        задач нет
      </span>
    );
  const red = tasks.some((t) => t.hue === "red");
  return (
    <span className="d2-tasks-w" ref={ref}>
      <button type="button" className="d2-tasks" data-hue={red ? "red" : "amber"} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Icon name="alert" size={13} />
        {tasks.length} {plural(tasks.length, ["задача", "задачи", "задач"])}
        <Icon name="chevR" size={12} className={`grp-chev${open ? " open" : ""}`} />
      </button>
      {open && (
        <div className="d2-tasks-pop card" role="dialog" aria-label="Задачи на сегодня">
          {tasks.map((t) => (
            <div key={t.title} className="d2-tasks-row" data-hue={t.hue}>
              <span className="ic">
                <Icon name={t.icon} size={15} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="t">
                  {t.title}
                  <b>{t.n}</b>
                </div>
                <div className="w" title={t.who}>{t.who}</div>
              </div>
              <Link href={t.href} className="d2-task-btn" onClick={() => setOpen(false)}>
                {t.btn}
                <Icon name="arrowR" size={12} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}

/* ── люди периода: лучшие, отстающие, динамика, факты ─────────────── */

/**
 * Кого похвалить и с кем поговорить за выбранный период. Лучшие — по факту; отстающие — по разрыву
 * к плану на дату, с причиной (часы / лиды в час / план выше обычной работы); динамика — темп
 * последних смен к предыдущим (не зависит от периода); внизу — факты периода.
 */
function PeopleCard({ m, line, span }: { m: MonthModel; line: OpRow[]; span: Span }) {
  const { ix, data } = useCrm();
  const router = useRouter();
  const norm = data.settings.convNormPct / 100;
  const ins = useMemo(() => buildInsights(m.ops, ix, m.cal), [m, ix]);
  const past = m.cal.phase === "past";
  const gapOf = (r: OpRow) => (span === "day" || past ? r.pace.fact - r.terms.plan : r.pace.deviation);
  const ratioOf = (r: OpRow) => (span === "day" || past ? r.pace.pct : r.pace.paceRatio);

  const v = useMemo(() => {
    const pool = line.filter((r) => !r.op.deletedAt && r.op.status !== "fired");
    const best = pool.filter((r) => r.pace.fact > 0).sort((a, b) => b.pace.fact - a.pace.fact || ratioOf(b) - ratioOf(a)).slice(0, 3);
    const behind = pool
      .filter((r) => r.terms.plan > 0 && r.op.role !== "trainee" && r.op.status === "active" && gapOf(r) < -0.5)
      .sort((a, b) => gapOf(a) - gapOf(b))
      .slice(0, 3);
    const tempo = pool
      .filter((r) => r.op.status === "active")
      .map((r) => ({ r, t: ins.byOp.get(r.op.id)?.tempo }))
      .filter((x): x is { r: OpRow; t: NonNullable<typeof x.t> } => !!x.t && x.t.change != null);
    // вклад в результат: доля каждого в лидах периода — топ-3 и «остальные»
    const total = pool.reduce((a, r) => a + r.pace.fact, 0);
    const byFact = pool.filter((r) => r.pace.fact > 0).sort((a, b) => b.pace.fact - a.pace.fact);
    const share = { total, top: byFact.slice(0, 3), rest: byFact.slice(3).reduce((a, r) => a + r.pace.fact, 0), restN: Math.max(0, byFact.length - 3) };
    // факты: лучшая конверсия (от 8 ч), больше всех часов, смены без лидов подряд
    const conv = pool.filter((r) => r.lph != null && r.hours >= 8).sort((a, b) => (b.lph ?? 0) - (a.lph ?? 0))[0] ?? null;
    const hours = pool.filter((r) => r.hours > 0).sort((a, b) => b.hours - a.hours)[0] ?? null;
    const zero = tempo.filter((x) => x.t.zeroStreak >= 2).sort((a, b) => b.t.zeroStreak - a.t.zeroStreak)[0] ?? null;
    return { best, behind, share, conv, hours, zero };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, ins, span, past]);

  const open = (r: OpRow) => router.push(`/operators?id=${encodeURIComponent(r.op.id)}`);
  const what = span === "day" ? "дня" : span === "week" ? "недели" : "месяца";
  const empty = !v.best.length && !v.behind.length;
  if (empty) return null;

  return (
    <section className="card d2-pp">
      <div className="d2-pp-h">
        <h3 className="d2-h">
          <Icon name="users" size={15} className="title-ic" />
          Люди {what}
        </h3>
        <span className="d2-pp-sub">кого похвалить и с кем поговорить</span>
      </div>
      <div className="d2-pp-grid">
        {/* лучшие */}
        <div className="d2-pp-col">
          <div className="d2-pp-ct">
            <Icon name="star" size={13} /> Лучшие
          </div>
          {v.best.map((r, i) => {
            const ratio = ratioOf(r);
            return (
              <button key={r.op.id} type="button" className="d2-pp-row" onClick={() => open(r)}>
                <span className="d2-pp-rank" data-rank={i + 1} title={i === 0 ? `Лучший ${what}` : undefined}>{i + 1}</span>
                <Avatar name={r.op.name} id={r.op.id} size={26} />
                <span className="d2-pp-n">
                  <b>{shortName(r.op.name)}</b>
                  <i>{r.terms.plan > 0 ? `${fmtPct(ratio)} плана${span === "month" && !past ? " на сегодня" : ""}` : "без плана"}</i>
                </span>
                <span className="d2-pp-v">
                  <b>{fmtInt(r.pace.fact)}</b>
                  <i>{plural(r.pace.fact, LEADS)}</i>
                </span>
              </button>
            );
          })}
          {!v.best.length && <div className="d2-pp-none">Лидов за период ещё нет</div>}
        </div>

        {/* отстающие */}
        <div className="d2-pp-col">
          <div className="d2-pp-ct">
            <Icon name="alert" size={13} /> Отстают
          </div>
          {v.behind.map((r) => {
            const reason = ins.byOp.get(r.op.id)?.reason;
            return (
              <button key={r.op.id} type="button" className="d2-pp-row" onClick={() => open(r)} title={reason ? LAG_HINT[reason.kind] : undefined}>
                <Avatar name={r.op.name} id={r.op.id} size={26} />
                <span className="d2-pp-n">
                  <b>{shortName(r.op.name)}</b>
                  <i>{reason ? LAG_LABEL[reason.kind] : `${fmtPct(ratioOf(r))} плана`}</i>
                </span>
                <span className="d2-pp-v">
                  <b className="d2-red">{fmtSigned(Math.round(gapOf(r)))}</b>
                  <i>{fmtPct(ratioOf(r))}</i>
                </span>
              </button>
            );
          })}
          {!v.behind.length && <div className="d2-pp-none d2-green">Все идут по плану</div>}
        </div>

        {/* вклад в результат */}
        <div className="d2-pp-col">
          <div className="d2-pp-ct" title="Доля каждого в лидах за период">
            <Icon name="chart" size={13} /> Вклад в результат
          </div>
          {v.share.total > 0 ? (
            <>
              <div className="d2-pp-share" role="img" aria-label="Доли в лидах периода">
                {v.share.top.map((r, i) => (
                  <i key={r.op.id} data-i={i} style={{ width: `${(r.pace.fact / v.share.total) * 100}%` }} title={`${shortName(r.op.name)} — ${fmtPct(r.pace.fact / v.share.total)}`} />
                ))}
                {v.share.rest > 0 && <i data-i="rest" style={{ width: `${(v.share.rest / v.share.total) * 100}%` }} title={`Остальные ${v.share.restN} — ${fmtPct(v.share.rest / v.share.total)}`} />}
              </div>
              {v.share.top.map((r, i) => (
                <button key={r.op.id} type="button" className="d2-pp-row d2-pp-srow" onClick={() => open(r)}>
                  <span className="d2-pp-sw" data-i={i} />
                  <span className="d2-pp-n">
                    <b>{shortName(r.op.name)}</b>
                  </span>
                  <span className="d2-pp-v">
                    <b>{fmtPct(r.pace.fact / v.share.total)}</b>
                    <i>{fmtInt(r.pace.fact)} {plural(r.pace.fact, LEADS)}</i>
                  </span>
                </button>
              ))}
              {v.share.restN > 0 && (
                <div className="d2-pp-concl">
                  {v.share.top.length} {plural(v.share.top.length, ["человек даёт", "человека дают", "человек дают"])}{" "}
                  <b>{fmtPct((v.share.total - v.share.rest) / v.share.total)}</b> лидов · остальные {v.share.restN} — {fmtPct(v.share.rest / v.share.total)}
                </div>
              )}
            </>
          ) : (
            <div className="d2-pp-none">Лидов за период ещё нет</div>
          )}
        </div>
      </div>

      {/* факты периода */}
      {(v.conv || v.hours || v.zero) && (
        <div className="d2-pp-facts">
          {v.conv && (
            <button type="button" onClick={() => open(v.conv!)}>
              <Icon name="target" size={13} /> Лучшая конверсия <b className={norm > 0 && (v.conv.lph ?? 0) >= norm ? "d2-green" : undefined}>{fmtPct(v.conv.lph ?? 0)}</b> {shortName(v.conv.op.name)}
            </button>
          )}
          {v.hours && (
            <button type="button" onClick={() => open(v.hours!)}>
              <Icon name="clock" size={13} /> Больше всех часов <b>{fmtNum(v.hours.hours, 1)}</b> {shortName(v.hours.op.name)}
            </button>
          )}
          {v.zero && (
            <button type="button" className="bad" onClick={() => open(v.zero!.r)}>
              <Icon name="phone" size={13} /> {v.zero.t.zeroStreak} {plural(v.zero.t.zeroStreak, ["смена", "смены", "смен"])} без лидов <b>{shortName(v.zero.r.op.name)}</b>
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/* ── накопительный разрыв к плану ──────────────────────────────────── */

export function GapCard({ rows, cal, p, span = "month" }: { rows: DayRow[]; cal: MonthCal; p: Pace; span?: Span }) {
  const pid = useId().replace(/:/g, "");
  const [box, W] = useChartWidth();
  const [hi, setHi] = useState<number | null>(null);
  const { H, L, R, T, B } = CH;
  const n = rows.length;
  const sw = (W - L - R) / n;
  const colX = (i: number) => Math.round(L + sw * i);
  const cx = (i: number) => L + sw * i + sw / 2;

  const lastIdx = rows.reduce((a, r, i) => (!r.future ? i : a), -1);
  const current = cal.phase === "current";
  const showFc = current && lastIdx >= 0 && p.elapsedW > 0 && p.plan > 0;
  const base = lastIdx >= 0 ? rows[lastIdx].deviation : 0;
  const w0 = lastIdx >= 0 ? cal.wIdx(rows[lastIdx].day) : 0;
  // коридор: сверху — «дальше идём ровно по дневному плану» (разрыв замирает), снизу — «сохраняется текущий темп»
  const slope = p.avgPerDay - p.dailyPlan;
  const fc = showFc
    ? rows.slice(lastIdx).map((r, k) => {
        const dw = cal.wIdx(r.day) - w0;
        const b = base + slope * dw;
        return { i: lastIdx + k, day: r.day, hi: Math.max(base, b), lo: Math.min(base, b), mid: b };
      })
    : [];

  const vals = [0, ...rows.filter((r) => !r.future).map((r) => r.deviation), ...fc.flatMap((f) => [f.hi, f.lo])];
  const sc = zeroScale(Math.min(...vals), Math.max(...vals));
  const y = (v: number) => T + ((sc.max - v) / (sc.max - sc.min)) * (H - T - B);
  const y0 = y(0);
  const ticks = Array.from({ length: CH.parts + 1 }, (_, k) => sc.max - k * sc.step);

  const past = rows.slice(0, lastIdx + 1);
  const pts = past.map((r, i) => [cx(i), y(r.deviation)] as const);
  const line = pts.map(([x, yy]) => `${x},${yy}`).join(" ");
  const area = pts.length ? `${pts[0][0]},${y0} ${line} ${pts[pts.length - 1][0]},${y0}` : "";
  // самая глубокая просадка и лучший момент — подписываем, если это не сегодняшняя точка
  let minI = -1;
  let maxI = -1;
  past.forEach((r, i) => {
    if (r.deviation < 0 && (minI < 0 || r.deviation < past[minI].deviation)) minI = i;
    if (r.deviation > 0 && (maxI < 0 || r.deviation > past[maxI].deviation)) maxI = i;
  });

  const endFc = fc[fc.length - 1];
  const final = endFc ? endFc.mid : base;
  const tone = (v: number) => (v < -0.5 ? "var(--c-red-fg)" : v > 0.5 ? "var(--c-green-fg)" : "var(--text-sub)");
  const toneCls = (v: number) => (v < -0.5 ? "d2-red" : v > 0.5 ? "d2-green" : "");
  const clampY = (v: number) => Math.min(H - B - 10, Math.max(T + 9, v));
  const band = fc.length > 1 ? [...fc.map((f) => `${cx(f.i)},${y(f.hi)}`), ...[...fc].reverse().map((f) => `${cx(f.i)},${y(f.lo)}`)].join(" ") : "";

  const kpis: { l: string; v: string; cls?: string; s?: string }[] = [
    {
      l: current ? "Разрыв сейчас" : "Разрыв",
      v: lastIdx >= 0 ? fmtSigned(Math.round(base)) : "—",
      cls: toneCls(base),
      s: lastIdx >= 0 ? `на ${dayNum(rows[lastIdx].day)} ${dow(rows[lastIdx].day)}` : "месяц не начался",
    },
  ];
  if (showFc) kpis.push({ l: `К концу ${SPAN_W[span].gen}`, v: fmtSigned(Math.round(final)), cls: toneCls(final), s: "при текущем темпе" });
  if (p.needPerDay != null && p.remainingW > 0 && p.plan > 0)
    kpis.push({ l: "Нужно в день", v: fmtNum(p.needPerDay), cls: p.needPerDay > p.dailyPlan * 1.05 ? "d2-red" : "", s: `план ${fmtNum(p.dailyPlan)}` });
  if (lastIdx >= 0 && minI >= 0) kpis.push({ l: "Худший день", v: fmtSigned(Math.round(past[minI].deviation)), s: `${dayNum(past[minI].day)} ${dow(past[minI].day)}` });

  const hv = hi != null ? rows[hi] : null;
  const hf = hi != null ? fc.find((f) => f.i === hi) : undefined;

  return (
    <section className="card d2-ch">
      <div className="d2-ch-head">
        <h3 className="d2-h"><Icon name="trend" size={15} className="title-ic" />Накопительный разрыв к плану</h3>
        <div className="d2-leg">
          <span><i className="ln" style={{ background: "var(--c-red-fg)" }} />Факт</span>
          {showFc && (
            <span>
              <i className="sq" style={{ background: "repeating-linear-gradient(135deg, var(--ink-25) 0 1px, transparent 1px 3px)", boxShadow: "inset 0 0 0 1px var(--ink-08)" }} />
              Прогноз (коридор)
            </span>
          )}
          <span><i className="sq" style={{ background: "var(--ink-05)" }} />Выходные</span>
        </div>
      </div>
      <div className="d2-gk">
        {kpis.map((k) => (
          <div key={k.l}>
            <div className="d2-gk-l">{k.l}</div>
            <div className={`d2-gk-v ${k.cls ?? ""}`}>{k.v}</div>
            {k.s && <div className="d2-gk-s">{k.s}</div>}
          </div>
        ))}
      </div>
      <div ref={box} className="d2-plot">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} onMouseLeave={() => setHi(null)}>
          <defs>
            <pattern id={`h${pid}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--ink-25)" strokeWidth="1" />
            </pattern>
            <clipPath id={`cp${pid}`}>
              <rect x={0} y={0} width={W} height={y0} />
            </clipPath>
            <clipPath id={`cn${pid}`}>
              <rect x={0} y={y0} width={W} height={H} />
            </clipPath>
            <linearGradient id={`gn${pid}`} gradientUnits="userSpaceOnUse" x1="0" y1={y0} x2="0" y2={y(sc.min)}>
              <stop offset="0" style={{ stopColor: "var(--c-red-fg)", stopOpacity: 0.04 }} />
              <stop offset="1" style={{ stopColor: "var(--c-red-fg)", stopOpacity: 0.3 }} />
            </linearGradient>
            <linearGradient id={`gp${pid}`} gradientUnits="userSpaceOnUse" x1="0" y1={y0} x2="0" y2={y(sc.max)}>
              <stop offset="0" style={{ stopColor: "var(--c-green-fg)", stopOpacity: 0.04 }} />
              <stop offset="1" style={{ stopColor: "var(--c-green-fg)", stopOpacity: 0.3 }} />
            </linearGradient>
            <linearGradient id={`gf${pid}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" style={{ stopColor: "var(--text-sub)", stopOpacity: 0.16 }} />
              <stop offset="1" style={{ stopColor: "var(--text-sub)", stopOpacity: 0.05 }} />
            </linearGradient>
          </defs>

          {rows.map((r, i) =>
            !r.isWork ? <rect key={`w${i}`} x={colX(i) + 1} y={T} width={colX(i + 1) - colX(i) - 2} height={H - B - T} rx={2} fill="var(--ink-05)" /> : null,
          )}
          {hi != null && <rect x={colX(hi) + 1} y={T} width={colX(hi + 1) - colX(hi) - 2} height={H - T - 2} rx={3} fill="var(--ink-05)" />}
          {ticks.map((v) => (
            <g key={v}>
              {v !== 0 && <path fill="none" d={`M${L},${crisp(y(v))}H${W - R}`} stroke="var(--ink-06)" />}
              <text style={tr(L - 8, Math.round(y(v)) + 3.5)} textAnchor="end" fontSize="10" fill={v === 0 ? "var(--text)" : "var(--text-sub)"} fontWeight={v === 0 ? 600 : 400}>
                {v > 0 ? `+${v}` : v}
              </text>
            </g>
          ))}

          {/* прогноз: веер между «дальше по плану» и «текущий темп» */}
          {band && (
            <g className="d2-fade" style={{ "--d": "0.55s" } as CSSProperties}>
              <path d={ptsD(band, true)} fill={`url(#gf${pid})`} />
              <path d={ptsD(band, true)} fill={`url(#h${pid})`} opacity={0.7} />
              <path fill="none" d={`M${cx(fc[0].i)},${crisp(y(base))}H${cx(endFc.i)}`} stroke="var(--text-sub3)" strokeDasharray="1.5 3" />
              <path d={ptsD(fc.map((f) => `${cx(f.i)},${y(f.mid)}`).join(" "), false)} fill="none" stroke={tone(final)} strokeOpacity={0.75} strokeWidth={1.5} strokeDasharray="4 3" />
              <circle cx={cx(endFc.i)} cy={y(endFc.mid)} r={3} fill="var(--bg-panel)" stroke={tone(final)} strokeWidth={1.5} />
            </g>
          )}

          <path fill="none" d={`M${L},${crisp(y0)}H${W - R}`} stroke="var(--text-sub3)" />

          {/* факт: линия + заливка до нуля, зелёная выше плана, красная ниже */}
          {pts.length > 0 && (
            <>
              <g className="d2-fade" style={{ "--d": "0.25s" } as CSSProperties}>
                <path d={ptsD(area, true)} fill={`url(#gp${pid})`} clipPath={`url(#cp${pid})`} />
                <path d={ptsD(area, true)} fill={`url(#gn${pid})`} clipPath={`url(#cn${pid})`} />
              </g>
              <path className="d2-draw" pathLength={1} d={ptsD(line, false)} fill="none" stroke="var(--c-green-fg)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#cp${pid})`} />
              <path className="d2-draw" pathLength={1} d={ptsD(line, false)} fill="none" stroke="var(--c-red-fg)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#cn${pid})`} />
              <g className="d2-fade" style={{ "--d": "0.45s" } as CSSProperties}>
                {past.map((r, i) =>
                  r.isWork && i !== lastIdx ? (
                    <circle key={`d${i}`} cx={pts[i][0]} cy={pts[i][1]} r={2.5} fill="var(--bg-panel)" stroke={tone(r.deviation)} strokeWidth={1.5} />
                  ) : null,
                )}
              </g>
            </>
          )}

          {/* сегодня */}
          {lastIdx >= 0 && (
            <g className="d2-fade" style={{ "--d": "0.6s" } as CSSProperties}>
              {current && (
                <>
                  <path fill="none" d={`M${crisp(cx(lastIdx))},${T - 4}V${H - B}`} stroke="var(--text-sub3)" strokeDasharray="2 2" />
                  <text style={tr(Math.round(cx(lastIdx)), T - 8)} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--text-sub)">
                    сегодня
                  </text>
                </>
              )}
              {current && <circle className="d2-pulse" cx={cx(lastIdx)} cy={y(base)} r={6} fill={tone(base)} />}
              <circle cx={cx(lastIdx)} cy={y(base)} r={4.5} fill={tone(base)} stroke="var(--bg-panel)" strokeWidth={2} />
              {Math.abs(base) >= 0.5 && (
                <Pill
                  x={cx(lastIdx) + (lastIdx > n - 4 ? -10 : 10)}
                  cy={clampY(y(base) + (base < 0 ? 15 : -15))}
                  text={fmtSigned(Math.round(base))}
                  color={tone(base)}
                  anchor={lastIdx > n - 4 ? "end" : "start"}
                />
              )}
            </g>
          )}
          {minI >= 0 && minI !== lastIdx && (
            <text className="d2-fade" style={tr(Math.round(pts[minI][0]), Math.round(pts[minI][1]) + 15)} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--c-red-fg)">
              {fmtSigned(Math.round(past[minI].deviation))}
            </text>
          )}
          {maxI >= 0 && maxI !== lastIdx && (
            <text className="d2-fade" style={tr(Math.round(pts[maxI][0]), Math.round(pts[maxI][1]) - 9)} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--c-green-fg)">
              {fmtSigned(Math.round(past[maxI].deviation))}
            </text>
          )}

          {/* итог прогноза — плашкой у конца веера, внутри области графика */}
          {endFc && fc.length > 2 && (
            <g className="d2-fade" style={{ "--d": "0.8s" } as CSSProperties}>
              <Pill x={cx(endFc.i) - 10} cy={clampY(y(endFc.mid))} text={`${fmtSigned(Math.round(endFc.mid))} при текущем темпе`} color={tone(final)} anchor="end" />
              {Math.abs(y(base) - y(endFc.mid)) > 24 && Math.abs(base) >= 0.5 && (
                <Pill x={cx(endFc.i) - 10} cy={clampY(y(base) - 13)} text={`${fmtSigned(Math.round(base))} если по плану`} color="var(--text-sub)" anchor="end" />
              )}
            </g>
          )}

          {/* наведение: линия дня и точка на факте или прогнозе */}
          {hv && (
            <g pointerEvents="none">
              <path fill="none" d={`M${crisp(cx(hi!))},${T}V${H - B}`} stroke="var(--ink-25)" />
              {!hv.future && <circle cx={cx(hi!)} cy={y(hv.deviation)} r={4.5} fill={tone(hv.deviation)} stroke="var(--bg-panel)" strokeWidth={2} />}
              {hv.future && hf && <circle cx={cx(hi!)} cy={y(hf.mid)} r={4} fill="var(--bg-panel)" stroke={tone(final)} strokeWidth={2} />}
            </g>
          )}

          {rows.map((r, i) => {
            const td = current && i === lastIdx;
            const on = td || i === hi;
            const c = on ? "var(--text)" : r.isWork ? "var(--text-sub)" : "var(--dim)";
            const x = Math.round(cx(i));
            return (
              <g key={`x${i}`}>
                {(sw >= 13 || on || i % 2 === 0) && (
                  <text style={tr(x, H - B + 16)} textAnchor="middle" fontSize="10" fill={c} fontWeight={on ? 700 : 400}>
                    {dayNum(r.day)}
                  </text>
                )}
                {(sw >= 17 || on) && (
                  <text style={tr(x, H - B + 29)} textAnchor="middle" fontSize="9" fill={c} fontWeight={on ? 600 : 400}>
                    {dow(r.day)}
                  </text>
                )}
                <rect x={colX(i)} y={0} width={colX(i + 1) - colX(i)} height={H} fill="transparent" onMouseEnter={() => setHi(i)} />
              </g>
            );
          })}
        </svg>
        {hv && (
          <ChartTip x={cx(hi!)} W={W}>
            <div className="d2-ctip-h">
              {fmtDay(hv.day)}, {dow(hv.day)}
              <span>{current && hi === lastIdx ? "сегодня" : !hv.isWork ? "выходной" : hv.future ? "впереди" : ""}</span>
            </div>
            {!hv.future ? (
              <div className="d2-ctip-g">
                <span>Лидов за день</span>
                <b>{fmtInt(hv.count)}</b>
                <span>Факт с начала</span>
                <b>{fmtInt(hv.cum)}</b>
                <span>По плану</span>
                <b>{fmtNum(hv.cumPlan)}</b>
                <span>Разрыв</span>
                <b className={toneCls(hv.deviation)}>{fmtSigned(Math.round(hv.deviation))}</b>
              </div>
            ) : hf ? (
              <div className="d2-ctip-g">
                <span>Если по плану</span>
                <b className={toneCls(base)}>{fmtSigned(Math.round(base))}</b>
                <span>При текущем темпе</span>
                <b className={toneCls(hf.mid)}>{fmtSigned(Math.round(hf.mid))}</b>
              </div>
            ) : (
              <div className="d2-ctip-g">
                <span>Ещё не наступил</span>
                <b />
              </div>
            )}
          </ChartTip>
        )}
      </div>
    </section>
  );
}

/* ── эта неделя против прошлой ─────────────────────────────────────── */

export function WeekCard({ cal, p, ref_, counts, focus }: { cal: MonthCal; p: Pace; ref_: DayKey; counts: Map<DayKey, number> | undefined; focus?: DayKey }) {
  const { data } = useCrm();
  const [box, W] = useChartWidth();
  const [hi, setHi] = useState<number | null>(null);
  const ws = weekStart(ref_);
  const days = rangeDays(ws, addDays(ws, 6));
  const live = cal.phase !== "future";
  const cur = days.map((d) => (d <= ref_ && live ? counts?.get(d) ?? 0 : null));
  const prev = days.map((d) => counts?.get(addDays(d, -7)) ?? 0);
  const thisWeek = cur.reduce<number>((a, v) => a + (v ?? 0), 0);
  const prevWeek = prev.reduce((a, v) => a + v, 0);
  const upTo = cur.filter((v) => v != null).length;
  const prevSame = prev.slice(0, upTo).reduce((a, v) => a + v, 0);
  const change = prevSame > 0 ? thisWeek / prevSame - 1 : null;
  const refIdx = cal.phase === "current" ? days.indexOf(cal.today) : -1;
  // режим «день»: выбранный день отмечен так же, как «сегодня»
  const fIdx = focus && focus !== cal.today ? days.indexOf(focus) : -1;
  // впереди по графику — пунктиром «сколько нужно в день», чтобы закрыть месяц
  const need = days.map((d, i) => (cal.phase === "current" && i > refIdx && cal.isWork(d) && p.needPerDay != null && p.needPerDay > 0 ? p.needPerDay : null));
  const best = cur.reduce<number>((b, v, i) => (v != null && v > 0 && (b < 0 || v > (cur[b] ?? 0)) ? i : b), -1);
  // рабочий день — по графику из настроек: неделя может захватывать соседний месяц
  const workLike = (d: DayKey) => isWorkday(d, data.settings);
  const workedCur = days.filter((d, i) => cur[i] != null && (workLike(d) || (cur[i] ?? 0) > 0)).length;
  const avg = workedCur ? thisWeek / workedCur : null;

  const { H, L, R, T, B } = CH;
  const top = Math.max(...prev, ...cur.map((v) => v ?? 0), ...need.map((v) => v ?? 0), p.dailyPlan, 1);
  const step = axisStep((top * 1.08) / CH.parts);
  const yMax = step * CH.parts;
  const y = (v: number) => Math.round(T + (1 - v / yMax) * (H - T - B));
  const y0 = y(0);
  const sw = (W - L - R) / 7;
  const colX = (i: number) => Math.round(L + sw * i);
  const bw = Math.round(Math.max(6, Math.min(24, sw * 0.26)));
  const ticks = Array.from({ length: CH.parts + 1 }, (_, k) => k * step);
  const planY = p.dailyPlan > 0 ? T + (1 - p.dailyPlan / yMax) * (H - T - B) : null;

  const kpis: { l: string; v: string; cls?: string; s: string }[] = [
    { l: "Текущая неделя", v: fmtInt(thisWeek), s: upTo ? `за ${upTo} ${plural(upTo, DAYS)}` : "ещё не началась" },
    { l: "Прошлая неделя", v: fmtInt(prevWeek), s: upTo && upTo < 7 ? `за те же дни ${fmtInt(prevSame)}` : "за 7 дней" },
    {
      l: "Изменение",
      v: change == null ? "—" : `${change >= 0 ? "+" : "−"}${fmtPct(Math.abs(change))}`,
      cls: change == null || change >= 0 ? "" : "d2-red",
      s: "к тем же дням",
    },
    {
      l: "В среднем",
      v: avg == null ? "—" : fmtNum(avg),
      cls: avg != null && p.dailyPlan > 0 && avg < p.dailyPlan ? "d2-red" : "",
      s: best >= 0 ? `лучший ${DOW[best]} · ${fmtInt(cur[best] ?? 0)}` : "в рабочий день",
    },
  ];

  const hd = hi != null ? days[hi] : null;
  const hv = hi != null ? cur[hi] : null;
  const hDiff = hi != null && hv != null ? hv - prev[hi] : null;

  return (
    <section className="card d2-ch">
      <div className="d2-ch-head">
        <h3 className="d2-h"><Icon name="chart" size={15} className="title-ic" />Эта неделя vs прошлая</h3>
        <div className="d2-leg">
          <span><i className="sq" style={{ background: "var(--ink-15)" }} />Прошлая</span>
          <span><i className="sq" style={{ background: "var(--brand)" }} />Текущая</span>
          {need.some((v) => v != null) && <span><i className="sq" style={{ boxShadow: "inset 0 0 0 1px var(--text-sub3)" }} />Нужно</span>}
          {p.dailyPlan > 0 && <span><i className="ln dash" />План</span>}
        </div>
      </div>
      <div className="d2-gk">
        {kpis.map((k) => (
          <div key={k.l}>
            <div className="d2-gk-l">{k.l}</div>
            <div className={`d2-gk-v ${k.cls ?? ""}`}>{k.v}</div>
            <div className="d2-gk-s">{k.s}</div>
          </div>
        ))}
      </div>
      <div ref={box} className="d2-plot">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} onMouseLeave={() => setHi(null)}>
          {refIdx >= 0 && <rect x={colX(refIdx) + 2} y={T - 18} width={colX(refIdx + 1) - colX(refIdx) - 4} height={H - T + 17} rx={6} fill="var(--ink-04)" />}
          {hi != null && hi !== refIdx && hi !== fIdx && <rect x={colX(hi) + 2} y={T - 18} width={colX(hi + 1) - colX(hi) - 4} height={H - T + 17} rx={6} fill="var(--ink-03)" />}
          {fIdx >= 0 && <rect x={colX(fIdx) + 2} y={T - 18} width={colX(fIdx + 1) - colX(fIdx) - 4} height={H - T + 17} rx={6} fill="var(--ink-04)" />}
          {refIdx >= 0 && (
            <text style={tr(Math.round(L + sw * refIdx + sw / 2), T - 8)} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--text-sub)">
              сегодня
            </text>
          )}
          {fIdx >= 0 && (
            <text style={tr(Math.round(L + sw * fIdx + sw / 2), T - 8)} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--text-sub)">
              выбран
            </text>
          )}
          {ticks.map((v) => (
            <g key={v}>
              <path fill="none" d={`M${L},${crisp(y(v))}H${W - R}`} stroke={v === 0 ? "var(--text-sub3)" : "var(--ink-06)"} />
              <text style={tr(L - 8, y(v) + 3.5)} textAnchor="end" fontSize="10" fill="var(--text-sub)">
                {v}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const c = L + sw * i + sw / 2;
            const v = cur[i];
            const nd = need[i];
            const px = Math.round(c - 2) - bw;
            const cx2 = Math.round(c + 2);
            const td = i === refIdx;
            const done = v != null && !td;
            const below = done && p.dailyPlan > 0 && workLike(d) && v < p.dailyPlan;
            const diff = v != null ? v - prev[i] : null;
            const on = td || i === hi || i === fIdx;
            const dim = hi != null && hi !== i;
            const lx = Math.round(c);
            return (
              <g key={d} className="d2-col" style={{ opacity: dim ? 0.45 : 1 }}>
                <path className="d2-grow" style={{ "--i": i } as CSSProperties} d={barPath(px, y(prev[i]), bw, y0 - y(prev[i]))} fill="var(--ink-15)" />
                {prev[i] > 0 && (
                  <text className="d2-fade" style={tr(px + bw / 2, y(prev[i]) - 5)} textAnchor="middle" fontSize="9.5" fill="var(--text-sub)">
                    {prev[i]}
                  </text>
                )}
                {v != null && (
                  <>
                    <path
                      className="d2-grow"
                      style={{ "--i": i + 1 } as CSSProperties}
                      d={barPath(cx2, y(v), bw, y0 - y(v))}
                      fill={below ? "var(--c-red-fg)" : "var(--brand)"}
                      opacity={below ? 0.8 : 1}
                    />
                    <text className="d2-fade" style={tr(cx2 + bw / 2, y(v) - 5)} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={below ? "var(--c-red-fg)" : "var(--text)"}>
                      {v}
                    </text>
                  </>
                )}
                {v == null && nd != null && (
                  <>
                    <rect x={cx2 + 0.5} y={y(nd) + 0.5} width={bw - 1} height={Math.max(0, y0 - y(nd) - 1)} rx={3} fill="none" stroke="var(--text-sub3)" strokeDasharray="3 2" />
                    <text style={tr(cx2 + bw / 2, y(nd) - 5)} textAnchor="middle" fontSize="9.5" fill="var(--dim)">
                      {Math.ceil(nd)}
                    </text>
                  </>
                )}
                <text style={tr(lx, H - B + 16)} textAnchor="middle" fontSize="10" fill={on ? "var(--text)" : "var(--text-sub)"} fontWeight={on ? 700 : 500}>
                  {DOW[i]} <tspan fontWeight={400} fill={on ? "var(--text-sub)" : "var(--dim)"}>{dayNum(d)}</tspan>
                </text>
                {diff != null && (v !== 0 || prev[i] !== 0) && (
                  <text style={tr(lx, H - B + 29)} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={diff < 0 ? "var(--c-red-fg)" : diff > 0 ? "var(--text-sub)" : "var(--dim)"}>
                    {diff === 0 ? "=" : fmtSigned(diff)}
                  </text>
                )}
              </g>
            );
          })}
          {planY != null && (
            <g pointerEvents="none">
              <path fill="none" d={`M${L},${crisp(planY)}H${W - R}`} stroke="var(--text-sub)" strokeOpacity={0.6} strokeDasharray="4 3" />
              <Pill x={W - R} cy={Math.round(planY) - 10} text={`план ${fmtNum(p.dailyPlan)}`} color="var(--text-sub)" anchor="end" />
            </g>
          )}
          {days.map((d, i) => (
            <rect key={`h${d}`} x={colX(i)} y={0} width={colX(i + 1) - colX(i)} height={H} fill="transparent" onMouseEnter={() => setHi(i)} />
          ))}
        </svg>
        {hd && (
          <ChartTip x={L + sw * hi! + sw / 2} W={W} half={sw / 2}>
            <div className="d2-ctip-h">
              {DOW[hi!]}, {fmtDay(hd)}
              <span>{hi === refIdx ? "сегодня" : hv == null ? "впереди" : !workLike(hd) ? "выходной" : ""}</span>
            </div>
            <div className="d2-ctip-g">
              <span><i style={{ background: "var(--brand)" }} />Эта неделя</span>
              <b>{hv == null ? "—" : fmtInt(hv)}</b>
              <span><i style={{ background: "var(--ink-15)" }} />Неделей раньше</span>
              <b>{fmtInt(prev[hi!])}</b>
              {hDiff != null && (
                <>
                  <span>Разница</span>
                  <b className={hDiff < 0 ? "d2-red" : ""}>{hDiff === 0 ? "=" : fmtSigned(hDiff)}</b>
                </>
              )}
              {need[hi!] != null && (
                <>
                  <span>Нужно, чтобы закрыть</span>
                  <b>{Math.ceil(need[hi!]!)}</b>
                </>
              )}
              {p.dailyPlan > 0 && workLike(hd) && (
                <>
                  <span>План на день</span>
                  <b>{fmtNum(p.dailyPlan)}</b>
                </>
              )}
            </div>
          </ChartTip>
        )}
      </div>
    </section>
  );
}

/* ── лиды по часам: режим «день» ───────────────────────────────────── */

/** День против того же дня неделей раньше — по часам (время лида — по Москве, как в журнале). */
function HourCard({ day, keys, plan }: { day: DayKey; keys: string[] | null; plan: number }) {
  const { data, today } = useCrm();
  const [box, W] = useChartWidth();
  const [hi, setHi] = useState<number | null>(null);
  const prevDay = addDays(day, -7);
  const { cur, prev } = useMemo(() => {
    const set = keys ? new Set(keys) : null;
    const cur = new Array<number>(24).fill(0);
    const prev = new Array<number>(24).fill(0);
    for (const l of data.leads) {
      // как в факте: «не доведён» не считается
      if (l.status === "failed") continue;
      const d = l.at.slice(0, 10);
      if (d !== day && d !== prevDay) continue;
      if (set && !set.has(l.groupId || NO_GROUP)) continue;
      const h = Number(l.at.slice(11, 13));
      if (!(h >= 0 && h < 24)) continue;
      (d === day ? cur : prev)[h]++;
    }
    return { cur, prev };
  }, [data.leads, day, prevDay, keys]);

  const isToday = day === today;
  const future = day > today;
  const nowH = isToday ? nowHour() : future ? -1 : 23;
  const any = (a: number[]) => a.findIndex((v) => v > 0);
  const lastAny = (a: number[]) => 23 - [...a].reverse().findIndex((v) => v > 0);
  const firstH = Math.min(9, ...[any(cur), any(prev)].filter((h) => h >= 0));
  const lastH = Math.max(20, ...[cur, prev].filter((a) => any(a) >= 0).map(lastAny), isToday ? nowH : 0);
  const hours = rangeHours(firstH, Math.min(23, lastH));
  const val = (h: number) => (h > nowH ? null : cur[h]);

  const total = cur.reduce((a, v) => a + v, 0);
  const prevTotal = prev.reduce((a, v) => a + v, 0);
  const prevTo = prev.slice(0, nowH + 1).reduce((a, v) => a + v, 0);
  const totalTo = cur.slice(0, nowH + 1).reduce((a, v) => a + v, 0);
  const change = prevTo > 0 && !future ? totalTo / prevTo - 1 : null;
  const peak = cur.reduce((b, v, h) => (v > 0 && (b < 0 || v > cur[b]) ? h : b), -1);
  const slot = (h: number) => `${h}:00–${h + 1}:00`;

  const { H, L, R, T, B } = CH;
  const top = Math.max(...hours.map((h) => Math.max(cur[h], prev[h])), 1);
  const step = axisStep((top * 1.08) / CH.parts);
  const yMax = step * CH.parts;
  const y = (v: number) => Math.round(T + (1 - v / yMax) * (H - T - B));
  const y0 = y(0);
  const n = hours.length;
  const sw = (W - L - R) / n;
  const colX = (i: number) => Math.round(L + sw * i);
  const bw = Math.round(Math.max(4, Math.min(16, sw * 0.3)));
  const ticks = Array.from({ length: CH.parts + 1 }, (_, k) => k * step);
  const nowIdx = isToday ? hours.indexOf(nowH) : -1;

  const kpis: { l: string; v: string; cls?: string; s: string }[] = [
    { l: isToday ? "Сегодня" : "За день", v: fmtInt(total), s: future ? "ещё впереди" : isToday ? `к ${nowH + 1}:00` : plan > 0 ? `из ${fmtNum(plan, 0)} по плану` : "лидов" },
    { l: "Неделю назад", v: fmtInt(prevTotal), s: isToday ? `к этому часу ${fmtInt(prevTo)}` : `${dow(prevDay)}, ${dayShort(prevDay)}` },
    {
      l: "Изменение",
      v: change == null ? "—" : `${change >= 0 ? "+" : "−"}${fmtPct(Math.abs(change))}`,
      cls: change == null || change >= 0 ? "" : "d2-red",
      s: isToday ? "к тому же часу" : "к прошлой неделе",
    },
    { l: "Пиковый час", v: peak >= 0 ? `${peak}:00` : "—", s: peak >= 0 ? `${fmtInt(cur[peak])} ${plural(cur[peak], LEADS)}` : "лидов не было" },
  ];

  const hh = hi != null ? hours[hi] : null;
  const cumTo = (h: number) => cur.slice(0, h + 1).reduce((a, v) => a + v, 0);

  return (
    <section className="card d2-ch">
      <div className="d2-ch-head">
        <h3 className="d2-h"><Icon name="clock" size={15} className="title-ic" />Лиды по часам</h3>
        <div className="d2-leg">
          <span><i className="sq" style={{ background: "var(--ink-15)" }} />Неделю назад</span>
          <span><i className="sq" style={{ background: "var(--brand)" }} />{isToday ? "Сегодня" : dayShort(day)}</span>
        </div>
      </div>
      <div className="d2-gk">
        {kpis.map((k) => (
          <div key={k.l}>
            <div className="d2-gk-l">{k.l}</div>
            <div className={`d2-gk-v ${k.cls ?? ""}`}>{k.v}</div>
            <div className="d2-gk-s">{k.s}</div>
          </div>
        ))}
      </div>
      <div ref={box} className="d2-plot">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }} onMouseLeave={() => setHi(null)}>
          {nowIdx >= 0 && <rect x={colX(nowIdx) + 2} y={T - 18} width={colX(nowIdx + 1) - colX(nowIdx) - 4} height={H - T + 17} rx={6} fill="var(--ink-04)" />}
          {hi != null && hi !== nowIdx && <rect x={colX(hi) + 2} y={T - 18} width={colX(hi + 1) - colX(hi) - 4} height={H - T + 17} rx={6} fill="var(--ink-03)" />}
          {nowIdx >= 0 && (
            <text style={tr(Math.round(L + sw * nowIdx + sw / 2), T - 8)} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--text-sub)">
              сейчас
            </text>
          )}
          {ticks.map((v) => (
            <g key={v}>
              <path fill="none" d={`M${L},${crisp(y(v))}H${W - R}`} stroke={v === 0 ? "var(--text-sub3)" : "var(--ink-06)"} />
              <text style={tr(L - 8, y(v) + 3.5)} textAnchor="end" fontSize="10" fill="var(--text-sub)">
                {v}
              </text>
            </g>
          ))}
          {hours.map((h, i) => {
            const c = L + sw * i + sw / 2;
            const v = val(h);
            const px = Math.round(c - 1.5) - bw;
            const cx2 = Math.round(c + 1.5);
            const on = i === nowIdx || i === hi;
            const dim = hi != null && hi !== i;
            const lx = Math.round(c);
            const diff = v != null ? v - prev[h] : null;
            return (
              <g key={h} className="d2-col" style={{ opacity: dim ? 0.45 : 1 }}>
                <path className="d2-grow" style={{ "--i": i * 0.5 } as CSSProperties} d={barPath(px, y(prev[h]), bw, y0 - y(prev[h]), 2)} fill="var(--ink-15)" />
                {v != null && (
                  <>
                    <path className="d2-grow" style={{ "--i": i * 0.5 + 0.5 } as CSSProperties} d={barPath(cx2, y(v), bw, y0 - y(v), 2)} fill="var(--brand)" />
                    {v > 0 && (
                      <text className="d2-fade" style={tr(cx2 + bw / 2, y(v) - 5)} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text)">
                        {v}
                      </text>
                    )}
                  </>
                )}
                <text style={tr(lx, H - B + 16)} textAnchor="middle" fontSize="10" fill={on ? "var(--text)" : "var(--text-sub)"} fontWeight={on ? 700 : 500}>
                  {h}
                  <tspan fontWeight={400} fill="var(--dim)">:00</tspan>
                </text>
                {diff != null && (v !== 0 || prev[h] !== 0) && (
                  <text style={tr(lx, H - B + 29)} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={diff < 0 ? "var(--c-red-fg)" : diff > 0 ? "var(--text-sub)" : "var(--dim)"}>
                    {diff === 0 ? "=" : fmtSigned(diff)}
                  </text>
                )}
              </g>
            );
          })}
          {hours.map((h, i) => (
            <rect key={`h${h}`} x={colX(i)} y={0} width={colX(i + 1) - colX(i)} height={H} fill="transparent" onMouseEnter={() => setHi(i)} />
          ))}
        </svg>
        {hh != null && (
          <ChartTip x={L + sw * hi! + sw / 2} W={W} half={sw / 2}>
            <div className="d2-ctip-h">
              {slot(hh)}
              <span>{hi === nowIdx ? "сейчас" : val(hh) == null ? "впереди" : ""}</span>
            </div>
            <div className="d2-ctip-g">
              <span><i style={{ background: "var(--brand)" }} />{isToday ? "Сегодня" : dayShort(day)}</span>
              <b>{val(hh) == null ? "—" : fmtInt(cur[hh])}</b>
              <span><i style={{ background: "var(--ink-15)" }} />Неделю назад</span>
              <b>{fmtInt(prev[hh])}</b>
              {val(hh) != null && (
                <>
                  <span>С начала дня</span>
                  <b>
                    {fmtInt(cumTo(hh))}
                    {plan > 0 && <span className="d2-dim" style={{ fontWeight: 500 }}> из {fmtNum(plan, 0)}</span>}
                  </b>
                </>
              )}
            </div>
          </ChartTip>
        )}
      </div>
    </section>
  );
}

const rangeHours = (a: number, b: number) => Array.from({ length: Math.max(1, b - a + 1) }, (_, i) => a + i);

/* ── операторы ─────────────────────────────────────────────────────── */

const ABSENT_LABEL: Partial<Record<DayType, string>> = { off: "Выходной", vacation: "Отпуск", sick: "Больничный", platform: "Платформа" };

/**
 * Разбивка операторов по группам для сводки «весь отдел» (и «все мои группы»): порядок — как у
 * групп сводки, затем «без группы», отдельными блоками стажёры (у них ещё нет плана) и уволенные,
 * работавшие в периоде (их лиды и часы — в итогах команды).
 * Выбрана конкретная группа — без разбивки (null).
 */
const TRAINEES = "__trainees__";
const GONE = "__gone__";
function groupSections(list: OpRow[], groups?: GroupRow[] | null): { key: string; name: string; color: string; rows: OpRow[] }[] | null {
  if (!groups) return null;
  const map = new Map<string, OpRow[]>();
  for (const r of list) {
    const key = r.op.status === "fired" ? GONE : r.op.role === "trainee" ? TRAINEES : r.groupKey;
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  if (!map.size) return null;
  const order = new Map(groups.map((g, i) => [g.key, i]));
  const rank = (key: string) => (key === GONE ? 1e6 + 2 : key === TRAINEES ? 1e6 + 1 : order.get(key) ?? 1e6);
  return [...map.entries()]
    .map(([key, rows]) => {
      const g = key === TRAINEES || key === GONE ? null : groups.find((x) => x.key === key);
      return { key, name: key === GONE ? "Уволены" : key === TRAINEES ? "Стажёры" : g?.name ?? NO_GROUP_LABEL, color: g?.color ?? "gray", rows };
    })
    .sort((a, b) => rank(a.key) - rank(b.key) || a.name.localeCompare(b.name, "ru"));
}

/** Столбцы таблицы операторов: порядок — перетаскиванием заголовков, набор — «Столбцы». Своё у каждого аккаунта. */
const OPS_COLS = ["status", "group", "fact", "should", "gap", "prog", "plan", "forecast", "need", "recent", "avg", "shifts", "hours", "conv", "spark"] as const;
type OpsCol = (typeof OPS_COLS)[number];
const OPS_DEFAULT: OpsCol[] = ["status", "group", "fact", "should", "gap", "prog", "forecast", "need", "recent", "hours", "conv", "spark"];

function mergeVisible(full: string[], visibleNext: string[]): string[] {
  const vis = new Set(visibleNext);
  let i = 0;
  return full.map((k) => (vis.has(k) ? visibleNext[i++] : k));
}

function OpsCard({ m, line, settings, ref_, groups, span = "month" }: { m: MonthModel; line: OpRow[]; settings: Settings; ref_: DayKey; groups?: GroupRow[] | null; span?: Span }) {
  const w = SPAN_W[span];
  const isDay = span === "day";
  const { ix, today } = useCrm();
  const router = useRouter();
  const cal = m.cal;
  const cur = cal.phase === "current";
  const past = cal.phase === "past";
  const yday = addDays(ref_, -1);

  const vis = useColumnVisibility("dash-ops", OPS_COLS, OPS_DEFAULT);
  const colOrder = useColumnOrder("dash-ops", OPS_COLS);
  const shown = useMemo(() => colOrder.order.filter((k) => vis.shown.has(k)) as OpsCol[], [colOrder.order, vis.shown]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const colDrag = useColumnDrag({ wrapRef, order: shown, onChange: (next) => colOrder.save(mergeVisible(colOrder.order, next)) });

  const title: Record<OpsCol, { label: string; hint?: string }> = {
    status: { label: cur ? "Сегодня" : "Статус" },
    group: { label: "Группа" },
    fact: { label: "Факт", hint: `Лидов за ${w.acc}` },
    should: { label: past ? "План" : "Должно быть", hint: past ? `План на ${w.acc}` : "Сколько должно быть к сегодня по плану" },
    gap: { label: "Разрыв", hint: "Факт минус «должно быть»" },
    prog: { label: `Выполнение плана${past ? "" : " на сегодня"}` },
    plan: { label: `План на ${w.acc}` },
    forecast: { label: "Прогноз", hint: `Сколько выйдет к концу ${w.gen} при текущем темпе` },
    need: { label: "Нужно в день", hint: `Сколько лидов в рабочий день нужно до конца ${w.gen}, чтобы закрыть план` },
    recent: { label: cur ? "Сегодня / вчера" : "Посл. день / до него", hint: "Лиды за последние два дня" },
    avg: { label: "В среднем за смену", hint: "Лидов в рабочий день" },
    shifts: { label: "Смен", hint: `Отработано смен за ${w.acc}` },
    hours: { label: "Часы" },
    conv: { label: "Конв.", hint: "Конверсия: лиды ÷ отработанные часы" },
    spark: { label: "Динамика (7 смен)", hint: "Лиды за последние 7 рабочих смен — выходные не считаются" },
  };

  const list = useMemo(
    () =>
      [...line].sort((a, b) => {
        const ap = a.terms.plan > 0 ? 0 : 1;
        const bp = b.terms.plan > 0 ? 0 : 1;
        return ap - bp || a.pace.deviation - b.pace.deviation || b.pace.fact - a.pace.fact;
      }),
    [line],
  );

  // разбивка по группам: порядок — как у групп сводки, «без группы» в конце; внутри — по разрыву
  const sections = useMemo(() => groupSections(list, groups), [list, groups]);
  // стажёры и уволенные при входе свёрнуты: у стажёров нет плана, уволенные — только для сверки итогов
  const fold = useFoldGroups(wrapRef, [TRAINEES, GONE]);

  const todayState = (r: OpRow): { hue: string; label: string } => {
    if (r.op.status === "fired") return { hue: "gray", label: "Уволен" };
    if (r.op.status === "pause") return { hue: "gray", label: "На паузе" };
    const sh = ix.shift.get(`${today}|${r.op.id}`);
    if (sh && isWorked(sh.type, sh.hours)) {
      const n = ix.opDay.get(r.op.id)?.get(today) ?? 0;
      return { hue: n > 0 ? "green" : "red", label: `На смене (${n} ${plural(n, LEADS)})` };
    }
    if (sh) return { hue: "gray", label: ABSENT_LABEL[sh.type] ?? "Нет смены" };
    return cal.isWork(today) ? { hue: "amber", label: "Без смены" } : { hue: "gray", label: "Выходной" };
  };

  const cell = (c: OpsCol, r: OpRow) => {
    const hasPlan = r.terms.plan > 0;
    const should = past ? r.terms.plan : r.pace.planToDate;
    const gap = past ? r.pace.fact - r.terms.plan : r.pace.deviation;
    const ratio = past ? r.pace.pct : r.pace.paceRatio;
    const tone = !hasPlan ? "var(--ink-25)" : ratio * 100 >= settings.normalPct ? "var(--c-green-fg)" : ratio * 100 >= settings.lagPct ? "var(--c-amber-fg)" : "var(--c-red-fg)";
    const dash = <span className="d2-dim">—</span>;
    switch (c) {
      case "status": {
        const st = cur ? todayState(r) : null;
        return (
          <td key={c} data-col={c}>
            {st ? (
              <span className="d2-st" data-hue={st.hue}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                {st.label}
              </span>
            ) : (
              <StatusChip status={r.status} />
            )}
          </td>
        );
      }
      case "group":
        return (
          <td key={c} data-col={c} className="d2-sub">
            {r.op.role === "trainee" ? "Стажёр" : r.op.groupId ? ix.groupById.get(r.op.groupId)?.name ?? NO_GROUP_LABEL : NO_GROUP_LABEL}
          </td>
        );
      case "fact":
        return (
          <td key={c} data-col={c} className={r.pace.fact === 0 && hasPlan ? "d2-red" : undefined} style={{ fontWeight: 600 }}>
            {fmtInt(r.pace.fact)}
          </td>
        );
      case "should":
        return (
          <td key={c} data-col={c}>
            {hasPlan ? fmtInt(Math.round(should)) : dash}
          </td>
        );
      case "gap":
        return (
          <td key={c} data-col={c} className={!hasPlan ? undefined : gap < -0.5 ? "d2-red" : "d2-green"} style={{ fontWeight: 600 }}>
            {hasPlan ? fmtSigned(Math.round(gap)) : dash}
          </td>
        );
      case "prog":
        return (
          <td key={c} data-col={c}>
            {hasPlan ? (
              <div className="d2-prog">
                <div className="t">
                  <b style={{ width: `${Math.max(ratio > 0 ? 2 : 3, Math.min(100, (ratio / 1.5) * 100))}%`, background: tone }} />
                  <i style={{ left: `${100 / 1.5}%` }} />
                </div>
                <span>{fmtPct(ratio)}</span>
              </div>
            ) : (
              <span style={{ color: "var(--dim)", fontSize: 12 }}>план не задан</span>
            )}
          </td>
        );
      case "plan":
        return (
          <td key={c} data-col={c}>
            {hasPlan ? fmtNum(r.terms.plan, 0) : dash}
          </td>
        );
      case "forecast":
        return (
          <td key={c} data-col={c}>
            {hasPlan && r.pace.fact > 0 && !isDay ? (
              <>
                {fmtInt(Math.round(r.pace.rr))}{" "}
                <span className={r.pace.rrPct >= 1 ? "d2-green" : "d2-red"} style={{ fontSize: 11.5 }}>
                  ({fmtPct(r.pace.rrPct)})
                </span>
              </>
            ) : (
              dash
            )}
          </td>
        );
      case "need":
        return (
          <td key={c} data-col={c}>
            {hasPlan && !past && !isDay && r.pace.needPerDay != null ? fmtNum(r.pace.needPerDay) : dash}
          </td>
        );
      case "recent": {
        const a = ix.opDay.get(r.op.id)?.get(ref_) ?? 0;
        const b = ix.opDay.get(r.op.id)?.get(yday) ?? 0;
        return (
          <td key={c} data-col={c}>
            <b style={{ fontWeight: 600 }}>{a}</b> <span className="d2-dim">/ {b}</span>
          </td>
        );
      }
      case "avg":
        return (
          <td key={c} data-col={c}>
            {r.avgPerWorkday > 0 ? fmtNum(r.avgPerWorkday) : dash}
          </td>
        );
      case "shifts":
        return (
          <td key={c} data-col={c}>
            {r.daysWorked > 0 ? fmtInt(r.daysWorked) : dash}
          </td>
        );
      case "hours":
        return (
          <td key={c} data-col={c}>
            {fmtNum(r.hours, 1)}
          </td>
        );
      case "conv":
        return (
          <td key={c} data-col={c}>
            <Conv value={r.lph} />
          </td>
        );
      case "spark":
        return (
          <td key={c} data-col={c} style={{ paddingTop: 2, paddingBottom: 2 }}>
            {(() => {
              // последние 7 рабочих смен — выходные не тянут тренд к нулю
              const wd = workedDays(ix, r.op.id, ref_);
              return <Spark values={wd.map((d) => ix.opDay.get(r.op.id)?.get(d) ?? 0)} days={wd} open={wd[wd.length - 1] === today && today > ix.workedTo} good={hasPlan && ratio * 100 >= settings.normalPct} />;
            })()}
          </td>
        );
    }
  };

  /** Итоги группы в строке-заголовке: те же столбцы, что у операторов. */
  const groupCell = (c: OpsCol, rows: OpRow[]) => {
    const withPlan = rows.filter((r) => r.terms.plan > 0);
    const fact = rows.reduce((a, r) => a + r.pace.fact, 0);
    const factP = withPlan.reduce((a, r) => a + r.pace.fact, 0);
    const should = withPlan.reduce((a, r) => a + (past ? r.terms.plan : r.pace.planToDate), 0);
    const gap = factP - should;
    const ratio = should > 0 ? factP / should : 0;
    const tone = ratio * 100 >= settings.normalPct ? "var(--c-green-fg)" : ratio * 100 >= settings.lagPct ? "var(--c-amber-fg)" : "var(--c-red-fg)";
    const plan = withPlan.reduce((a, r) => a + r.terms.plan, 0);
    const rr = withPlan.reduce((a, r) => a + r.pace.rr, 0);
    const hours = rows.reduce((a, r) => a + r.hours, 0);
    const closed = rows.reduce((a, r) => a + r.factClosed, 0);
    const dash = <span className="d2-dim">—</span>;
    switch (c) {
      case "status": {
        if (!cur) return <td key={c} data-col={c} />;
        const on = rows.filter((r) => {
          const sh = ix.shift.get(`${today}|${r.op.id}`);
          return !!sh && isWorked(sh.type, sh.hours);
        }).length;
        return (
          <td key={c} data-col={c} className="d2-sub" style={{ fontWeight: 500 }}>
            на смене {on}
          </td>
        );
      }
      case "fact":
        return (
          <td key={c} data-col={c}>
            {fmtInt(fact)}
          </td>
        );
      case "should":
        return (
          <td key={c} data-col={c}>
            {should > 0 ? fmtInt(Math.round(should)) : dash}
          </td>
        );
      case "gap":
        return (
          <td key={c} data-col={c} className={should > 0 ? (gap < -0.5 ? "d2-red" : "d2-green") : undefined}>
            {should > 0 ? fmtSigned(Math.round(gap)) : dash}
          </td>
        );
      case "prog":
        return (
          <td key={c} data-col={c}>
            {should > 0 ? (
              <div className="d2-prog">
                <div className="t">
                  <b style={{ width: `${Math.max(ratio > 0 ? 2 : 3, Math.min(100, (ratio / 1.5) * 100))}%`, background: tone }} />
                  <i style={{ left: `${100 / 1.5}%` }} />
                </div>
                <span>{fmtPct(ratio)}</span>
              </div>
            ) : (
              dash
            )}
          </td>
        );
      case "plan":
        return (
          <td key={c} data-col={c}>
            {plan > 0 ? fmtNum(plan, 0) : dash}
          </td>
        );
      case "forecast":
        return (
          <td key={c} data-col={c}>
            {plan > 0 && factP > 0 && !isDay ? (
              <>
                {fmtInt(Math.round(rr))}{" "}
                <span className={rr >= plan ? "d2-green" : "d2-red"} style={{ fontSize: 11.5 }}>
                  ({fmtPct(rr / plan)})
                </span>
              </>
            ) : (
              dash
            )}
          </td>
        );
      case "recent": {
        const a = rows.reduce((s, r) => s + (ix.opDay.get(r.op.id)?.get(ref_) ?? 0), 0);
        const b = rows.reduce((s, r) => s + (ix.opDay.get(r.op.id)?.get(yday) ?? 0), 0);
        return (
          <td key={c} data-col={c}>
            {a} <span className="d2-dim">/ {b}</span>
          </td>
        );
      }
      case "hours":
        return (
          <td key={c} data-col={c}>
            {fmtNum(hours, 1)}
          </td>
        );
      case "conv":
        return (
          <td key={c} data-col={c}>
            <Conv value={hours > 0 ? closed / hours : null} />
          </td>
        );
      default:
        return <td key={c} data-col={c} />;
    }
  };

  /**
   * Метка «лучший»: больше всех лидов за выбранный период — дня, недели или месяца (факт периода).
   * Если лучших больше двух — метку не ставим: это уже не «лучший», а ничья.
   */
  const badges = useMemo(() => {
    const out = new Map<string, { k: string; icon: IconName; text: string; title: string }[]>();
    const best = line.reduce((a, r) => Math.max(a, r.pace.fact), 0);
    const tops = best > 0 ? line.filter((r) => r.pace.fact === best) : [];
    if (tops.length && tops.length <= 2) {
      const what = span === "day" ? "дня" : span === "week" ? "недели" : "месяца";
      for (const r of tops)
        out.set(r.op.id, [{ k: `best-${span}`, icon: "star", text: `лучший ${what}`, title: `${fmtInt(best)} ${plural(best, LEADS)} — больше всех за ${w.acc}` }]);
    }
    return out;
  }, [line, span, w.acc]);

  const opRow = (r: OpRow, extra?: { className?: string; style?: CSSProperties }) => (
    <tr key={r.op.id} className={extra?.className || undefined} style={extra?.style} onClick={() => router.push(`/operators?id=${encodeURIComponent(r.op.id)}`)}>
      <td>
        <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          <Avatar name={r.op.name} id={r.op.id} size={20} />
          {shortName(r.op.name)}
          {badges.get(r.op.id)?.map((b) => (
            <span key={b.k} className="d2-badge" data-k={b.k} title={b.title}>
              <Icon name={b.icon} size={11} />
              {b.text}
            </span>
          ))}
        </span>
      </td>
      {shown.map((c) => cell(c, r))}
    </tr>
  );

  const pickCols = (keys: OpsCol[]) => keys.map((k) => ({ key: k, label: title[k].label, hint: title[k].hint }));

  return (
    <section className="card d2-ops">
      <div className="d2-ops-h">
        <h3 className="d2-h">
          <Icon name="users" size={15} className="title-ic" />Операторы<small>(отсортировано по разрыву)</small>
        </h3>
        <span className="d2-ops-hint">Столбцы переставляются перетаскиванием заголовка</span>
        {colOrder.custom && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={colOrder.reset} title="Вернуть порядок столбцов">
            <Icon name="refresh" size={13} /> Порядок
          </button>
        )}
        <ColumnPicker
          groups={[
            { title: "План", cols: pickCols(["fact", "should", "gap", "prog", "plan", "forecast", "need"]) },
            { title: "Работа", cols: pickCols(["status", "group", "recent", "avg", "shifts", "hours", "conv", "spark"]) },
          ]}
          shown={vis.shown}
          onToggle={vis.toggle}
          onReset={vis.reset}
          custom={vis.custom}
        />
      </div>
      {list.length === 0 ? (
        <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--dim)" }}>В этом периоде нет операторов.</div>
      ) : (
        <div style={{ overflowX: "auto" }} ref={wrapRef}>
          <table className="d2-tbl">
            <thead>
              <tr>
                <th>Оператор</th>
                {shown.map((c) => {
                  const hp = colDrag.headProps(c);
                  return (
                    <th key={c} {...hp} title={title[c].hint ? `${title[c].hint}. Перетащите, чтобы переставить` : "Перетащите, чтобы переставить столбец"}>
                      {title[c].label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            {sections ? (
              sections.map((sec) => {
                const closed = fold.isClosed(sec.key);
                const phase = fold.phase(sec.key);
                return (
                  <tbody key={sec.key} data-fold={sec.key}>
                    <tr className="grp-head" onClick={() => fold.toggle(sec.key)} aria-expanded={!closed} title={closed ? "Развернуть группу" : "Свернуть группу"}>
                      <td>
                        <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
                          <Icon name="chevR" size={14} className={`grp-chev${closed || phase === "out" ? "" : " open"}`} />
                          <span className="d2-swatch" style={{ background: `var(--c-${sec.color}-fg)` }} />
                          <span>{sec.name}</span>
                          <span className="grp-head-sub">{sec.rows.length} чел.</span>
                        </span>
                      </td>
                      {shown.map((c) => groupCell(c, sec.rows))}
                    </tr>
                    {!closed && sec.rows.map((r, i) => opRow(r, foldRow(phase, i)))}
                  </tbody>
                );
              })
            ) : (
              <tbody>{list.map((r) => opRow(r))}</tbody>
            )}
          </table>
        </div>
      )}
    </section>
  );
}

/** Лиды по последним рабочим сменам (без выходных); идущая сегодня смена — полым кружком. */
function Spark({ values, days, good, open }: { values: number[]; days: DayKey[]; good: boolean; open?: boolean }) {
  const W = 150;
  const H = 22;
  if (!values.length)
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <title>Смен не было</title>
        <line x1={3} x2={W - 3} y1={H - 3} y2={H - 3} stroke="var(--ink-15)" strokeDasharray="2 3" />
      </svg>
    );
  const max = Math.max(...values, 1);
  // меньше 7 смен — точки прижаты вправо, шаг тот же
  const step = (W - 6) / 6;
  const x0 = W - 3 - step * (values.length - 1);
  const pts = values.map((v, i) => [x0 + i * step, H - 3 - (v / max) * (H - 7)] as const);
  const line = pts.map((p) => p.join(",")).join(" ");
  const c = good ? "var(--c-green-fg)" : "var(--c-red-fg)";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <title>{`Лиды за последние ${values.length} ${plural(values.length, ["смену", "смены", "смен"])} (без выходных)\n${days.map((d, i) => `${dayNum(d)} ${dow(d)}: ${values[i]}${open && i === days.length - 1 ? " — смена идёт" : ""}`).join("\n")}`}</title>
      {pts.length > 1 && <polygon points={`${pts[0][0]},${H - 2} ${line} ${pts[pts.length - 1][0]},${H - 2}`} fill={good ? "var(--c-green-bg)" : "var(--c-red-bg)"} />}
      {pts.length > 1 && <polyline points={line} fill="none" stroke={c} strokeWidth="1.2" />}
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

/* ── тепловая карта: оператор × день ───────────────────────────────── */

function HeatCard({ m, sc, rows, groups, focus }: { m: MonthModel; sc: Scope; rows: DayRow[]; groups?: GroupRow[] | null; focus?: DayKey }) {
  const { ix, data } = useCrm();
  const cal = m.cal;
  const t = sc;
  const line = sc.line;
  const attendance = sc.attendance;
  const days = cal.days;
  const ops = useMemo(() => [...line].sort((a, b) => b.pace.fact - a.pace.fact || a.op.name.localeCompare(b.op.name, "ru")), [line]);
  let max = 1;
  for (const r of ops) for (const d of days) max = Math.max(max, ix.opDay.get(r.op.id)?.get(d) ?? 0);
  const todayIdx = cal.phase === "current" ? days.indexOf(cal.today) : -1;
  const NAME_W = 120;
  const shade = (v: number) => {
    const k = Math.min(1, v / max);
    return { background: `color-mix(in srgb, var(--text) ${Math.round(8 + 62 * k)}%, var(--bg-panel))`, color: k > 0.5 ? "var(--bg-panel)" : "var(--text)" };
  };
  const dailyPlan = t.p.dailyPlan;
  const norm = data.settings.convNormPct / 100;
  const isFuture = (d: DayKey) => cal.phase === "future" || d > cal.ref;

  // конверсия дня — лиды ÷ часы смен по тем же операторам, что в таблице (как в «Графике»)
  const conv = useMemo(
    () =>
      days.map((d) => {
        let leads = 0;
        let hours = 0;
        for (const r of ops) {
          leads += ix.opDay.get(r.op.id)?.get(d) ?? 0;
          hours += ix.plannedOpDay.get(r.op.id)?.get(d) ?? 0;
        }
        return { leads, hours, v: hours > 0 ? leads / hours : null };
      }),
    [days, ops, ix],
  );

  /* ── выделение дней, как в «Графике»: протянуть по датам или клеткам — итоги у курсора ── */
  const [range, setRange] = useState<{ a: number; b: number } | null>(null);
  const [tipAt, setTipAt] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const clear = () => {
    drag.current = false;
    setRange(null);
    setTipAt(null);
  };
  useEffect(() => {
    if (!range) return;
    const move = (e: MouseEvent) => {
      if (drag.current) setTipAt({ x: e.clientX / uiZoom(), y: e.clientY / uiZoom() });
    };
    const up = () => {
      drag.current = false;
    };
    const down = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (gridRef.current?.contains(el) && el.closest?.("[data-ci]")) return;
      clear();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && clear();
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [range]);
  const colOf = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest?.("[data-ci]") as HTMLElement | null;
    return el ? Number(el.dataset.ci) : null;
  };

  const stats = useMemo(() => {
    if (!range) return null;
    const c0 = Math.min(range.a, range.b);
    const c1 = Math.max(range.a, range.b);
    let leads = 0;
    let hours = 0;
    let shifts = 0;
    let zero = 0;
    let workdays = 0;
    const people = new Set<string>();
    const per = new Map<string, { name: string; leads: number; hours: number }>();
    for (let c = c0; c <= c1; c++) {
      const d = days[c];
      if (!d) continue;
      if (cal.isWork(d)) workdays++;
      for (const r of ops) {
        const l = ix.opDay.get(r.op.id)?.get(d) ?? 0;
        const h = ix.plannedOpDay.get(r.op.id)?.get(d) ?? 0;
        leads += l;
        hours += h;
        if (h > 0) {
          shifts++;
          people.add(r.op.id);
          if (l === 0 && !isFuture(d)) zero++;
        }
        if (l || h) {
          const x = per.get(r.op.id) ?? { name: r.op.name, leads: 0, hours: 0 };
          x.leads += l;
          x.hours += h;
          per.set(r.op.id, x);
        }
      }
    }
    const top = [...per.values()].filter((x) => x.leads > 0).sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name, "ru")).slice(0, 3);
    const plan = dailyPlan * workdays;
    return { from: days[c0], to: days[c1], c0, c1, count: c1 - c0 + 1, workdays, leads, hours, shifts, zero, people: people.size, plan, top };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, days, ops, ix, cal, dailyPlan]);

  const cols = `${NAME_W}px repeat(${days.length}, minmax(20px, 1fr))`;
  // весь отдел — по группам, каждую можно свернуть
  const sections = useMemo(() => groupSections(ops, groups), [ops, groups]);
  const [shut, setShut] = useState<Set<string>>(() => new Set([TRAINEES, GONE]));
  const toggleSec = (key: string) =>
    setShut((p) => {
      const n = new Set(p);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const colLeft = (c: number) => `calc(${NAME_W}px + (100% - ${NAME_W}px) * ${c} / ${days.length})`;
  const colWidth = (n: number) => `calc((100% - ${NAME_W}px) * ${n} / ${days.length})`;

  return (
    <section className="card d2-hm">
      <div className="d2-hm-head">
        <h3 className="d2-h" style={{ marginTop: 3 }}><Icon name="calendar" size={15} className="title-ic" />Тепловая карта: оператор × день</h3>
        <div className="d2-leg" style={{ marginTop: 6 }}>
          <span>
            <i style={{ width: 9, height: 9, borderRadius: "50%", background: "color-mix(in srgb, var(--text) 20%, var(--bg-panel))" }} />
            <i style={{ width: 9, height: 9, borderRadius: "50%", background: "color-mix(in srgb, var(--text) 70%, var(--bg-panel))", marginLeft: -3 }} />
            Больше лидов
          </span>
          <span><i style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--c-red-fg)" }} />0 лидов (был на смене)</span>
          <span><i style={{ width: 10, height: 0, borderTop: "1.5px dashed var(--dim)" }} />Не было смены</span>
          <span><b className="d2-leg-off">вых</b>Выходной</span>
          {todayIdx >= 0 && <span><i style={{ width: 11, height: 11, border: "1.5px solid var(--c-red-fg)", borderRadius: 2 }} />Сегодня</span>}
          <span><i style={{ width: 11, height: 11, background: "var(--ink-04)", borderRadius: 2 }} />Будущие дни</span>
          <span className="d2-leg-hint">
            <Icon name="plus" size={11} />
            Протяните по дням — итоги за выбранные дни
          </span>
        </div>
        <div className="d2-hm-stats">
          <div><b>{fmtInt(t.headcount)}</b><span>{plural(t.headcount, OPS)}</span></div>
          <div><b>{fmtNum(attendance)}</b><span>в среднем на смене</span></div>
          <div><b>{fmtNum(t.hours, 0)}</b><span>часов</span></div>
          <div><b><Conv value={t.lph} /></b><span>конверсия</span></div>
        </div>
      </div>
      <div className="d2-hm-scroll">
        {/* обёртка — общая для блоков сетки: выделение дней и рамка «сегодня» тянутся через все группы */}
        <div
          ref={gridRef}
          className={`d2-hm-wrap${range ? " picking" : ""}`}
          onMouseDown={(e) => {
            if (e.button !== 0) return;
            const ci = colOf(e);
            if (ci == null) return;
            e.preventDefault();
            drag.current = true;
            setRange({ a: ci, b: ci });
            setTipAt({ x: e.clientX / uiZoom(), y: e.clientY / uiZoom() });
          }}
          onMouseOver={(e) => {
            if (!drag.current) return;
            const ci = colOf(e);
            if (ci == null) return;
            setRange((p) => (p && p.b !== ci ? { a: p.a, b: ci } : p));
          }}
        >
          <div className="d2-grid" style={{ gridTemplateColumns: cols }}>
            <div className="dh" style={{ textAlign: "left", paddingTop: 16, fontWeight: 600, color: "var(--text)" }}>
              Оператор
            </div>
            {days.map((d, i) => (
              <div key={d} className="dh" data-ci={i} data-off={String(!cal.isWork(d))} data-today={String(i === todayIdx)} title={range ? undefined : "Протяните по дням, чтобы увидеть итоги"}>
                {dayNum(d)}
                <br />
                {dow(d)}
              </div>
            ))}
            {!sections && ops.map((r) => <HeatRow key={r.op.id} r={r} days={days} cal={cal} shade={shade} />)}
          </div>

          {/* весь отдел — по группам: заголовок с лидами группы по дням, строки сворачиваются плавно */}
          {sections?.map((sec) => {
            const open = !shut.has(sec.key);
            return (
              <div key={sec.key} className="d2-hm-sec">
                <div className="d2-grid d2-hm-gh" style={{ gridTemplateColumns: cols }}>
                  <button type="button" className="nm gh" onClick={() => toggleSec(sec.key)} aria-expanded={open} title={open ? "Свернуть группу" : "Развернуть группу"}>
                    <Icon name="chevR" size={13} className={`grp-chev${open ? " open" : ""}`} />
                    <span className="d2-swatch" style={{ background: `var(--c-${sec.color}-fg)` }} />
                    <span className="gh-n">{sec.name}</span>
                    <span className="gh-c">{sec.rows.length}</span>
                  </button>
                  {days.map((d, i) => {
                    if (isFuture(d)) return <div key={d} className="c f gt" data-ci={i}>—</div>;
                    const n = sec.rows.reduce((a, r) => a + (ix.opDay.get(r.op.id)?.get(d) ?? 0), 0);
                    return (
                      <div key={d} className="c gt" data-ci={i} title={`${sec.name} · ${dayNum(d)} ${dow(d)}: ${n} ${plural(n, LEADS)}`}>
                        {n || "·"}
                      </div>
                    );
                  })}
                </div>
                <Collapse open={open}>
                  <div className="d2-grid" style={{ gridTemplateColumns: cols }}>
                    {sec.rows.map((r) => (
                      <HeatRow key={r.op.id} r={r} days={days} cal={cal} shade={shade} />
                    ))}
                  </div>
                </Collapse>
              </div>
            );
          })}

          <div className="d2-grid" style={{ gridTemplateColumns: cols }}>
            <div className="nm tot">Итого (команда)</div>
            {rows.map((row, i) => {
              if (row.future) return <div key={row.day} className="c f tot" data-ci={i}>—</div>;
              const good = dailyPlan > 0 && row.count >= dailyPlan;
              const bad = row.isWork && dailyPlan > 0 && !good;
              return (
                <div
                  key={row.day}
                  className="c tot"
                  data-ci={i}
                  title={`${dayNum(row.day)} ${dow(row.day)}: ${row.count} из ${fmtNum(dailyPlan)}`}
                  style={good ? { background: "var(--c-green-bg)", color: "var(--c-green-fg)" } : bad ? { background: "var(--c-red-bg)", color: "var(--c-red-fg)" } : undefined}
                >
                  {row.count}
                </div>
              );
            })}
            {/* конверсия дня: только процент; цвет — относительно нормы из настроек */}
            <div className="nm cv" title="Лиды ÷ часы смен за день">Конверсия</div>
            {days.map((d, i) => {
              const x = conv[i];
              if (isFuture(d) || x.v == null) return <div key={d} className={`c cv${isFuture(d) ? " f" : " n"}`} data-ci={i}>—</div>;
              const ok = norm > 0 ? x.v >= norm : undefined;
              return (
                <div key={d} className="c cv" data-ci={i} data-ok={ok === undefined ? undefined : String(ok)} title={`${dayNum(d)} ${dow(d)}: ${fmtInt(x.leads)} лид. ÷ ${fmtNum(x.hours)} ч = ${fmtNum(x.v, 2)} лид/ч${norm > 0 ? ` · норма ${fmtPct(norm)}` : ""}`}>
                  {fmtPct(x.v)}
                </div>
              );
            })}
          </div>
          {stats && <div className="d2-csel" style={{ left: colLeft(stats.c0), width: colWidth(stats.count) }} />}
          {todayIdx >= 0 && <div className="d2-today" style={{ left: colLeft(todayIdx), width: colWidth(1) }} />}
          {focus && focus !== cal.today && days.includes(focus) && <div className="d2-today d2-focus" style={{ left: colLeft(days.indexOf(focus)), width: colWidth(1) }} />}
        </div>
      </div>
      {stats && tipAt && <HeatTip at={tipAt} st={stats} norm={norm} />}
    </section>
  );
}

/** Итоги выделенных дней у курсора: лиды и план, часы, конверсия, кто был на смене, лучшие. */
function HeatTip({
  at,
  st,
  norm,
}: {
  at: { x: number; y: number };
  st: { from: DayKey; to: DayKey; count: number; workdays: number; leads: number; hours: number; shifts: number; zero: number; people: number; plan: number; top: { name: string; leads: number; hours: number }[] };
  norm: number;
}) {
  const W = 268;
  const H = 250 + st.top.length * 20;
  const vw = window.innerWidth / uiZoom();
  const vh = window.innerHeight / uiZoom();
  const left = at.x + 16 + W > vw - 8 ? at.x - W - 16 : at.x + 16;
  const top = at.y + 18 + H > vh - 8 ? at.y - H - 12 : at.y + 18;
  const conv = st.hours > 0 ? st.leads / st.hours : null;
  const pct = st.plan > 0 ? st.leads / st.plan : null;
  return createPortal(
    <div className="card day-tip" role="status" style={{ left: Math.max(8, left), top: Math.max(8, top), width: W }}>
      <div className="day-tip-head">
        <b>{st.from === st.to ? `${fmtDay(st.from)}, ${dow(st.from)}` : fmtRange(st.from, st.to)}</b>
        <span>
          {st.count} {plural(st.count, DAYS)}
          {st.count > 1 ? ` · рабочих ${st.workdays}` : ""}
        </span>
      </div>
      <div className="day-tip-grid">
        <span>Лидов</span>
        <b className="num">
          {fmtInt(st.leads)}
          {st.plan > 0 && <span className="d2-dim" style={{ fontWeight: 500 }}> из {fmtNum(st.plan, 0)}</span>}
        </b>
        {pct != null && (
          <>
            <span>Выполнение плана</span>
            <b className={pct >= 1 ? "d2-green" : "d2-red"}>{fmtPct(pct)}</b>
          </>
        )}
        <span>Часов на сменах</span>
        <b className="num">{fmtNum(st.hours)}</b>
        <span>Конверсия</span>
        <b className={conv == null || norm <= 0 ? undefined : conv >= norm ? "d2-green" : "d2-red"}>{conv == null ? "—" : fmtPct(conv)}</b>
        <span>На смене</span>
        <b className="num">
          {fmtInt(st.people)} чел. · {fmtInt(st.shifts)} {plural(st.shifts, ["смена", "смены", "смен"])}
        </b>
        <span>Смен без лидов</span>
        <b className={st.zero > 0 ? "d2-red" : undefined}>{fmtInt(st.zero)}</b>
      </div>
      {st.top.length > 0 && (
        <div className="d2-tip-top">
          <span>Больше всех лидов</span>
          {st.top.map((x) => (
            <div key={x.name}>
              <i>{shortName(x.name)}</i>
              <b className="num">{fmtInt(x.leads)}</b>
              <em>{x.hours > 0 ? fmtPct(x.leads / x.hours) : "—"}</em>
            </div>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

function HeatRow({ r, days, cal, shade }: { r: OpRow; days: DayKey[]; cal: MonthCal; shade: (v: number) => CSSProperties }) {
  const { ix } = useCrm();
  const counts = ix.opDay.get(r.op.id);
  return (
    <>
      <Link className="nm" href={`/operators?id=${encodeURIComponent(r.op.id)}`} title={r.op.name}>
        {shortName(r.op.name)}
      </Link>
      {days.map((d, i) => {
        const future = cal.phase === "future" || d > cal.ref;
        const sh = ix.shift.get(`${d}|${r.op.id}`);
        // выходной — серым «вых»: по графику, а если день не заполнен — по календарю (пока человек в штате)
        const employed = !(r.op.hireDate && d < r.op.hireDate) && !(r.op.fireDate && d > r.op.fireDate);
        const dayOff = sh ? sh.type === "off" : employed && !cal.isWork(d);
        if (future)
          return sh?.type === "off" ? (
            <div key={d} className="c f o" data-ci={i} title={`${dayNum(d)} ${dow(d)}: выходной`}>
              вых
            </div>
          ) : (
            <div key={d} className="c f" data-ci={i}>—</div>
          );
        const v = counts?.get(d) ?? 0;
        if (v > 0) {
          return (
            <div key={d} className="c" data-ci={i} style={shade(v)} title={`${dayNum(d)} ${dow(d)}: ${v} лид.${sh ? ` · ${sh.hours} ч` : ""}`}>
              {v}
            </div>
          );
        }
        if (sh && isWorked(sh.type, sh.hours)) {
          return (
            <div key={d} className="c z" data-ci={i} title={`${dayNum(d)} ${dow(d)}: смена ${sh.hours} ч, лидов нет`}>
              0
            </div>
          );
        }
        if (dayOff) {
          return (
            <div key={d} className="c o" data-ci={i} title={`${dayNum(d)} ${dow(d)}: выходной`}>
              вых
            </div>
          );
        }
        if (sh && ABSENT_LABEL[sh.type] && sh.type !== "off") {
          return (
            <div key={d} className="c a" data-ci={i} title={`${dayNum(d)} ${dow(d)}: ${ABSENT_LABEL[sh.type]}`}>
              {ABSENT_LABEL[sh.type]![0]}
            </div>
          );
        }
        return <div key={d} className="c n" data-ci={i}>—</div>;
      })}
    </>
  );
}
