"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { ITEMS, badgeOf, namePaint, useLook } from "@/lib/shop";

/**
 * Украшения из Лавки (lib/shop.ts) на экране:
 *  • FrameFx — рамка вокруг аватарки (рисует CSS: app/shop.css, .avfx[data-fx]);
 *  • NameFx — имя градиентом;
 *  • ShopTrail — след за своей мышью и за курсорами коллег (.lv-cur[data-trail] из LiveCursors);
 *  • TrailDemo — тот же след в карточке Лавки: идёт за мышью над карточкой или сам по кругу.
 * Следы — частицы на одном холсте поверх страницы, один кадр анимации на всех.
 */

/** Рамка не нужна на совсем маленьких аватарках: в таблицах она только мешает. */
export const FRAME_MIN = 24;

export function FrameFx({ fx, size, children }: { fx?: string; size: number; children: ReactNode }) {
  if (!fx || size < FRAME_MIN || !ITEMS.has(fx)) return <>{children}</>;
  return (
    <span className="avfx" data-fx={fx} style={{ ["--s" as string]: `${size}px`, width: size, height: size }}>
      {children}
      <i aria-hidden />
    </span>
  );
}

/** Имя в стиле из Лавки и значок за ним; accountId — чьё имя. */
export function NameFx({ accountId, me, children, className }: { accountId?: string; me?: string; children: ReactNode; className?: string }) {
  const look = useLook(accountId, me);
  const paint = namePaint(look);
  const badge = badgeOf(look);
  const name = paint ? (
    <span className={`nmfx${className ? ` ${className}` : ""}`} data-nm={look.name} style={{ ["--nm" as string]: paint } as CSSProperties}>
      {children}
    </span>
  ) : (
    <span className={className}>{children}</span>
  );
  if (!badge) return name;
  return (
    <>
      {name}
      <Badge id={look.badge} />
    </>
  );
}

/** Значок из Лавки рядом с именем. */
export function Badge({ id }: { id?: string }) {
  const it = id ? ITEMS.get(id) : undefined;
  if (!it) return null;
  return (
    <span className="nm-badge" data-b={it.id} title={it.name} aria-hidden>
      {it.glyph}
    </span>
  );
}

/* ── частицы ── */

type P = { x: number; y: number; vx: number; vy: number; t0: number; life: number; size: number; rot: number; vr: number; k: string; c: string; g?: string; seed: number };
type Src = { x: number; y: number; t: number; dist: number; still: number; burst: boolean };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
const PIX = ["#ff4d4d", "#ffb84d", "#f5e93d", "#4dff88", "#4dc3ff", "#9b6bff", "#ff6ec7"];
const FIRE = ["#ff4d6d", "#ffd23f", "#3bceac", "#5e60ce", "#ff8fab", "#ffffff", "#00bbf9"];

/** Больше частиц одновременно не держим: хвост длинный, а кадр лёгкий. */
const MAX_PARTS = 180;

/** Через сколько пикселей пути — новая частица. */
const STEP: Record<string, number> = { t_bubbles: 24, t_hearts: 22, t_snow: 20, t_pixels: 10, t_stars: 12, t_money: 26, t_fireworks: 14, t_bats: 30 };

