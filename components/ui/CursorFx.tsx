"use client";

import { useEffect } from "react";

/**
 * Курсор CRM — «живая» точка вместо системной стрелки: маленькая точка в цвет акцента
 * и кольцо, которое догоняет её с задержкой. Над кнопками, ссылками и строками кольцо
 * раздувается, над полями ввода точка становится кареткой, при нажатии кольцо сжимается
 * и от точки расходится волна.
 *
 * Только мышь: на сенсорных экранах и при «уменьшить движение» остаётся системный курсор.
 * Слои кладём прямо в <html>, а не в <body>: у body CSS zoom (масштаб интерфейса), а
 * координаты мыши — экранные.
 */
const CLICKABLE =
  "a, button, [role=button], [role=tab], [role=radio], [role=menuitem], [role=option], [role=switch], label, select, summary, " +
  "input[type=checkbox], input[type=radio], input[type=range], tbody tr, .click, .sel-trigger, .lcard, .ph-stack, .ph-part, .isl.can-open[data-s=mini] .isl-top, .isl-seek";
const TEXT = "input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]):not([type=submit]), textarea, [contenteditable=true]";

export function CursorFx() {
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const ring = document.createElement("div");
    ring.className = "cfx-ring";
    const dot = document.createElement("div");
    dot.className = "cfx-dot";
    root.append(ring, dot);
    root.classList.add("cfx-on");

    let x = -100;
    let y = -100;
    let rx = x;
    let ry = y;
    let shown = false;
    let raf = 0;
    // кольцо догоняет точку плавно, независимо от частоты событий мыши
    const loop = () => {
      rx += (x - rx) * 0.22;
      ry += (y - ry) * 0.22;
      ring.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x = e.clientX;
      y = e.clientY;
      dot.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (!shown) {
        shown = true;
        rx = x;
        ry = y;
        root.classList.add("cfx-in");
      }
      const t = e.target instanceof Element ? e.target : null;
      const text = !!t?.closest(TEXT);
      root.classList.toggle("cfx-text", text);
      root.classList.toggle("cfx-link", !text && !!t?.closest(CLICKABLE));
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      root.classList.add("cfx-down");
      const r = document.createElement("div");
      r.className = "cfx-ripple";
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      r.addEventListener("animationend", () => r.remove());
      root.append(r);
    };
    const up = () => root.classList.remove("cfx-down");
    const hide = () => {
      shown = false;
      root.classList.remove("cfx-in", "cfx-down");
    };
    const out = (e: MouseEvent) => {
      if (!e.relatedTarget) hide();
    };

    window.addEventListener("pointermove", move, { capture: true, passive: true });
    window.addEventListener("pointerdown", down, { capture: true, passive: true });
    window.addEventListener("pointerup", up, { capture: true, passive: true });
    document.addEventListener("mouseout", out);
    window.addEventListener("blur", hide);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move, { capture: true });
      window.removeEventListener("pointerdown", down, { capture: true });
      window.removeEventListener("pointerup", up, { capture: true });
      document.removeEventListener("mouseout", out);
      window.removeEventListener("blur", hide);
      ring.remove();
      dot.remove();
      root.classList.remove("cfx-on", "cfx-in", "cfx-link", "cfx-text", "cfx-down");
    };
  }, []);
  return null;
}
