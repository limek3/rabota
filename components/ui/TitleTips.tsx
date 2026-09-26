"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Все всплывающие подсказки CRM — в одном стиле с подсказками журнала лидов (.clip-tip):
 * панель в цвет темы, скругление, тень, плавное появление. Вместо системной подсказки
 * браузера, которая не слушает тему.
 *
 * Разметку страниц не трогаем: у элемента под курсором атрибут title переезжает в data-tip
 * (браузер больше не показывает свою подсказку), а текст рисуем сами. Если React позже
 * обновит title — при следующем наведении возьмём новый текст.
 */
const DELAY = 300;
const GAP = 8;

type Tip = { text: string; left: number; top?: number; bottom?: number };

export function TitleTips() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let timer = 0;
    let cur: HTMLElement | null = null;

    const textOf = (el: HTMLElement): string => {
      const t = el.getAttribute("title");
      if (t != null) {
        el.removeAttribute("title");
        el.setAttribute("data-tip", t);
        // у кнопок-иконок подсказка была единственным названием — оставляем его для экранного диктора
        if (t && !el.hasAttribute("aria-label") && !el.textContent?.trim()) el.setAttribute("aria-label", t);
        return t;
      }
      return el.getAttribute("data-tip") ?? "";
    };

    const hide = () => {
      window.clearTimeout(timer);
      cur = null;
      setTip(null);
    };

    const place = (el: HTMLElement, text: string) => {
      const r = el.getBoundingClientRect();
      const left = Math.max(8, Math.min(r.left, window.innerWidth - 388));
      // под элементом; у нижнего края окна — над ним
      if (window.innerHeight - r.bottom < 90) setTip({ text, left, bottom: window.innerHeight - r.top + GAP });
      else setTip({ text, left, top: r.bottom + GAP });
    };

    const over = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = (e.target as Element | null)?.closest?.("[title], [data-tip]") as HTMLElement | null;
      if (el === cur) return;
      window.clearTimeout(timer);
      setTip(null);
      cur = el;
      if (!el) return;
      const text = textOf(el);
      if (!text.trim()) return;
      // зажатая кнопка мыши — идёт выделение протягиванием, подсказки только мешают
      if (e.buttons) return;
      timer = window.setTimeout(() => {
        if (cur === el && el.isConnected) place(el, el.getAttribute("data-tip") ?? text);
      }, DELAY);
    };

    const out = (e: PointerEvent) => {
      if (!cur) return;
      const to = e.relatedTarget as Node | null;
      if (to && cur.contains(to)) return;
      hide();
    };

    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  if (!tip) return null;
  const { text, ...pos } = tip;
  return createPortal(
    <div className={pos.bottom != null ? "clip-tip up" : "clip-tip"} style={pos} role="tooltip">
      {text}
    </div>,
    document.body,
  );
}
