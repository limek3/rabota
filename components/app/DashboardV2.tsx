"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { dailyRows, pace, sumRange, WORKED_TYPES, type DayRow, type GroupRow, type MonthCal, type MonthModel, type OpRow, type Pace } from "@/lib/crm/calc";
import { addDays, fmtMonth, isoWeekday, rangeDays, weekStart } from "@/lib/crm/dates";
import { DAYS, fmtInt, fmtNum, fmtPct, fmtSigned, LEADS, OPS, plural, safeDiv, shortName } from "@/lib/crm/format";
import { NO_GROUP_LABEL, type DayKey, type DayType, type Settings } from "@/lib/crm/types";
import { Avatar, Conv, MonthSwitcher, PageHead, StatusChip } from "@/components/ui/kit";
import { Icon, type IconName } from "@/components/ui/icons";
import { dot, Select, type Opt } from "@/components/ui/select";
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

/** Шаг сетки оси: 1·2·5 × 10ⁿ, примерно на `parts` делений. */
function niceStep(range: number, parts = 4): number {
  const raw = Math.max(range, 1) / parts;
  const p = 10 ** Math.floor(Math.log10(raw));
  const k = raw / p;
  return (k <= 1 ? 1 : k <= 2 ? 2 : k <= 5 ? 5 : 10) * p;
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
          <OpsCard m={m} line={sc.line} settings={s} ref_={ref} />
          <HeatCard m={m} sc={sc} rows={rows} />
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
  const W = 640;
  const H = 200;
  const L = 34;
  const R = 8;
  const T = 10;
  const B = 32;
  const n = rows.length;
  const sw = (W - L - R) / n;
  const cx = (i: number) => L + sw * i + sw / 2;

  const lastIdx = rows.reduce((a, r, i) => (!r.future ? i : a), -1);
  const showFc = cal.phase === "current" && lastIdx >= 0 && p.elapsedW > 0 && p.plan > 0;
  const base = lastIdx >= 0 ? rows[lastIdx].deviation : 0;
  const w0 = lastIdx >= 0 ? cal.wIdx(rows[lastIdx].day) : 0;
  // коридор: сверху — «дальше идём ровно по дневному плану» (разрыв замирает), снизу — «сохраняется текущий темп»
  const slope = p.avgPerDay - p.dailyPlan;
  const fc = showFc
    ? rows.slice(lastIdx).map((r, k) => {
        const dw = cal.wIdx(r.day) - w0;
        const a = base;
        const b = base + slope * dw;
        return { i: lastIdx + k, hi: Math.max(a, b), lo: Math.min(a, b), mid: b };
      })
    : [];

  const vals = [0, ...rows.filter((r) => !r.future).map((r) => r.deviation), ...fc.flatMap((f) => [f.hi, f.lo])];
  const step = niceStep(Math.max(...vals) - Math.min(...vals));
  const yMin = Math.floor(Math.min(...vals) / step) * step;
  const yMax = Math.max(step, Math.ceil(Math.max(...vals) / step) * step);
  const y = (v: number) => T + ((yMax - v) / (yMax - yMin)) * (H - T - B);
  const ticks: number[] = [];
  for (let v = yMax; v >= yMin - 1e-9; v -= step) ticks.push(Math.round(v));

  const pastCount = lastIdx + 1;
  const bw = Math.min(22, sw * 0.62);
  const endFc = fc[fc.length - 1];

  return (
    <section className="card d2-ch">
      <div className="d2-ch-head">
        <h3 className="d2-h"><Icon name="trend" size={15} className="title-ic" />Накопительный разрыв к плану</h3>
        <div className="d2-leg">
          <span><i style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--c-red-fg)" }} />Факт. разрыв</span>
          {showFc && (
            <span>
              <i style={{ width: 11, height: 10, background: "repeating-linear-gradient(135deg, var(--ink-25) 0 1px, transparent 1px 3px)" }} />
              Прогноз (коридор)
            </span>
          )}
          <span><i style={{ width: 11, height: 10, background: "var(--ink-06)" }} />Выходные</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", marginTop: 8 }}>
        <defs>
          <pattern id={`h${pid}`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--ink-25)" strokeWidth="1" />
          </pattern>
        </defs>
        {rows.map((r, i) =>
          !r.isWork ? <rect key={`w${i}`} x={L + sw * i + 1} y={T} width={sw - 2} height={H - T - B} fill="var(--ink-04)" /> : null,
        )}
        {cal.phase === "current" && lastIdx >= 0 && (
          <rect x={L + sw * lastIdx + 1} y={T - 6} width={sw - 2} height={H - T + 4} fill="var(--c-red-bg)" opacity={0.85} />
        )}
        {ticks.map((v) => (
          <g key={v}>
            {v !== 0 && <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--ink-05)" />}
            <text x={L - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-sub)">
              {v}
            </text>
          </g>
        ))}
        {fc.length > 1 && (
          <>
            <polygon
              points={[...fc.map((f) => `${cx(f.i)},${y(f.hi)}`), ...[...fc].reverse().map((f) => `${cx(f.i)},${y(f.lo)}`)].join(" ")}
              fill={`url(#h${pid})`}
            />
            {fc.slice(1).map((f) => (
              <rect key={`f${f.i}`} x={cx(f.i) - bw / 2} y={y(Math.min(0, f.hi))} width={bw} height={Math.max(0, y(f.mid) - y(Math.min(0, f.hi)))} fill="var(--ink-06)" />
            ))}
            <polyline points={fc.map((f) => `${cx(f.i)},${y(f.mid)}`).join(" ")} fill="none" stroke="var(--dim)" strokeDasharray="3 3" />
          </>
        )}
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="var(--text-sub3)" strokeDasharray="3 3" />
        {rows.slice(0, pastCount).map((r, i) => {
          const v = r.deviation;
          const neg = v < 0;
          const top = Math.min(y(v), y(0));
          const h = Math.max(1, Math.abs(y(v) - y(0)));
          const label = pastCount <= 12 || i === lastIdx;
          return (
            <g key={r.day}>
              <title>{`${dayNum(r.day)} ${dow(r.day)}: факт ${fmtInt(r.cum)}, план ${fmtNum(r.cumPlan)}, разрыв ${fmtSigned(Math.round(v))}`}</title>
              <rect x={cx(i) - bw / 2} y={top} width={bw} height={h} fill={neg ? "var(--c-red-fg)" : "var(--c-green-fg)"} opacity={i === lastIdx ? 0.95 : 0.7} />
              {label && Math.abs(v) >= 0.5 && (
                <text x={cx(i)} y={neg ? y(v) + 12 : y(v) - 4} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--text)">
                  {fmtSigned(Math.round(v))}
                </text>
              )}
            </g>
          );
        })}
        {endFc && fc.length > 2 && (
          <text x={cx(endFc.i)} y={y(endFc.mid) + (endFc.mid < 0 ? 13 : -6)} textAnchor="end" fontSize="10" fill="var(--text-sub)">
            {fmtSigned(Math.round(endFc.mid))} к концу месяца
          </text>
        )}
        {rows.map((r, i) => {
          const td = cal.phase === "current" && i === lastIdx;
          const c = td ? "var(--c-red-fg)" : r.isWork ? "var(--text-sub)" : "var(--dim)";
          return (
            <g key={`x${i}`}>
              <text x={cx(i)} y={H - 18} textAnchor="middle" fontSize="9.5" fill={c} fontWeight={td ? 700 : 400}>
                {dayNum(r.day)}
              </text>
              <text x={cx(i)} y={H - 6} textAnchor="middle" fontSize="8.5" fill={c} fontWeight={td ? 700 : 400}>
                {dow(r.day)}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

/* ── эта неделя против прошлой ─────────────────────────────────────── */

export function WeekCard({ cal, p, ref_, counts }: { cal: MonthCal; p: Pace; ref_: DayKey; counts: Map<DayKey, number> | undefined }) {
  const ws = weekStart(ref_);
  const days = rangeDays(ws, addDays(ws, 6));
  const cur = days.map((d) => (d <= ref_ && cal.phase !== "future" ? counts?.get(d) ?? 0 : null));
  const prev = days.map((d) => counts?.get(addDays(d, -7)) ?? 0);
  const thisWeek = cur.reduce<number>((a, v) => a + (v ?? 0), 0);
  const prevWeek = prev.reduce((a, v) => a + v, 0);
  const upTo = cur.filter((v) => v != null).length;
  const prevSame = prev.slice(0, upTo).reduce((a, v) => a + v, 0);
  const change = prevSame > 0 ? thisWeek / prevSame - 1 : null;

  const W = 450;
  const H = 200;
  const L = 28;
  const R = 4;
  const T = 14;
  const B = 22;
  const top = Math.max(...prev, ...cur.map((v) => v ?? 0), p.dailyPlan, 1);
  const step = niceStep(top, 5);
  const yMax = Math.ceil((top * 1.08) / step) * step;
  const y = (v: number) => T + (1 - v / yMax) * (H - T - B);
  const sw = (W - L - R) / 7;
  const bw = Math.min(19, sw * 0.32);
  const ticks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += step) ticks.push(Math.round(v));
  const refIdx = cal.phase === "current" ? days.indexOf(ref_) : -1;

  return (
    <section className="card d2-ch">
      <div className="d2-ch-head">
        <h3 className="d2-h"><Icon name="chart" size={15} className="title-ic" />Эта неделя vs прошлая</h3>
        <div className="d2-leg">
          <span><i style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--ink-15)" }} />Прошлая неделя</span>
          <span><i style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)" }} />Текущая неделя</span>
          {p.dailyPlan > 0 && <span><i style={{ width: 18, height: 0, borderTop: "1.5px dashed var(--text-sub3)" }} />План ({fmtNum(p.dailyPlan)}/день)</span>}
        </div>
      </div>
      <div className="d2-wk">
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
          {refIdx >= 0 && <rect x={L + sw * refIdx + 4} y={T - 10} width={sw - 8} height={H - T + 8} fill="var(--c-red-bg)" opacity={0.85} />}
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--ink-05)" />
              <text x={L - 8} y={y(v) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-sub)">
                {v}
              </text>
            </g>
          ))}
          {days.map((d, i) => {
            const c = L + sw * i + sw / 2;
            const v = cur[i];
            const px = v == null ? c - bw / 2 : c - bw - 1;
            return (
              <g key={d}>
                <title>{`${dow(d)} ${dayNum(d)}: ${v == null ? "ещё не наступил" : `${fmtInt(v)} лид.`} · неделей раньше ${fmtInt(prev[i])}`}</title>
                <rect x={px} y={y(prev[i])} width={bw} height={y(0) - y(prev[i])} fill="var(--ink-15)" />
                {prev[i] > 0 && (
                  <text x={px + bw / 2} y={y(prev[i]) - 4} textAnchor="middle" fontSize="10" fill="var(--text-sub)">
                    {prev[i]}
                  </text>
                )}
                {v != null && (
                  <>
                    <rect x={c + 1} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} fill="var(--brand)" />
                    <text x={c + 1 + bw / 2} y={y(v) - 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="var(--text)">
                      {v}
                    </text>
                  </>
                )}
                <text x={c} y={H - 6} textAnchor="middle" fontSize="10" fill={i === refIdx ? "var(--c-red-fg)" : "var(--text-sub)"} fontWeight={i === refIdx ? 700 : 400}>
                  {DOW[i]}
                </text>
              </g>
            );
          })}
          {p.dailyPlan > 0 && <line x1={L} x2={W - R} y1={y(p.dailyPlan)} y2={y(p.dailyPlan)} stroke="var(--text-sub3)" strokeDasharray="4 3" />}
        </svg>
        <div className="d2-tot">
          <div className="d2-tot-l">Итого за неделю</div>
          <div className="d2-tot-v">{fmtInt(thisWeek)}</div>
          <div className="d2-tot-s">текущая неделя</div>
          <div className="d2-tot-v" style={{ marginTop: 12 }}>
            {fmtInt(prevWeek)}
          </div>
          <div className="d2-tot-s">прошлая неделя</div>
          {change != null && (
            <>
              <div className={`d2-tot-d ${change >= 0 ? "d2-green" : "d2-red"}`}>
                {change >= 0 ? "↑" : "↓"} {change >= 0 ? "+" : "−"}
                {fmtPct(Math.abs(change))}
              </div>
              <div className="d2-tot-s">к тем же дням прошлой</div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ── операторы ─────────────────────────────────────────────────────── */

const ABSENT_LABEL: Partial<Record<DayType, string>> = { off: "Выходной", vacation: "Отпуск", sick: "Больничный", platform: "Платформа" };

/** Столбцы таблицы операторов: порядок — перетаскиванием заголовков, набор — «Столбцы». Своё у каждого аккаунта. */
const OPS_COLS = ["status", "group", "fact", "should", "gap", "prog", "plan", "forecast", "need", "recent", "avg", "shifts", "hours", "conv", "spark"] as const;
type OpsCol = (typeof OPS_COLS)[number];
const OPS_DEFAULT: OpsCol[] = ["status", "group", "fact", "should", "gap", "prog", "forecast", "need", "recent", "hours", "conv", "spark"];

function mergeVisible(full: string[], visibleNext: string[]): string[] {
  const vis = new Set(visibleNext);
  let i = 0;
  return full.map((k) => (vis.has(k) ? visibleNext[i++] : k));
}

function OpsCard({ m, line, settings, ref_ }: { m: MonthModel; line: OpRow[]; settings: Settings; ref_: DayKey }) {
  const { ix, today } = useCrm();
  const router = useRouter();
  const cal = m.cal;
  const cur = cal.phase === "current";
  const past = cal.phase === "past";
  const last7 = rangeDays(addDays(ref_, -6), ref_);
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
    spark: { label: "Динамика (7 дней)" },
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
            <Spark values={last7.map((d) => ix.opDay.get(r.op.id)?.get(d) ?? 0)} days={last7} good={hasPlan && ratio * 100 >= settings.normalPct} />
          </td>
        );
    }
  };

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
            <tbody>
              {list.map((r) => (
                <tr key={r.op.id} onClick={() => router.push(`/operators?id=${encodeURIComponent(r.op.id)}`)}>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <Avatar name={r.op.name} id={r.op.id} size={20} />
                      {shortName(r.op.name)}
                    </span>
                  </td>
                  {shown.map((c) => cell(c, r))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Spark({ values, days, good }: { values: number[]; days: DayKey[]; good: boolean }) {
  const W = 150;
  const H = 22;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [3 + (i * (W - 6)) / (values.length - 1), H - 3 - (v / max) * (H - 7)] as const);
  const line = pts.map((p) => p.join(",")).join(" ");
  const c = good ? "var(--c-green-fg)" : "var(--c-red-fg)";
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
      <title>{days.map((d, i) => `${dayNum(d)} ${dow(d)}: ${values[i]}`).join("\n")}</title>
      <polygon points={`${pts[0][0]},${H - 2} ${line} ${pts[pts.length - 1][0]},${H - 2}`} fill={good ? "var(--c-green-bg)" : "var(--c-red-bg)"} />
      <polyline points={line} fill="none" stroke={c} strokeWidth="1.2" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r="1.6" fill={c} />
      ))}
    </svg>
  );
}

