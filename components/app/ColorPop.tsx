"use client";

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from "react";

/**
 * Свой выбор цвета для «Холста»: квадрат насыщенность/яркость, полоса оттенка и поле HEX.
 * Системное окно <input type="color"> рисует браузер — в нём не видно курсоров CRM,
 * и выглядит оно в каждой ОС по-своему. Цвет меняется сразу, пока тянешь.
 */

interface Hsv {
  h: number;
  s: number;
  v: number;
}

function hexToHsv(hex: string): Hsv {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToHex({ h, s, v }: Hsv): string {
  const f = (k: number) => {
    const x = (k + h / 60) % 6;
    const c = v - v * s * Math.max(0, Math.min(x, 4 - x, 1));
    return Math.round(c * 255).toString(16).padStart(2, "0");
  };
  return `#${f(5)}${f(3)}${f(1)}`;
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));

/** Доля по ширине/высоте элемента — не зависит от масштаба интерфейса (zoom на body). */
function frac(e: RPointerEvent<HTMLElement>) {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: clamp((e.clientX - r.left) / (r.width || 1)), y: clamp((e.clientY - r.top) / (r.height || 1)) };
}

export function ColorPop({ value, onChange, onClose }: { value: string; onChange: (hex: string) => void; onClose: () => void }) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [text, setText] = useState(value);
  const ref = useRef<HTMLDivElement>(null);

  // снаружи поменяли цвет (палитра, пипетка) — подтягиваем, если это не наш же
  useEffect(() => {
    if (value !== hsvToHex(hsv)) {
      setHsv(hexToHsv(value));
      setText(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // клик, которым окно открыли, ещё в пути — слушаем со следующего кадра
    const t = setTimeout(() => window.addEventListener("pointerdown", onDown), 0);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const set = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setText(hex);
    onChange(hex);
  };

  const drag = (apply: (e: RPointerEvent<HTMLDivElement>) => void) => ({
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      apply(e);
    },
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) apply(e);
    },
  });

  const hex = hsvToHex(hsv);
  return (
    <div className="px-cp" ref={ref} role="dialog" aria-label="Свой цвет">
      <div
        className="px-cp-sv"
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        {...drag((e) => {
          const p = frac(e);
          set({ ...hsv, s: p.x, v: 1 - p.y });
        })}
      >
        <i className="px-cp-knob" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div
        className="px-cp-hue"
        {...drag((e) => set({ ...hsv, h: Math.min(359.9, frac(e).x * 360) }))}
      >
        <i className="px-cp-knob" style={{ left: `${(hsv.h / 360) * 100}%`, top: "50%", background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="px-cp-row">
        <i className="px-cp-prev" style={{ background: hex }} />
        <input
          className="px-cp-hex num"
          value={text}
          spellCheck={false}
          maxLength={7}
          onChange={(e) => {
            const v = e.target.value.trim().toLowerCase();
            setText(v);
            const full = v.startsWith("#") ? v : `#${v}`;
            if (/^#[0-9a-f]{6}$/.test(full)) {
              setHsv(hexToHsv(full));
              onChange(full);
            }
          }}
        />
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
          Готово
        </button>
      </div>
    </div>
  );
}
