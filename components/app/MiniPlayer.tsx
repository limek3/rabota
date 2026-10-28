"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCrm } from "@/lib/crm/store";
import { player, usePlayer, type PlayerState } from "@/lib/player";
import { Icon } from "@/components/ui/icons";
import { mmss } from "./LeadDialog";

const SPEEDS = [1, 1.25, 1.5, 2];
/** Плеер карточки закрыли не дольше этого назад — мини-плеер «прилетает» с его места. */
const FLY_FRESH_MS = 1500;
const OUT_MS = 300;

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Мини-плеер записи разговора поверх страницы: запустили запись в карточке лида и ушли —
 * она играет дальше, а здесь — пауза, перемотка по полоске, скорость, «открыть лид» и закрыть.
 * Пока карточка с этой записью открыта, мини-плеер не нужен — прячется.
 *
 * Появление: плеер «перелетает» из карточки — с места, где стоял её плеер, сжимается в плашку внизу
 * и приземляется с лёгким отскоком; следом проявляются кнопки и по плашке пробегает блик.
 * Карточки не было (открыли с другой страницы) — всплывает снизу. Исчезает — опускается и растворяется.
 */
export function MiniPlayer() {
  const pl = usePlayer();
  const want = !!pl.src && !!pl.meta && !((pl.views[pl.src] ?? 0) > 0);
  // показываем последнее состояние, пока плашка уезжает (после «закрыть» src уже пуст)
  const [shown, setShown] = useState<PlayerState | null>(want ? pl : null);
  const [leaving, setLeaving] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const out = useRef<Animation | null>(null);

  useEffect(() => {
    if (want) {
      // передумали уезжать (снова нужна) — снимаем застывшую анимацию ухода
      out.current?.cancel();
      out.current = null;
      setShown(pl);
      setLeaving(false);
    } else if (shown && !leaving) setLeaving(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [want, pl]);

  // уезжает: опускается, сжимается, растворяется в размытии — потом убираем
  useEffect(() => {
    if (!leaving || !el.current) return;
    const a = (out.current = reduced()
      ? null
      : el.current.animate(
          [
            { transform: "translate(-50%, 0) scale(1)", opacity: 1, filter: "blur(0)" },
            { transform: "translate(-50%, 28px) scale(0.9)", opacity: 0, filter: "blur(6px)" },
          ],
          { duration: OUT_MS, easing: "cubic-bezier(0.4, 0, 0.8, 0.4)", fill: "forwards" },
        ));
    const t = window.setTimeout(() => {
      out.current = null;
      setShown(null);
      setLeaving(false);
    }, a ? OUT_MS : 0);
    return () => window.clearTimeout(t);
  }, [leaving]);

  // появилась плашка — перелёт из карточки или всплытие снизу
  const mounted = !!shown;
  useLayoutEffect(() => {
    const node = el.current;
    if (!mounted || !node || reduced()) return;
    const o = player.get().origin;
    const t = node.getBoundingClientRect();
    let a: Animation;
    if (o && Date.now() - o.at < FLY_FRESH_MS && t.width > 0) {
      const dx = o.x + o.w / 2 - (t.left + t.width / 2);
      const dy = o.y + o.h / 2 - (t.top + t.height / 2);
      const sx = o.w / t.width;
      const sy = o.h / t.height;
      a = node.animate(
        [
          { transform: `translate(calc(-50% + ${dx}px), ${dy}px) scale(${sx}, ${sy})`, opacity: 0.55, borderRadius: "14px", filter: "blur(1.5px)" },
          { opacity: 1, filter: "blur(0)", offset: 0.55 },
          { transform: "translate(-50%, -6px) scale(1.02, 0.98)", offset: 0.82 },
          { transform: "translate(-50%, 0) scale(1)", opacity: 1, borderRadius: "16px", filter: "blur(0)" },
        ],
        { duration: 720, easing: "cubic-bezier(0.22, 0.9, 0.3, 1)" },
      );
    } else {
      a = node.animate(
        [
          { transform: "translate(-50%, 40px) scale(0.86)", opacity: 0, filter: "blur(8px)" },
          { transform: "translate(-50%, -5px) scale(1.02)", opacity: 1, filter: "blur(0)", offset: 0.7 },
          { transform: "translate(-50%, 0) scale(1)", opacity: 1, filter: "blur(0)" },
        ],
        { duration: 560, easing: "cubic-bezier(0.22, 0.9, 0.3, 1)" },
      );
    }
    // приземлилась — блик по плашке и вспышка вокруг кнопки. data-атрибут, не класс: className
    // React перезаписывает при каждом обновлении времени
    node.dataset.fx = "arrive";
    a.onfinish = () => {
      node.dataset.fx = "land";
      window.setTimeout(() => {
        if (node.dataset.fx === "land") delete node.dataset.fx;
      }, 1200);
    };
  }, [mounted]);

  const { data, openLead } = useCrm();
  if (!shown || !shown.src || !shown.meta) return null;
  const live = want ? pl : shown;
  const src = shown.src;
  const meta = shown.meta;
  const total = live.dur || 0;
  const pct = total ? Math.min(100, (live.t / total) * 100) : 0;
  const lead = data.leads.find((l) => l.id === meta.leadId) ?? null;

  return createPortal(
    <div ref={el} className={`mp${live.playing ? " on" : ""}`} role="region" aria-label="Запись разговора">
      <button type="button" className="mp-play" onClick={() => player.toggle()} aria-label={live.playing ? "Пауза" : "Слушать"}>
        {live.playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <rect x="2.25" y="1.5" width="2.75" height="9" rx="0.8" fill="currentColor" />
            <rect x="7" y="1.5" width="2.75" height="9" rx="0.8" fill="currentColor" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M2.6 1.6 10.6 6 2.6 10.4Z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <div className="mp-info">
        <b>
          <span className="mp-eq" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          {meta.title}
        </b>
        <small>{meta.sub}</small>
      </div>
      <span className="mp-time num">
        {mmss(live.t)} / {mmss(total)}
      </span>
      <button type="button" className="mp-btn mp-speed num" onClick={() => player.setSpeed(SPEEDS[(SPEEDS.indexOf(live.speed) + 1) % SPEEDS.length])} aria-label="Скорость">
        {live.speed}×
      </button>
      {lead && (
        <button type="button" className="mp-btn" onClick={() => openLead(lead)} aria-label="Открыть лид">
          <Icon name="external" size={14} />
        </button>
      )}
      <button type="button" className="mp-btn" onClick={() => player.stop()} aria-label="Закрыть плеер">
        <Icon name="close" size={14} />
      </button>
      {/* полоска прогресса по нижнему краю — она же перемотка */}
      <div
        className="mp-bar"
        role="slider"
        tabIndex={0}
        aria-label="Перемотка"
        aria-valuemin={0}
        aria-valuemax={Math.round(total)}
        aria-valuenow={Math.round(live.t)}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          if (total) player.seek(src, meta, Math.max(0, Math.min(total, ((e.clientX - r.left) / r.width) * total)));
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            player.seek(src, meta, Math.max(0, Math.min(total, live.t + (e.key === "ArrowRight" ? 5 : -5))));
          }
        }}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>,
    document.documentElement,
  );
}
