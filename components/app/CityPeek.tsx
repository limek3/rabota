"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useCrm } from "@/lib/crm/store";
import { isTyping } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";

/**
 * Быстрое окно «Карты городов» поверх любой страницы и окна лида: клавиша G или
 * openCityPeek(). Справочник городов грузится только при первом открытии.
 */

const CityFinder = dynamic(() => import("./CityFinder").then((m) => m.CityFinder), {
  ssr: false,
  loading: () => <div className="cp-load">Загружаем карту…</div>,
});

export interface CityPeekOpts {
  /** Проект лида: его города — в списке «наших». */
  projectId?: string;
  /** Подставить выбранный город в поле лида. */
  choose?: (label: string) => void;
  /** Какие значения поле лида принимает. */
  allowed?: string[];
}

const EVT = "leadup:city-peek";

export function openCityPeek(opts: CityPeekOpts = {}) {
  window.dispatchEvent(new CustomEvent<CityPeekOpts>(EVT, { detail: opts }));
}

export function CityPeek() {
  const { access, paletteOpen, confirmState } = useCrm();
  const [opts, setOpts] = useState<CityPeekOpts | null>(null);
  const allowed = access.routes.has("/cities");

  useEffect(() => {
    const onOpen = (e: Event) => setOpts((e as CustomEvent<CityPeekOpts>).detail ?? {});
    const onKey = (e: KeyboardEvent) => {
      if (!allowed || isTyping(e) || paletteOpen || confirmState || e.ctrlKey || e.metaKey || e.altKey) return;
      // code — физическая клавиша (работает в любой раскладке)
      if (e.code === "KeyG" || e.key === "g" || e.key === "G" || e.key === "п" || e.key === "П") {
        e.preventDefault();
        setOpts((o) => (o ? null : {}));
      }
    };
    window.addEventListener(EVT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(EVT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [allowed, paletteOpen, confirmState]);

  useEffect(() => {
    if (!opts) return;
    // Esc закрывает только карту, окно лида под ней остаётся
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // открыты подсказки или список проектов — первый Esc закрывает их, а не карту
      if (document.querySelector(".cp .cf-pop, .sel-pop")) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setOpts(null);
    };
    window.addEventListener("keydown", onEsc, true);
    return () => window.removeEventListener("keydown", onEsc, true);
  }, [opts]);

  if (!opts || typeof document === "undefined") return null;
  return createPortal(
    <div className="cp-back" onMouseDown={(e) => e.target === e.currentTarget && setOpts(null)}>
      <div className="cp" role="dialog" aria-modal="true" aria-label="Карта городов">
        <div className="cp-h">
          <Icon name="map" size={16} />
          <b>Карта городов</b>
          <span className="cp-sub">ближайший город, где мы работаем</span>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setOpts(null)} aria-label="Закрыть" title="Закрыть (Esc)">
            <Icon name="close" size={14} />
          </button>
        </div>
        <CityFinder
          compact
          projectId={opts.projectId}
          allowed={opts.allowed}
          choose={
            opts.choose
              ? (label) => {
                  opts.choose?.(label);
                  setOpts(null);
                }
              : undefined
          }
        />
      </div>
    </div>,
    document.body,
  );
}
