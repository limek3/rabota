"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { dailyRows, pace, sumRange, workedDays, WORKED_TYPES, type DayRow, type GroupRow, type MonthCal, type MonthModel, type OpRow, type Pace } from "@/lib/crm/calc";
import { addDays, fmtDay, fmtMonth, fmtRange, isoWeekday, rangeDays, weekStart } from "@/lib/crm/dates";
import { DAYS, fmtInt, fmtNum, fmtPct, fmtSigned, LEADS, OPS, plural, safeDiv, shortName } from "@/lib/crm/format";
import { NO_GROUP_LABEL, type DayKey, type DayType, type Settings } from "@/lib/crm/types";
import { Avatar, Collapse, Conv, MonthSwitcher, PageHead, StatusChip, foldRow, useFoldGroups } from "@/components/ui/kit";
import { Icon, type IconName } from "@/components/ui/icons";
import { dot, Select, uiZoom, type Opt } from "@/components/ui/select";
import { ColumnPicker, useColumnDrag, useColumnOrder, useColumnVisibility } from "@/components/ui/ColumnOrder";
import { Onboarding } from "@/components/app/DashboardClassic";

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
      <text x={x0 + w / 2 + 0.5} y={top + 12} textAnchor="middle" fontSize="10" fontWeight="600" fill={color}>
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

const SCOPE_KEY = "leadup.dashboard.scope";