/* ── тепловая карта: оператор × день ───────────────────────────────── */

function HeatCard({ m, sc, rows }: { m: MonthModel; sc: Scope; rows: DayRow[] }) {
  const { ix } = useCrm();
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
          {todayIdx >= 0 && <span><i style={{ width: 11, height: 11, border: "1.5px solid var(--c-red-fg)", borderRadius: 2 }} />Сегодня</span>}
          <span><i style={{ width: 11, height: 11, background: "var(--ink-04)", borderRadius: 2 }} />Будущие дни</span>
        </div>
        <div className="d2-hm-stats">
          <div><b>{fmtInt(t.headcount)}</b><span>{plural(t.headcount, OPS)}</span></div>
          <div><b>{fmtNum(attendance)}</b><span>в среднем на смене</span></div>
          <div><b>{fmtNum(t.hours, 0)}</b><span>часов</span></div>
          <div><b><Conv value={t.lph} /></b><span>конверсия</span></div>
        </div>
      </div>
      <div className="d2-hm-scroll">
        <div className="d2-grid" style={{ gridTemplateColumns: `${NAME_W}px repeat(${days.length}, minmax(20px, 1fr))` }}>
          <div className="dh" style={{ textAlign: "left", paddingTop: 16, fontWeight: 600, color: "var(--text)" }}>
            Оператор
          </div>
          {days.map((d, i) => (
            <div key={d} className="dh" data-off={String(!cal.isWork(d))} data-today={String(i === todayIdx)}>
              {dayNum(d)}
              <br />
              {dow(d)}
            </div>
          ))}
          {ops.map((r) => (
            <HeatRow key={r.op.id} r={r} days={days} cal={cal} shade={shade} />
          ))}
          <div className="nm tot">Итого (команда)</div>
          {rows.map((row) => {
            if (row.future) return <div key={row.day} className="c f tot">—</div>;
            const good = dailyPlan > 0 && row.count >= dailyPlan;
            const bad = row.isWork && dailyPlan > 0 && !good;
            return (
              <div
                key={row.day}
                className="c tot"
                title={`${dayNum(row.day)} ${dow(row.day)}: ${row.count} из ${fmtNum(dailyPlan)}`}
                style={good ? { background: "var(--c-green-bg)", color: "var(--c-green-fg)" } : bad ? { background: "var(--c-red-bg)", color: "var(--c-red-fg)" } : undefined}
              >
                {row.count}
              </div>
            );
          })}
          {todayIdx >= 0 && (
            <div className="d2-today" style={{ left: `calc(${NAME_W}px + (100% - ${NAME_W}px) * ${todayIdx} / ${days.length})`, width: `calc((100% - ${NAME_W}px) / ${days.length})` }} />
          )}
        </div>
      </div>
    </section>
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
      {days.map((d) => {
        const future = cal.phase === "future" || d > cal.ref;
        if (future) return <div key={d} className="c f">—</div>;
        const v = counts?.get(d) ?? 0;
        const sh = ix.shift.get(`${d}|${r.op.id}`);
        if (v > 0) {
          return (
            <div key={d} className="c" style={shade(v)} title={`${dayNum(d)} ${dow(d)}: ${v} лид.${sh ? ` · ${sh.hours} ч` : ""}`}>
              {v}
            </div>
          );
        }
        if (sh && isWorked(sh.type, sh.hours)) {
          return (
            <div key={d} className="c z" title={`${dayNum(d)} ${dow(d)}: смена ${sh.hours} ч, лидов нет`}>
              0
            </div>
          );
        }
        if (sh && ABSENT_LABEL[sh.type] && sh.type !== "off") {
          return (
            <div key={d} className="c a" title={`${dayNum(d)} ${dow(d)}: ${ABSENT_LABEL[sh.type]}`}>
              {ABSENT_LABEL[sh.type]![0]}
            </div>
          );
        }
        return <div key={d} className="c n">—</div>;
      })}
    </>
  );
}
