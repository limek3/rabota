"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useCrm } from "@/lib/crm/store";
import { player, usePlayer, type PlayerMeta, type PlayerState } from "@/lib/player";
import { Icon } from "@/components/ui/icons";
import { mmss } from "./LeadDialog";
import { LeadIslandCard } from "./LeadModal";

const SPEEDS = [1, 1.25, 1.5, 2];
/** Сколько длится «уезд» вниз — потом остров убираем из DOM. */
const OUT_MS = 340;
/** Сколько держать карточку лида в DOM, пока остров сворачивается обратно в капсулу. */
const FOLD_MS = 450;

/**
 * Мини-плеер «Остров» — запись разговора поверх страницы, матовое стекло.
 *  • Запустили запись в карточке лида и ушли — остров плавно выезжает снизу; запись играет дальше.
 *  • Капсула: плей, кто на записи, время; навели — раздвигается: скорость, «к лиду», закрыть.
 *  • По низу капсулы — перемотка: навели — полоса толще и ярче, бегунок и время под курсором; тяните или щёлкайте.
 *  • «К лиду» — остров вырастает вверх в карточку лида с формой обработки (данные, машина, статусы).
 *  • Пока на экране открыта карточка с этой же записью — остров не нужен и уезжает вниз.
 */
export function MiniPlayer() {
  const pl = usePlayer();
  const want = !!pl.src && !!pl.meta && !((pl.views[pl.src] ?? 0) > 0);
  // последнее состояние — чтобы доиграть «уезд», когда запись уже закрыли
  const [shown, setShown] = useState<PlayerState | null>(null);
  const [stage, setStage] = useState<"hidden" | "mini" | "open">("hidden");
  const [keepBig, setKeepBig] = useState(false);

  // три независимых шага — иначе событие плеера (пауза при закрытии) сбрасывало таймер «уезда»
  useEffect(() => {
    if (want) setShown(pl);
  }, [want, pl]);
  const mounted = !!shown;
  useEffect(() => {
    // смонтировали спрятанным — на следующем шаге выезжает (переход в CSS); не нужен — уезжает
    if (want && mounted && stage === "hidden") {
      const t = window.setTimeout(() => setStage((s) => (s === "hidden" ? "mini" : s)), 30);
      return () => window.clearTimeout(t);
    }
    if (!want && stage !== "hidden") setStage("hidden");
  }, [want, mounted, stage]);
  useEffect(() => {
    // уехал — убираем из DOM
    if (want || stage !== "hidden" || !mounted) return;
    const t = window.setTimeout(() => setShown(null), OUT_MS);
    return () => window.clearTimeout(t);
  }, [want, mounted, stage]);

  // карточку лида держим, пока остров сворачивается, — без резкого исчезновения содержимого
  useEffect(() => {
    if (stage === "open") return setKeepBig(true);
    const t = window.setTimeout(() => setKeepBig(false), FOLD_MS);
    return () => window.clearTimeout(t);
  }, [stage]);

  // Esc в раскрытом острове — свернуть в капсулу
  useEffect(() => {
    if (stage !== "open") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && setStage("mini");
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage]);

  const { data } = useCrm();
  if (!shown || !shown.src || !shown.meta) return null;
  const live = want ? pl : shown;
  const src = shown.src;
  const meta = shown.meta;
  const total = live.dur || 0;
  const lead = data.leads.find((l) => l.id === meta.leadId) ?? null;
  const open = stage === "open";

  return createPortal(
    <div className={`isl${live.playing ? " on" : ""}`} data-s={stage} role="region" aria-label="Запись разговора">
      <span className="isl-ring" aria-hidden />
      <div className="isl-top">
        <button type="button" className="isl-play" onClick={() => player.toggle()} aria-label={live.playing ? "Пауза" : "Слушать"}>
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
        <div className="isl-who">
          <b>
            <span className="isl-eq" aria-hidden>
              <i />
              <i />
              <i />
            </span>
            {meta.title}
          </b>
          <small>{meta.sub}</small>
        </div>
        <span className="isl-time num">
          {mmss(live.t)} / {mmss(total)}
        </span>
        <span className="isl-more">
          <button type="button" className="isl-btn isl-speed num" onClick={() => player.setSpeed(SPEEDS[(SPEEDS.indexOf(live.speed) + 1) % SPEEDS.length])} aria-label="Скорость">
            {live.speed}×
          </button>
          {lead && (
            <button type="button" className="isl-btn isl-up" onClick={() => setStage(open ? "mini" : "open")} aria-label={open ? "Свернуть" : "К лиду"} aria-expanded={open}>
              <Icon name="chevD" size={15} />
            </button>
          )}
          <button type="button" className="isl-btn" onClick={() => player.stop()} aria-label="Закрыть плеер">
            <Icon name="close" size={14} />
          </button>
        </span>
      </div>
      <Seek t={live.t} total={total} src={src} meta={meta} />
      {lead && (open || keepBig) && (
        <div className="isl-big">
          <LeadIslandCard lead={lead} onClose={() => setStage("mini")} />
        </div>
      )}
    </div>,
    document.documentElement,
  );
}

/**
 * Перемотка по низу острова: тонкая полоса; навели — толще и ярче, бегунок и время под курсором,
 * до курсора — лёгкая подсветка; щелчок — в точку, зажали и тянете — плавно, отпустили — туда.
 */
function Seek({ t, total, src, meta }: { t: number; total: number; src: string; meta: PlayerMeta }) {
  const trk = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const frac = (x: number) => {
    const r = trk.current?.getBoundingClientRect();
    return r && r.width ? Math.max(0, Math.min(1, (x - r.left) / r.width)) : 0;
  };
  const pos = drag ?? (total ? t / total : 0);
  const tipAt = drag ?? hover;
  return (
    <div
      className={`isl-seek${drag != null ? " drag" : ""}`}
      role="slider"
      tabIndex={0}
      aria-label="Перемотка"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(t)}
      aria-valuetext={`${mmss(t)} из ${mmss(total)}`}
      onPointerMove={(e) => {
        const f = frac(e.clientX);
        setHover(f);
        if (drag != null) setDrag(f);
      }}
      onPointerLeave={() => setHover(null)}
      onPointerDown={(e) => {
        if (!total) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(frac(e.clientX));
      }}
      onPointerUp={(e) => {
        if (drag == null) return;
        player.seek(src, meta, frac(e.clientX) * total);
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          player.seek(src, meta, Math.max(0, Math.min(total, t + (e.key === "ArrowRight" ? 5 : -5))));
        }
      }}
    >
      <div ref={trk} className="isl-trk">
        {hover != null && drag == null && <span className="isl-hov" style={{ width: `${hover * 100}%` }} />}
        <i style={{ width: `${pos * 100}%` }} />
        <b className="isl-knob" style={{ left: `${pos * 100}%` }} />
      </div>
      {tipAt != null && total > 0 && (
        <span className="isl-tip num" style={{ left: `${tipAt * 100}%` }}>
          {mmss(tipAt * total)}
        </span>
      )}
    </div>
  );
}
