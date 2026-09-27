"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { useCrm } from "@/lib/crm/store";
import { Icon } from "./icons";
import { uiZoom } from "./select";

/**
 * Свой порядок столбцов в таблице: у каждого аккаунта свой (личные настройки, prefs.cols),
 * РОП и СВ друг другу не мешают. defaults — порядок по умолчанию; его массив должен быть
 * постоянным (вне компонента). Новые столбцы, которых не было в сохранённом порядке, встают
 * на своё место из порядка по умолчанию.
 */
export function useColumnOrder(table: string, defaults: readonly string[]) {
  const { me, saveMyProfile } = useCrm();
  const saved = me.prefs.cols?.[table];
  // пока настройки сохраняются (в Supabase — с задержкой), показываем новый порядок сразу
  const [pending, setPending] = useState<string[] | null>(null);
  const order = useMemo(() => pending ?? mergeOrder(saved, defaults), [pending, saved, defaults]);
  const custom = order.join("|") !== defaults.join("|");

  const save = useCallback(
    (next: string[]) => {
      setPending(next);
      const cols = { ...(me.prefs.cols ?? {}) };
      if (next.join("|") === defaults.join("|")) delete cols[table];
      else cols[table] = next;
      void saveMyProfile({ cols }).finally(() => setPending(null));
    },
    [me.prefs.cols, table, defaults, saveMyProfile],
  );

  return { order, custom, save, reset: () => save([...defaults]) };
}

function mergeOrder(saved: string[] | undefined, defaults: readonly string[]): string[] {
  if (!saved?.length) return [...defaults];
  const known = new Set(defaults);
  const out = saved.filter((k) => known.has(k));
  defaults.forEach((k, i) => {
    if (!out.includes(k)) out.splice(Math.min(i, out.length), 0, k);
  });
  return out;
}

const THRESHOLD = 5; // сколько пикселей протянуть, чтобы начать перетаскивание (иначе это клик — сортировка)
const EDGE = 56; // зона автопрокрутки у краёв таблицы

/**
 * Перетаскивание столбцов за заголовок. headProps(key) — на <th> каждого перетаскиваемого столбца,
 * а у всех ячеек этого столбца должен быть data-col={key}.
 *
 * Как выглядит: заголовок «отрывается» и едет за курсором (чуть повёрнутая карточка), весь столбец
 * подсвечивается, между столбцами светится полоса — куда встанет. У краёв таблица сама
 * прокручивается. После отпускания столбцы плавно переезжают на новые места (FLIP), а
 * перенесённый столбец коротко вспыхивает. Esc — отмена; простой клик по заголовку — как раньше.
 */
