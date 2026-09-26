"use client";

import { fmtDay, fmtWeekday } from "@/lib/crm/dates";
import type { DayKey } from "@/lib/crm/types";
import { fmtNum, fmtPct } from "@/lib/crm/format";

/** Один день мини-графика: лиды за смену; null — смены не было (выходной, больничный, до приёма). */
export interface SparkPoint {
  day: DayKey;
  leads: number | null;
  hours: number;
}

const SLOT = 8; // ширина дня
const H = 26;
const PAD = 3; // поле сверху и снизу, чтобы точки не обрезались

/**
 * Мини-график «Операторов»: линия лидов по сменам за 14 дней. Дни стоят на одних и тех же местах
 * во всех строках, высота — в общем масштабе таблицы (max), поэтому людей можно сравнивать.
 * Линия соединяет только смены (выходной и дни до приёма — не ноль, а пропуск); смена без лидов —
 * красная точка на нуле; последняя смена — крупная точка. Подсказка по дню — атрибут title
 * (общая система подсказок CRM).
 */
export function Sparkline({ points, max }: { points: SparkPoint[]; max: number }) {
  const W = points.length * SLOT;
  const top = Math.max(4, max);
  const x = (i: number) => i * SLOT + SLOT / 2;
  const y = (v: number) => H - PAD - (v / top) * (H - PAD * 2);
  const pts = points.flatMap((p, i) => (p.leads == null ? [] : [{ i, v: p.leads, x: x(i), y: y(p.leads) }]));
  const line = pts.map((p, k) => `${k ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const base = H - PAD;
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <line x1={0} x2={W} y1={base + 0.5} y2={base + 0.5} className="spark-base" />
      {pts.length > 1 && (
        <>
          <path d={`${line} L${last.x.toFixed(1)} ${base} L${pts[0].x.toFixed(1)} ${base} Z`} className="spark-area" />
          <path d={line} className="spark-line" />
        </>
      )}
      {pts.map((p) => (
        <circle
          key={p.i}
          cx={p.x}
          cy={p.y}
          r={p === last ? 2.8 : 1.7}
          className={p.v === 0 ? "spark-dot zero" : p === last ? "spark-dot last" : "spark-dot"}
        />
      ))}
      {points.map((p, i) => (
        <rect
          key={p.day}
          x={i * SLOT}
          y={0}
          width={SLOT}
          height={H}
          fill="transparent"
          {...{ title: `${fmtDay(p.day)}, ${fmtWeekday(p.day)} · ${p.leads == null ? "нет смены" : `${p.leads} лид.${p.hours ? ` за ${fmtNum(p.hours)} ч` : ""}`}` }}
        />
      ))}
    </svg>
  );
}

/**
 * Тренд: средние лиды за смену за последние 7 дней против предыдущих 7.
 * Сравнивать не с чем (в одной из недель меньше двух смен) — ничего не показываем.
 */
export function SparkTrend({ points }: { points: SparkPoint[] }) {
  const half = Math.floor(points.length / 2);
  const avg = (ps: SparkPoint[]) => {
    const v = ps.map((p) => p.leads).filter((x): x is number => x != null);
    return v.length >= 2 ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const prev = avg(points.slice(0, half));
  const last = avg(points.slice(half));
  if (prev == null || last == null) return <span className="spark-trend" />;
  const d = prev === 0 ? (last > 0 ? 1 : 0) : (last - prev) / prev;
  const flat = Math.abs(d) < 0.05;
  const up = d > 0;
  return (
    <span
      className={`spark-trend ${flat ? "flat" : up ? "up" : "down"}`}
      title={`В среднем за смену: ${fmtNum(prev, 1)} → ${fmtNum(last, 1)} лида (последние 7 дней против предыдущих 7)`}
    >
      {flat ? "≈ 0%" : `${up ? "↑" : "↓"} ${fmtPct(Math.abs(d))}`}
    </span>
  );
}
