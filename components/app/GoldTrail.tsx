"use client";

import { useEffect } from "react";

/** Сколько живёт хвост, мс: курсор остановился — шлейф втягивается за это время. */
const LIFE = 340;

/**
 * Грейд IV — золотая «комета» за курсором: плавный шлейф по траектории движения, к хвосту тоньше
 * и прозрачнее, с мягким свечением и ярким ядром у самого курсора.
 *  • own — за своей мышью (у вас сегодня Грейд IV);
 *  • peers — за курсорами коллег с Грейдом IV на этой странице (.lv-cur.g4 из LiveCursors).
 * Один холст поверх страницы и один кадр анимации на всех — не десятки элементов.
 */
export function GoldTrail({ own, peers }: { own: boolean; peers: boolean }) {
  useEffect(() => {
    if (!own && !peers) return;
    if (!window.matchMedia("(pointer: fine)").matches || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = document.createElement("canvas");
    c.className = "lv-comet";
    c.setAttribute("aria-hidden", "true");
    document.documentElement.append(c);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    let w = 0;
    let h = 0;
    const fit = () => {
      const d = window.devicePixelRatio || 1;
      w = window.innerWidth;
      h = window.innerHeight;
      c.width = Math.round(w * d);
      c.height = Math.round(h * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    fit();
    window.addEventListener("resize", fit);

    let mouse: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "mouse") mouse = { x: e.clientX, y: e.clientY };
    };
    const out = () => (mouse = null);
    if (own) {
      window.addEventListener("pointermove", move, { passive: true });
      document.documentElement.addEventListener("mouseleave", out);
    }

    const trails = new Map<string, { x: number; y: number; t: number }[]>();
    const draw = (a: { x: number; y: number; t: number }[], now: number) => {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      // два прохода: широкое мягкое свечение, поверх — тонкая яркая нить
      for (const pass of [0, 1]) {
        for (let i = 1; i < a.length; i++) {
          const f = Math.max(0, 1 - (now - a[i].t) / LIFE); // 1 — у курсора, 0 — кончик хвоста
          const k = i / (a.length - 1);
          const life = f * (0.35 + 0.65 * k);
          if (life <= 0.02) continue;
          ctx.beginPath();
          ctx.moveTo(a[i - 1].x, a[i - 1].y);
          ctx.lineTo(a[i].x, a[i].y);
          // тёплое свечение заметно и на белом фоне, и на тёмном
          if (pass === 0) {
            ctx.strokeStyle = `rgba(240, 156, 28, ${0.3 * life})`;
            ctx.lineWidth = 3 + 10 * life;
          } else {
            ctx.strokeStyle = `rgba(255, ${196 + Math.round(48 * life)}, ${Math.round(70 + 150 * life)}, ${0.95 * life})`;
            ctx.lineWidth = 1.2 + 3.6 * life;
          }
          ctx.stroke();
        }
      }
      // ядро у курсора
      const head = a[a.length - 1];
      const f = Math.max(0, 1 - (now - head.t) / LIFE);
      if (f > 0.05) {
        const g = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 9);
        g.addColorStop(0, `rgba(255, 250, 225, ${0.9 * f})`);
        g.addColorStop(0.45, `rgba(255, 200, 70, ${0.45 * f})`);
        g.addColorStop(1, "rgba(255, 180, 40, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 9, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    let raf = 0;
    const frame = (now: number) => {
      const pts: [string, number, number][] = [];
      if (own && mouse) pts.push(["me", mouse.x, mouse.y]);
      // у коллег берём, где точка на экране сейчас — с учётом её плавного перехода
      if (peers)
        document.querySelectorAll<HTMLElement>(".lv-cur.g4:not(.idle) > .lv-dot").forEach((d) => {
          const r = d.getBoundingClientRect();
          pts.push([d.parentElement?.dataset.sid ?? "", r.left + r.width / 2, r.top + r.height / 2]);
        });
      for (const [key, x, y] of pts) {
        const a = trails.get(key) ?? [];
        const last = a[a.length - 1];
        // стоит на месте — новых точек нет, хвост сам втягивается
        if (!last || Math.hypot(last.x - x, last.y - y) > 0.6) a.push({ x, y, t: now });
        trails.set(key, a);
      }
      ctx.clearRect(0, 0, w, h);
      for (const [key, a] of trails) {
        while (a.length && now - a[0].t > LIFE) a.shift();
        if (!a.length) trails.delete(key);
        else if (a.length > 1) draw(a, now);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("mouseleave", out);
      c.remove();
    };
  }, [own, peers]);
  return null;
}