export function useColumnDrag({ wrapRef, order, onChange }: { wrapRef: RefObject<HTMLElement>; order: string[]; onChange: (next: string[]) => void }) {
  const orderRef = useRef(order);
  orderRef.current = order;
  const flip = useRef<{ lefts: Map<string, number>; moved: string } | null>(null);

  // после смены порядка: столбцы плавно доезжают со старых мест на новые
  useLayoutEffect(() => {
    const f = flip.current;
    const table = wrapRef.current?.querySelector("table");
    flip.current = null;
    if (!f || !table) return;
    const z = uiZoom();
    // следы прошлой анимации (если её прервали) — убрать до замеров
    table.querySelectorAll<HTMLElement>("[data-col]").forEach((c) => {
      c.style.transition = "";
      c.style.transform = "";
    });
    const animated: HTMLElement[] = [];
    for (const [key, oldLeft] of f.lefts) {
      const th = table.querySelector<HTMLElement>(`thead th[data-col="${key}"]`);
      if (!th) continue;
      const dx = (oldLeft - th.getBoundingClientRect().left) / z;
      const cells = Array.from(table.querySelectorAll<HTMLElement>(`[data-col="${key}"]`));
      if (key === f.moved) cells.forEach((c) => c.classList.add("col-landed"));
      if (Math.abs(dx) < 0.5) continue;
      for (const c of cells) {
        c.style.transition = "none";
        c.style.transform = `translateX(${dx}px)`;
        animated.push(c);
      }
    }
    if (!animated.length) return;
    // зафиксировать стартовое положение и сразу поехать на место (без requestAnimationFrame:
    // в свёрнутой вкладке он не срабатывает, и столбец остался бы сдвинутым)
    void table.offsetWidth;
    for (const c of animated) {
      c.style.transition = "transform 300ms cubic-bezier(.2,.8,.2,1)";
      c.style.transform = "";
    }
    window.setTimeout(() => animated.forEach((c) => (c.style.transition = "")), 340);
    window.setTimeout(() => table.querySelectorAll(".col-landed").forEach((c) => c.classList.remove("col-landed")), 950);
  }, [order, wrapRef]);

  const onPointerDown = useCallback(
    (key: string) => (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      if ((e.target as HTMLElement).closest("input, button, a, select, textarea")) return;
      const wrap = wrapRef.current;
      const table = wrap?.querySelector("table");
      const th = e.currentTarget;
      if (!wrap || !table) return;
      const z = uiZoom();
      const startX = e.clientX;
      const startY = e.clientY;
      const from = orderRef.current.indexOf(key);
      let started = false;
      let target = -1;
      let lastX = startX;
      let raf = 0;
      let ghost: HTMLDivElement | null = null;
      let line: HTMLDivElement | null = null;
      let grabDx = 0;
      let lifted: HTMLElement[] = [];

      const heads = () =>
        orderRef.current.map((k) => table.querySelector<HTMLElement>(`thead th[data-col="${k}"]`)).filter((h): h is HTMLElement => !!h);

      const begin = () => {
        started = true;
        const r = th.getBoundingClientRect();
        grabDx = startX - r.left;
        lifted = Array.from(table.querySelectorAll<HTMLElement>(`[data-col="${key}"]`));
        lifted.forEach((c) => c.classList.add("col-lifted"));
        document.body.classList.add("is-col-dragging");
        ghost = document.createElement("div");
        ghost.className = "col-ghost";
        ghost.textContent = (th.innerText || key).split("\n")[0].replace(/[▲▼]/g, "").trim();
        ghost.style.minWidth = `${Math.max(80, r.width / z)}px`;
        ghost.style.top = `${r.top / z + 2}px`;
        document.body.appendChild(ghost);
        line = document.createElement("div");
        line.className = "col-drop-line";
        line.style.opacity = "0";
        document.body.appendChild(line);
      };

      const place = (x: number) => {
        if (!ghost || !line) return;
        ghost.style.left = `${(x - grabDx) / z}px`;
        const hs = heads();
        let idx = hs.length;
        for (let i = 0; i < hs.length; i++) {
          const r = hs[i].getBoundingClientRect();
          if (x < r.left + r.width / 2) {
            idx = i;
            break;
          }
        }
        target = idx;
        // то же место — полосу не показываем
        if (idx === from || idx === from + 1 || !hs.length) {
          line.style.opacity = "0";
          return;
        }
        const edge = idx < hs.length ? hs[idx].getBoundingClientRect().left : hs[hs.length - 1].getBoundingClientRect().right;
        const w = wrap.getBoundingClientRect();
        line.style.opacity = "1";
        line.style.left = `${edge / z - 1.5}px`;
        line.style.top = `${w.top / z + 4}px`;
        line.style.height = `${Math.min(w.height, table.getBoundingClientRect().height) / z - 8}px`;
      };

      // автопрокрутка у краёв, пока тянем
      const tick = () => {
        const w = wrap.getBoundingClientRect();
        const sticky = table.querySelector<HTMLElement>("thead th.sticky-col");
        const leftEdge = w.left + (sticky ? sticky.getBoundingClientRect().width : 0);
        let dx = 0;
        if (lastX > w.right - EDGE) dx = Math.ceil(((lastX - (w.right - EDGE)) / EDGE) * 14);
        else if (lastX < leftEdge + EDGE) dx = -Math.ceil(((leftEdge + EDGE - lastX) / EDGE) * 14);
        if (dx) {
          wrap.scrollLeft += dx;
          place(lastX);
        }
        raf = requestAnimationFrame(tick);
      };

      const move = (ev: PointerEvent) => {
        lastX = ev.clientX;
        if (!started) {
          if (Math.abs(ev.clientX - startX) < THRESHOLD && Math.abs(ev.clientY - startY) < THRESHOLD) return;
          begin();
          raf = requestAnimationFrame(tick);
        }
        ev.preventDefault();
        place(ev.clientX);
      };

      const finish = (commit: boolean) => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("keydown", key_);
        cancelAnimationFrame(raf);
        if (!started) return;
        lifted.forEach((c) => c.classList.remove("col-lifted"));
        document.body.classList.remove("is-col-dragging");
        ghost?.remove();
        line?.remove();
        // клик после перетаскивания — не сортировка
        const swallow = (ce: MouseEvent) => {
          ce.stopPropagation();
          ce.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
        if (!commit || target < 0 || target === from || target === from + 1) return;
        const cur = orderRef.current;
        const next = cur.filter((k) => k !== key);
        next.splice(target > from ? target - 1 : target, 0, key);
        const lefts = new Map<string, number>();
        for (const k of cur) {
          const h = table.querySelector<HTMLElement>(`thead th[data-col="${k}"]`);
          if (h) lefts.set(k, h.getBoundingClientRect().left);
        }
        flip.current = { lefts, moved: key };
        onChange(next);
      };
      const up = () => finish(true);
      const key_ = (ke: KeyboardEvent) => {
        if (ke.key === "Escape") finish(false);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("keydown", key_);
    },
    [wrapRef, onChange],
  );

  const headProps = useCallback(
    (key: string) => ({
      "data-col": key,
      className: "col-drag",
      onPointerDown: onPointerDown(key),
    }),
    [onPointerDown],
  );

  return { headProps };
}

/** Подсказка «столбцы можно переставлять» или кнопка «вернуть порядок», если он менялся. */
export function ColumnOrderHint({ custom, onReset }: { custom: boolean; onReset: () => void }) {
  return custom ? (
    <button type="button" className="btn btn-ghost btn-sm col-reset" onClick={onReset} title="Вернуть столбцы в порядок по умолчанию">
      <Icon name="refresh" size={13} /> Вернуть порядок столбцов
    </button>
  ) : (
    <span className="col-hint">
      <span className="col-hint-grip" aria-hidden />
      Столбцы можно переставлять — перетащите заголовок
    </span>
  );
}
