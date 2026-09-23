"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Bar, CartesianGrid, ComposedChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Lead, MonthKey } from "@/lib/crm/types";
import { bestWindow, hh, hourGrid, perDay } from "@/lib/crm/hours";
import { WEEKDAYS_SHORT, addMonths, fmtMonth, fmtMonthShort, monthEnd, monthStart } from "@/lib/crm/dates";
import { LEADS, fmtInt, fmtNum, fmtPct, plural, safeDiv } from "@/lib/crm/format";
import { Empty, Seg, downloadText, toCsv } from "@/components/ui/kit";
import { Legend } from "@/components/ui/charts";
import { Icon } from "@/components/ui/icons";

/**
 * Лиды по часам. Главное — столбики «сколько лидов в среднем даёт этот час за рабочий
 * день»: форма дня и лучшее окно смены видны сразу. Ниже — компактная карта по дням
 * недели без цифр в клетках (цифры — при наведении), чтобы сравнить понедельник с пятницей.
 */

type Span = "1" | "3" | "6";

const WEEKDAYS_FULL = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
/** Меньше стольких лидов в часе — доля «не доведён» случайна. */
const MIN_FOR_FAIL = 5;

interface HourPoint {
  hour: number;
  label: string;
  ok: number;
  failed: number;
  okAvg: number;
  failedAvg: number;
}

