"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { goneLast, isGone, sumRange, type OpRow } from "@/lib/crm/calc";
import { DAY_LABEL, DAY_SHORT, NO_GROUP, NO_GROUP_LABEL, type DayKey, type DayType, type Shift } from "@/lib/crm/types";
import { addMonths, fmtDay, fmtMonth, fmtRange, fmtWeekday, isWorkday, monthEnd, monthStart, rangeDays } from "@/lib/crm/dates";
import { DAYS, fmtInt, fmtNum, fmtPct, plural, safeDiv, shortName } from "@/lib/crm/format";
import { Avatar, Conv, Empty, Field, GoneSepRow, GoneTag, LeadN, Modal, MonthSwitcher, NumInput, PageHead, Seg, Switch, useWheelHScroll } from "@/components/ui/kit";
import { DateInput, Select, dot, type Opt } from "@/components/ui/select";
import { canEditShift } from "@/lib/crm/access";
import { Icon } from "@/components/ui/icons";

const TYPE_HUE: Record<DayType, string> = { work: "blue", off: "gray", training: "purple", vacation: "amber", sick: "red" };
const TYPES: DayType[] = ["work", "training", "off", "vacation", "sick"];

interface Sel {
  opId: string;
  day: DayKey;
  rect: { left: number; top: number; bottom: number };
}

/** Прямоугольное выделение клеток: строка (оператор) × колонка (день). */
interface Cell {
  r: number;
  c: number;
}
interface Range {
  a: Cell;
  b: Cell;
}
const inRange = (rng: Range | null, r: number, c: number) =>
  !!rng &&
  r >= Math.min(rng.a.r, rng.b.r) &&
  r <= Math.max(rng.a.r, rng.b.r) &&
  c >= Math.min(rng.a.c, rng.b.c) &&
  c <= Math.max(rng.a.c, rng.b.c);
const rangeSize = (rng: Range) =>
  (Math.abs(rng.a.r - rng.b.r) + 1) * (Math.abs(rng.a.c - rng.b.c) + 1);

