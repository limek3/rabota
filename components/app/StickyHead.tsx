"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/icons";
import type { Pace } from "@/lib/crm/calc";
import { fmtInt, fmtPct, fmtSigned } from "@/lib/crm/format";

/**
 * Липкая шапка страницы: тонкая полоса сверху, когда шапка страницы (или её главный блок —
 * anchor) ушла вверх. Только нужное: название, контекст (период, группа, фильтр) и 2–4 главных
 * числа. Рисуется в общий слот #sticky-host над содержимым (Shell) — в разметке страницы
 * места не занимает и раскладку не сдвигает.
 */

export interface StickyItem {
  l: string;
  v: ReactNode;
  tone?: "red" | "green" | "amber";
  hint?: string;
}

/**
 * Главные числа по плану — одинаково на всех страницах: факт из плана, разрыв (зелёный — в
 * плане, красный — отстаём), конверсия к норме. conv: undefined — конверсию не показываем.
 */
export function planItems(p: Pace, conv?: number | null, norm = 0): StickyItem[] {
  const out: StickyItem[] = [{ l: "Факт", v: p.plan > 0 ? `${fmtInt(p.fact)} из ${fmtInt(Math.round(p.plan))}` : fmtInt(p.fact) }];
  if (p.plan > 0) out.push({ l: "Разрыв", v: fmtSigned(Math.round(p.deviation)), tone: p.deviation < -0.5 ? "red" : "green" });
  if (conv !== undefined) out.push({ l: "Конв.", v: conv == null ? "—" : fmtPct(conv), tone: conv == null || norm <= 0 ? undefined : conv >= norm ? "green" : "red" });
  return out;
}

export function StickyHead({
  title,
  ctx,
  items = [],
  anchor,
  offset = 120,
}: {
  title: ReactNode;
  ctx?: ReactNode;
  items?: StickyItem[];
  /** Блок, после ухода которого шапка показывается; без него — после `offset` px прокрутки. */
  anchor?: RefObject<HTMLElement | null>;
  offset?: number;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    setHost(document.getElementById("sticky-host"));
    const sc = document.getElementById("app-scroll");
    if (!sc) return;
    let raf = 0;
    const check = () => {
      raf = 0;
      const el = anchor?.current;
      const show = el ? el.getBoundingClientRect().bottom < sc.getBoundingClientRect().top + 8 : sc.scrollTop > offset;
      setOn((o) => (o === show ? o : show));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(check);
    };
    check();
    sc.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      sc.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [anchor, offset]);

  // пока шапка видна, прилипающие к верху блоки страницы (правая панель, оглавления) опускаются
  // на её высоту — иначе полоса наезжает на них (--sh-h в crm.css, ops2.css, learn.css)
  useEffect(() => {
    const sc = document.getElementById("app-scroll");
    if (!sc) return;
    sc.style.setProperty("--sh-h", on ? "46px" : "0px");
    return () => {
      sc.style.removeProperty("--sh-h");
    };
  }, [on]);

  if (!host) return null;
  return createPortal(
    <div className="sh" data-on={String(on)} aria-hidden={!on}>
      <div className="sh-in">
        <span className="sh-t">{title}</span>
        {ctx && <span className="sh-c">{ctx}</span>}
        <span className="sh-gap" />
        {items.map((it) => (
          <span key={it.l} className="sh-k" title={it.hint}>
            {it.l} <b data-tone={it.tone}>{it.v}</b>
          </span>
        ))}
        <button
          type="button"
          className="sh-up"
          tabIndex={on ? 0 : -1}
          title="Наверх"
          aria-label="Наверх"
          onClick={() => document.getElementById("app-scroll")?.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <Icon name="chevL" size={14} style={{ transform: "rotate(90deg)" }} />
        </button>
      </div>
    </div>,
    host,
  );
}