export function DashboardV2() {
  const { data, ix, month, setMonth, today, access } = useCrm();
  const m = useMonthModel();
  const cal = m.cal;
  const s = data.settings;

  // операторы на линии: без супервайзеров, удалённых и уволенных до месяца
  const allLine = useMemo(() => m.ops.filter((r) => !r.op.deletedAt && !ix.svIds.has(r.op.id) && r.status !== "fired"), [m.ops, ix]);

  // какие группы можно выбрать: РОП — все, остальные — только свои
  const own = access.isHead ? null : access.ownGroups;
  const choices = useMemo(() => m.groups.filter((g) => (own ? own.has(g.key) : true)), [m.groups, own]);
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

  const sc: Scope = useMemo(() => {
    const keys = picked ? [picked.key] : own ? choices.map((g) => g.key) : null;
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
  }, [picked, own, choices, m, ix, cal, s, allLine]);

  const p = sc.p;
  const rows = useMemo(() => dailyRows(cal, sc.plan, sc.counts, sc.hoursMap), [cal, sc]);

  const empty = data.operators.filter((o) => !o.deletedAt).length === 0 && data.leads.length === 0;
  const cur = cal.phase === "current";
  const ref = cal.phase === "future" ? cal.days[0] : cal.ref;

  const sub = cal.phase === "future"
    ? `${fmtMonth(month)} ещё не начался · ${cal.W} ${plural(cal.W, ["рабочий день", "рабочих дня", "рабочих дней"])}`
    : cal.phase === "past"
      ? `${fmtMonth(month)} · месяц закрыт`
      : `${dow(today)}, ${dayNum(today)} ${MON_SHORT[Number(today.slice(5, 7)) - 1]} · рабочий день ${p.elapsedW} из ${cal.W}`;

  // сегодня: лиды за день, вчера, кто на смене — для крупной цифры в главном блоке
  const todayInfo = useMemo<HeroToday | null>(() => {
    if (!cur) return null;
    const onShift = sc.line.filter((r) => {
      const sh = ix.shift.get(`${today}|${r.op.id}`);
      return !!sh && isWorked(sh.type, sh.hours);
    }).length;
    return { n: sc.counts?.get(today) ?? 0, yesterday: sc.counts?.get(addDays(today, -1)) ?? 0, dayPlan: cal.isWork(today) ? p.dailyPlan : 0, onShift };
  }, [cur, sc, ix, today, cal, p.dailyPlan]);

  const ownNames = choices.map((g) => g.name).join(", ");
  const title = access.isHead ? "Сводка" : `Сводка · ${ownNames || "группы не назначены"}`;
  const showPicker = access.isHead ? choices.length > 0 : choices.length > 1;

  return (
    <div className="stack">
      <PageHead
        title={title}
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
                options={[
                  { value: "all", label: access.isHead ? "Весь отдел" : "Все мои группы", icon: <Icon name={access.isHead ? "users" : "groups"} size={14} /> },
                  ...choices.map<Opt>((g) => ({ value: g.key, label: g.name, group: "Группы", icon: dot(g.color), hint: g.plan > 0 ? `план ${fmtInt(g.plan)}` : "без плана" })),
                ]}
              />
            )}
            <MonthSwitcher value={month} onChange={setMonth} />
          </>
        }
      />
      {empty ? (
        <Onboarding />
      ) : (
        <div className="d2">
          <Hero cal={cal} plan={sc.plan} p={p} today={todayInfo} />
          {cur && <Actions m={m} line={sc.line} groups={sc.groups} />}
          <div className="d2-charts">
            <GapCard rows={rows} cal={cal} p={p} />
            <WeekCard cal={cal} p={p} ref_={ref} counts={sc.counts} />
          </div>
          {/* весь отдел (или несколько своих групп) — таблица и карта разбиты по группам */}
          <OpsCard m={m} line={sc.line} settings={s} ref_={ref} groups={picked ? null : sc.groups} />
          <HeatCard m={m} sc={sc} rows={rows} groups={picked ? null : sc.groups} />
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
}

export function Hero({ cal, plan, p, who = "team", today }: { cal: MonthCal; plan: number; p: Pace; who?: "team" | "op"; today?: HeroToday | null }) {
  const one = who === "op";
  const cur = cal.phase === "current";
  const past = cal.phase === "past";

  let hue = "gray";
  let text: ReactNode;
  if (plan <= 0) {
    hue = "amber";
    text = (
      <>
        План на месяц не задан — темп и прогноз не посчитать. <Link href="/plans">Задать план →</Link>
      </>
    );
  } else if (cal.phase === "future") {
    text = (
      <>
        Месяц ещё не начался. План <em>{fmtInt(plan)}</em> — это <em>{fmtNum(p.dailyPlan)}</em> в рабочий день.
      </>
    );
  } else if (past) {
    hue = p.pct >= 1 ? "green" : "red";
    text = p.pct >= 1 ? (
      <>
        Месяц закрыт: план выполнен на <em>{fmtPct(p.pct)}</em>, сверх плана <em>{fmtInt(p.fact - plan)}</em>.
      </>
    ) : (
      <>
        Месяц закрыт: <em>{fmtPct(p.pct)}</em> плана, не хватило <em>{fmtInt(p.remaining)} {plural(p.remaining, LEADS)}</em>.
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
        {one ? "выйдет" : "выйдем"} на <em>{fmtInt(p.rr)}</em> ({fmtPct(p.rrPct)} плана).
      </>
    );
  }

  const kpis: { l: string; ic: IconName; v: string; u: string; tone?: "red" | "green" }[] = [
    { l: "План", ic: "target", v: fmtInt(plan), u: plural(plan, LEADS) },
    { l: "Факт", ic: "leads", v: fmtInt(p.fact), u: plural(p.fact, LEADS) },
    { l: past ? "Должно было быть" : "Должно быть", ic: "calendar", v: fmtInt(Math.round(past ? plan : p.planToDate)), u: past ? "к концу месяца" : "к сегодня" },
    { l: "Разрыв", ic: "move", v: fmtSigned(Math.round(past ? p.fact - plan : p.deviation)), u: plural(Math.abs(Math.round(past ? p.fact - plan : p.deviation)), LEADS), tone: (past ? p.fact - plan : p.deviation) < -0.5 ? "red" : "green" },
    { l: "Темп", ic: "bolt", v: p.elapsedW > 0 ? fmtNum(p.avgPerDay) : "—", u: "в рабочий день" },
    { l: "Нужно", ic: "route", v: p.needPerDay == null ? "—" : fmtNum(p.needPerDay), u: p.needPerDay == null ? (past ? "месяц закрыт" : "дней не осталось") : "в рабочий день", tone: p.needPerDay != null && p.elapsedW > 0 && p.needPerDay > p.avgPerDay ? "red" : undefined },
    { l: "Прогноз", ic: "trend", v: p.elapsedW > 0 || past ? fmtInt(p.rr) : "—", u: plan > 0 && (p.elapsedW > 0 || past) ? `(${fmtPct(p.rrPct)})` : "по темпу" },
  ];
  if (plan <= 0) kpis[3].tone = undefined;

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
            <div className="d2-fact-l"><Icon name="leads" size={13} className="mi" />Факт{past ? " за месяц" : ""}</div>
            <div className="d2-fact-n num">
              {fmtInt(p.fact)}
              <small>{plural(p.fact, LEADS)}</small>
            </div>
          </div>
          {cur && today && (
            <div className="d2-now" title="Лиды, переданные сегодня (по Москве)">
              <div className="d2-fact-l"><Icon name="phone" size={13} className="mi" />Сегодня передали</div>
              <div className="d2-fact-n num">
                {fmtInt(today.n)}
                <small>{plural(today.n, LEADS)}</small>
              </div>
              <div className="d2-now-s">
                {today.dayPlan > 0 && (
                  <span className={today.n >= today.dayPlan ? "d2-green" : undefined}>
                    {fmtPct(today.n / today.dayPlan)} дневного плана ({fmtNum(today.dayPlan)})
                  </span>
                )}
                <span>
                  вчера {fmtInt(today.yesterday)} · на смене {fmtInt(today.onShift)}
                </span>
              </div>
            </div>
          )}
          <div className="d2-alert" data-hue={hue}>
            <Icon name={hue === "green" ? "check" : hue === "red" ? "alert" : "info"} size={22} />
            <div>{text}</div>
          </div>
        </div>
        <div className="d2-kpis">
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

/* ── что сделать сейчас ────────────────────────────────────────────── */

function Actions({ m, line, groups }: { m: MonthModel; line: OpRow[]; groups: GroupRow[] }) {
  const { ix, today } = useCrm();
  const workday = m.cal.isWork(today);

  const v = useMemo(() => {
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
      // одна карточка на человека: без смен на неделю вперёд важнее, чем «нет смены сегодня»
      if (!ahead.some((d) => ix.shift.has(`${d}|${op.id}`))) noWeek.push(r);
      else if (workday) noToday.push(r);
    }
    const noPlan = groups.filter((g) => g.group && !g.group.deletedAt && g.plan <= 0);
    return { zero, noToday, noWeek, noPlan };
  }, [line, ix, today, workday, groups]);

  const cards: { hue: string; icon: IconName; title: string; n: number; who: ReactNode; desc: string; href: string; btn: string; ok: string }[] = [
    {
      hue: "red",
      icon: "phone",
      title: "На смене, но 0 лидов",
      n: v.zero.length,
      who: names(v.zero),
      desc: "Смена идёт, а лидов сегодня ещё нет.",
      href: "/operators",
      btn: "Проверить загрузку",
      ok: "У всех на смене лиды идут.",
    },
    {
      hue: "amber",
      icon: "calendar",
      title: "Нет смен на неделю",
      n: v.noWeek.length,
      who: v.noWeek.length ? (
        <>
          <b>
            {v.noWeek.length} {plural(v.noWeek.length, ["человек", "человека", "человек"])}
          </b>
          <br />
          {names(v.noWeek)}
        </>
      ) : null,
      desc: "Ни одной смены на 7 дней вперёд.",
      href: "/schedule",
      btn: "Назначить смены",
      ok: "У всех есть смены на неделю.",
    },
    {
      hue: "red",
      icon: "clock",
      title: "Без смены сегодня",
      n: v.noToday.length,
      who: names(v.noToday),
      desc: "В графике на сегодня пусто — риск недобора.",
      href: "/schedule",
      btn: "Закрыть слот",
      ok: workday ? "Сегодня у всех есть смена." : "Сегодня выходной по графику.",
    },
    {
      hue: "amber",
      icon: "target",
      title: "Группа без плана",
      n: v.noPlan.length,
      who: v.noPlan.length ? (
        <>
          <b>{v.noPlan.map((g) => g.name).join(", ")}</b>
          <br />
          План на месяц: <b>0 лидов</b>
        </>
      ) : null,
      desc: "У группы не установлен план.",
      href: "/plans",
      btn: "Поставить план",
      ok: "План задан всем группам.",
    },
  ];

  return (
    <section className="card card-pad" style={{ padding: "12px 12px" }}>
      <h3 className="d2-h"><Icon name="bolt" size={15} className="title-ic" />Что сделать сейчас</h3>
      <div className="d2-acts">
        {cards.map((c) => {
          const done = c.n === 0;
          return (
            <div key={c.title} className="d2-ac" data-hue={done ? "green" : c.hue}>
              <div className="d2-ac-hd">
                <div className="d2-ac-ic">
                  <Icon name={done ? "check" : c.icon} size={22} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="d2-ac-t">
                    <span>{c.title}</span>
                    <span className="d2-ac-n">{c.n}</span>
                  </div>
                  <div className="d2-ac-who">{done ? <span style={{ color: "var(--text-sub)" }}>{c.ok}</span> : c.who}</div>
                </div>
              </div>
              {!done && (
                <>
                  <div className="d2-ac-ds">{c.desc}</div>
                  <Link href={c.href} className="d2-ac-btn">
                    {c.btn}
                    <Icon name="arrowR" size={13} />
                  </Link>
                </>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── накопительный разрыв к плану ──────────────────────────────────── */

export function GapCard({ rows, cal, p }: { rows: DayRow[]; cal: MonthCal; p: Pace }) {
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
  if (showFc) kpis.push({ l: "К концу месяца", v: fmtSigned(Math.round(final)), cls: toneCls(final), s: "при текущем темпе" });
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
              {v !== 0 && <line x1={L} x2={W - R} y1={crisp(y(v))} y2={crisp(y(v))} stroke="var(--ink-06)" />}
              <text x={L - 8} y={Math.round(y(v)) + 3.5} textAnchor="end" fontSize="10" fill={v === 0 ? "var(--text)" : "var(--text-sub)"} fontWeight={v === 0 ? 600 : 400}>
                {v > 0 ? `+${v}` : v}
              </text>
            </g>
          ))}

          {/* прогноз: веер между «дальше по плану» и «текущий темп» */}
          {band && (
            <g className="d2-fade" style={{ "--d": "0.55s" } as CSSProperties}>
              <polygon points={band} fill={`url(#gf${pid})`} />
              <polygon points={band} fill={`url(#h${pid})`} opacity={0.7} />
              <line x1={cx(fc[0].i)} x2={cx(endFc.i)} y1={crisp(y(base))} y2={crisp(y(base))} stroke="var(--text-sub3)" strokeDasharray="1.5 3" />
              <polyline points={fc.map((f) => `${cx(f.i)},${y(f.mid)}`).join(" ")} fill="none" stroke={tone(final)} strokeOpacity={0.75} strokeWidth={1.5} strokeDasharray="4 3" />
              <circle cx={cx(endFc.i)} cy={y(endFc.mid)} r={3} fill="var(--bg-panel)" stroke={tone(final)} strokeWidth={1.5} />
            </g>
          )}

          <line x1={L} x2={W - R} y1={crisp(y0)} y2={crisp(y0)} stroke="var(--text-sub3)" />

          {/* факт: линия + заливка до нуля, зелёная выше плана, красная ниже */}
          {pts.length > 0 && (
            <>
              <g className="d2-fade" style={{ "--d": "0.25s" } as CSSProperties}>
                <polygon points={area} fill={`url(#gp${pid})`} clipPath={`url(#cp${pid})`} />
                <polygon points={area} fill={`url(#gn${pid})`} clipPath={`url(#cn${pid})`} />
              </g>
              <polyline className="d2-draw" pathLength={1} points={line} fill="none" stroke="var(--c-green-fg)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#cp${pid})`} />
              <polyline className="d2-draw" pathLength={1} points={line} fill="none" stroke="var(--c-red-fg)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#cn${pid})`} />
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
                  <line x1={crisp(cx(lastIdx))} x2={crisp(cx(lastIdx))} y1={T - 4} y2={H - B} stroke="var(--text-sub3)" strokeDasharray="2 2" />
                  <text x={Math.round(cx(lastIdx))} y={T - 8} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--text-sub)">
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
            <text className="d2-fade" x={Math.round(pts[minI][0])} y={Math.round(pts[minI][1]) + 15} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--c-red-fg)">
              {fmtSigned(Math.round(past[minI].deviation))}
            </text>
          )}
          {maxI >= 0 && maxI !== lastIdx && (
            <text className="d2-fade" x={Math.round(pts[maxI][0])} y={Math.round(pts[maxI][1]) - 9} textAnchor="middle" fontSize="10" fontWeight="600" fill="var(--c-green-fg)">
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
              <line x1={crisp(cx(hi!))} x2={crisp(cx(hi!))} y1={T} y2={H - B} stroke="var(--ink-25)" />
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
                  <text x={x} y={H - B + 16} textAnchor="middle" fontSize="10" fill={c} fontWeight={on ? 700 : 400}>
                    {dayNum(r.day)}
                  </text>
                )}
                {(sw >= 17 || on) && (
                  <text x={x} y={H - B + 29} textAnchor="middle" fontSize="9" fill={c} fontWeight={on ? 600 : 400}>
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

export function WeekCard({ cal, p, ref_, counts }: { cal: MonthCal; p: Pace; ref_: DayKey; counts: Map<DayKey, number> | undefined }) {
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
  const refIdx = cal.phase === "current" ? days.indexOf(ref_) : -1;
  // впереди по графику — пунктиром «сколько нужно в день», чтобы закрыть месяц
  const need = days.map((d, i) => (cal.phase === "current" && i > refIdx && cal.isWork(d) && p.needPerDay != null && p.needPerDay > 0 ? p.needPerDay : null));
  const best = cur.reduce<number>((b, v, i) => (v != null && v > 0 && (b < 0 || v > (cur[b] ?? 0)) ? i : b), -1);
  // неделя может начаться в прошлом месяце — там графика нет, берём будни
  const workLike = (d: DayKey) => (d.slice(0, 7) === cal.month ? cal.isWork(d) : isoWeekday(d) <= 5);
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
      cls: change == null ? "" : change >= 0 ? "d2-green" : "d2-red",
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
          {hi != null && hi !== refIdx && <rect x={colX(hi) + 2} y={T - 18} width={colX(hi + 1) - colX(hi) - 4} height={H - T + 17} rx={6} fill="var(--ink-03)" />}
          {refIdx >= 0 && (
            <text x={Math.round(L + sw * refIdx + sw / 2)} y={T - 8} textAnchor="middle" fontSize="9.5" fontWeight="600" fill="var(--text-sub)">
              сегодня
            </text>
          )}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={crisp(y(v))} y2={crisp(y(v))} stroke={v === 0 ? "var(--text-sub3)" : "var(--ink-06)"} />
              <text x={L - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-sub)">
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
            const on = td || i === hi;
            const dim = hi != null && hi !== i;
            const lx = Math.round(c);
            return (
              <g key={d} className="d2-col" style={{ opacity: dim ? 0.45 : 1 }}>
                <path className="d2-grow" style={{ "--i": i } as CSSProperties} d={barPath(px, y(prev[i]), bw, y0 - y(prev[i]))} fill="var(--ink-15)" />
                {prev[i] > 0 && (
                  <text className="d2-fade" x={px + bw / 2} y={y(prev[i]) - 5} textAnchor="middle" fontSize="9.5" fill="var(--text-sub)">
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
                    <text className="d2-fade" x={cx2 + bw / 2} y={y(v) - 5} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={below ? "var(--c-red-fg)" : "var(--text)"}>
                      {v}
                    </text>
                  </>
                )}
                {v == null && nd != null && (
                  <>
                    <rect x={cx2 + 0.5} y={y(nd) + 0.5} width={bw - 1} height={Math.max(0, y0 - y(nd) - 1)} rx={3} fill="none" stroke="var(--text-sub3)" strokeDasharray="3 2" />
                    <text x={cx2 + bw / 2} y={y(nd) - 5} textAnchor="middle" fontSize="9.5" fill="var(--dim)">
                      {Math.ceil(nd)}
                    </text>
                  </>
                )}
                <text x={lx} y={H - B + 16} textAnchor="middle" fontSize="10" fill={on ? "var(--text)" : "var(--text-sub)"} fontWeight={on ? 700 : 500}>
                  {DOW[i]} <tspan fontWeight={400} fill={on ? "var(--text-sub)" : "var(--dim)"}>{dayNum(d)}</tspan>
                </text>
                {diff != null && (v !== 0 || prev[i] !== 0) && (
                  <text x={lx} y={H - B + 29} textAnchor="middle" fontSize="9.5" fontWeight="600" fill={diff > 0 ? "var(--c-green-fg)" : diff < 0 ? "var(--c-red-fg)" : "var(--dim)"}>
                    {diff === 0 ? "=" : fmtSigned(diff)}
                  </text>
                )}
              </g>
            );
          })}
          {planY != null && (
            <g pointerEvents="none">
              <line x1={L} x2={W - R} y1={crisp(planY)} y2={crisp(planY)} stroke="var(--text-sub)" strokeOpacity={0.6} strokeDasharray="4 3" />
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
                  <b className={hDiff > 0 ? "d2-green" : hDiff < 0 ? "d2-red" : ""}>{hDiff === 0 ? "=" : fmtSigned(hDiff)}</b>
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

/* ── операторы ─────────────────────────────────────────────────────── */

const ABSENT_LABEL: Partial<Record<DayType, string>> = { off: "Выходной", vacation: "Отпуск", sick: "Больничный", platform: "Платформа" };

/**
 * Разбивка операторов по группам для сводки «весь отдел» (и «все мои группы»): порядок — как у
 * групп сводки, затем «без группы» и отдельным блоком стажёры (у них ещё нет плана).
 * Выбрана конкретная группа — без разбивки (null).
 */
const TRAINEES = "__trainees__";
function groupSections(list: OpRow[], groups?: GroupRow[] | null): { key: string; name: string; color: string; rows: OpRow[] }[] | null {
  if (!groups) return null;
  const map = new Map<string, OpRow[]>();
  for (const r of list) {
    const key = r.op.role === "trainee" ? TRAINEES : r.groupKey;
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  if (!map.size) return null;
  const order = new Map(groups.map((g, i) => [g.key, i]));
  const rank = (key: string) => (key === TRAINEES ? 1e6 + 1 : order.get(key) ?? 1e6);
  return [...map.entries()]
    .map(([key, rows]) => {
      const g = key === TRAINEES ? null : groups.find((x) => x.key === key);
      return { key, name: key === TRAINEES ? "Стажёры" : g?.name ?? NO_GROUP_LABEL, color: g?.color ?? "gray", rows };
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

function OpsCard({ m, line, settings, ref_, groups }: { m: MonthModel; line: OpRow[]; settings: Settings; ref_: DayKey; groups?: GroupRow[] | null }) {
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
    fact: { label: "Факт", hint: "Лидов за месяц" },
    should: { label: past ? "План" : "Должно быть", hint: past ? "План на месяц" : "Сколько должно быть к сегодня по плану" },
    gap: { label: "Разрыв", hint: "Факт минус «должно быть»" },
    prog: { label: `Выполнение плана${past ? "" : " на сегодня"}` },
    plan: { label: "План на месяц" },
    forecast: { label: "Прогноз", hint: "Сколько выйдет к концу месяца при текущем темпе" },
    need: { label: "Нужно в день", hint: "Сколько лидов в рабочий день нужно до конца месяца, чтобы закрыть план" },
    recent: { label: cur ? "Сегодня / вчера" : "Посл. день / до него", hint: "Лиды за последние два дня" },
    avg: { label: "В среднем за смену", hint: "Лидов в рабочий день" },
    shifts: { label: "Смен", hint: "Отработано смен в месяце" },
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
  const fold = useFoldGroups(wrapRef);

  const todayState = (r: OpRow): { hue: string; label: string } => {
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
            {hasPlan ? fmtInt(r.terms.plan) : dash}
          </td>
        );
      case "forecast":
        return (
          <td key={c} data-col={c}>
            {hasPlan && r.pace.fact > 0 ? (
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
            {hasPlan && !past && r.pace.needPerDay != null ? fmtNum(r.pace.needPerDay) : dash}
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
            {plan > 0 ? fmtInt(plan) : dash}
          </td>
        );
      case "forecast":
        return (
          <td key={c} data-col={c}>
            {plan > 0 && factP > 0 ? (
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

  const opRow = (r: OpRow, extra?: { className?: string; style?: CSSProperties }) => (
    <tr key={r.op.id} className={extra?.className || undefined} style={extra?.style} onClick={() => router.push(`/operators?id=${encodeURIComponent(r.op.id)}`)}>
      <td>
        <span className="row" style={{ gap: 8 }}>
          <Avatar name={r.op.name} id={r.op.id} size={20} />
          {shortName(r.op.name)}
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
        <div style={{ padding: "12px 16px", fontSize: 13, color: "var(--dim)" }}>В этом месяце нет операторов.</div>
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

function HeatCard({ m, sc, rows, groups }: { m: MonthModel; sc: Scope; rows: DayRow[]; groups?: GroupRow[] | null }) {
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
    return { background: `color-mix(in srgb, var(--c-green-fg) ${Math.round(18 + 62 * k)}%, var(--bg-panel))`, color: k > 0.55 ? "var(--bg-panel)" : "var(--text)" };
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
  const [shut, setShut] = useState<Set<string>>(() => new Set());
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
            <i style={{ width: 9, height: 9, borderRadius: "50%", background: "color-mix(in srgb, var(--c-green-fg) 30%, var(--bg-panel))" }} />
            <i style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--c-green-fg)", marginLeft: -3 }} />
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
