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

const SLOT = 7; // ширина дня
const BAR = 5; // ширина столбика
const H = 24;

/**
 * Мини-график «Операторов»: столбик на каждый день из 14. Дни стоят на одних и тех же местах во всех
 * строках, а высота — в общем масштабе таблицы (max), поэтому людей можно сравнивать между собой.
 * Нет смены — пусто; смена без лидов — короткая красная черта; последний день — ярче.
 * Подсказка по дню — через общую систему подсказок CRM (атрибут title).
 */
export function Sparkline({ points, max }: { points: SparkPoint[]; max: number }) {
  const W = points.length * SLOT;
  const top = Math.max(4, max);
  const last = points.length - 1;
  return (
    <svg className="spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="spark-base" />
      {points.map((p, i) => {
        const x = i * SLOT + (SLOT - BAR) / 2;
        const tip = `${fmtDay(p.day)}, ${fmtWeekday(p.day)} · ${p.leads == null ? "нет смены" : `${p.leads} лид.${p.hours ? ` за ${fmtNum(p.hours)} ч` : ""}`}`;
        let bar = null;
        if (p.leads != null && p.leads > 0) {
          const h = Math.max(3, Math.round((p.leads / top) * (H - 2)));
          bar = <rect x={x} y={H - 1 - h} width={BAR} height={h} rx={1.5} className={i === last ? "spark-bar now" : "spark-bar"} />;
        } else if (p.leads === 0) {
          bar = <rect x={x} y={H - 3} width={BAR} height={2} rx={1} className="spark-zero" />;
        }
        return (
          <g key={p.day}>
            {bar}
            {/* зона наведения на весь день */}
            <rect x={i * SLOT} y={0} width={SLOT} height={H} fill="transparent" {...{ title: tip }} />
          </g>
        );
      })}
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
