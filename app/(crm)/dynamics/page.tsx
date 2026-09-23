"use client";

import { useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { dailyRows, weeklyRows } from "@/lib/crm/calc";
import { fmtDay, fmtDayShort, fmtMonth, fmtRange, fmtWeekday } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct, fmtSigned, fmtSignedPct } from "@/lib/crm/format";
import { MonthSwitcher, PageHead, Seg, downloadText, toCsv } from "@/components/ui/kit";
import { Select, dot, type Opt } from "@/components/ui/select";
import { CumulativeChart, DailyBars, Legend } from "@/components/ui/charts";
import { Icon } from "@/components/ui/icons";
import { HourHeatmap } from "@/components/app/HourHeatmap";
import { NO_GROUP } from "@/lib/crm/types";

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
      if (r) return { label: r.op.name, plan: r.terms.plan, counts: ix.opDay.get(r.op.id), hours: ix.hoursOpDay.get(r.op.id), pace: r.pace };
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

  const exportCsv = () => {
    if (tab === "days") {
      const head = ["Дата", "День недели", "Рабочий", "Лиды", "Накоп. факт", "Накоп. план", "Отклонение", "Средний темп", "Нужный темп", "Часы", "Лид/час"];
      const body = days.filter((d) => !d.future).map((d) => [d.day, fmtWeekday(d.day), d.isWork ? "да" : "нет", d.count, d.cum, Math.round(d.cumPlan * 10) / 10, Math.round(d.deviation * 10) / 10, d.avgPace == null ? "" : Math.round(d.avgPace * 10) / 10, d.needPace == null ? "" : Math.round(d.needPace * 10) / 10, d.hours, d.hours > 0 ? Math.round((d.count / d.hours) * 100) / 100 : ""]);
      downloadText(`dynamics_days_${month}.csv`, toCsv([head, ...body]), "text/csv;charset=utf-8");
    } else {
      const head = ["С", "По", "План недели", "Факт", "% выполнения", "Среднее в день", "Изменение к прошлой неделе, %"];
      const body = weeks.map((w) => [w.from, w.to, Math.round(w.plan * 10) / 10, w.fact, Math.round(w.pct * 1000) / 10, w.avgPerDay == null ? "" : Math.round(w.avgPerDay * 10) / 10, w.change == null ? "" : Math.round(w.change * 1000) / 10]);
      downloadText(`dynamics_weeks_${month}.csv`, toCsv([head, ...body]), "text/csv;charset=utf-8");
    }
  };

  return (
    <div className="stack">
      <PageHead
        title="Динамика"
        sub={`${fmtMonth(month)} · ${sel.label}: ${fmtInt(p.fact)} из ${fmtInt(sel.plan)} (${fmtPct(p.pct)}), прогноз ${fmtInt(p.rr)}`}
        actions={
          <>
            <MonthSwitcher value={month} onChange={setMonth} />
            {tab !== "hours" && (
              <button className="btn" onClick={exportCsv}>
                <Icon name="download" size={14} /> CSV
              </button>
            )}
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
              .map<Opt>((r) => ({ value: `o:${r.op.id}`, label: r.op.name, group: "Операторы" })),
          ]}
        />
        <Seg value={tab} onChange={setTab} options={[{ value: "days", label: "По дням" }, { value: "weeks", label: "По неделям" }, { value: "hours", label: "По часам" }]} />
      </div>

      {tab !== "hours" && (
        <div className="grid2" style={{ gap: 16 }}>
          <div className="card card-pad">
            <div className="card-head">
              <h3 className="card-title">Накопительный итог</h3>
              <Legend items={[{ color: "var(--brand)", label: "Факт" }, { color: "var(--text-sub3)", label: "План", dashed: true }, ...(cur ? [{ color: "var(--brand)", label: "Прогноз", dashed: true }] : [])]} />
            </div>
            <CumulativeChart rows={days} rr={p.rr} showForecast={cur && p.elapsedW > 0} height={230} />
          </div>
          <div className="card card-pad">
            <div className="card-head">
              <h3 className="card-title">Лиды по дням</h3>
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
                <th className="r">Лид/час</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day} className={d.future ? "dim" : ""} style={!d.isWork ? { background: "var(--ink-03)" } : undefined}>
                  <td>
                    <span className="num">{fmtDayShort(d.day)}</span> <span className="muted">{fmtWeekday(d.day)}</span>
                    {!d.isWork && <span className="muted"> · вых.</span>}
                  </td>
                  <td className="r num" style={{ fontWeight: 600 }}>{d.future ? "" : fmtInt(d.count)}</td>
                  <td className="r num">{d.future ? "" : fmtInt(d.cum)}</td>
                  <td className="r num muted">{fmtNum(d.cumPlan)}</td>
                  <td className="r num" style={{ color: d.future ? undefined : d.deviation >= 0 ? "var(--c-green-fg)" : "var(--c-red-fg)" }}>{d.future ? "" : fmtSigned(d.deviation, 1)}</td>
                  <td className="r num">{d.future || d.avgPace == null ? "" : fmtNum(d.avgPace)}</td>
                  <td className="r num">{d.future || d.needPace == null ? "" : fmtNum(d.needPace)}</td>
                  <td className="r num bl">{d.hours ? fmtNum(d.hours) : ""}</td>
                  <td className="r num">{d.hours > 0 && !d.future ? fmtNum(d.count / d.hours, 2) : ""}</td>
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
                  <td className="r num" style={{ color: w.change == null ? undefined : w.change >= 0 ? "var(--c-green-fg)" : "var(--c-red-fg)" }}>{w.change == null ? "—" : fmtSignedPct(w.change)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <HourHeatmap leads={scopedLeads} month={month} dayHours={data.settings.dayHours} scopeLabel={sel.label} />
      )}
    </div>
  );
}
