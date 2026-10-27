"use client";

import type { CSSProperties, ReactNode, Ref } from "react";
import { Icon, type IconName } from "@/components/ui/icons";

/**
 * Хиро страницы — тёмная «витрина» вверху: заголовок, управление страницей и главное по её теме
 * (итог, доли, тревога, столбики по дням). Тёмная в обеих темах; акцент (свечение) — свой у страницы.
 * Внутри переопределены токены темы, поэтому обычные кнопки, переключатели и плитки внутри
 * сами становятся тёмными — страницам не нужно ничего перекрашивать.
 *
 * Части — PageHero (рамка) и HeroBig / HeroSplit / HeroAlarm / HeroBars / HeroStats (наполнение).
 */

export type HeroAccent = "violet" | "emerald" | "blue" | "amber" | "teal" | "rose" | "cyan" | "orange" | "indigo" | "slate" | "pink";
/** Цвета частей на тёмном: статусы и цвета групп/проектов (как в Chip / Swatch). */
export type HeroHue = "green" | "amber" | "red" | "blue" | "purple" | "teal" | "pink" | "indigo" | "orange" | "gray" | "brand" | (string & {});
export interface HeroDelta {
  text: string;
  up: boolean;
  good: boolean;
  title?: string;
}

export function PageHero({
  title,
  sub,
  tools,
  bar,
  accent = "violet",
  children,
  heroRef,
  compact,
  className,
  style,
}: {
  title: ReactNode;
  sub?: ReactNode;
  tools?: ReactNode;
  /** Строка управления под заголовком — переключатели и выбор периода страницы. */
  bar?: ReactNode;
  accent?: HeroAccent;
  children?: ReactNode;
  heroRef?: Ref<HTMLElement>;
  /** Ниже и плотнее — для страниц, где под хиро нужна высота (график смен). */
  compact?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <section ref={heroRef} className={`ph${compact ? " ph-compact" : ""}${className ? ` ${className}` : ""}`} data-accent={accent} style={style}>
      <div className="ph-top">
        <div className="ph-head">
          <h1 className="ph-title">{title}</h1>
          {sub && (
            <div className="ph-sub" title={typeof sub === "string" ? sub : undefined}>
              {sub}
            </div>
          )}
        </div>
        {tools && <div className="ph-tools">{tools}</div>}
      </div>
      {bar && <div className="ph-ctrl">{bar}</div>}
      {children && <div className="ph-body">{children}</div>}
    </section>
  );
}