export function LeadsByHour({ leads, month, dayHours, scopeLabel }: { leads: Lead[]; month: MonthKey; dayHours: number; scopeLabel: string }) {
  const [span, setSpan] = useState<Span>("1");
  const back = Number(span) - 1;
  const from = monthStart(addMonths(month, -back));
  const to = monthEnd(month);
  const g = useMemo(() => hourGrid(leads, from, to), [leads, from, to]);
  const len = dayHours > 0 ? dayHours : 8;
  const win = useMemo(() => bestWindow(g.byHour, len), [g.byHour, len]);

  const days = g.daysByWd.reduce((a, b) => a + b, 0);
  const hours = Array.from({ length: g.hourTo - g.hourFrom + 1 }, (_, i) => g.hourFrom + i);
  const points: HourPoint[] = hours.map((h) => ({
    hour: h,
    label: String(h),
    ok: g.byHour[h],
    failed: g.failedByHour[h],
    okAvg: safeDiv(g.byHour[h], days),
    failedAvg: safeDiv(g.failedByHour[h], days),
  }));
  // дни недели без лидов (обычно выходные) в карте не показываем
  const weekdays = WEEKDAYS_SHORT.map((w, wd) => ({ w, wd })).filter((x) => g.daysByWd[x.wd] > 0);
  let cellMax = 0;
  for (const { wd } of weekdays) for (const h of hours) cellMax = Math.max(cellMax, perDay(g, wd, h));

  const peakHour = g.byHour.reduce((best, n, h) => (n > g.byHour[best] ? h : best), 0);
  const bestWd = weekdays.map(({ wd }) => ({ wd, avg: safeDiv(g.byWd[wd], g.daysByWd[wd]) })).sort((a, b) => b.avg - a.avg)[0] ?? null;
  const failAvg = safeDiv(g.failedTotal, g.total + g.failedTotal);
  const failHour =
    hours
      .map((h) => ({ h, all: g.byHour[h] + g.failedByHour[h], pct: safeDiv(g.failedByHour[h], g.byHour[h] + g.failedByHour[h]) }))
      .filter((x) => x.all >= MIN_FOR_FAIL && x.pct > failAvg)
      .sort((a, b) => b.pct - a.pct)[0] ?? null;

  const period = span === "1" ? fmtMonth(month) : `${fmtMonthShort(addMonths(month, -back))} – ${fmtMonthShort(month)}`;

  const exportCsv = () => {
    const head = ["День недели", ...hours.map(hh), "Всего"];
    const body = WEEKDAYS_SHORT.map((w, wd) => [w, ...hours.map((h) => g.leads[wd][h]), g.byWd[wd]]);
    const bad = WEEKDAYS_SHORT.map((w, wd) => [`${w}, не доведено`, ...hours.map((h) => g.failed[wd][h]), g.failed[wd].reduce((a, b) => a + b, 0)]);
    downloadText(`leads_by_hour_${from}_${to}.csv`, toCsv([head, ...body, ["Всего", ...hours.map((h) => g.byHour[h]), g.total], [], ...bad]), "text/csv;charset=utf-8");
  };

  return (
    <div className="card card-pad">
      <div className="card-head" style={{ flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 className="card-title">Лиды по часам</h3>
          <p className="card-sub">
            {scopeLabel} · {period} · {fmtInt(g.total)} {plural(g.total, LEADS)} за {fmtInt(days)} {plural(days, ["рабочий день", "рабочих дня", "рабочих дней"])}
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <Seg<Span>
            value={span}
            onChange={setSpan}
            options={[
              { value: "1", label: "Месяц" },
              { value: "3", label: "3 мес." },
              { value: "6", label: "6 мес." },
            ]}
          />
          <button className="btn btn-sm" onClick={exportCsv} disabled={!g.total && !g.failedTotal}>
            <Icon name="download" size={13} /> CSV
          </button>
        </div>
      </div>

      {g.total + g.failedTotal === 0 ? (
        <Empty icon="clock" title="Лидов за период нет" text="График строится по времени передачи лида. Выберите период подлиннее или другую группу." />
      ) : (
        <div className="stack" style={{ gap: 18 }}>
          <div className="hs-tiles">
            <Tile label="Пиковый час" value={`${hh(peakHour)}–${hh(peakHour + 1)}`} sub={`${fmtPct(safeDiv(g.byHour[peakHour], g.total))} лидов · ${fmtNum(safeDiv(g.byHour[peakHour], days))} в день`} />
            {win && <Tile label={`Лучшая смена на ${fmtNum(len)} ч`} value={`${hh(win.from)}–${hh(win.to)}`} sub={`собирает ${fmtPct(win.share)} лидов`} tone="brand" />}
            {bestWd && <Tile label="Сильный день" value={WEEKDAYS_FULL[bestWd.wd]} sub={`${fmtNum(bestWd.avg)} ${plural(Math.round(bestWd.avg), LEADS)} за день`} />}
            {failHour ? (
              <Tile label="Чаще срываются" value={`${hh(failHour.h)}–${hh(failHour.h + 1)}`} sub={`не доведено ${fmtPct(failHour.pct)} при среднем ${fmtPct(failAvg)}`} tone="bad" />
            ) : (
              <Tile label="Не доведено" value={fmtPct(failAvg)} sub={`${fmtInt(g.failedTotal)} ${plural(g.failedTotal, LEADS)} за период`} />
            )}
          </div>

          <div>
            <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>В среднем за рабочий день</span>
              <Legend
                items={[
                  { color: "var(--brand)", label: "В факт", bar: true },
                  { color: "var(--c-red-fg)", label: "Не доведено", bar: true },
                  ...(win ? [{ color: "color-mix(in srgb, var(--brand) 22%, transparent)", label: "Лучшая смена", bar: true }] : []),
                ]}
              />
            </div>
            <HourBars points={points} win={win} />
          </div>

          {weekdays.length > 1 && (
            <div>
              <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>По дням недели</span>
                <span className="hs-scale">
                  меньше <i /> больше
                </span>
              </div>
              <div className="hs-map" style={{ "--cols": hours.length } as CSSProperties}>
                <span />
                {hours.map((h) => (
                  <span key={h} className="hs-map-h">
                    {h}
                  </span>
                ))}
                <span className="hs-map-h">в день</span>
                {weekdays.map(({ w, wd }) => (
                  <Row key={w} w={w} wd={wd} hours={hours} g={g} max={cellMax} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ w, wd, hours, g, max }: { w: string; wd: number; hours: number[]; g: ReturnType<typeof hourGrid>; max: number }) {
  return (
    <>
      <span className="hs-map-wd">{w}</span>
      {hours.map((h) => {
        const v = perDay(g, wd, h);
        const n = g.leads[wd][h];
        const f = g.failed[wd][h];
        return (
          <span
            key={h}
            className="hs-map-c"
            style={{ "--k": max > 0 ? Math.round((v / max) * 100) / 100 : 0 } as CSSProperties}
            title={`${WEEKDAYS_FULL[wd]}, ${hh(h)}–${hh(h + 1)}\nв среднем ${fmtNum(v, 1)} за день · всего ${fmtInt(n)}${f ? ` · не доведено ${fmtInt(f)}` : ""}`}
          />
        );
      })}
      <span className="hs-map-sum num">{fmtNum(safeDiv(g.byWd[wd], g.daysByWd[wd]))}</span>
    </>
  );
}

/** Ровные деления оси: 0, 0.5, 1… или 0, 2, 4… — а не 0,9 / 1,7 / 2,6. */
function niceTicks(max: number): number[] {
  const raw = Math.max(max, 0.1) / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((x) => x >= raw) ?? raw;
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

function HourBars({ points, win }: { points: HourPoint[]; win: { from: number; to: number } | null }) {
  const ticks = niceTicks(Math.max(...points.map((p) => p.okAvg + p.failedAvg)));
  return (
    <div style={{ width: "100%", height: 230 }}>
      <ResponsiveContainer>
        <ComposedChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: -14 }} barCategoryGap="18%">
          <CartesianGrid stroke="var(--ink-06)" vertical={false} />
          {win && (
            <ReferenceArea
              x1={String(Math.max(win.from, points[0].hour))}
              x2={String(Math.min(win.to - 1, points[points.length - 1].hour))}
              fill="var(--brand)"
              fillOpacity={0.07}
              ifOverflow="extendDomain"
            />
          )}
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--dim)" }} tickLine={false} axisLine={{ stroke: "var(--ink-10)" }} tickFormatter={(v) => `${v}:00`} interval="preserveStartEnd" minTickGap={6} />
          <YAxis tick={{ fontSize: 11, fill: "var(--dim)" }} tickLine={false} axisLine={false} width={44} ticks={ticks} domain={[0, ticks[ticks.length - 1]]} tickFormatter={(v: number) => (Number.isInteger(v) ? fmtInt(v) : fmtNum(v, 1))} />
          <Tooltip
            cursor={{ fill: "var(--ink-04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as HourPoint;
              const all = p.ok + p.failed;
              return (
                <div className="hs-tip">
                  <b>
                    {hh(p.hour)}–{hh(p.hour + 1)}
                  </b>
                  <span>В среднем за день</span>
                  <em className="num">{fmtNum(p.okAvg, 1)}</em>
                  <span>Всего за период</span>
                  <em className="num">{fmtInt(p.ok)}</em>
                  <span>Не доведено</span>
                  <em className="num">{p.failed ? `${fmtInt(p.failed)} · ${fmtPct(safeDiv(p.failed, all))}` : "—"}</em>
                </div>
              );
            }}
          />
          <Bar dataKey="okAvg" stackId="h" fill="var(--brand)" isAnimationActive={false} maxBarSize={34} />
          <Bar dataKey="failedAvg" stackId="h" fill="var(--c-red-fg)" fillOpacity={0.55} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={34} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "brand" | "bad" }) {
  return (
    <div className={tone ? `hs-tile ${tone}` : "hs-tile"}>
      <span className="hs-tile-label">{label}</span>
      <span className="hs-tile-value">{value}</span>
      <span className="hs-tile-sub">{sub}</span>
    </div>
  );
}
