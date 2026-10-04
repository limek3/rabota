"use client";

import type { ReactNode } from "react";
import { addMonths, fmtMonth } from "@/lib/crm/dates";
import type { MonthKey } from "@/lib/crm/types";
import { Icon, type IconName } from "@/components/ui/icons";

/**
 * Общие куски страниц в стиле «Сводки», «Лидов» и «Операторов» (классы o2-* из app/ops2.css):
 * плитка показателя, переключатель месяца в шапке, заглушка закреплённой панели справа.
 */

export interface TileDelta {
  text: string;
  up: boolean;
  good: boolean;
}

/**
 * Плитка в полосе показателей (.o2-kpis): значок, подпись, число (+ мелкая доля рядом),
 * строка изменения или пояснения и короткая подпись снизу. Все строки — в одну линию.
 */
export function Tile({
  icon,
  label,
  value,
  pct,
  delta,
  line,
  sub,
  hue,
  tone,
  on,
  onClick,
  title,
}: {
  icon: IconName;
  label: string;
  value: ReactNode;
  pct?: string;
  delta?: TileDelta | null;
  line?: ReactNode;
  sub?: ReactNode;
  /** Цвет значка и доли: green / red / amber. */
  hue?: string;
  /** Окраска числа: норматив соблюдён или нет. */
  tone?: "good" | "bad" | "warn";
  on?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const color = tone === "good" ? "var(--c-green-fg)" : tone === "bad" ? "var(--c-red-fg)" : tone === "warn" ? "var(--c-amber-fg)" : undefined;
  return (
    <div className={`o2-kpi${onClick ? " click" : ""}${on ? " on" : ""}`} data-hue={hue} onClick={onClick} title={title}>
      <span className="ic">
        <Icon name={icon} size={18} />
      </span>
      <div className="o2-kpi-b">
        <div className="l">{label}</div>
        <div className="v" style={color ? { color } : undefined}>
          {value}
          {pct && <span className="pc">{pct}</span>}
        </div>
        {delta ? (
          <div className={`d ${delta.good ? "o2-up" : "o2-down"}`}>
            {delta.up ? "▲" : "▼"} {delta.text}
          </div>
        ) : (
          <div className="d" style={{ color: "var(--text)" }}>
            {line ?? <span className="o2-muted">—</span>}
          </div>
        )}
        <div className="s">{sub ?? ""}</div>
      </div>
    </div>
  );
}

/** Месяц в шапке страницы: ‹ Октябрь 2026 › — как период на «Лидах». */
export function MonthNav({ month, onChange }: { month: MonthKey; onChange: (m: MonthKey) => void }) {
  return (
    <div className="o2-date">
      <button className="o2-ib" onClick={() => onChange(addMonths(month, -1))} aria-label="Предыдущий месяц">
        <Icon name="chevL" size={15} />
      </button>
      <span className="lbl" style={{ minWidth: 130, justifyContent: "center", fontWeight: 600 }}>
        <Icon name="calendar" size={14} />
        {fmtMonth(month)}
      </span>
      <button className="o2-ib" onClick={() => onChange(addMonths(month, 1))} aria-label="Следующий месяц">
        <Icon name="chevR" size={15} />
      </button>
    </div>
  );
}

/** Закреплённая панель справа, пока ничего не выбрано: подсказка и контуры будущих блоков. */
export function SideEmpty({ icon, title, text, ghosts }: { icon: IconName; title: string; text: string; ghosts: string[] }) {
  return (
    <aside className="card o2-side o2-side-empty">
      <div className="o2-empty">
        <span className="ic">
          <Icon name={icon} size={22} />
        </span>
        <b>{title}</b>
        <span>{text}</span>
      </div>
      {ghosts.map((t) => (
        <div key={t} className="o2-box o2-ghost">
          <b>{t}</b>
          <i style={{ width: "72%" }} />
          <i style={{ width: "48%" }} />
        </div>
      ))}
    </aside>
  );
}