/** Главное число: «1 350 лидов», сравнение и пара фактов строкой ниже. */
export function HeroBig({
  value,
  unit,
  label,
  delta,
  vs,
  facts,
  onClick,
  title,
  tone,
}: {
  value: ReactNode;
  unit?: ReactNode;
  /** Цвет числа: убыток, отставание — красным. */
  tone?: "red" | "green";
  /** Подпись над числом: «Факт за октябрь». */
  label?: ReactNode;
  delta?: HeroDelta | null;
  vs?: ReactNode;
  facts?: ReactNode[];
  onClick?: () => void;
  title?: string;
}) {
  const Num = onClick ? "button" : "div";
  return (
    <div className="ph-big">
      {label && <div className="ph-big-l">{label}</div>}
      <Num type={onClick ? "button" : undefined} className="ph-num" data-tone={tone} onClick={onClick} title={title}>
        <span className="num">{value}</span>
        {unit && <small>{unit}</small>}
      </Num>
      {(delta || vs) && (
        <div className="ph-vs">
          {delta && (
            <span className={delta.good ? "up" : "down"} title={delta.title}>
              {delta.up ? "▲" : "▼"} {delta.text}
            </span>
          )}
          {vs}
        </div>
      )}
      {facts && facts.filter(Boolean).length > 0 && (
        <div className="ph-facts">
          {facts.filter(Boolean).map((f, i) => (
            <span key={i}>{f}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export interface HeroPart {
  key: string;
  label: string;
  value: number;
  /** Число на карточке, если не value (деньги, «4,2 ч»). */
  shown?: string;
  /** Мелко рядом с числом: доля. */
  pct?: string;
  delta?: HeroDelta | null;
  /** Строка под числом, когда сравнения нет. */
  note?: ReactNode;
  hue: HeroHue;
  on?: boolean;
  onClick?: () => void;
  title?: string;
}

/** Доли одной полосой и карточки частей под ней. Клик по карточке или сегменту — фильтр страницы. */
export function HeroSplit({ parts, bar = true, after, cols }: { parts: HeroPart[]; bar?: boolean; after?: ReactNode; cols?: number }) {
  const sum = parts.reduce((a, p) => a + Math.max(0, p.value), 0);
  return (
    <div className="ph-split">
      {bar && (
        <div className="ph-bar" aria-hidden>
          {sum > 0 ? parts.map((p) => <i key={p.key} data-hue={p.hue} style={{ flexGrow: Math.max(0, p.value) }} onClick={p.onClick} title={`${p.label}: ${p.shown ?? p.value}`} />) : <i className="empty" />}
        </div>
      )}
      <div className="ph-parts" style={{ ["--n" as string]: cols ?? Math.min(parts.length, 4) }}>
        {parts.map((p) => {
          const Tag = p.onClick ? "button" : "div";
          return (
            <Tag key={p.key} type={p.onClick ? "button" : undefined} data-hue={p.hue} className={`ph-part${p.on ? " on" : ""}${p.onClick ? " click" : ""}`} onClick={p.onClick} title={p.title}>
              <span className="k">{p.label}</span>
              <span className="v num">
                {p.shown ?? p.value.toLocaleString("ru-RU")}
                {p.pct && <small>{p.pct}</small>}
              </span>
              <span className={`d${p.delta ? (p.delta.good ? " good" : " bad") : ""}`} title={p.delta?.title}>
                {p.delta ? `${p.delta.up ? "▲" : "▼"} ${p.delta.text}` : p.note ?? " "}
              </span>
            </Tag>
          );
        })}
      </div>
      {after}
    </div>
  );
}

/** Плашка «что требует внимания»: красная пульсирует, зелёная — «всё хорошо». */
export function HeroAlarm({ tone, icon, children, onClick, on, title }: { tone: "red" | "amber" | "green" | "blue"; icon?: IconName; children: ReactNode; onClick?: () => void; on?: boolean; title?: string }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`ph-alarm${on ? " on" : ""}${onClick ? " click" : ""}`} data-tone={tone} onClick={onClick} title={title}>
      {tone === "red" || tone === "amber" ? <span className="pulse" /> : <Icon name={icon ?? "check"} size={13} stroke={2.4} />}
      <span className="t">{children}</span>
      {onClick && <Icon name="arrowR" size={13} />}
    </Tag>
  );
}

export interface HeroCol {
  key: string;
  /** Подсказка при наведении. */
  title: string;
  /** Части столбика снизу вверх; одна часть — простой столбик. */
  parts: { hue: HeroHue; n: number }[];
  /** Отметка на столбике (план дня, «должно быть»): в тех же единицах, что части. */
  mark?: number;
  today?: boolean;
  on?: boolean;
  /** Будущее или пусто: бледная «заглушка». */
  ghost?: boolean;
  onClick?: () => void;
}

/** Столбики по дням (или по людям, месяцам): общий масштаб, сегодня обведено, клик — действие страницы. */
export function HeroBars({ cols, from, to, caption, legend, height }: { cols: HeroCol[]; from?: ReactNode; to?: ReactNode; caption?: ReactNode; legend?: { hue: HeroHue; label: string }[]; height?: number }) {
  const max = Math.max(1, ...cols.map((c) => Math.max(c.parts.reduce((a, p) => a + p.n, 0), c.mark ?? 0)));
  return (
    <div className="ph-chart">
      {legend && (
        <div className="ph-legend">
          {legend.map((l) => (
            <span key={l.label} data-hue={l.hue}>
              {l.label}
            </span>
          ))}
        </div>
      )}
      <div className="ph-bars" style={height ? { height } : undefined}>
        {cols.map((c) => {
          const n = c.parts.reduce((a, p) => a + p.n, 0);
          const Tag = c.onClick && !c.ghost ? "button" : "span";
          return (
            <span key={c.key} className="ph-col">
              <Tag
                type={Tag === "button" ? "button" : undefined}
                className={`ph-stack${c.today ? " td" : ""}${c.on ? " on" : ""}${c.ghost ? " ghost" : ""}`}
                title={c.title}
                onClick={c.ghost ? undefined : c.onClick}
                style={{ height: `${c.ghost ? 5 : Math.max(n > 0 ? 4 : 2, (n / max) * 100)}%` }}
              >
                {c.parts.map((p, i) => (p.n > 0 ? <i key={i} data-hue={p.hue} style={{ flexGrow: p.n }} /> : null))}
              </Tag>
              {c.mark != null && c.mark > 0 && <span className="ph-mark" style={{ bottom: `${(c.mark / max) * 100}%` }} />}
            </span>
          );
        })}
      </div>
      {(from || to || caption) && (
        <div className="ph-axis">
          <span>{from}</span>
          <span>{caption}</span>
          <span>{to}</span>
        </div>
      )}
    </div>
  );
}

/** Несколько чисел в ряд — когда долей нет (справочники, настройки). */
export function HeroStats({ items }: { items: { label: string; value: ReactNode; note?: ReactNode; hue?: HeroHue; title?: string; onClick?: () => void }[] }) {
  return (
    <div className="ph-stats">
      {items.map((it) => {
        const Tag = it.onClick ? "button" : "div";
        return (
          <Tag key={it.label} type={it.onClick ? "button" : undefined} className={`ph-stat${it.onClick ? " click" : ""}`} data-hue={it.hue} title={it.title} onClick={it.onClick}>
            <span className="k">{it.label}</span>
            <span className="v num">{it.value}</span>
            {it.note && <span className="d">{it.note}</span>}
          </Tag>
        );
      })}
    </div>
  );
}

/** Знак изменения: «+4%», «−1,2 п.п.» — для HeroBig/HeroPart. */
export function heroDelta(d: number | null | undefined, fmt: (abs: number) => string, goodUp = true, min = 0.0005, title?: string): HeroDelta | null {
  if (d == null || !Number.isFinite(d) || Math.abs(d) < min) return null;
  return { text: `${d > 0 ? "+" : "−"}${fmt(Math.abs(d))}`, up: d > 0, good: goodUp ? d > 0 : d < 0, title };
}

/** Рейтинг: «название — полоска — число», первые N. Для марок, городов и т.п., где столбики по дням не к месту. */
export function HeroRank({ title, items, limit = 5 }: { title?: ReactNode; items: { key: string; label: string; value: number; shown?: string; hue?: HeroHue }[]; limit?: number }) {
  const top = items.slice(0, limit);
  const max = Math.max(1, ...top.map((i) => i.value));
  return (
    <div className="ph-rank">
      {title && <div className="ph-rank-t">{title}</div>}
      {top.map((i) => (
        <div key={i.key} className="ph-rank-r" data-hue={i.hue ?? "purple"}>
          <span className="l">{i.label}</span>
          <span className="b">
            <i style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="v num">{i.shown ?? i.value.toLocaleString("ru-RU")}</span>
        </div>
      ))}
      {items.length > limit && <div className="ph-rank-more">ещё {items.length - limit}</div>}
    </div>
  );
}