function spawn(k: string, x: number, y: number, now: number, dx: number, dy: number): P[] {
  const base = { x, y, t0: now, rot: 0, vr: 0, seed: Math.random() * 100 };
  switch (k) {
    case "t_bubbles":
      return [{ ...base, vx: rnd(-0.15, 0.15), vy: rnd(-0.6, -0.3), life: rnd(900, 1500), size: rnd(3, 8), k, c: "" }];
    case "t_hearts":
      return [{ ...base, vx: rnd(-0.5, 0.5), vy: rnd(-0.9, -0.3), life: rnd(700, 1000), size: rnd(10, 15), k, c: "", g: pick(["💖", "💕", "💗", "❤️"]), vr: rnd(-0.004, 0.004) }];
    case "t_snow":
      return [{ ...base, vx: rnd(-0.2, 0.2), vy: rnd(0.25, 0.55), life: rnd(1200, 1800), size: rnd(8, 13), k, c: "", rot: rnd(0, 6), vr: rnd(-0.003, 0.003) }];
    case "t_pixels":
      return [{ ...base, x: x + rnd(-4, 4), y: y + rnd(-4, 4), vx: -dx * 0.05 + rnd(-0.4, 0.4), vy: rnd(-0.6, 0), life: rnd(500, 850), size: pick([4, 5, 6]), k, c: pick(PIX) }];
    case "t_stars":
      return [{ ...base, x: x + rnd(-6, 6), y: y + rnd(-6, 6), vx: rnd(-0.15, 0.15), vy: rnd(-0.1, 0.25), life: rnd(600, 1100), size: rnd(3, 7), k, c: pick(["#fff7c2", "#ffe066", "#ffffff", "#c7d2ff"]) }];
    case "t_money":
      return [{ ...base, vx: rnd(-0.4, 0.4), vy: rnd(-0.7, -0.3), life: rnd(900, 1300), size: rnd(12, 16), k, c: "", g: pick(["💵", "💸", "🪙", "💰"]), rot: rnd(-0.5, 0.5), vr: rnd(-0.006, 0.006) }];
    case "t_fireworks":
      return [{ ...base, vx: rnd(-0.2, 0.2), vy: rnd(-0.2, 0.2), life: rnd(250, 450), size: rnd(1.5, 2.5), k, c: pick(FIRE) }];
    case "t_bats":
      return [{ ...base, vx: rnd(-1, 1), vy: rnd(-1.1, -0.5), life: rnd(1000, 1400), size: rnd(12, 17), k, c: "", g: "🦇" }];
    default:
      return [];
  }
}

/** Салют: курсор остановился — разлетается кольцо искр. */
function burst(x: number, y: number, now: number): P[] {
  const c = pick(FIRE);
  const n = 26;
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rnd(-0.05, 0.05);
    const v = rnd(1.1, 1.8);
    return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t0: now, life: rnd(700, 1000), size: rnd(1.6, 2.6), rot: 0, vr: 0, k: "fw", c: i % 5 === 0 ? "#ffffff" : c, seed: i };
  });
}

/**
 * Спрайты: эмодзи и светящиеся точки рисуем один раз в маленький холст и дальше только копируем.
 * Текст эмодзи и shadowBlur на каждом кадре — это и было «лагает мышка»: браузер заново
 * растеризовал шрифт и размытие для каждой частицы 60 раз в секунду.
 */
const SPR = 2; // запас по чёткости для экранов с увеличением
const sprites = new Map<string, HTMLCanvasElement>();

function sprite(key: string, size: number, paint: (c: CanvasRenderingContext2D, s: number) => void): HTMLCanvasElement {
  const k = `${key}|${size}`;
  let c = sprites.get(k);
  if (c) return c;
  c = document.createElement("canvas");
  const px = Math.ceil(size * SPR);
  c.width = px;
  c.height = px;
  const x = c.getContext("2d");
  if (x) paint(x, px);
  sprites.set(k, c);
  return c;
}