export default function SchedulePage() {
  const { data, ix, month, setMonth, today, access } = useCrm();
  const m = useMonthModel();
  const s = data.settings;
  const [group, setGroup] = useState("");
  const [showLeads, setShowLeads] = useState(true);
  const [sel, setSel] = useState<Sel | null>(null);
  const [fillOpen, setFillOpen] = useState(false);
  // выделение мышью, как в таблицах: зажали и протянули по клеткам
  const [range, setRange] = useState<Range | null>(null);
  const [bulk, setBulk] = useState<{ rect: { left: number; top: number; bottom: number }; cells: { opId: string; day: DayKey }[] } | null>(null);
  const dragging = useRef(false);
  // колесо листает дни вправо-влево без Shift
  const scrollRef = useRef<HTMLDivElement>(null);
  useWheelHScroll(scrollRef);
  const lastRect = useRef<{ left: number; top: number; bottom: number }>({ left: 0, top: 0, bottom: 0 });
  // выделение дат по заголовкам: протянули мышью — рядом с курсором итоги за эти дни
  const [dayRange, setDayRange] = useState<{ a: number; b: number } | null>(null);
  const [tipAt, setTipAt] = useState<{ x: number; y: number } | null>(null);
  const dayDrag = useRef(false);

  const days = m.cal.days;
  const rows = useMemo(
    () =>
      m.ops
        .filter((r) => !r.op.deletedAt || r.hours > 0)
        .filter((r) => !group || r.groupKey === group)
        .sort((a, b) => {
          const ga = a.groupKey === NO_GROUP ? "я" : ix.groupById.get(a.groupKey)?.name ?? "";
          const gb = b.groupKey === NO_GROUP ? "я" : ix.groupById.get(b.groupKey)?.name ?? "";
          return ga.localeCompare(gb, "ru") || goneLast(a.op, b.op) || a.op.name.localeCompare(b.op.name, "ru");
        }),
    [m.ops, group, ix],
  );

  const dayTotals = useMemo(
    () =>
      days.map((d) => {
        let h = 0;
        let n = 0;
        let people = 0;
        for (const r of rows) {
          const hh = ix.hoursOpDay.get(r.op.id)?.get(d) ?? 0;
          h += hh;
          if (hh > 0) people++;
          n += ix.opDay.get(r.op.id)?.get(d) ?? 0;
        }
        return { h, n, people };
      }),
    [days, rows, ix],
  );

  const tot = useMemo(() => {
    const hours = rows.reduce((a, r) => a + r.hours, 0);
    const leads = rows.reduce((a, r) => a + r.pace.fact, 0);
    const planToDate = rows.reduce((a, r) => a + r.pace.planToDate, 0);
    const plan = rows.reduce((a, r) => a + r.pace.plan, 0);
    return { hours, leads, planToDate, plan };
  }, [rows]);

  // итоги выделенных дат — по тем же строкам, что на экране (учитывает фильтр группы)
  const dayStats = useMemo(() => {
    if (!dayRange) return null;
    const c0 = Math.min(dayRange.a, dayRange.b);
    const c1 = Math.max(dayRange.a, dayRange.b);
    let hours = 0;
    let leads = 0;
    let shifts = 0;
    let workdays = 0;
    for (let c = c0; c <= c1; c++) {
      const d = days[c];
      if (!d) continue;
      if (isWorkday(d, s)) workdays++;
      for (const r of rows) {
        const hh = ix.hoursOpDay.get(r.op.id)?.get(d) ?? 0;
        hours += hh;
        if (hh > 0) shifts++;
        leads += ix.opDay.get(r.op.id)?.get(d) ?? 0;
      }
    }
    return { from: days[c0], to: days[c1], c0, c1, count: c1 - c0 + 1, workdays, hours, leads, shifts };
  }, [dayRange, days, rows, ix, s]);

  const clearDays = () => {
    dayDrag.current = false;
    setDayRange(null);
    setTipAt(null);
  };

  // протягивание по датам: карточка едет за курсором, после отпускания остаётся на месте
  useEffect(() => {
    if (!dayRange) return;
    const move = (e: MouseEvent) => {
      if (dayDrag.current) setTipAt({ x: e.clientX, y: e.clientY });
    };
    const up = () => {
      dayDrag.current = false;
    };
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest?.(".sched th.day") || t.closest?.(".day-tip")) return;
      clearDays();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && clearDays();
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
  }, [dayRange]);

  const colSel = dayStats ? { c0: dayStats.c0, c1: dayStats.c1 } : null;

  const groups = data.groups.filter((g) => !g.deletedAt);
  const past = m.cal.phase === "past";

  /* протягивание мышью: старт на клетке, расширение при наведении, итог по отпусканию */
  const startCell = (r: number, c: number, rect: { left: number; top: number; bottom: number }) => {
    clearDays();
    dragging.current = true;
    lastRect.current = rect;
    setSel(null);
    setBulk(null);
    setRange({ a: { r, c }, b: { r, c } });
  };
  const extendCell = (r: number, c: number, rect: { left: number; top: number; bottom: number }) => {
    if (!dragging.current) return;
    lastRect.current = rect;
    setRange((prev) => (prev ? { a: prev.a, b: { r, c } } : prev));
  };

  useEffect(() => {
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      setRange((rng) => {
        if (!rng) return null;
        if (rangeSize(rng) === 1) {
          const row = rows[rng.a.r];
          const day = days[rng.a.c];
          if (row && day) setSel({ opId: row.op.id, day, rect: lastRect.current });
          return null;
        }
        const cells: { opId: string; day: DayKey }[] = [];
        for (let r = Math.min(rng.a.r, rng.b.r); r <= Math.max(rng.a.r, rng.b.r); r++) {
          const row = rows[r];
          if (!row || !canEditShift(access, row.op.id)) continue;
          for (let c = Math.min(rng.a.c, rng.b.c); c <= Math.max(rng.a.c, rng.b.c); c++) {
            const day = days[c];
            if (!day) continue;
            if (row.op.hireDate && day < row.op.hireDate) continue;
            if (row.op.fireDate && day > row.op.fireDate) continue;
            cells.push({ opId: row.op.id, day });
          }
        }
        if (cells.length) setBulk({ rect: lastRect.current, cells });
        return rng;
      });
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      dragging.current = false;
      setRange(null);
      setBulk(null);
    };
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", esc);
    };
  }, [rows, days, access]);

  return (
    // таблица по высоте содержимого: «Итого по дням» идёт сразу под строками;
    // когда строк много, таблица упирается в высоту окна и прокручивается, а итог остаётся на виду
    <div className="stack" style={{ height: "calc(100vh / var(--ui-scale, 1) - 132px)" }}>
      <PageHead
        title="График"
        sub={`${fmtMonth(month)} · отработанные часы, нормы и выработка.${access.can.editShifts ? " Клик по клетке — записать смену." : ""}`}
        actions={
          <>
            <MonthSwitcher value={month} onChange={setMonth} />
            {access.can.editShifts && (
              <button className="btn" onClick={() => setFillOpen(true)} disabled={!rows.length}>
                <Icon name="fill" size={14} /> Заполнить
              </button>
            )}
          </>
        }
      />

      <div className="toolbar">
        <Select
          width={190}
          value={group}
          options={[
            { value: "", label: "Все группы" },
            ...groups.map<Opt>((g) => ({ value: g.id, label: g.name, icon: dot(g.color) })),
            { value: NO_GROUP, label: NO_GROUP_LABEL, icon: dot("gray") },
          ]}
          onChange={setGroup}
          ariaLabel="Группа"
        />
        <Switch size="sm" checked={showLeads} onChange={setShowLeads} label="лиды в клетках" />
        <span className="spacer" />
        <div className="row" style={{ gap: 10, fontSize: 12, color: "var(--text-sub)", flexWrap: "wrap" }}>
          {TYPES.map((t) => (
            <span key={t} className="row" style={{ gap: 5 }}>
              <span style={{ width: 18, height: 16, borderRadius: 4, background: `var(--c-${TYPE_HUE[t]}-bg)`, color: `var(--c-${TYPE_HUE[t]}-fg)`, fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                {t === "work" ? s.dayHours : DAY_SHORT[t]}
              </span>
              {DAY_LABEL[t]}
            </span>
          ))}
          <span className="row" style={{ gap: 5 }}>
            <span style={{ width: 18, height: 16, borderRadius: 4, background: "var(--c-red-bg)", color: "var(--c-red-fg)", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>У</span>
            Уволен
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <Empty icon="calendar" title="Некого ставить в график" text="В выбранном месяце нет операторов в штате. Добавьте операторов или смените месяц." />
        </div>
      ) : (
        <div ref={scrollRef} className="tbl-wrap" style={{ flex: "0 1 auto", minHeight: 0 }}>
          <table
            className="tbl sched"
            onMouseMove={(e) => {
              if (!dragging.current) return;
              const td = (e.target as HTMLElement).closest?.("td.cell") as HTMLElement | null;
              if (!td?.dataset.r) return;
              const rc = td.getBoundingClientRect();
              extendCell(Number(td.dataset.r), Number(td.dataset.c), { left: rc.left, top: rc.top, bottom: rc.bottom });
            }}
          >
            <thead>
              <tr>
                <th className="sticky-col" style={{ width: 1, minWidth: 150, whiteSpace: "nowrap" }}>
                  Оператор
                </th>
                {days.map((d, ci) => {
                  const off = !isWorkday(d, s);
                  const on = !!colSel && ci >= colSel.c0 && ci <= colSel.c1;
                  return (
                    <th
                      key={d}
                      className={`day ${off ? "off" : ""} ${d === today ? "today" : ""} ${on ? "csel" : ""}`}
                      title={dayRange ? undefined : `${fmtDay(d)}, ${fmtWeekday(d)}${off ? " · выходной" : ""} — протяните по датам, чтобы увидеть итоги`}
                      onMouseDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        setSel(null);
                        setBulk(null);
                        setRange(null);
                        dayDrag.current = true;
                        setDayRange({ a: ci, b: ci });
                        setTipAt({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseEnter={() => dayDrag.current && setDayRange((p) => (p ? { a: p.a, b: ci } : p))}
                    >
                      <div>{Number(d.slice(8))}</div>
                      <div style={{ fontWeight: 400, color: "var(--dim)", fontSize: 10 }}>{fmtWeekday(d)}</div>
                    </th>
                  );
                })}
                {/* итоги: часы → лиды → сколько лидов не хватает до плана → конверсия (лиды ÷ часы) */}
                <th className="r sum sum-h" title="Отработано часов (рабочие дни + обучение)">Часы</th>
                <th className="r sum sum-l hl">Лиды</th>
                <th className="r sum sum-d" title={past ? "Лиды минус план месяца" : "Лиды минус план на сегодня"}>
                  ±
                </th>
                <th className="r sum sum-c hl" title="Конверсия: лиды ÷ отработанные часы">Конв.</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const prevKey = i > 0 ? rows[i - 1].groupKey : null;
                const gName = r.groupKey === NO_GROUP ? NO_GROUP_LABEL : ix.groupById.get(r.groupKey)?.name ?? "";
                return (
                  <SchedRow
                    key={r.op.id}
                    r={r}
                    rowIndex={i}
                    days={days}
                    groupHeader={!group && r.groupKey !== prevKey ? gName : null}
                    goneSep={
                      isGone(r.op) && (r.groupKey !== prevKey || !isGone(rows[i - 1].op))
                        ? rows.filter((x) => x.groupKey === r.groupKey && isGone(x.op)).length
                        : 0
                    }
                    colSpan={days.length + 5}
                    showLeads={showLeads}
                    sel={sel}
                    range={range}
                    colSel={colSel}
                    onDown={startCell}
                  />
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky-col">Итого по дням</td>
                {dayTotals.map((t, i) => (
                  <td
                    key={days[i]}
                    className={`c num ${colSel && i >= colSel.c0 && i <= colSel.c1 ? "csel" : ""}`}
                    style={{ fontSize: 11, padding: "6px 0" }}
                    title={`${fmtDay(days[i])}: ${fmtNum(t.h)} ч, ${t.people} чел., ${t.n} лид.${t.h ? ` · конверсия ${fmtPct(t.n / t.h)} (${fmtNum(t.n / t.h, 2)} лид/ч)` : ""}`}
                  >
                    <div>{t.h ? fmtNum(t.h, 0) : ""}</div>
                    {showLeads && <div style={{ color: "var(--brand)", fontWeight: 600 }}>{t.n || ""}</div>}
                    {/* конверсия дня: лиды ÷ часы в процентах — как «эффективность» в обучении */}
                    <div>{t.h > 0 && t.n > 0 ? <Conv leads={t.n} hours={t.h} /> : ""}</div>
                  </td>
                ))}
                <td className="r num sum sum-h">{fmtNum(tot.hours)}</td>
                <td className="r num sum sum-l hl"><LeadN n={tot.leads} /></td>
                <LeadsDelta fact={tot.leads} plan={tot.plan} planToDate={tot.planToDate} />
                <td className="r num sum sum-c hl"><Conv leads={tot.leads} hours={tot.hours} /></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {dayStats && tipAt && <DayTip at={tipAt} st={dayStats} scope={group ? ix.groupById.get(group)?.name ?? NO_GROUP_LABEL : null} />}
      {sel && <CellEditor sel={sel} onClose={() => setSel(null)} />}
      {bulk && (
        <RangeEditor
          rect={bulk.rect}
          cells={bulk.cells}
          onClose={() => {
            setBulk(null);
            setRange(null);
          }}
        />
      )}
      {fillOpen && <FillModal rows={rows} onClose={() => setFillOpen(false)} />}
    </div>
  );
}

function SchedRow({
  r,
  rowIndex,
  days,
  groupHeader,
  goneSep,
  colSpan,
  showLeads,
  sel,
  range,
  colSel,
  onDown,
}: {
  r: OpRow;
  rowIndex: number;
  days: DayKey[];
  groupHeader: string | null;
  /** Первый уволенный в группе — перед ним разделитель «Уволены · N». */
  goneSep: number;
  colSpan: number;
  showLeads: boolean;
  sel: Sel | null;
  range: Range | null;
  colSel: { c0: number; c1: number } | null;
  onDown: (r: number, c: number, rect: { left: number; top: number; bottom: number }) => void;
}) {
  const { ix, data, today, access } = useCrm();
  const s = data.settings;
  const canEdit = canEditShift(access, r.op.id);
  const counts = ix.opDay.get(r.op.id);
  const hire = r.op.hireDate;
  const fire = r.op.fireDate;
  return (
    <>
      {groupHeader != null && (
        <tr className="grp">
          <td className="sticky-col" style={{ background: "var(--bg-strip)", fontSize: 11.5, fontWeight: 600, color: "var(--text-sub)", padding: "6px 10px" }}>
            {groupHeader}
          </td>
          <td colSpan={colSpan - 1} style={{ background: "var(--bg-strip)", padding: 0 }} />
        </tr>
      )}
      {goneSep > 0 && <GoneSepRow count={goneSep} colSpan={colSpan} />}
      <tr>
        <td className="sticky-col">
          <span className="row" style={{ gap: 8 }}>
            <Avatar name={r.op.name} id={r.op.id} size={22} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }} title={r.op.name}>
              {shortName(r.op.name)}
            </span>
            <GoneTag op={r.op} />
          </span>
        </td>
        {days.map((d, colIndex) => {
          const sh = ix.shift.get(`${d}|${r.op.id}`);
          const off = !isWorkday(d, s);
          // уволен: с даты увольнения — «У» (если смены в этот день нет); до приёма — штриховка
          const gone = r.op.status === "fired" && !!fire && d >= fire && !sh;
          const outside = !!hire && d < hire;
          const n = counts?.get(d) ?? 0;
          const isSel = sel?.opId === r.op.id && sel.day === d;
          const isRange = inRange(range, rowIndex, colIndex);
          const hue = sh ? TYPE_HUE[sh.type] : null;
          return (
            <td
              key={d}
              className={`cell ${off ? "off" : ""} ${d === today ? "today" : ""} ${isSel ? "sel" : ""} ${isRange ? "rng" : ""} ${colSel && colIndex >= colSel.c0 && colIndex <= colSel.c1 ? "csel" : ""}`}
              style={{
                // цвет клетки — как в легенде: рабочий день синий, выходной серый, больничный красный…
                background: sh ? `var(--c-${hue}-bg)` : gone ? "var(--c-red-bg)" : outside ? "repeating-linear-gradient(135deg, transparent 0 4px, var(--ink-04) 4px 6px)" : undefined,
                color: sh ? `var(--c-${hue}-fg)` : gone ? "var(--c-red-fg)" : undefined,
                cursor: canEdit ? undefined : "default",
              }}
              title={`${fmtDay(d)}${sh ? ` · ${DAY_LABEL[sh.type]}${sh.hours ? `, ${fmtNum(sh.hours)} ч` : ""}${sh.comment ? ` · ${sh.comment}` : ""}` : ""}${n ? ` · лидов: ${n}` : ""}${outside ? " · до даты приёма" : ""}${gone ? " · уволен" : ""}`}
              onMouseDown={(e) => {
                if (!canEdit || e.button !== 0) return;
                e.preventDefault(); // иначе браузер начинает выделять текст
                const rc = (e.currentTarget as HTMLElement).getBoundingClientRect();
                onDown(rowIndex, colIndex, { left: rc.left, top: rc.top, bottom: rc.bottom });
              }}
              data-r={rowIndex}
              data-c={colIndex}
            >
              <div className="num" style={{ fontWeight: sh?.type === "work" ? 500 : 700, fontSize: (sh && sh.type !== "work" && !sh.hours) || gone ? 11 : 12 }}>
                {sh ? (sh.type === "work" ? (sh.hours ? fmtNum(sh.hours) : "0") : sh.type === "training" && sh.hours ? fmtNum(sh.hours) : DAY_SHORT[sh.type]) : gone ? "У" : ""}
              </div>
              {showLeads && n > 0 && (
                <div className="num" style={{ fontSize: 10, color: "var(--brand)", fontWeight: 700, lineHeight: 1 }}>
                  {n}
                </div>
              )}
            </td>
          );
        })}
        <td className="r num sum sum-h">{fmtNum(r.hours)}</td>
        <td className="r num sum sum-l hl"><LeadN n={r.pace.fact} /></td>
        <LeadsDelta fact={r.pace.fact} plan={r.pace.plan} planToDate={r.pace.planToDate} />
        <td className="r num sum sum-c hl"><Conv leads={r.pace.fact} hours={r.hours} /></td>
      </tr>
    </>
  );
}

/** «±» в итогах графика: лиды минус план на дату (в прошедшем месяце — минус план месяца). Нет плана — прочерк. */
function LeadsDelta({ fact, plan, planToDate }: { fact: number; plan: number; planToDate: number }) {
  if (plan <= 0) return <td className="r num muted sum sum-d">—</td>;
  const d = Math.round(fact - planToDate);
  return (
    <td
      className="r num sum sum-d"
      style={{ color: d < 0 ? "var(--c-red-fg)" : d > 0 ? "var(--c-green-fg)" : undefined, fontWeight: 600 }}
      title={d < 0 ? `Не хватает ${fmtInt(-d)} лид. до плана на дату (${fmtInt(Math.round(planToDate))})` : `План на дату (${fmtInt(Math.round(planToDate))}) выполнен`}
    >
      {d > 0 ? "+" : d < 0 ? "−" : ""}
      {fmtInt(Math.abs(d))}
    </td>
  );
}

/** Итоги выделенных дат рядом с курсором: часы, лиды, конверсия. */
function DayTip({
  at,
  st,
  scope,
}: {
  at: { x: number; y: number };
  st: { from: DayKey; to: DayKey; count: number; workdays: number; hours: number; leads: number; shifts: number };
  scope: string | null;
}) {
  const W = 240;
  const H = 170;
  // справа-снизу от курсора; у края экрана — с другой стороны
  const left = at.x + 16 + W > window.innerWidth - 8 ? at.x - W - 16 : at.x + 16;
  const top = at.y + 18 + H > window.innerHeight - 8 ? at.y - H - 12 : at.y + 18;
  const conv = st.hours > 0 ? st.leads / st.hours : null;
  return createPortal(
    <div className="card day-tip" role="status" style={{ left: Math.max(8, left), top: Math.max(8, top), width: W }}>
      <div className="day-tip-head">
        <b>{st.from === st.to ? fmtDay(st.from) : fmtRange(st.from, st.to)}</b>
        <span>
          {st.count} {plural(st.count, DAYS)}
          {st.count > 1 ? ` · рабочих ${st.workdays}` : ""}
          {scope ? ` · ${scope}` : ""}
        </span>
      </div>
      <div className="day-tip-grid">
        <span>Часов</span>
        <b className="num">{fmtNum(st.hours)}</b>
        <span>Лидов</span>
        <b className="num" style={{ color: "var(--brand)" }}>{fmtInt(st.leads)}</b>
        <span>Конверсия</span>
        <b>{conv == null ? "—" : <Conv value={conv} />}</b>
        <span>Смен</span>
        <b className="num">{fmtInt(st.shifts)}</b>
      </div>
    </div>,
    document.body,
  );
}

/** Редактор выделенного диапазона: один тип дня и часы на все клетки сразу. */
function RangeEditor({
  rect,
  cells,
  onClose,
}: {
  rect: { left: number; top: number; bottom: number };
  cells: { opId: string; day: DayKey }[];
  onClose: () => void;
}) {
  const { data, ix, saveShifts, clearShifts, toast } = useCrm();
  const s = data.settings;
  const [type, setType] = useState<DayType>("work");
  const [hours, setHours] = useState<number | null>(s.dayHours);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const people = new Set(cells.map((c) => c.opId)).size;
  const dayFrom = cells.reduce((a, c) => (c.day < a ? c.day : a), cells[0].day);
  const dayTo = cells.reduce((a, c) => (c.day > a ? c.day : a), cells[0].day);
  const filled = cells.filter((c) => ix.shift.has(`${c.day}|${c.opId}`)).length;

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".sched td.cell")) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  const apply = async (t: DayType, h: number | null) => {
    setBusy(true);
    const worked = t === "work" || t === "training";
    const n = await saveShifts(cells.map((c) => ({ date: c.day, operatorId: c.opId, hours: worked ? h ?? 0 : 0, type: t })));
    setBusy(false);
    if (n) toast(`Записано смен: ${n}`);
    onClose();
  };

  const clear = async () => {
    setBusy(true);
    const n = await clearShifts(cells.map((c) => ({ date: c.day, operatorId: c.opId })));
    setBusy(false);
    if (n) toast(`Очищено клеток: ${n}`, "info");
    onClose();
  };

  const W = 320;
  const left = Math.min(Math.max(8, rect.left - W / 2 + 17), window.innerWidth - W - 8);
  const below = rect.bottom + 300 < window.innerHeight;
  const style: React.CSSProperties = below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 };

  return createPortal(
    <div
      ref={ref}
      className="card"
      role="dialog"
      aria-label="Выделенные клетки"
      style={{ position: "fixed", left, width: W, zIndex: 600, padding: 14, boxShadow: "var(--shadow-xl)", display: "flex", flexDirection: "column", gap: 10, background: "var(--bg-modal)", animation: "vexaModalIn .14s var(--ease)", ...style }}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>Выделено клеток: {cells.length}</div>
        <div style={{ fontSize: 12, color: "var(--dim)" }}>
          {people} {people === 1 ? "оператор" : people < 5 ? "оператора" : "операторов"} · {fmtDay(dayFrom)}
          {dayFrom === dayTo ? "" : ` — ${fmtDay(dayTo)}`}
          {filled ? ` · заполнено ${filled}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {TYPES.map((t) => (
          <button
            key={t}
            className="chip"
            style={{ ["--chip-fg" as string]: `var(--c-${TYPE_HUE[t]}-fg)`, ["--chip-bg" as string]: `var(--c-${TYPE_HUE[t]}-bg)`, ["--chip-bd" as string]: `var(--c-${TYPE_HUE[t]}-bd)`, height: 26 }}
            aria-pressed={type === t}
            onClick={() => {
              setType(t);
              if (t === "work" || t === "training") setHours((h) => (h ? h : s.dayHours));
              else void apply(t, 0);
            }}
          >
            {DAY_LABEL[t]}
          </button>
        ))}
      </div>
      {(type === "work" || type === "training") && (
        <div className="row" style={{ gap: 6 }}>
          <NumInput value={hours} onChange={setHours} step={0.5} max={24} className="inp inp-sm" style={{ width: 70 }} autoFocus onEnter={() => void apply(type, hours)} />
          <span style={{ fontSize: 12, color: "var(--dim)" }}>ч</span>
          {[s.dayHours, s.dayHours / 2].map((h) => (
            <button key={h} className="btn btn-sm" onClick={() => void apply(type, h)}>
              {fmtNum(h)} ч
            </button>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 6 }}>
        {filled > 0 && (
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void clear()}>
            Очистить
          </button>
        )}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={onClose}>
          Отмена
        </button>
        <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => void apply(type, hours)}>
          Записать ({cells.length})
        </button>
      </div>
    </div>,
    document.body,
  );
}

function CellEditor({ sel, onClose }: { sel: Sel; onClose: () => void }) {
  const { ix, data, saveShift } = useCrm();
  const s = data.settings;
  const existing: Shift | undefined = ix.shift.get(`${sel.day}|${sel.opId}`);
  const op = ix.opById.get(sel.opId);
  const [type, setType] = useState<DayType>(existing?.type ?? "work");
  const [hours, setHours] = useState<number | null>(existing ? existing.hours : s.dayHours);
  const [comment, setComment] = useState(existing?.comment ?? "");
  const ref = useRef<HTMLDivElement>(null);
  const leads = ix.opDay.get(sel.opId)?.get(sel.day) ?? 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest?.(".sched td.cell")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  const save = async (t = type, h = hours) => {
    const worked = t === "work" || t === "training";
    await saveShift(sel.day, sel.opId, { type: t, hours: worked ? h ?? 0 : 0, comment });
    onClose();
  };

  const W = 300;
  const left = Math.min(Math.max(8, sel.rect.left - W / 2 + 17), window.innerWidth - W - 8);
  const below = sel.rect.bottom + 330 < window.innerHeight;
  const style: React.CSSProperties = below ? { top: sel.rect.bottom + 6 } : { bottom: window.innerHeight - sel.rect.top + 6 };

  return createPortal(
    <div
      ref={ref}
      className="card"
      role="dialog"
      aria-label="Смена"
      style={{ position: "fixed", left, width: W, zIndex: 600, padding: 14, boxShadow: "var(--shadow-xl)", display: "flex", flexDirection: "column", gap: 10, background: "var(--bg-modal)", animation: "vexaModalIn .14s var(--ease)", ...style }}
      key={`${sel.opId}|${sel.day}`}
    >
      <div>
        <div style={{ fontWeight: 600, fontSize: 13 }}>{op?.name}</div>
        <div style={{ fontSize: 12, color: "var(--dim)" }}>
          {fmtDay(sel.day)}, {fmtWeekday(sel.day)}
          {leads ? ` · передано лидов: ${leads}` : ""}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {TYPES.map((t) => (
          <button
            key={t}
            className="chip"
            style={{ ["--chip-fg" as string]: `var(--c-${TYPE_HUE[t]}-fg)`, ["--chip-bg" as string]: `var(--c-${TYPE_HUE[t]}-bg)`, ["--chip-bd" as string]: `var(--c-${TYPE_HUE[t]}-bd)`, height: 26 }}
            aria-pressed={type === t}
            onClick={() => {
              setType(t);
              if (t === "work" || t === "training") setHours((h) => (h ? h : s.dayHours));
              else void save(t, 0);
            }}
          >
            {DAY_LABEL[t]}
          </button>
        ))}
      </div>
      {(type === "work" || type === "training") && (
        <div className="row" style={{ gap: 6 }}>
          <NumInput value={hours} onChange={setHours} step={0.5} max={24} className="inp inp-sm" style={{ width: 70 }} autoFocus onEnter={() => void save()} />
          <span style={{ fontSize: 12, color: "var(--dim)" }}>ч</span>
          {[s.dayHours, s.dayHours / 2].map((h) => (
            <button key={h} className="btn btn-sm" onClick={() => void save(type, h)}>
              {fmtNum(h)} ч
            </button>
          ))}
        </div>
      )}
      <input className="inp inp-sm" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Комментарий" onKeyDown={(e) => e.key === "Enter" && void save()} />
      <div className="row" style={{ gap: 6 }}>
        {existing && (
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              void saveShift(sel.day, sel.opId, null);
              onClose();
            }}
          >
            Очистить
          </button>
        )}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={onClose}>
          Отмена
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => void save()}>
          Сохранить
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Графики сменности: «работаем n дней — отдыхаем m». «—» значит «каждый рабочий день недели». */
const PATTERNS: { v: string; t: string; on: number; off: number }[] = [
  { v: "week", t: "Каждый рабочий день", on: 0, off: 0 },
  { v: "5/2", t: "5 через 2", on: 5, off: 2 },
  { v: "4/4", t: "4 через 4", on: 4, off: 4 },
  { v: "4/3", t: "4 через 3", on: 4, off: 3 },
  { v: "4/2", t: "4 через 2", on: 4, off: 2 },
  { v: "3/3", t: "3 через 3", on: 3, off: 3 },
  { v: "3/2", t: "3 через 2", on: 3, off: 2 },
  { v: "2/2", t: "2 через 2", on: 2, off: 2 },
  { v: "2/1", t: "2 через 1", on: 2, off: 1 },
];

function FillModal({ rows, onClose }: { rows: OpRow[]; onClose: () => void }) {
  const { data, ix, month, saveShifts, toast, today } = useCrm();
  const m = useMonthModel();
  const s = data.settings;
  const [who, setWho] = useState<string>("all");
  const [from, setFrom] = useState(monthStart(month));
  const [to, setTo] = useState(today.slice(0, 7) === month ? today : monthEnd(month));
  const [hours, setHours] = useState<number | null>(s.dayHours);
  const [mode, setMode] = useState<"empty" | "all">("empty");
  const [pattern, setPattern] = useState("week");
  const [busy, setBusy] = useState(false);

  const pat = PATTERNS.find((p) => p.v === pattern) ?? PATTERNS[0];

  const plan = useMemo(() => {
    const ops = rows.filter((r) => (who === "all" ? r.op.status === "active" && !r.op.deletedAt : r.op.id === who));
    const items: { date: DayKey; operatorId: string; hours: number; type: DayType }[] = [];
    const days = rangeDays(from, to);
    for (const r of ops) {
      days.forEach((d, i) => {
        // «каждый рабочий день» слушает настройки недели, сменный график — свой цикл
        if (pat.on === 0 ? !isWorkday(d, s) : i % (pat.on + pat.off) >= pat.on) return;
        if (r.op.hireDate && d < r.op.hireDate) return;
        if (r.op.fireDate && d > r.op.fireDate) return;
        const ex = ix.shift.get(`${d}|${r.op.id}`);
        if (ex && mode === "empty") return;
        if (ex && (ex.type === "vacation" || ex.type === "sick")) return; // отпуск и больничный не затираем
        items.push({ date: d, operatorId: r.op.id, hours: hours ?? 0, type: "work" });
      });
    }
    return items;
  }, [rows, who, from, to, hours, mode, ix, s, pat]);

  /* хватит ли людей: часы в среднем за день × конверсия отдела против дневного плана */
  const coverage = useMemo(() => {
    const days = rangeDays(from, to);
    const workDays = days.filter((d) => (pat.on === 0 ? isWorkday(d, s) : true));
    if (!workDays.length) return null;
    const perDay = new Map<DayKey, number>();
    for (const it of plan) perDay.set(it.date, (perDay.get(it.date) ?? 0) + it.hours);
    // к плану добавляем уже записанные смены — считаем итоговое покрытие
    for (const d of workDays) {
      for (const r of rows) {
        const ex = ix.shift.get(`${d}|${r.op.id}`);
        if (ex && (ex.type === "work" || ex.type === "training") && !plan.some((p) => p.date === d && p.operatorId === r.op.id))
          perDay.set(d, (perDay.get(d) ?? 0) + ex.hours);
      }
    }
    const covered = workDays.filter((d) => (perDay.get(d) ?? 0) > 0);
    if (!covered.length) return null;
    const avgHours = covered.reduce((a, d) => a + (perDay.get(d) ?? 0), 0) / covered.length;
    const lph = m.team.lph ?? 0;
    const dailyPlan = m.team.pace.dailyPlan;
    const leads = avgHours * lph;
    const needHours = lph > 0 ? dailyPlan / lph : 0;
    return { avgHours, leads, dailyPlan, needHours, lph, enough: lph <= 0 || leads >= dailyPlan };
  }, [plan, rows, from, to, ix, s, pat, m]);

  const apply = async () => {
    setBusy(true);
    const n = await saveShifts(plan);
    setBusy(false);
    if (n) toast(`Записано смен: ${n}`);
    onClose();
  };

  const leadsInRange = useMemo(() => sumRange(ix.day, from, to), [ix, from, to]);

  return (
    <Modal
      title="Заполнить график"
      onClose={onClose}
      width={500}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => void apply()} disabled={busy || plan.length === 0}>
            Записать {plan.length ? `(${plan.length})` : ""}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.5 }}>
        Проставит рабочие смены в рабочие дни (по настройкам недели и праздникам). Отпуска и больничные не затираются.
      </div>
      <Field label="Кому">
        <Select
          value={who}
          options={[
            { value: "all", label: `Всем активным в списке (${rows.filter((r) => r.op.status === "active" && !r.op.deletedAt).length})` },
            ...rows.map<Opt>((r) => ({ value: r.op.id, label: shortName(r.op.name) })),
          ]}
          onChange={setWho}
          ariaLabel="Кому"
        />
      </Field>
      <div className="grid3">
        <Field label="С">
          <DateInput value={from} onChange={(d) => d && setFrom(d)} ariaLabel="С" workdays={s} />
        </Field>
        <Field label="По">
          <DateInput value={to} onChange={(d) => d && setTo(d)} min={from} ariaLabel="По" workdays={s} />
        </Field>
        <Field label="Часов в смене">
          <NumInput value={hours} onChange={setHours} step={0.5} max={24} />
        </Field>
      </div>
      <div className="grid2">
        <Field label="График сменности" hint={pat.on === 0 ? "По настройкам рабочей недели" : `Цикл ${pat.on} + ${pat.off} дней от даты «С»`}>
          <Select value={pattern} options={PATTERNS.map((x) => ({ value: x.v, label: x.t }))} onChange={setPattern} ariaLabel="График сменности" />
        </Field>
        <Field label="Период" hint="Быстро перекинуть на месяц вперёд">
          <button
            type="button"
            className="btn"
            style={{ width: "100%" }}
            onClick={() => {
              const next = addMonths(month, 1);
              setFrom(monthStart(next));
              setTo(monthEnd(next));
            }}
          >
            <Icon name="calendar" size={14} /> Следующий месяц
          </button>
        </Field>
      </div>
      <Seg
        value={mode}
        onChange={setMode}
        options={[
          { value: "empty", label: "Только пустые дни" },
          { value: "all", label: "Перезаписать рабочие" },
        ]}
      />
      <div style={{ fontSize: 12, color: "var(--dim)" }}>
        Будет записано смен: <b>{plan.length}</b>. Лидов за период: {fmtInt(leadsInRange)}.
      </div>
      {coverage && coverage.lph > 0 && (
        <div className={`note-line ${coverage.enough ? "ok" : "warn"}`}>
          <Icon name={coverage.enough ? "check" : "alert"} size={15} stroke={2.2} />
          <span>
            {coverage.enough ? (
              <>
                <b>Людей хватает.</b> В среднем {fmtNum(coverage.avgHours, 0)} ч на смену — это ≈ {fmtNum(coverage.leads, 0)} лидов в день при
                дневном плане {fmtNum(coverage.dailyPlan)}.
              </>
            ) : (
              <>
                <b>Не хватает часов на дневной план.</b> Выходит ≈ {fmtNum(coverage.leads, 0)} лидов в день при плане {fmtNum(coverage.dailyPlan)}:
                нужно {fmtNum(coverage.needHours, 0)} ч на смену вместо {fmtNum(coverage.avgHours, 0)} (конверсия {fmtPct(coverage.lph)} лид/ч).
              </>
            )}
          </span>
        </div>
      )}
    </Modal>
  );
}
