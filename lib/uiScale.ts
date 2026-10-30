"use client";

import { useEffect, useState } from "react";

/**
 * Масштаб интерфейса — CSS-переменная --ui-scale (zoom на body, app/globals.css).
 *
 * «Авто» подбирает масштаб под окно: на ноутбуке 1366×768 или 1280×720 интерфейс чуть
 * уменьшается, и всё помещается без прокрутки вбок; на большом мониторе — как есть, на
 * телефоне — всегда 100% (там своя раскладка). Можно выбрать и вручную: мельче, чтобы
 * влезло больше, или крупнее — «большой режим». Запоминается в этом браузере: у одного
 * человека ноутбук и монитор разные.
 */

export type ScalePref = "auto" | "0.8" | "0.9" | "1" | "1.1" | "1.25";

export const SCALE_OPTIONS: { value: ScalePref; label: string; hint?: string }[] = [
  { value: "auto", label: "Авто", hint: "под размер окна" },
  { value: "0.8", label: "80%", hint: "влезает больше всего" },
  { value: "0.9", label: "90%", hint: "компактно" },
  { value: "1", label: "100%", hint: "как задумано" },
  { value: "1.1", label: "110%", hint: "крупнее" },
  { value: "1.25", label: "125%", hint: "большой режим" },
];

const KEY = "leadup.uiScale";
const EVENT = "leadup:ui-scale";

export function scalePref(): ScalePref {
  try {
    const v = window.localStorage.getItem(KEY) as ScalePref | null;
    return v && SCALE_OPTIONS.some((o) => o.value === v) ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setScalePref(p: ScalePref): void {
  try {
    if (p === "auto") window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, p);
  } catch {
    /* нет хранилища — только до перезагрузки */
  }
  applyUiScale(p);
  // раскладка поменялась как при смене размера окна: всплывашки (меню аккаунта) и графики перемеряются
  window.dispatchEvent(new Event("resize"));
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** «Авто»: телефон — 100%; низкое или узкое окно ноутбука — меньше. */
export function autoScale(w: number, h: number): number {
  if (w <= 760) return 1;
  if (w < 1280 || h < 680) return 0.85;
  if (w < 1440 || h < 800) return 0.9;
  return 1;
}

export function scaleValue(p: ScalePref = scalePref()): number {
  if (typeof window === "undefined") return 1;
  // вручную выбранный масштаб на телефоне не применяем: там своя раскладка на всю ширину
  if (window.innerWidth <= 760) return 1;
  return p === "auto" ? autoScale(window.innerWidth, window.innerHeight) : Number(p);
}

export function applyUiScale(p: ScalePref = scalePref()): number {
  const v = scaleValue(p);
  document.documentElement.style.setProperty("--ui-scale", String(v));
  return v;
}

/** Ставит масштаб при загрузке и держит его при смене размера окна. Вызывается один раз в оболочке. */
export function useUiScaleApplier(): void {
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => applyUiScale());
    };
    applyUiScale();
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);
}

/** Текущий выбор и итоговый масштаб — для настроек и меню. */
export function useUiScale(): { pref: ScalePref; value: number; set: (p: ScalePref) => void } {
  const [st, setSt] = useState<{ pref: ScalePref; value: number }>({ pref: "auto", value: 1 });
  useEffect(() => {
    const read = () => setSt({ pref: scalePref(), value: scaleValue() });
    read();
    window.addEventListener(EVENT, read);
    window.addEventListener("resize", read);
    return () => {
      window.removeEventListener(EVENT, read);
      window.removeEventListener("resize", read);
    };
  }, []);
  return { ...st, set: setScalePref };
}

/** Шаг масштаба: крупнее (+1) или мельче (−1) от текущего итогового. */
export function stepScale(dir: 1 | -1): void {
  const steps = SCALE_OPTIONS.filter((o) => o.value !== "auto").map((o) => Number(o.value));
  const cur = scaleValue();
  const next = dir > 0 ? steps.find((s) => s > cur + 0.001) : [...steps].reverse().find((s) => s < cur - 0.001);
  if (next != null) setScalePref(String(next) as ScalePref);
}
