"use client";

import { Fragment } from "react";
import { useCrm } from "@/lib/crm/store";
import type { MonthCal, OpRow } from "@/lib/crm/calc";
import { DAY_LABEL, DAY_SHORT } from "@/lib/crm/types";
import { fmtDayShort, fmtWeekday } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct, shortName } from "@/lib/crm/format";
import { Avatar, Swatch } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";

/**
 * Карта дней: операторы × дни месяца. Клетка — лиды за день против дневного плана
 * оператора (план ÷ рабочие дни). Видно провалы, пропуски и смены без лидов, которые
 * в сумме за месяц теряются.
 */

interface Section {
  key: string;
  name: string;
  color: string;
  supervisor: string | null;
  rows: OpRow[];
}

const hueOf = (ratio: number) => (ratio >= 1.1 ? "green" : ratio >= 0.95 ? "blue" : ratio >= 0.8 ? "amber" : "red");

/** Столбцы фиксированной ширины: имя и итог, дни делят остаток поровну — сетка ровная на любой ширине. */
const NAME_W = 200;
const TOT_W = 96;
const DAY_MIN = 30;

export function DayHeatmap({
  sections,
  grouped,
  cal,
  onOpen,
  paused,
}: {
  sections: Section[];
  grouped: boolean;
  cal: MonthCal;
  onOpen: (id: string) => void;
  /** Свернуть операторов на паузе в одну строку (null — показывать всех). */
  paused: { open: boolean; toggle: () => void } | null;
}) {
  const { ix } = useCrm();
  const days = cal.days;
  const future = (d: string) => cal.phase === "future" || d > cal.ref;
  const weekStartCls = (d: string, i: number) => (i > 0 && fmtWeekday(d) === "пн" ? " hm-wk" : "");

  const cell = (r: OpRow, d: string, i: number) => {
    const cls = weekStartCls(d, i) + (cal.isWork(d) ? "" : " hm-we");
    if (future(d)) return <td key={d} className={cls} />;
    const leads = ix.opDay.get(r.op.id)?.get(d) ?? 0;
    const hours = ix.hoursOpDay.get(r.op.id)?.get(d) ?? 0;
    const sh = ix.shift.get(`${d}|${r.op.id}`);
    const when = `${fmtDayShort(d)}, ${fmtWeekday(d)}`;
    if (leads > 0 || hours > 0) {
      const plan = r.pace.dailyPlan;
      const hue = plan > 0 ? hueOf(leads / plan) : "gray";
      const zero = leads === 0;
      const tip = `${when}: ${fmtInt(leads)} лид.${hours > 0 ? ` за ${fmtNum(hours)} ч` : ""}${plan > 0 ? ` · план дня ${fmtNum(plan)}` : ""}${zero ? " · смена без лидов" : ""}`;
      return (
        <td key={d} className={cls}>
          <span className={`hm-c${zero ? " hm-zero" : ""}`} style={{ background: `var(--c-${zero ? "red" : hue}-bg)`, color: `var(--c-${zero ? "red" : hue}-fg)` }} title={tip}>
            {leads}
          </span>
        </td>
      );
    }
    if (sh && sh.type !== "work" && sh.type !== "training")
      return (
        <td key={d} className={cls}>
          <span className="hm-c hm-abs" title={`${when}: ${DAY_LABEL[sh.type].toLowerCase()}`}>
            {DAY_SHORT[sh.type]}
          </span>
        </td>
      );
    // рабочий день без часов и лидов: в графике смен пусто — не выходил
    const inWin = (!r.op.hireDate || d >= r.op.hireDate) && (!r.op.fireDate || d <= r.op.fireDate);
    if (cal.isWork(d) && inWin && r.hasShifts)
      return (
        <td key={d} className={cls}>
          <span className="hm-c hm-off" title={`${when}: не выходил`} />
        </td>
      );
    return <td key={d} className={cls} />;
  };

  const isPaused = (r: OpRow) => r.op.status === "pause" && !r.op.deletedAt;
  const pausedAll = paused ? sections.reduce((a, s) => a + s.rows.filter(isPaused).length, 0) : 0;
  const opRow = (r: OpRow) => (
    <tr key={r.op.id}>
      <td className="hm-name">
        <button type="button" className="hm-op" onClick={() => onOpen(r.op.id)}>
          <Avatar name={r.op.name} id={r.op.id} size={20} />
          <span>{shortName(r.op.name)}</span>
        </button>
      </td>
      {days.map((d, i) => cell(r, d, i))}
      <td className="hm-tot num">
        {fmtInt(r.pace.fact)}
        {r.terms.plan > 0 && <span className="muted"> {fmtPct(r.pace.pct)}</span>}
      </td>
    </tr>
  );

  return (
    <div className="card hm-card">
      <div className="tbl-wrap hm-wrap">
        <table className="hm" style={{ minWidth: NAME_W + TOT_W + days.length * DAY_MIN }}>
          <colgroup>
            <col style={{ width: NAME_W }} />
            {days.map((d) => (
              <col key={d} />
            ))}
            <col style={{ width: TOT_W }} />
          </colgroup>
          <thead>
            <tr>
              <th className="hm-name">Оператор</th>
              {days.map((d, i) => (
                <th key={d} className={`hm-d${weekStartCls(d, i)}${cal.isWork(d) ? "" : " hm-we"}${d === cal.today ? " hm-today" : ""}`}>
                  <span>{fmtWeekday(d)}</span>
                  {Number(d.slice(8))}
                </th>
              ))}
              <th className="hm-tot">Факт</th>
            </tr>
          </thead>
          <tbody>
            {sections.map((sec) => {
              const rows = sec.rows.filter((r) => !paused || !isPaused(r));
              if (!rows.length) return null;
              return (
                <Fragment key={sec.key}>
                  {grouped && (
                    <tr className="hm-grp">
                      <td colSpan={days.length + 2}>
                        <span className="hm-grp-lbl">
                          <Swatch hue={sec.color} />
                          {sec.name}
                          {sec.supervisor && <span className="muted">· СВ {sec.supervisor}</span>}
                        </span>
                      </td>
                    </tr>
                  )}
                  {rows.map(opRow)}
                </Fragment>
              );
            })}
            {/* на паузе — после всех групп, одной свёрнутой строкой */}
            {paused && pausedAll > 0 && (
              <>
                <tr className="hm-psep" onClick={paused.toggle} aria-expanded={paused.open}>
                  <td colSpan={days.length + 2}>
                    <span className="hm-grp-lbl">
                      <Icon name="chevR" size={12} className={`grp-chev${paused.open ? " open" : ""}`} />
                      На паузе · {pausedAll}
                    </span>
                  </td>
                </tr>
                {paused.open && sections.flatMap((s) => s.rows.filter(isPaused)).map(opRow)}
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="hm-legend">
        {[
          ["green", "≥ 110% плана дня"],
          ["blue", "95–110%"],
          ["amber", "80–95%"],
          ["red", "< 80%"],
        ].map(([h, l]) => (
          <span key={h}>
            <i className="hm-c" style={{ background: `var(--c-${h}-bg)` }} />
            {l}
          </span>
        ))}
        <span>
          <i className="hm-c hm-zero" style={{ background: "var(--c-red-bg)" }} />
          смена без лидов
        </span>
        <span>
          <i className="hm-c hm-off" />
          не выходил
        </span>
        <span>
          <i className="hm-c hm-abs">О</i>
          отпуск, Б — больничный, В — выходной
        </span>
      </div>
    </div>
  );
}
