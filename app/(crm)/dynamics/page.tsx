"use client";

import { useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { dailyRows, weeklyRows } from "@/lib/crm/calc";
import { fmtDay, fmtDayShort, fmtMonth, fmtRange, fmtWeekday } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct, fmtSigned, fmtSignedPct, shortName } from "@/lib/crm/format";
import { Conv, LeadN, MonthSwitcher, PageHead, Seg } from "@/components/ui/kit";
import { Select, dot, type Opt } from "@/components/ui/select";
import { CumulativeChart, DailyBars, Legend } from "@/components/ui/charts";
import { Icon } from "@/components/ui/icons";
import { LeadsByHour } from "@/components/app/LeadsByHour";
import { NO_GROUP } from "@/lib/crm/types";
import { StickyHead, planItems } from "@/components/app/StickyHead";

export default function DynamicsPage() {
  const { data, ix, month, setMonth } = useCrm();
  const m = useMonthModel();
  const [scope, setScope] = useState("team");
  const [tab, setTab] = useState<"days" | "weeks" | "hours">("days");

  const sel = useMemo(() => {
    if (scope.startsWith("g:")) {
      const g = m.groups.find((x) => x.key === scope.slice(2));
      if (g) return { label: g.name, plan: g.plan, counts: ix.groupDay.get(g.key), hours: ix.hoursGroupDay.get(g.key), pace: g.pace };
    }
    if (scope.startsWith("o:")) {
      const r = m.ops.find((x) => x.op.id === scope.slice(2));
      if (r) return { label: shortName(r.op.name), plan: r.terms.plan, counts: ix.opDay.get(r.op.id), hours: ix.hoursOpDay.get(r.op.id), pace: r.pace };
    }
    return { label: "Вся команда", plan: m.team.plan, counts: ix.day, hours: ix.hoursDay, pace: m.team.pace };
  }, [scope, m, ix]);

  // лиды выбранного среза — для карты по часам (группа — на момент передачи, как в факте)
  const scopedLeads = useMemo(() => {
    if (scope.startsWith("g:")) {
      const key = scope.slice(2);
      return data.leads.filter((l) => (l.groupId || NO_GROUP) === key);
    }
    if (scope.startsWith("o:")) {
      const id = scope.slice(2);
      return data.leads.filter((l) => l.operatorId === id);
    }
    return data.leads;
  }, [scope, data.leads]);

  const days = useMemo(() => dailyRows(m.cal, sel.plan, sel.counts, sel.hours), [m.cal, sel]);
  const weeks = useMemo(() => weeklyRows(m.cal, sel.plan, sel.counts), [m.cal, sel]);
  const p = sel.pace;
  const cur = m.cal.phase === "current";


  return (
    <div className="stack">
      <StickyHead
        title="Динамика"
        ctx={fmtMonth(month)}
        items={[
          ...planItems(m.team.pace, m.team.lph, data.settings.convNormPct / 100),
          ...(m.team.pace.plan > 0 && m.team.pace.elapsedW > 0 ? [{ l: "Прогноз", v: `${fmtInt(Math.round(m.team.pace.rr))} · ${fmtPct(m.team.pace.rrPct)}` }] : []),
        ]}
      />
      <PageHead
        title="Динамика"
        sub={`${fmtMonth(month)} · ${sel.label}: ${fmtInt(p.fact)} из ${fmtInt(sel.plan)} (${fmtPct(p.pct)}), прогноз ${fmtInt(p.rr)}`}
        actions={
          <>
            <MonthSwitcher value={month} onChange={setMonth} />
          </>
        }
      />

      <div className="toolbar">
        <Select
          width={300}
          value={scope}
          onChange={setScope}
          ariaLabel="Чья динамика"
          minPopWidth={320}
          options={[
            { value: "team", label: "Вся команда" },
            ...m.groups.map<Opt>((g) => ({ value: `g:${g.key}`, label: g.name, group: "Группы", icon: dot(g.color) })),
            ...[...m.ops]
              .sort((a, b) => a.op.name.localeCompare(b.op.name, "ru"))
              .map<Opt>((r) => ({ value: `o:${r.op.id}`, label: shortName(r.op.name), group: "Операторы" })),
          ]}
        />
        <Seg value={tab} onChange={setTab} options={[{ value: "days", label: "По дням" }, { value: "weeks", label: "По неделям" }, { value: "hours", label: "По часам" }]} />
      </div>

      {tab !== "hours" && (
        <div className="grid2" style={{ gap: 16 }}>
          <div className="card card-pad">
            <div className="card-head">
              <h3 className="card-title"><Icon name="trend" size={15} className="title-ic" />Накопительный итог</h3>
              <Legend items={[{ color: "var(--brand)", label: "Факт" }, { color: "var(--text-sub3)", label: "План", dashed: true }, ...(cur ? [{ color: "var(--brand)", label: "Прогноз", dashed: true }] : [])]} />
            </div>
            <CumulativeChart rows={days} rr={p.rr} showForecast={cur && p.elapsedW > 0} height={230} />
          </div>
          <div className="card card-pad">
            <div className="card-head">
              <h3 className="card-title"><Icon name="chart" size={15} className="title-ic" />Лиды по дням</h3>
              <span style={{ fontSize: 12, color: "var(--dim)" }}>пунктир — дневной план {fmtNum(p.dailyPlan)}</span>
            </div>
            <DailyBars rows={days} dailyPlan={p.dailyPlan} height={230} />
          </div>
        </div>
      )}

      {tab === "days" ? (
        <div className="tbl-wrap">
          <table className="tbl tbl-fit">
            <thead>
              <tr>
                <th>День</th>
                <th className="r">Лиды</th>
                <th className="r">Накоп. факт</th>
                <th className="r">Накоп. план</th>
                <th className="r">Отклонение</th>
                <th className="r" title="Накопленный факт / прошедшие рабочие дни">Средний темп</th>
                <th className="r" title="Сколько нужно в рабочий день дальше, чтобы выполнить план">Нужный темп</th>
                <th className="r bl">Часы</th>
                <th className="r" title="Конверсия: лиды ÷ отработанные часы">Конв.</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className={d.future ? "dim" : ""} style={!d.isWork ? { background: "var(--ink-03)" } : undefined}>
                  <td>
                    <span className="num">{fmtDayShort(d.day)}</span> <span className="muted">{fmtWeekday(d.day)}</span>
                    {!d.isWork && <span className="muted"> · вых.</span>}
                  </td>
                  <td className="r num">{d.future ? "" : <LeadN n={d.count} />}</td>
                  <td className="r num">{d.future ? "" : fmtInt(d.cum)}</td>
                  <td className="r num muted">{fmtNum(d.cumPlan)}</td>
                  <td className="r num" style={{ color: d.future ? undefined : d.deviation >= 0 ? "var(--c-green-fg)" : "var(--c-red-fg)" }}>{d.future ? "" : fmtSigned(d.deviation, 1)}</td>
                  <td className="r num">{d.future || d.avgPace == null ? "" : fmtNum(d.avgPace)}</td>
                  <td className="r num">{d.future || d.needPace == null ? "" : fmtNum(d.needPace)}</td>
                  <td className="r num bl">{d.hours ? fmtNum(d.hours) : ""}</td>
                  <td className="r num">{d.hours > 0 && !d.future ? <Conv leads={d.count} hours={d.hours} /> : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === "weeks" ? (
        <div className="tbl-wrap">
          <table className="tbl tbl-fit">
            <thead>
              <tr>
                <th>Неделя</th>
                <th className="r">Раб. дней</th>
                <th className="r">План недели</th>
                <th className="r">Факт</th>
                <th className="r">Выполнение</th>
                <th className="r">Среднее в день</th>
                <th className="r" title="Изменение среднего в рабочий день к предыдущей неделе">К прошлой неделе</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.from} className={w.future ? "dim" : ""}>
                  <td title={`${fmtDay(w.from)} — ${fmtDay(w.to)}`}>{fmtRange(w.from, w.to)}</td>
                  <td className="r num">
                    {w.elapsedW < w.workdays && !w.future ? `${w.elapsedW} из ${w.workdays}` : w.workdays}
                  </td>
                  <td className="r num">{fmtNum(w.plan)}</td>
                  <td className="r num" style={{ fontWeight: 600 }}>{w.future ? "" : fmtInt(w.fact)}</td>
                  <td className="r num">{w.future ? "" : fmtPct(w.pct)}</td>
                  <td className="r num">{w.avgPerDay == null ? "" : fmtNum(w.avgPerDay)}</td>
                  <td className="r num" style={{ color: w.change == null ? undefined : w.change >= 0 ? undefined : "var(--c-red-fg)" }}>{w.change == null ? "—" : fmtSignedPct(w.change)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <LeadsByHour leads={scopedLeads} month={month} dayHours={data.settings.dayHours} scopeLabel={sel.label} />
      )}
    </div>
  );
}
