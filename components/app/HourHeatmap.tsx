"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { Lead, MonthKey } from "@/lib/crm/types";
import { bestWindow, hh, hourGrid, perDay, topHours, type HourGrid } from "@/lib/crm/hours";
import { WEEKDAYS_SHORT, addMonths, fmtMonth, fmtMonthShort, monthEnd, monthStart } from "@/lib/crm/dates";
import { LEADS, fmtInt, fmtNum, fmtPct, plural, safeDiv } from "@/lib/crm/format";
import { Empty, Seg, downloadText, toCsv } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";

/**
 * Тепловая карта «день недели × час»: в какие часы передаётся больше лидов
 * и где лиды чаще срываются. Внизу — итог по часам, справа — по дням недели,
 * сбоку — выводы для графика смен (пик, лучшее окно смены, сильные часы).
 */

type Span = "1" | "3" | "6";
type Mode = "sum" | "avg" | "failed";

/** Меньше стольких лидов в часе — доля «не доведён» не показательна. */
const MIN_FOR_FAIL = 5;

export function HourHeatmap({ leads, month, dayHours, scopeLabel }: { leads: Lead[]; month: MonthKey; dayHours: number; scopeLabel: string }) {
  const [span, setSpan] = useState<Span>("1");
  const [mode, setMode] = useState<Mode>("sum");
  const from = monthStart(addMonths(month, -(Number(span) - 1)));
  const to = monthEnd(month);
  const g = useMemo(() => hourGrid(leads, from, to), [leads, from, to]);
  const hours = useMemo(() => Array.from({ length: g.hourTo - g.hourFrom + 1 }, (_, i) => g.hourFrom + i), [g.hourFrom, g.hourTo]);
  const win = useMemo(() => bestWindow(g.byHour, dayHours || 8), [g.byHour, dayHours]);
  const top = useMemo(() => topHours(g.byHour, 3), [g.byHour]);

  const period = span === "1" ? fmtMonth(month) : `${fmtMonthShort(addMonths(month, -(Number(span) - 1)))} – ${fmtMonthShort(month)}`;

  // значение клетки и масштаб цвета для выбранного режима
  const cell = (wd: number, h: number): number | null => {
    if (mode === "sum") return g.leads[wd][h];
    if (mode === "avg") return g.daysByWd[wd] ? perDay(g, wd, h) : null;
    const all = g.leads[wd][h] + g.failed[wd][h];
    return all ? g.failed[wd][h] / all : null;
  };
  let max = 0;
  for (let wd = 0; wd < 7; wd++) for (const h of hours) max = Math.max(max, cell(wd, h) ?? 0);

  const fmtCell = (v: number | null) => (v == null ? "" : mode === "failed" ? `${Math.round(v * 100)}` : mode === "avg" ? (v ? fmtNum(v, v < 10 ? 1 : 0) : "") : v ? fmtInt(v) : "");

  // выводы
  const wdAvg = g.byWd.map((n, wd) => ({ wd, n, avg: safeDiv(n, g.daysByWd[wd]) }));
  const bestWd = [...wdAvg].filter((x) => x.n > 0).sort((a, b) => b.avg - a.avg)[0] ?? null;
  const failHour =
    g.byHour
      .map((n, h) => ({ h, all: n + g.failedByHour[h], pct: safeDiv(g.failedByHour[h], n + g.failedByHour[h]) }))
      .filter((x) => x.all >= MIN_FOR_FAIL && x.pct > 0)
      .sort((a, b) => b.pct - a.pct)[0] ?? null;
  const failAvg = safeDiv(g.failedTotal, g.total + g.failedTotal);

  const exportCsv = () => {
    const head = ["День недели", ...hours.map(hh), "Итого"];
    const body = WEEKDAYS_SHORT.map((w, wd) => [w, ...hours.map((h) => g.leads[wd][h]), g.byWd[wd]]);
    const failed = WEEKDAYS_SHORT.map((w, wd) => [`${w} · не доведено`, ...hours.map((h) => g.failed[wd][h]), g.failed[wd].reduce((a, b) => a + b, 0)]);
    downloadText(`leads_by_hour_${from}_${to}.csv`, toCsv([head, ...body, ["Итого", ...hours.map((h) => g.byHour[h]), g.total], [], ...failed]), "text/csv;charset=utf-8");
  };

  return (
    <div className="card card-pad">
      <div className="card-head" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 className="card-title">Лиды по часам</h3>
          <p className="card-sub">
            {scopeLabel} · {period} · {fmtInt(g.total)} {plural(g.total, LEADS)} в факт{g.failedTotal ? `, не доведено ${fmtInt(g.failedTotal)}` : ""}
          </p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <Seg<Span>
            value={span}
            onChange={setSpan}
            options={[
              { value: "1", label: "Месяц" },
              { value: "3", label: "3 мес." },
              { value: "6", label: "6 мес." },
            ]}
          />
          <Seg<Mode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "sum", label: "Всего" },
              { value: "avg", label: "В среднем за день" },
              { value: "failed", label: "Не доведено, %" },
            ]}
          />
          <button className="btn btn-sm" onClick={exportCsv} disabled={!g.total && !g.failedTotal}>
            <Icon name="download" size={13} /> CSV
          </button>
        </div>
      </div>

      {g.total + g.failedTotal === 0 ? (
        <Empty icon="clock" title="Лидов за период нет" text="Карта строится по времени передачи лида. Выберите период подлиннее или другую группу." />
      ) : (
        <div className="heat-layout">
          <div className="heat-scroll">
            <table className="heat" style={{ "--heat-cols": hours.length } as CSSProperties}>
              <thead>
                <tr>
                  <th />
                  {hours.map((h) => (
                    <th key={h} className="heat-h">
                      {String(h).padStart(2, "0")}
                    </th>
                  ))}
                  <th className="heat-sum">Итого</th>
                </tr>
              </thead>
              <tbody>
                {WEEKDAYS_SHORT.map((w, wd) => (
                  <tr key={w}>
                    <th className="heat-wd">
                      {w}
                      {g.daysByWd[wd] > 0 && <span>{g.daysByWd[wd]} дн.</span>}
                    </th>
                    {hours.map((h) => {
                      const v = cell(wd, h);
                      const k = max > 0 && v ? v / max : 0;
                      const n = g.leads[wd][h];
                      const f = g.failed[wd][h];
                      return (
                        <td
                          key={h}
                          className={mode === "failed" ? "heat-c bad" : "heat-c"}
                          style={{ "--k": Math.round(k * 100) / 100 } as CSSProperties}
                          data-hot={k > 0.55 ? "1" : undefined}
                          title={`${w} ${hh(h)}–${hh(h + 1)}: ${fmtInt(n)} ${plural(n, LEADS)}${f ? `, не доведено ${f}` : ""}${g.daysByWd[wd] ? ` · в среднем ${fmtNum(perDay(g, wd, h), 2)} за день` : ""}`}
                        >
                          {fmtCell(v)}
                        </td>
                      );
                    })}
                    <td className="heat-sum num">
                      {mode === "avg" ? fmtNum(safeDiv(g.byWd[wd], g.daysByWd[wd])) : mode === "failed" ? pctOrDash(g.failed[wd].reduce((a, b) => a + b, 0), g.byWd[wd]) : fmtInt(g.byWd[wd])}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th className="heat-wd">Итого</th>
                  {hours.map((h) => (
                    <td key={h} className="heat-foot">
                      <HourBar g={g} h={h} mode={mode} />
                    </td>
                  ))}
                  <td className="heat-sum num">{mode === "failed" ? fmtPct(failAvg) : fmtInt(g.total)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="heat-note">
              {mode === "sum"
                ? "Число лидов по времени передачи. Чем темнее клетка, тем больше лидов."
                : mode === "avg"
                  ? "Сумма ÷ число дней этого дня недели, когда были лиды. Так пятница с 4 рабочими днями честно сравнивается с понедельником, у которого их 5."
                  : "Доля «не доведён» от всех лидов часа. Итог справа — по дню недели, внизу — общий."}
            </p>
          </div>

          <div className="heat-side">
            {g.peak && (
              <Insight icon="bolt" title="Пик">
                <b>
                  {WEEKDAYS_SHORT[g.peak.wd]}, {hh(g.peak.hour)}–{hh(g.peak.hour + 1)}
                </b>{" "}
                — {fmtInt(g.peak.leads)} {plural(g.peak.leads, LEADS)}
              </Insight>
            )}
            {win && (
              <Insight icon="clock" title={`Лучшее окно смены на ${fmtNum(dayHours || 8)} ч`}>
                <b>
                  {hh(win.from)}–{hh(win.to)}
                </b>{" "}
                собирает {fmtPct(win.share)} лидов периода
              </Insight>
            )}
            {top.length > 0 && (
              <Insight icon="chart" title="Сильные часы">
                {top.map((t, i) => (
                  <span key={t.hour}>
                    {i > 0 && ", "}
                    <b>{hh(t.hour)}</b> {fmtPct(t.share)}
                  </span>
                ))}
              </Insight>
            )}
            {bestWd && (
              <Insight icon="calendar" title="Сильный день недели">
                <b>{WEEKDAYS_SHORT[bestWd.wd]}</b> — {fmtNum(bestWd.avg)} {plural(Math.round(bestWd.avg), LEADS)} за день в среднем
              </Insight>
            )}
            {failHour && failHour.pct > failAvg && (
              <Insight icon="alert" title="Чаще срываются" tone="bad">
                <b>{hh(failHour.h)}</b> — не доведено {fmtPct(failHour.pct)} при среднем {fmtPct(failAvg)}
              </Insight>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function pctOrDash(failed: number, ok: number): string {
  return failed + ok ? `${Math.round((failed / (failed + ok)) * 100)}` : "";
}

/** Итог часа — маленький столбик: видно форму дня, не читая цифры. */
function HourBar({ g, h, mode }: { g: HourGrid; h: number; mode: Mode }) {
  const val = mode === "failed" ? safeDiv(g.failedByHour[h], g.byHour[h] + g.failedByHour[h]) : g.byHour[h];
  const max = mode === "failed" ? 1 : Math.max(1, ...g.byHour);
  const label = mode === "failed" ? (g.byHour[h] + g.failedByHour[h] ? `${Math.round(val * 100)}` : "") : val ? fmtInt(val) : "";
  return (
    <div className="heat-bar" title={`${hh(h)}: ${fmtInt(g.byHour[h])} ${plural(g.byHour[h], LEADS)}${g.failedByHour[h] ? `, не доведено ${g.failedByHour[h]}` : ""}`}>
      <span className={mode === "failed" ? "bad" : undefined} style={{ height: `${Math.round(safeDiv(val, max) * 100)}%` }} />
      <em>{label}</em>
    </div>
  );
}

function Insight({ icon, title, children, tone }: { icon: "bolt" | "clock" | "chart" | "calendar" | "alert"; title: string; children: ReactNode; tone?: "bad" }) {
  return (
    <div className={tone === "bad" ? "heat-ins bad" : "heat-ins"}>
      <span className="heat-ins-ico">
        <Icon name={icon} size={15} />
      </span>
      <div>
        <div className="heat-ins-title">{title}</div>
        <div className="heat-ins-text">{children}</div>
      </div>
    </div>
  );
}
