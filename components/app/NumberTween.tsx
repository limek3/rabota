"use client";

import { useEffect } from "react";

/**
 * Плавная смена чисел на всех страницах CRM: когда React меняет текст с числами — «1 270»,
 * «+16», «−4%», «22,6», «12 345 ₽», «база 40 022 ₽», «вчера 31 · на смене 4» — старые
 * значения за ~320 мс досчитываются до новых. Компоненты ничего об этом не знают: смотрим
 * за текстовыми узлами (MutationObserver), промежуточные кадры пишем сами и в конце ставим
 * ровно тот текст, что отрисовал React, поэтому его сверка DOM не ломается.
 *
 * Текст со словами анимируем, только если слова до и после чисел не поменялись. Не трогаем:
 * даты и время («04.10», «12:00»), подписи с месяцами, поля ввода, SVG (оси графиков
 * перестраиваются целиком), всё внутри [data-no-tween], скрытую вкладку и «уменьшить движение».
 */

const DUR = 320;
const MAX_RUNS = 400;
const SEP = /[   ]/g;
// число: 0 | 1 234 567 | 1234 и дробь через запятую; знак — только вплотную к цифрам
const TOK = /([+\-−]?)(0|[1-9]\d{0,2}(?:[   ]\d{3})+|[1-9]\d*)(?:,(\d+))?/g;
const DATE_LIKE = /\d[.:/]\d|(?:янв|фев|мар|апр|мая|май|июн|июл|авг|сен|окт|ноя|дек)/i;

interface Num {
  v: number;
  dec: number;
  sep: string;
  plus: boolean;
  minus: string;
}
interface Parsed {
  parts: string[];
  nums: Num[];
}

function parse(text: string): Parsed | null {
  if (!text || text.length > 80 || DATE_LIKE.test(text)) return null;
  const parts: string[] = [];
  const nums: Num[] = [];
  let last = 0;
  for (const m of text.matchAll(TOK)) {
    const at = m.index ?? 0;
    // цифра вплотную слева — это не начало числа (например, «05»)
    if (at > 0 && /\d/.test(text[at - 1])) return null;
    const abs = Number(m[2].replace(SEP, "") + (m[3] ? `.${m[3]}` : ""));
    if (!Number.isFinite(abs)) return null;
    const neg = m[1] === "-" || m[1] === "−";
    parts.push(text.slice(last, at));
    nums.push({ v: neg ? -abs : abs, dec: m[3]?.length ?? 0, sep: m[2].match(SEP)?.[0] ?? " ", plus: m[1] === "+", minus: m[1] === "-" ? "-" : "−" });
    last = at + m[0].length;
  }
  if (!nums.length) return null;
  parts.push(text.slice(last));
  return { parts, nums };
}

function fmt(v: number, to: Num): string {
  const abs = Math.abs(v);
  const [i, d] = abs.toFixed(to.dec).split(".");
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, to.sep);
  const zero = Number(abs.toFixed(to.dec)) === 0;
  const sign = zero ? "" : v < 0 ? to.minus : to.plus ? "+" : "";
  return `${sign}${int}${d ? `,${d}` : ""}`;
}

function render(from: number[], to: Parsed, e: number): string {
  let out = to.parts[0];
  to.nums.forEach((n, k) => {
    out += fmt(from[k] + (n.v - from[k]) * e, n) + to.parts[k + 1];
  });
  return out;
}

const sameShape = (a: Parsed, b: Parsed) => a.nums.length === b.nums.length && a.parts.every((p, i) => p === b.parts[i]);

const skip = (node: Text) => {
  const el = node.parentElement;
  return !el || !!el.closest("input, textarea, select, [contenteditable], svg, [data-no-tween]");
};

export function NumberTween() {
  useEffect(() => {
    if (typeof MutationObserver === "undefined") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const runs = new Map<Text, { from: number[]; to: Parsed; final: string; start: number }>();
    // что мы сами записали в узел: наши кадры наблюдатель тоже видит — их пропускаем
    const own = new WeakMap<Text, string>();
    let raf = 0;

    const write = (node: Text, text: string) => {
      if (node.data === text) return;
      own.set(node, text);
      node.data = text;
    };

    const step = (now: number) => {
      raf = 0;
      for (const [node, r] of runs) {
        const k = Math.min(1, (now - r.start) / DUR);
        if (k >= 1) {
          runs.delete(node);
          write(node, r.final);
        } else write(node, render(r.from, r.to, 1 - (1 - k) ** 3));
      }
      if (runs.size) raf = requestAnimationFrame(step);
    };

    const mo = new MutationObserver((recs) => {
      if (document.hidden || reduce?.matches) return;
      const now = performance.now();
      for (const rec of recs) {
        if (rec.type !== "characterData") continue;
        const node = rec.target as Text;
        const text = node.data;
        if (own.get(node) === text) continue;
        own.delete(node);
        const from = parse(rec.oldValue ?? "");
        const to = parse(text);
        if (!from || !to || !sameShape(from, to) || from.nums.every((n, k) => n.v === to.nums[k].v) || skip(node)) {
          runs.delete(node);
          continue;
        }
        if (runs.size >= MAX_RUNS && !runs.has(node)) continue;
        // новое значение посреди анимации — продолжаем от того, что уже на экране
        const fromV = from.nums.map((n) => n.v);
        runs.set(node, { from: fromV, to, final: text, start: now });
        // первый кадр — сразу, иначе на один кадр мелькнёт конечное число
        write(node, render(fromV, to, 0));
      }
      if (runs.size && !raf) raf = requestAnimationFrame(step);
    });
    mo.observe(document.body, { subtree: true, characterData: true, characterDataOldValue: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
      // недоигранные — сразу к итоговому тексту
      for (const [node, r] of runs) node.data = r.final;
      runs.clear();
    };
  }, []);
  return null;
}