const emoji = (g: string, size: number) =>
  sprite(`e${g}`, size, (c, s) => {
    c.font = `${s * 0.8}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(g, s / 2, s / 2 + s * 0.04);
  });

const flake = (size: number) =>
  sprite("snow", size, (c, s) => {
    c.font = `${s * 0.8}px system-ui, sans-serif`;
    c.fillStyle = "#8fd3ff";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("❄", s / 2, s / 2);
  });

/** Светящаяся точка: ядро цвета и мягкий ореол — вместо shadowBlur. */
const glow = (color: string, size: number) =>
  sprite(`g${color}`, size, (c, s) => {
    const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.18, color);
    g.addColorStop(0.45, `${color}66`);
    g.addColorStop(1, `${color}00`);
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  });

/** Четырёхлучевая искра с ореолом. */
const star = (color: string, size: number) =>
  sprite(`s${color}`, size, (c, s) => {
    const m = s / 2;
    const g = c.createRadialGradient(m, m, 0, m, m, m);
    g.addColorStop(0, "rgba(255, 230, 150, 0.55)");
    g.addColorStop(1, "rgba(255, 230, 150, 0)");
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
    const r = s * 0.42;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(m, m - r);
    c.quadraticCurveTo(m, m, m + r, m);
    c.quadraticCurveTo(m, m, m, m + r);
    c.quadraticCurveTo(m, m, m - r, m);
    c.quadraticCurveTo(m, m, m, m - r);
    c.fill();
  });

/** Нарисовать частицу; f — 1 в начале жизни, 0 — в конце. */
function draw(ctx: CanvasRenderingContext2D, p: P, now: number) {
  const age = now - p.t0;
  const f = 1 - age / p.life;
  if (f <= 0) return;
  ctx.globalAlpha = Math.min(1, f * 1.6);
  // спрайт по центру частицы; поворот и сжатие — только у тех, кому нужно
  const put = (img: HTMLCanvasElement, size: number, sx = 1) => {
    if (!p.rot && sx === 1) {
      ctx.drawImage(img, p.x - size / 2, p.y - size / 2, size, size);
      return;
    }
    ctx.save();
    ctx.translate(p.x, p.y);
    if (p.rot) ctx.rotate(p.rot);
    if (sx !== 1) ctx.scale(sx, 1);
    ctx.drawImage(img, -size / 2, -size / 2, size, size);
    ctx.restore();
  };
  switch (p.k) {
    case "t_bubbles": {
      const r = p.size * (1 + (1 - f) * 0.4);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = "rgba(120, 190, 255, 0.85)";
      ctx.fillStyle = "rgba(170, 220, 255, 0.18)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.fillRect(p.x - r * 0.45, p.y - r * 0.45, Math.max(1.2, r * 0.3), Math.max(1.2, r * 0.3));
      break;
    }
    case "t_snow":
      put(flake(Math.round(p.size)), p.size);
      break;
    case "t_pixels":
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      break;
    case "t_stars": {
      const s = p.size * 3 * (0.6 + 0.4 * Math.abs(Math.sin(age / 90 + p.seed)));
      put(star(p.c, 16), s);
      break;
    }
    case "t_fireworks":
    case "fw": {
      const s = p.size * 6 * (p.k === "fw" ? 0.6 + f * 0.6 : 1);
      put(glow(p.c, 16), s);
      break;
    }
    case "t_bats":
      // взмахи крыльями — сжатие по горизонтали
      put(emoji(p.g ?? "", Math.round(p.size)), p.size, 0.55 + 0.45 * Math.abs(Math.sin(age / 70 + p.seed)));
      break;
    default:
      put(emoji(p.g ?? "", Math.round(p.size)), p.size);
  }
}

/** Движок: источники (курсоры) → частицы. Один на холст. */
function engine() {
  const parts: P[] = [];
  const srcs = new Map<string, Src>();
  return {
    feed(key: string, kind: string, x: number, y: number, now: number) {
      const s = srcs.get(key);
      if (!s) {
        srcs.set(key, { x, y, t: now, dist: 0, still: now, burst: true });
        return;
      }
      const dx = x - s.x;
      const dy = y - s.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.5) {
        s.dist += d;
        s.still = now;
        s.burst = false;
        const step = STEP[kind] ?? 16;
        // на быстром рывке — не больше трёх частиц за кадр
        let n = 0;
        while (s.dist >= step && n < 3) {
          s.dist -= step;
          n++;
          const k = n / 3;
          parts.push(...spawn(kind, s.x + dx * k, s.y + dy * k, now, dx, dy));
        }
        if (s.dist > step) s.dist = 0;
      } else if (kind === "t_fireworks" && !s.burst && now - s.still > 160) {
        s.burst = true;
        parts.push(...burst(x, y, now));
      }
      s.x = x;
      s.y = y;
      s.t = now;
    },
    step(ctx: CanvasRenderingContext2D, now: number, dt: number) {
      for (const [k, s] of srcs) if (now - s.t > 2000) srcs.delete(k);
      const m = dt / 16;
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        if (now - p.t0 > p.life) {
          parts.splice(i, 1);
          continue;
        }
        if (p.k === "t_bubbles") p.vx += Math.sin((now - p.t0) / 180 + p.seed) * 0.01;
        if (p.k === "t_snow") p.vx = Math.sin((now - p.t0) / 300 + p.seed) * 0.3;
        if (p.k === "t_money" || p.k === "t_pixels") p.vy += 0.035 * m;
        if (p.k === "fw") {
          p.vx *= 0.96;
          p.vy = p.vy * 0.96 + 0.02 * m;
        }
        p.x += p.vx * m;
        p.y += p.vy * m;
        p.rot += p.vr * dt;
        draw(ctx, p, now);
      }
      // слишком много — старые уходят первыми
      ctx.globalAlpha = 1;
      if (parts.length > MAX_PARTS) parts.splice(0, parts.length - MAX_PARTS);
    },
    get busy() {
      return parts.length > 0;
    },
  };
}

function fitCanvas(c: HTMLCanvasElement, w: number, h: number) {
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  const d = window.devicePixelRatio || 1;
  c.width = Math.round(w * d);
  c.height = Math.round(h * d);
  ctx.setTransform(d, 0, 0, d, 0, 0);
  return ctx;
}

const calm = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * След за курсорами на всю страницу.
 *  • own — свой след (вещь из Лавки) за своей мышью;
 *  • peers — есть ли на странице коллеги со следом (.lv-cur[data-trail]).
 */
export function ShopTrail({ own, peers }: { own?: string; peers: boolean }) {
  useEffect(() => {
    if (!own && !peers) return;
    if (!window.matchMedia("(pointer: fine)").matches || calm()) return;
    const c = document.createElement("canvas");
    c.className = "lv-comet";
    c.setAttribute("aria-hidden", "true");
    document.documentElement.append(c);
    let ctx = fitCanvas(c, window.innerWidth, window.innerHeight);
    if (!ctx) return;
    let w = window.innerWidth;
    let h = window.innerHeight;
    const fit = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      ctx = fitCanvas(c, w, h);
    };
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

    const eng = engine();
    let raf = 0;
    let dirty = false;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      if (own && mouse) eng.feed("me", own, mouse.x, mouse.y, now);
      if (peers)
        document.querySelectorAll<HTMLElement>(".lv-cur[data-trail]:not(.idle) > .lv-dot").forEach((d) => {
          const cur = d.parentElement!;
          const r = d.getBoundingClientRect();
          eng.feed(cur.dataset.sid ?? "", cur.dataset.trail ?? "", r.left + r.width / 2, r.top + r.height / 2, now);
        });
      // нечего рисовать — холст не трогаем: пустой кадр почти ничего не стоит
      if (ctx && (eng.busy || dirty)) {
        ctx.clearRect(0, 0, w, h);
        eng.step(ctx, now, dt);
        dirty = eng.busy;
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

/** След в карточке: мышь над карточкой — за ней, иначе (если play) — «курсор» сам рисует восьмёрку. */
export function TrailDemo({ kind, play }: { kind: string; play: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    const box = c?.parentElement;
    if (!c || !box) return;
    let w = box.clientWidth;
    let h = box.clientHeight;
    let ctx = fitCanvas(c, w, h);
    if (!ctx) return;
    const ro = new ResizeObserver(() => {
      w = box.clientWidth;
      h = box.clientHeight;
      ctx = fitCanvas(c, w, h);
    });
    ro.observe(box);

    let mouse: { x: number; y: number } | null = null;
    const move = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      // карточка может быть масштабирована (размер интерфейса) — переводим в её пиксели
      mouse = { x: ((e.clientX - r.left) / r.width) * w, y: ((e.clientY - r.top) / r.height) * h };
    };
    const leave = () => (mouse = null);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerleave", leave);

    const eng = engine();
    const still = calm();
    let raf = 0;
    let dirty = false;
    let last = performance.now();
    const t0 = last;
    let path = 0;
    const frame = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      if (mouse) eng.feed("m", kind, mouse.x, mouse.y, now);
      else if (play && !still) {
        // восьмёрка; у салюта — с паузами, чтобы были видны вспышки
        // время «курсора» стоит, пока пауза — точка замирает и салют успевает вспыхнуть
        if (!(kind === "t_fireworks" && Math.sin((now - t0) / 380) > 0.6)) path += dt / 1000;
        eng.feed("auto", kind, w / 2 + Math.sin(path * 1.3) * w * 0.32, h / 2 + Math.sin(path * 2.6) * h * 0.22, now);
      }
      // нечего рисовать — холст не трогаем: пустой кадр почти ничего не стоит
      if (ctx && (eng.busy || dirty)) {
        ctx.clearRect(0, 0, w, h);
        eng.step(ctx, now, dt);
        dirty = eng.busy;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerleave", leave);
    };
  }, [kind, play]);
  return <canvas ref={ref} className="shop-demo" aria-hidden />;
}
