"use client";

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import type { DayRow } from "@/lib/crm/calc";
import type { DayKey } from "@/lib/crm/types";
import { fmtDay, fmtWeekday } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct, fmtSigned } from "@/lib/crm/format";

/**
 * Два графика вместо одного с двумя осями: накопительный итог и дневные
 * значения живут в разных масштабах, и склеивать их на одной картинке
 * значило бы врать масштабом.
 */

const AXIS = { fontSize: 11, fill: "var(--dim)" } as const;

function TipBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--bg-modal)",
        border: "1px solid var(--ink-10)",
        borderRadius: 6,
        boxShadow: "var(--shadow-lg)",
        padding: "8px 10px",
        fontSize: 12,
        color: "var(--text)",
        minWidth: 150,
      }}
    >
      {children}
    </div>
  );
}

function TipRow({ color, label, value, dashed }: { color?: string; label: string; value: string; dashed?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
      {color && (
        <span
          style={{
            width: 12,
            height: 0,
            borderTop: `2px ${dashed ? "dashed" : "solid"} ${color}`,
            flex: "none",
          }}
        />
      )}
      <span style={{ color: "var(--text-sub)", flex: 1 }}>{label}</span>
      <span style={{ fontWeight: 600 }} className="num">
        {value}
      </span>
    </div>
  );
}

export function Legend({ items }: { items: { color: string; label: string; dashed?: boolean; bar?: boolean }[] }) {
  return (
    <div className="row" style={{ gap: 14, flexWrap: "wrap", fontSize: 12, color: "var(--text-sub)" }}>
      {items.map((i) => (
        <span key={i.label} className="row" style={{ gap: 6 }}>
          {i.bar ? (
            <span style={{ width: 10, height: 10, borderRadius: 3, background: i.color }} />
          ) : (
            <span style={{ width: 16, height: 0, borderTop: `2px ${i.dashed ? "dashed" : "solid"} ${i.color}` }} />
          )}
          {i.label}
        </span>
      ))}
    </div>
  );
}

interface CumPoint {
  d: number;
  day: string;
  fact: number | null;
  plan: number;
  forecast: number | null;
}

