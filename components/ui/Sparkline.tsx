"use client";

import { fmtDay, fmtWeekday } from "@/lib/crm/dates";
import type { DayKey } from "@/lib/crm/types";
import { fmtNum, fmtPct } from "@/lib/crm/format";

/** Одна точка мини-графика: лиды за смену; null — смены не было (выходной, больничный, до приёма). */
export interface SparkPoint {
  day: DayKey;
  leads: number | null;
  hours: number;
}

const W = 132;
const H = 30;

/**
 * Мини-график лидов по сменам (таблица «Операторы»). Дни без смены — пропуск в линии, а не ноль:
 * иначе у каждого была бы «пила» из выходных. Последняя смена — точкой. Наведение на день —
 * подсказка (общая система подсказок CRM берёт её из title).
 */
export function Sparkline({ points }: { points: SparkPoint[] }) {
  const n = points.length;
  const vals = points.map((p) => p.leads).filter((v): v is number => v != null);
  const max = Math.max(4, ...vals);
  const x = (i: number) => 4 + (i * (W - 8)) / Math.max(1, n - 1);
  const y = (v: number) => H - 3 - (v * (H - 8)) / max;
  const pts = points.map((p, i) => (p.leads == null ? null : { x: x(i), y: y(p.leads), i })).filter((p): p is { x: number; y: number; i: number } => !!p);
  const d = pts.map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden>
      <line x1={4} x2={W - 4} y1={H - 3} y2={H - 3} className="spark-base" strokeDasharray={pts.length ? undefined : "3 3"} />
      {pts.length > 1 && (
        <>
          <path d={`${d} L${last.x.toFixed(1)} ${H - 3} L${pts[0].x.toFixed(1)} ${H - 3} Z`} className="spark-area" />
          <path d={d} className="spark-line" />
        </>
      )}
      {pts.map((p) => (
        <circle key={p.i} cx={p.x} cy={p.y} r={p === last ? 3.2 : 1.6} className={p === last ? "spark-dot last" : "spark-dot"} />
      ))}
      {points.map((p, i) => (
        <rect
          key={p.day}
          x={x(i) - (W - 8) / (2 * Math.max(1, n - 1))}
          y={0}
          width={(W - 8) / Math.max(1, n - 1)}
          height={H}
          fill="transparent"
          // подсказка по дню
          {...{ title: `${fmtDay(p.day)}, ${fmtWeekday(p.day)} · ${p.leads == null ? "нет смены" : `${p.leads} лид.${p.hours ? ` за ${fmtNum(p.hours)} ч` : ""}`}` }}
        />
      ))}
    </svg>
  );
}

/**
 * Тренд: средние лиды за смену за последние 7 дней против предыдущих 7.
 * Сравнивать не с чем (в предыдущей неделе меньше двух смен) — «новый», если человек недавно
 * в штате, иначе прочерк.
 */
export function SparkTrend({ points, isNew }: { points: SparkPoint[]; isNew: boolean }) {
  const half = Math.floor(points.length / 2);
  const avg = (ps: SparkPoint[]) => {
    const v = ps.map((p) => p.leads).filter((x): x is number => x != null);
    return v.length ? { a: v.reduce((s, x) => s + x, 0) / v.length, n: v.length } : null;
  };
  const prev = avg(points.slice(0, half));
  const last = avg(points.slice(half));
  if (!last) return <span className="spark-trend muted">—</span>;
  if (!prev || prev.n < 2) return isNew ? <span className="spark-new">новый</span> : <span className="spark-trend muted">—</span>;
  const d = prev.a === 0 ? 1 : (last.a - prev.a) / prev.a;
  const up = d >= 0;
  return (
    <span className={`spark-trend ${up ? "up" : "down"}`} title={`В среднем за смену: ${fmtNum(prev.a, 1)} → ${fmtNum(last.a, 1)} лида (7 дней против предыдущих 7)`}>
      {up ? "↑" : "↓"} {up ? "+" : "−"}
      {fmtPct(Math.abs(d))}
    </span>
  );
}
