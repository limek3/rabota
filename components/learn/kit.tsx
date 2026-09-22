"use client";

import type { ReactNode } from "react";
import { itemCourse, kindIcon, type LearnItem } from "@/lib/learn";
import { Icon, type IconName } from "@/components/ui/icons";

/** Мелкие блоки академии: шапка страницы, списки материалов, карточки, плитки. */

export function PageHead({
  title,
  lead,
  onHome,
  crumbs,
  right,
}: {
  title: string;
  lead?: ReactNode;
  onHome?: () => void;
  crumbs?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <>
      <div className="crumbrow">
        <div className="crumbs">
          {crumbs ?? (
            <>
              <button onClick={onHome}>Главная</button>
              <Icon name="chevR" size={12} />
              <b>{title}</b>
            </>
          )}
        </div>
        {right}
      </div>
      <h1 className="lpg">{title}</h1>
      {lead && <p className="lead">{lead}</p>}
    </>
  );
}

export function LSec({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <h2 className="lsec">
      {children}
      {count != null && <span className="cnt num">{count}</span>}
    </h2>
  );
}

export const Subline = ({ children }: { children: ReactNode }) => <p className="subline">{children}</p>;

export interface RowLock {
  t: string;
}

/** Список материалов — строка с иконкой типа, подписью и отметкой. */
export function Rows({
  items,
  sub,
  onOpen,
  done,
  lockOf,
  pill,
  empty = "Пока пусто",
}: {
  items: LearnItem[];
  sub?: (i: LearnItem) => string;
  onOpen: (id: string) => void;
  done?: (id: string) => boolean;
  lockOf?: (id: string) => RowLock | null;
  pill?: (i: LearnItem) => { t: string; hue: string } | null;
  empty?: string;
}) {
  if (!items.length) return <div className="lrn-list"><div className="lrn-empty">{empty}</div></div>;
  return (
    <div className="lrn-list">
      {items.map((i) => {
        const lock = lockOf?.(i.id) ?? null;
        const p = pill?.(i) ?? null;
        return (
          <button
            key={i.id}
            className={`lrn-row${lock ? " lock" : ""}`}
            onClick={() => (lock ? undefined : onOpen(i.id))}
            disabled={!!lock}
            title={lock ? `Откроется после: ${lock.t}` : undefined}
          >
            <span className="ri">
              <Icon name={lock ? "lock" : kindIcon(i)} size={16} />
            </span>
            <span className="rt">
              <b>{i.t}</b>
              <span>{lock ? `Откроется после: ${lock.t}` : (sub?.(i) ?? `${itemCourse.get(i.id)?.title} · ${i.k} · ${i.m}`)}</span>
            </span>
            {p ? <span className={`lpill ${p.hue}`}>{p.t}</span> : done?.(i.id) ? <span className="lpill ok">пройдено</span> : null}
            <span className="rc">
              <Icon name="chevR" size={14} />
            </span>
          </button>
        );
      })}
    </div>
  );
}

export interface CardDef {
  t: string;
  d: string;
  i?: IconName;
  go?: string;
  id?: string;
  foot?: ReactNode;
}

export function Cards({ cards, onPick }: { cards: CardDef[]; onPick: (c: CardDef) => void }) {
  return (
    <div className="lgrid">
      {cards.map((c) => (
        <button className="lcard" key={c.t} onClick={() => onPick(c)}>
          <span className="ci2">
            <Icon name={c.i ?? "doc"} size={18} />
          </span>
          <span className="ct">{c.t}</span>
          <span className="cd">{c.d}</span>
          {c.foot && <span className="cf">{c.foot}</span>}
        </button>
      ))}
    </div>
  );
}

export function Bar({ pct }: { pct: number }) {
  return (
    <span className="lbar">
      <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

export function Tiles({ items }: { items: { l: string; v: ReactNode; u?: string; s?: string }[] }) {
  return (
    <div className="ltiles">
      {items.map((t) => (
        <div className="ltile" key={t.l}>
          <div className="tl">{t.l}</div>
          <div>
            <span className="tv num">{t.v}</span>
            {t.u && <span className="tu">{t.u}</span>}
          </div>
          {t.s && <div className="ts">{t.s}</div>}
        </div>
      ))}
    </div>
  );
}