export function CumulativeChart({ rows, rr, showForecast, height = 260 }: { rows: DayRow[]; rr: number; showForecast: boolean; height?: number }) {
  const lastIdx = rows.reduce((a, r, i) => (!r.future ? i : a), -1);
  const lastCum = lastIdx >= 0 ? rows[lastIdx].cum : 0;
  const n = rows.length;
  const data: CumPoint[] = rows.map((r, i) => ({
    d: i + 1,
    day: r.day,
    fact: r.future ? null : r.cum,
    plan: Math.round(r.cumPlan * 10) / 10,
    // прогноз: от последнего факта линейно к RR на конец месяца
    forecast:
      showForecast && lastIdx >= 0 && i >= lastIdx
        ? Math.round((lastCum + ((rr - lastCum) * (i - lastIdx)) / Math.max(1, n - 1 - lastIdx)) * 10) / 10
        : null,
  }));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--ink-06)" vertical={false} />
          <XAxis dataKey="d" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--ink-10)" }} interval="preserveStartEnd" minTickGap={14} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
          <Tooltip
            cursor={{ stroke: "var(--ink-15)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as CumPoint;
              return (
                <TipBox>
                  <div style={{ fontWeight: 600 }}>
                    {fmtDay(p.day)}, {fmtWeekday(p.day)}
                  </div>
                  {p.fact != null && <TipRow color="var(--brand)" label="Факт" value={fmtInt(p.fact)} />}
                  <TipRow color="var(--text-sub3)" label="План" value={fmtNum(p.plan)} dashed />
                  {p.fact != null && <TipRow label="Отклонение" value={fmtSigned(p.fact - p.plan)} />}
                  {p.forecast != null && p.fact == null && <TipRow color="var(--brand)" label="Прогноз" value={fmtNum(p.forecast)} dashed />}
                </TipBox>
              );
            }}
          />
          <Area type="monotone" dataKey="fact" stroke="none" fill="var(--brand)" fillOpacity={0.1} isAnimationActive={false} connectNulls={false} />
          <Line type="linear" dataKey="plan" stroke="var(--text-sub3)" strokeWidth={1.5} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          {showForecast && (
            <Line type="linear" dataKey="forecast" stroke="var(--brand)" strokeOpacity={0.55} strokeWidth={2} strokeDasharray="3 4" dot={false} isAnimationActive={false} connectNulls />
          )}
          <Line
            type="monotone"
            dataKey="fact"
            stroke="var(--brand)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4.5, stroke: "var(--bg-panel)", strokeWidth: 2, fill: "var(--brand)" }}
            isAnimationActive={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

interface BarPoint {
  d: number;
  day: string;
  count: number | null;
  isWork: boolean;
  hours: number;
}

export function DailyBars({ rows, dailyPlan, height = 200 }: { rows: DayRow[]; dailyPlan: number; height?: number }) {
  const data: BarPoint[] = rows.map((r, i) => ({ d: i + 1, day: r.day, count: r.future ? null : r.count, isWork: r.isWork, hours: r.hours }));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }} barCategoryGap="22%">
          <CartesianGrid stroke="var(--ink-06)" vertical={false} />
          <XAxis dataKey="d" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--ink-10)" }} interval="preserveStartEnd" minTickGap={10} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
          <Tooltip
            cursor={{ fill: "var(--ink-04)" }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as BarPoint;
              return (
                <TipBox>
                  <div style={{ fontWeight: 600 }}>
                    {fmtDay(p.day)}, {fmtWeekday(p.day)}
                    {!p.isWork && <span style={{ color: "var(--dim)", fontWeight: 400 }}> · выходной</span>}
                  </div>
                  <TipRow label="Передано" value={p.count == null ? "—" : fmtInt(p.count)} />
                  {p.isWork && <TipRow label="Дневной план" value={fmtNum(dailyPlan)} />}
                  {p.hours > 0 && <TipRow label="Часы" value={fmtNum(p.hours)} />}
                  {p.hours > 0 && p.count != null && <TipRow label="Конверсия" value={fmtPct(p.count / p.hours)} />}
                </TipBox>
              );
            }}
          />
          {dailyPlan > 0 && <ReferenceLine y={dailyPlan} stroke="var(--text-sub3)" strokeDasharray="5 4" strokeWidth={1.5} ifOverflow="extendDomain" />}
          <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
            {data.map((p) => (
              <Cell key={p.day} fill={p.count != null && p.count >= dailyPlan && dailyPlan > 0 ? "var(--brand)" : p.isWork ? "var(--brand-soft)" : "var(--ink-15)"} fillOpacity={p.count != null && p.count >= dailyPlan ? 1 : 0.55} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── лиды по сменам (карточка оператора) ────────────────────────────── */
interface ShiftPoint {
  d: number;
  day: string;
  /** Лиды за смену; null — смены не было (выходной, больничный, до приёма) или день ещё впереди. */
  leads: number | null;
  hours: number;
}

/**
 * Лиды за каждую смену месяца — тем же языком, что мини-график в «Операторах»: линия соединяет
 * только смены (выходной — пропуск, а не ноль), смена без лидов — красная точка на нуле,
 * последняя смена — крупная точка. Пунктир — личный план дня.
 */
export function ShiftLeadsChart({ rows, dayPlan, height = 170, marks = [] }: { rows: DayRow[]; dayPlan: number; height?: number; marks?: { day: DayKey; label: string }[] }) {
  const data: ShiftPoint[] = rows.map((r, i) => ({
    d: i + 1,
    day: r.day,
    leads: !r.future && (r.hours > 0 || r.count > 0) ? r.count : null,
    hours: r.hours,
  }));
  const lastIdx = data.reduce((a, p, i) => (p.leads != null ? i : a), -1);
  const max = Math.max(4, dayPlan, ...data.map((p) => p.leads ?? 0));
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 10, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--ink-06)" vertical={false} />
          <XAxis dataKey="d" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--ink-10)" }} interval="preserveStartEnd" minTickGap={14} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} domain={[0, Math.ceil(max)]} />
          <Tooltip
            cursor={{ stroke: "var(--ink-15)", strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as ShiftPoint;
              return (
                <TipBox>
                  <div style={{ fontWeight: 600 }}>
                    {fmtDay(p.day)}, {fmtWeekday(p.day)}
                  </div>
                  {p.leads == null ? (
                    <div style={{ marginTop: 3, color: "var(--dim)" }}>нет смены</div>
                  ) : (
                    <>
                      <TipRow color="var(--sch-we-label)" label="Лиды" value={fmtInt(p.leads)} />
                      {p.hours > 0 && <TipRow label="Часы" value={fmtNum(p.hours)} />}
                      {p.hours > 0 && <TipRow label="Конверсия" value={fmtPct(p.leads / p.hours)} />}
                    </>
                  )}
                  {dayPlan > 0 && <TipRow color="var(--text-sub3)" label="План дня" value={fmtNum(dayPlan, 1)} dashed />}
                </TipBox>
              );
            }}
          />
          {dayPlan > 0 && <ReferenceLine y={dayPlan} stroke="var(--text-sub3)" strokeWidth={1.5} strokeDasharray="5 4" ifOverflow="extendDomain" />}
          {/* заметки СВ: вертикальная отметка в день разговора */}
          {marks.map((mk) => {
            const i = rows.findIndex((r) => r.day === mk.day);
            return i < 0 ? null : (
              <ReferenceLine
                key={`${mk.day}-${mk.label}`}
                x={i + 1}
                stroke="var(--brand)"
                strokeWidth={1.5}
                label={{ value: mk.label, position: "insideTopRight", fill: "var(--brand)", fontSize: 10, fontWeight: 600 }}
              />
            );
          })}
          <Area type="linear" dataKey="leads" stroke="none" fill="var(--sch-we-label)" fillOpacity={0.09} isAnimationActive={false} connectNulls />
          <Line
            type="linear"
            dataKey="leads"
            stroke="var(--sch-we-label)"
            strokeWidth={2}
            connectNulls
            isAnimationActive={false}
            activeDot={{ r: 4.5, stroke: "var(--bg-panel)", strokeWidth: 2, fill: "var(--sch-we-label)" }}
            dot={(props: { cx?: number; cy?: number; index?: number; payload?: ShiftPoint }) => {
              const { cx, cy, index, payload } = props;
              if (cx == null || cy == null || payload?.leads == null) return <g key={`d${index}`} />;
              if (payload.leads === 0) return <circle key={`d${index}`} cx={cx} cy={cy} r={3} fill="var(--c-red-fg)" />;
              const last = index === lastIdx;
              return (
                <circle
                  key={`d${index}`}
                  cx={cx}
                  cy={cy}
                  r={last ? 4 : 2.6}
                  fill={last ? "var(--sch-we-label)" : "var(--bg-panel)"}
                  stroke={last ? "var(--bg-panel)" : "var(--sch-we-label)"}
                  strokeWidth={last ? 1.5 : 1.5}
                />
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
