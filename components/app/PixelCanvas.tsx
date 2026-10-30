"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from "react";
import { useCrm } from "@/lib/crm/store";
import { currentMonth, fmtMonth, nowMs } from "@/lib/crm/dates";
import { fmtInt, plural } from "@/lib/crm/format";
import type { MonthKey } from "@/lib/crm/types";
import { Empty, MonthSwitcher, PageHead, Seg } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { StickyHead } from "@/components/app/StickyHead";
import { PixelPalette } from "@/components/app/PixelPalette";
import {
  GOLD,
  SIZE,
  UNDO_MS,
  bestGrade,
  isColor,
  paintBlock,
  paintEarned,
  paintSpent,
  pixelStore,
  sortByTime,
  topCells,
  type PaintCtx,
  type Painter,
  type Pixel,
  type PixelChange,
} from "@/lib/pixels";

/**
 * «Холст» — общий пиксель-арт отдела (правила — lib/pixels.ts). Колёсико — масштаб,
 * перетаскивание — сдвиг, клик — инструмент: кисть, пипетка, у РОПа и супервайзера ещё ластик.
 * Прошлые месяцы — галерея: только смотреть, таймлапс и картинка.
 */

type Tool = "brush" | "pick" | "erase";
interface View {
  cell: number;
  ox: number;
  oy: number;
}

const RECENT_KEY = "leadup.pixels.recent";
const MIN_CELL = 4;
const MAX_CELL = 64;

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter(isColor).slice(0, 10) : [];
  } catch {
    return [];
  }
}

function applyChange(rows: Pixel[], c: PixelChange): Pixel[] {
  if (c.type === "del") return rows.filter((r) => r.id !== c.id);
  const i = rows.findIndex((r) => r.id === c.p.id);
  if (i < 0) return [...rows, c.p];
  const next = rows.slice();
  next[i] = c.p;
  return next;
}

/** Золото с бегущим по диагонали бликом: k — кадр анимации. */
function goldAt(x: number, y: number, k: number): string {
  const w = Math.max(0, Math.sin(k * 0.18 - (x + y) * 0.45)) ** 8;
  const ch = (a: number) => Math.round(a + (255 - a) * w * 0.85).toString(16).padStart(2, "0");
  return `#${ch(0xe8)}${ch(0xb9)}${ch(0x23)}`;
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });

export function PixelCanvas() {
  const { full, access, me, toast, confirm } = useCrm();
  const [month, setMonth] = useState<MonthKey>(() => currentMonth());
  const live = month === currentMonth();
  const accountId = access.account.id;
  const opId = access.opId;
  const canModerate = access.isHead || access.isSup;

  const [rows, setRows] = useState<Pixel[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    setRows([]);
    setLoading(true);
    setLoadErr(null);
    // что пришло по Realtime, пока грузился журнал, не теряем
    const unsub = pixelStore.subscribe(month, (c) => setRows((prev) => applyChange(prev, c)));
    pixelStore.load(month).then(
      (r) => {
        if (off) return;
        setRows((prev) => {
          const m = new Map(r.map((p) => [p.id, p]));
          for (const p of prev) m.set(p.id, p);
          return Array.from(m.values());
        });
        setLoading(false);
      },
      (e) => {
        if (off) return;
        setLoadErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
    return () => {
      off = true;
      unsub();
    };
  }, [month]);

  const who = useMemo<Painter>(() => ({ role: access.account.role, opId, groups: access.ownGroups }), [access.account.role, opId, access.ownGroups]);
  const canPaint = !!opId || who.role !== "operator";
  const earnedBy = useMemo(() => paintEarned(full.leads, who, month), [full.leads, who, month]);
  const earned = earnedBy.total;
  const grade = useMemo(() => bestGrade(full.leads, who, month), [full.leads, who, month]);
  const spent = useMemo(() => paintSpent(rows, accountId), [rows, accountId]);
  const left = earned - spent;
  // для обращений к хранилищу — всегда свежие значения, без пересоздания обработчиков
  const ctx = useRef<PaintCtx>({ accountId, name: me.name, month, earned, grade, canModerate });
  ctx.current = { accountId, name: me.name, month, earned, grade, canModerate };

  /* ── инструмент и цвет ── */
  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState("#3b82f6");
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecent()), []);
  const pushRecent = useCallback((c: string) => {
    setRecent((prev) => {
      const next = [c, ...prev.filter((x) => x !== c)].slice(0, 10);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        /* не запомнили — до перезагрузки */
      }
      return next;
    });
  }, []);

  /* ── таймлапс: журнал по порядку, ~8 секунд на весь месяц ── */
  const ordered = useMemo(() => sortByTime(rows.filter((r) => !r.erasedAt && !r.id.startsWith("tmp-"))), [rows]);
  const [play, setPlay] = useState<number | null>(null);
  useEffect(() => {
    if (play == null) return;
    if (play >= ordered.length) {
      const t = setTimeout(() => setPlay(null), 1200);
      return () => clearTimeout(t);
    }
    const step = Math.max(1, Math.ceil(ordered.length / 320));
    const t = setTimeout(() => setPlay((k) => (k == null ? null : k + step)), 25);
    return () => clearTimeout(t);
  }, [play, ordered.length]);

  const cells = useMemo(() => topCells(play == null ? rows : ordered.slice(0, play)), [rows, ordered, play]);

  /* ── вид: масштаб и сдвиг ── */
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ cell: 16, ox: 0, oy: 0 });
  const fitted = useRef(false);

  const fit = useCallback((w: number, h: number) => {
    const cell = Math.max(MIN_CELL, Math.floor((Math.min(w, h) * 0.94) / SIZE));
    setView({ cell, ox: Math.round((w - cell * SIZE) / 2), oy: Math.round((h - cell * SIZE) / 2) });
  }, []);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize({ w, h });
      if (!fitted.current && w > 0 && h > 0) {
        fitted.current = true;
        fit(w, h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const zoomAt = useCallback((mx: number, my: number, factor: number) => {
    setView((v) => {
      const cell = Math.min(MAX_CELL, Math.max(MIN_CELL, v.cell * factor));
      const k = cell / v.cell;
      return { cell, ox: mx - (mx - v.ox) * k, oy: my - (my - v.oy) * k };
    });
  }, []);

  // точка курсора в координатах холста; учитываем масштаб интерфейса (zoom на body)
  const local = useCallback((clientX: number, clientY: number) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const k = c.clientWidth / (r.width || 1);
    return { x: (clientX - r.left) * k, y: (clientY - r.top) * k };
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e.clientX, e.clientY);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [local, zoomAt]);

  const cellAt = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const p = local(clientX, clientY);
      const x = Math.floor((p.x - view.ox) / view.cell);
      const y = Math.floor((p.y - view.oy) / view.cell);
      return x >= 0 && y >= 0 && x < SIZE && y < SIZE ? { x, y } : null;
    },
    [local, view],
  );

  /* ── рисование на <canvas> ── */
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);

  // тема сменилась — пустые клетки и сетка берут цвета заново
  const [themeKey, setThemeKey] = useState(0);
  useEffect(() => {
    const bump = () => setThemeKey((n) => n + 1);
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);
    return () => {
      mo.disconnect();
      mq.removeEventListener("change", bump);
    };
  }, []);

  // блик по золотым пикселям — кадры идут, только пока золото есть на холсте
  const hasGold = useMemo(() => Array.from(cells.values()).some((p) => p.color === GOLD), [cells]);
  const [shine, setShine] = useState(0);
  useEffect(() => {
    if (!hasGold || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setShine((n) => n + 1), 70);
    return () => clearInterval(t);
  }, [hasGold]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(size.w * dpr) || c.height !== Math.round(size.h * dpr)) {
      c.width = Math.round(size.w * dpr);
      c.height = Math.round(size.h * dpr);
    }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);
    const css = getComputedStyle(c);
    const empty1 = css.getPropertyValue("--px-empty-1").trim() || "#f4f5f7";
    const empty2 = css.getPropertyValue("--px-empty-2").trim() || "#eceef2";
    const gridC = css.getPropertyValue("--px-grid").trim() || "rgba(0,0,0,.06)";
    const { cell, ox, oy } = view;
    const W = cell * SIZE;

    g.imageSmoothingEnabled = false;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const p = cells.get(y * SIZE + x);
        g.fillStyle = p ? (p.color === GOLD ? goldAt(x, y, shine) : p.color) : (x + y) % 2 ? empty2 : empty1;
        // +0.5 — без просветов между клетками на дробном масштабе
        g.fillRect(ox + x * cell, oy + y * cell, cell + 0.5, cell + 0.5);
      }
    }
    if (cell >= 10) {
      g.strokeStyle = gridC;
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= SIZE; i++) {
        const a = Math.round(ox + i * cell) + 0.5;
        const b = Math.round(oy + i * cell) + 0.5;
        g.moveTo(a, oy);
        g.lineTo(a, oy + W);
        g.moveTo(ox, b);
        g.lineTo(ox + W, b);
      }
      g.stroke();
    }
    if (hover && play == null) {
      const hx = ox + hover.x * cell;
      const hy = oy + hover.y * cell;
      if (tool === "brush" && live) {
        g.globalAlpha = 0.75;
        g.fillStyle = color;
        g.fillRect(hx, hy, cell, cell);
        g.globalAlpha = 1;
      }
      g.lineWidth = 2;
      g.strokeStyle = tool === "erase" ? "#ef4444" : "#111827";
      g.strokeRect(hx + 1, hy + 1, cell - 2, cell - 2);
      g.strokeStyle = "#ffffff";
      g.lineWidth = 1;
      g.strokeRect(hx + 2.5, hy + 2.5, cell - 5, cell - 5);
    }
  }, [cells, view, size, hover, color, tool, live, play, themeKey, shine]);

  /* ── действия ── */
  const [last, setLast] = useState<{ id: string; at: number } | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!last) return;
    const t = setInterval(() => {
      if (Date.now() - last.at > UNDO_MS) setLast(null);
      tick((n) => n + 1);
    }, 500);
    return () => clearInterval(t);
  }, [last]);

  const seq = useRef(0);
  const paint = useCallback(
    async (x: number, y: number) => {
      if (!canPaint) {
        toast("Рисовать можно с карточкой оператора: краска — за одобренные лиды", "err");
        return;
      }
      const why = paintBlock(cells.get(y * SIZE + x), color, accountId, left, grade);
      if (why) {
        toast(why, "err");
        return;
      }
      // сразу показываем пиксель, сервер подтвердит или вернёт отказ
      const tmp: Pixel = { id: `tmp-${++seq.current}`, month, x, y, color, accountId, name: me.name, at: new Date(nowMs()).toISOString(), erasedAt: null };
      setRows((prev) => [...prev, tmp]);
      try {
        const p = await pixelStore.paint(x, y, color, ctx.current);
        setRows((prev) => applyChange(prev.filter((r) => r.id !== tmp.id), { type: "put", p }));
        setLast({ id: p.id, at: Date.now() });
        pushRecent(color);
      } catch (e) {
        setRows((prev) => prev.filter((r) => r.id !== tmp.id));
        toast(e instanceof Error ? e.message : String(e), "err");
      }
    },
    [canPaint, cells, color, accountId, left, grade, month, me.name, toast, pushRecent],
  );

  const undo = useCallback(async () => {
    if (!last || Date.now() - last.at > UNDO_MS) return;
    const id = last.id;
    setLast(null);
    try {
      if (await pixelStore.undo(id, ctx.current)) setRows((prev) => prev.filter((r) => r.id !== id));
      else toast("Отменить уже нельзя", "err");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "err");
    }
  }, [last, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        void undo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  const eraseIds = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      try {
        const n = await pixelStore.erase(ids, ctx.current);
        const at = new Date(nowMs()).toISOString();
        const set = new Set(ids);
        setRows((prev) => prev.map((r) => (set.has(r.id) && !r.erasedAt ? { ...r, erasedAt: at } : r)));
        if (n > 1) toast(`Стёрто пикселей: ${fmtInt(n)}`);
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "err");
      }
    },
    [toast],
  );

  const act = useCallback(
    (x: number, y: number) => {
      const top = cells.get(y * SIZE + x);
      if (tool === "pick") {
        if (top) {
          setColor(top.color);
          setTool("brush");
        }
        return;
      }
      if (!live) {
        toast("Этот холст уже в галерее — рисуем на холсте текущего месяца", "err");
        return;
      }
      if (tool === "erase") {
        if (top) void eraseIds([top.id]);
        return;
      }
      void paint(x, y);
    },
    [cells, tool, live, paint, eraseIds, toast],
  );

  /* ── мышь: клик — инструмент, перетаскивание — сдвиг ── */
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(null);
  const onDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e.clientX, e.clientY);
    drag.current = { x: p.x, y: p.y, ox: view.ox, oy: view.oy, moved: e.button === 1 };
  };
  const onMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (d) {
      const p = local(e.clientX, e.clientY);
      const dx = p.x - d.x;
      const dy = p.y - d.y;
      if (d.moved || Math.abs(dx) + Math.abs(dy) > 5) {
        d.moved = true;
        setView((v) => ({ ...v, ox: d.ox + dx, oy: d.oy + dy }));
        return;
      }
    }
    const c = cellAt(e.clientX, e.clientY);
    setHover((h) => (h?.x === c?.x && h?.y === c?.y ? h : c));
  };
  const onUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || e.button !== 0 || play != null) return;
    const c = cellAt(e.clientX, e.clientY);
    if (c) act(c.x, c.y);
  };

  /* ── картинка холста ── */
  const download = () => {
    const k = 16;
    const c = document.createElement("canvas");
    c.width = c.height = SIZE * k;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    for (const p of topCells(rows).values()) {
      g.fillStyle = p.color;
      g.fillRect(p.x * k, p.y * k, k, k);
    }
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = `holst-${month}.png`;
    a.click();
  };

  /* ── художники месяца ── */
  const artists = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number; ids: string[] }>();
    for (const p of rows) {
      if (p.erasedAt || p.id.startsWith("tmp-")) continue;
      const a = m.get(p.accountId) ?? { id: p.accountId, name: p.name || "Без имени", n: 0, ids: [] };
      a.n++;
      a.ids.push(p.id);
      m.set(p.accountId, a);
    }
    return Array.from(m.values()).sort((a, b) => b.n - a.n);
  }, [rows]);
  const filled = cells.size;

  const eraseAuthor = async (a: { name: string; n: number; ids: string[] }) => {
    const ok = await confirm({
      title: `Стереть все пиксели — ${a.name}?`,
      text: `Сотрём ${fmtInt(a.n)} шт. за ${fmtMonth(month).toLowerCase()}. Под ними снова будет виден прежний цвет клеток. Краска не вернётся.`,
      ok: "Стереть",
      danger: true,
    });
    if (ok) await eraseIds(a.ids);
  };

  const hoverPx = hover ? cells.get(hover.y * SIZE + hover.x) : undefined;
  const undoLeft = last ? Math.max(0, Math.ceil((UNDO_MS - (Date.now() - last.at)) / 1000)) : 0;

  const toolOptions: { value: Tool; label: ReactNode }[] = [
    { value: "brush", label: <><Icon name="edit" size={13} /> Кисть</> },
    { value: "pick", label: <><Icon name="fill" size={13} /> Пипетка</> },
    ...(canModerate ? [{ value: "erase" as Tool, label: <><Icon name="trash" size={13} /> Ластик</> }] : []),
  ];

  return (
    <div className="stack">
      <StickyHead title="Холст" ctx={fmtMonth(month)} />
      <PageHead
        title="Холст"
        sub={`Общий пиксель-арт отдела · 1 одобренный лид = 1 пиксель · ${fmtMonth(month)}`}
        actions={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setPlay(play == null ? 0 : null)} disabled={!ordered.length}>
              <Icon name={play == null ? "play" : "pause"} size={14} /> {play == null ? "Таймлапс" : "Стоп"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={download} disabled={!filled}>
              <Icon name="download" size={14} /> Картинка
            </button>
            <MonthSwitcher value={month} onChange={(m) => (m <= currentMonth() ? setMonth(m) : undefined)} />
          </>
        }
      />

      <div className="px-wrap">
        <section className="card px-stage">
          <div className="px-bar">
            {live ? (
              <Seg value={tool} options={toolOptions} onChange={setTool} />
            ) : (
              <span className="px-gallery">
                <Icon name="lock" size={13} /> Галерея: холст за {fmtMonth(month).toLowerCase()} закрыт
              </span>
            )}
            <div className="px-zoom">
              <button type="button" className="btn btn-ghost btn-icon" title="Мельче" onClick={() => zoomAt(size.w / 2, size.h / 2, 1 / 1.4)}>
                −
              </button>
              <button type="button" className="btn btn-ghost btn-icon" title="Крупнее" onClick={() => zoomAt(size.w / 2, size.h / 2, 1.4)}>
                +
              </button>
              <button type="button" className="btn btn-ghost" title="Весь холст на экране" onClick={() => fit(size.w, size.h)}>
                <Icon name="grid" size={13} /> Весь
              </button>
            </div>
          </div>
          <div className="px-box" ref={boxRef} data-tool={tool}>
            <canvas
              ref={canvasRef}
              className="px-canvas"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={() => setHover(null)}
              onContextMenu={(e) => e.preventDefault()}
            />
            {loading && <div className="px-note">Загружаем холст…</div>}
            {loadErr && <div className="px-note px-note-err">Холст не загрузился: {loadErr}</div>}
            {play != null && (
              <div className="px-play">
                Таймлапс · {fmtInt(Math.min(play, ordered.length))} из {fmtInt(ordered.length)}
                {ordered[Math.min(play, ordered.length) - 1] && <> · {dayOf(ordered[Math.min(play, ordered.length) - 1].at)}</>}
              </div>
            )}
            {/* только что поставленный пиксель можно отменить — плашка прямо над холстом, полоска тает */}
            {last && undoLeft > 0 && (
              <button key={last.id} type="button" className="px-undo" onClick={() => void undo()} title="Краска вернётся">
                <i className="px-undo-sw" style={{ background: rows.find((r) => r.id === last.id)?.color }} />
                <span>Пиксель поставлен</span>
                <b>
                  <Icon name="restore" size={13} /> Отменить
                </b>
                <span className="px-undo-t num">{undoLeft} с</span>
                <kbd>Ctrl+Z</kbd>
                <i className="px-undo-bar" style={{ animationDuration: `${UNDO_MS}ms` }} />
              </button>
            )}
          </div>
          <div className="px-info">
            {hover ? (
              <>
                <span className="num">
                  {hover.x + 1}:{hover.y + 1}
                </span>
                {hoverPx ? (
                  <>
                    <i className="px-dot" style={{ background: hoverPx.color }} />
                    <b>{hoverPx.name || "Без имени"}</b>
                    <span>
                      {dayOf(hoverPx.at)}, {timeOf(hoverPx.at)}
                    </span>
                  </>
                ) : (
                  <span>пусто</span>
                )}
              </>
            ) : (
              <span>Колёсико — масштаб, перетаскивание — сдвиг, клик — {tool === "brush" ? "поставить пиксель" : tool === "pick" ? "взять цвет" : "стереть"}</span>
            )}
            <span className="px-fill">
              заполнено {fmtInt(filled)} из {fmtInt(SIZE * SIZE)}
            </span>
          </div>
        </section>

        <aside className="px-side">
          <section className="card px-paint" data-empty={left < 1 ? "" : undefined}>
            {canPaint ? (
              <>
                <div className="px-paint-n">
                  <span className="num">{fmtInt(left)}</span>
                  <small>{left < 0 ? "долг по краске" : `${plural(left, ["пиксель", "пикселя", "пикселей"])} краски`}</small>
                </div>
                <div className="px-paint-s">
                  {earnedBy.rate ? (
                    <>
                      {who.role === "head" ? "одобрено по отделу" : "одобрено в ваших группах"} <b className="num">{fmtInt(earnedBy.team)}</b> — 1 пиксель за каждые {earnedBy.rate}
                      {earnedBy.own > 0 && (
                        <>
                          {" "}
                          · свои лиды <b className="num">{fmtInt(earnedBy.own)}</b>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      одобрено лидов <b className="num">{fmtInt(earnedBy.own)}</b>
                    </>
                  )}{" "}
                  · поставлено <b className="num">{fmtInt(spent)}</b>
                </div>
                {left < 0 && <div className="px-paint-s">Часть лидов сняли с «доведён» — новые одобренные лиды закроют долг</div>}
                {left === 0 && live && (
                  <div className="px-paint-s">{earnedBy.rate ? `Краска появится с новыми одобренными лидами команды` : "Краска появится, когда супервайзер одобрит ваш лид"}</div>
                )}
              </>
            ) : (
              <div className="px-paint-s">Краска даётся за одобренные лиды — у аккаунта нет карточки оператора. Смотреть холст можно{canModerate ? ", стирать — ластиком" : ""}.</div>
            )}
          </section>

          <PixelPalette
            color={color}
            onPick={(c) => {
              setColor(c);
              setTool("brush");
            }}
            recent={recent}
            grade={grade}
          />

          <section className="card px-top">
            <h3 className="d2-h">
              <Icon name="star" size={15} className="title-ic" /> Художники · {fmtMonth(month).toLowerCase()}
            </h3>
            {artists.length ? (
              <ol>
                {artists.slice(0, 12).map((a, i) => (
                  <li key={a.id} data-me={a.id === accountId ? "" : undefined}>
                    <span className="px-rank num">{i + 1}</span>
                    <span className="px-name">{a.name}</span>
                    <b className="num">{fmtInt(a.n)}</b>
                    {canModerate && live && (
                      <button type="button" className="btn btn-ghost btn-icon px-wipe" title="Стереть все пиксели человека" onClick={() => void eraseAuthor(a)}>
                        <Icon name="trash" size={12} />
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <Empty icon="star" title="Пока никто не рисовал" text={live ? "Первый одобренный лид — первый пиксель" : undefined} />
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
