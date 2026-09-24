"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Report } from "@/lib/crm/report";
import { fmtDate, fmtDay, fmtDayShort, fmtMonth, fmtStamp, fmtWeekday, nowStamp } from "@/lib/crm/dates";
import { fmtInt, fmtNum, shortName } from "@/lib/crm/format";

/**
 * Отчёт картинкой: рисуем на canvas сами, без библиотек — поэтому то, что видно
 * на странице, один в один уходит в PNG (скачать / скопировать в чат). Палитра —
 * по теме CRM: в тёмной теме белая карточка слепит, и в чат уходит то же, что на экране.
 */

export interface ReportCanvasHandle {
  toBlob: () => Promise<Blob | null>;
  toDataURL: () => string;
}

const W = 960; // ширина картинки, CSS-пикселей
const P = 36; // поля
const SCALE = 2; // чёткость для экранов с плотными пикселями

const LIGHT = {
  bg: "#ffffff",
  text: "#28251f",
  sub: "#6b655a",
  dim: "#8a8478",
  line: "#eee9e0",
  strip: "#faf7f2",
  brand: "#3d6db3",
  brandSoft: "#e4edf9",
  green: "#2e6b45",
  greenBg: "#e0f1e4",
  red: "#ad3a33",
  redBg: "#fce5e1",
  amber: "#7d550b",
  amberBg: "#fbefd4",
};

/** Тёмная — те же поверхности и акценты, что у тёмной темы CRM (globals.css). */
const DARK: typeof LIGHT = {
  bg: "#232220",
  text: "#efece6",
  sub: "#aca79c",
  dim: "#7f7a70",
  line: "#312f2c",
  strip: "#2a2926",
  brand: "#92b8f0",
  brandSoft: "#22303f",
  green: "#8fd1a0",
  greenBg: "#1d3124",
  red: "#f4a097",
  redBg: "#3d2421",
  amber: "#ebc47e",
  amberBg: "#372d1c",
};

type Palette = typeof LIGHT;

/** Тема CRM сейчас: следим за data-theme на <html>, чтобы перерисовать при переключении. */
function useDarkTheme(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const read = () => setDark(el.dataset.theme === "dark");
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export const ReportCanvas = forwardRef<ReportCanvasHandle, { report: Report; company: string }>(function ReportCanvas({ report, company }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  const dark = useDarkTheme();

  useImperativeHandle(ref, () => ({
    toBlob: () => new Promise((res) => (cv.current ? cv.current.toBlob((b) => res(b), "image/png") : res(null))),
    toDataURL: () => cv.current?.toDataURL("image/png") ?? "",
  }));

  useEffect(() => {
    let alive = true;
    // шрифты приложения (next/font даёт им внутренние имена) — берём как есть из вычисленных стилей
    const sans = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
    const probe = document.createElement("span");
    probe.className = "num";
    document.body.appendChild(probe);
    const mono = getComputedStyle(probe).fontFamily || "monospace";
    probe.remove();
    void document.fonts.ready.then(() => {
      if (alive && cv.current) draw(cv.current, report, company, sans, mono, dark ? DARK : LIGHT);
    });
    return () => {
      alive = false;
    };
  }, [report, company, dark]);

  return <canvas ref={cv} style={{ width: "100%", maxWidth: W, height: "auto", display: "block", borderRadius: 12, boxShadow: "var(--shadow-sm)", border: "1px solid var(--ink-07)" }} />;
});

function draw(canvas: HTMLCanvasElement, r: Report, company: string, sans: string, mono: string, C: Palette) {
  const toneOf = (v: number | null) => (v == null ? C.text : v >= 1 ? C.green : v >= 0.8 ? C.amber : C.red);
  const week = r.kind === "week";
  const rowH = 30;
  const attn = [
    r.attention.noShift.length ? { title: "Нет смены в графике", tone: C.amber, bg: C.amberBg, items: r.attention.noShift.map(shortName) } : null,
    r.attention.noLeads.length ? { title: "На смене, но без лидов", tone: C.red, bg: C.redBg, items: r.attention.noLeads.map(shortName) } : null,
    r.attention.lowConv.length
      ? { title: `Конверсия ниже нормы ${Math.round(r.convNorm * 100)}%`, tone: C.red, bg: C.redBg, items: r.attention.lowConv.map((x) => `${shortName(x.name)} — ${Math.round(x.conv * 100)}%`) }
      : null,
  ].filter(Boolean) as { title: string; tone: string; bg: string; items: string[] }[];

  // ── раскладка по высоте ──
  const hHeader = 78;
  const hTiles = 96;
  // заголовок, полоса под подписи столбиков, столбики, подписи дней
  const hChart = week ? 208 : 0;
  // заголовок блока + шапка таблицы + строки + итого
  const hTable = 26 + (rowH + 2) + rowH * Math.max(1, r.rows.length) + rowH + 14;
  const ctx0 = document.createElement("canvas").getContext("2d")!;
  ctx0.font = `13px ${sans}`;
  const attnLines = attn.map((a) => wrap(ctx0, a.items.join(", "), W - P * 2 - 32).length);
  const hAttn = attn.length ? 34 + attnLines.reduce((s, n) => s + 24 + n * 19 + 12, 0) : 0;
  // кадровые события — строкой на событие: заголовок блока + строки
  const EV_ROW = 26;
  const hEvents = r.events.length ? 34 + r.events.length * EV_ROW + 6 : 0;
  const hFoot = 44;
  const H = P + hHeader + hTiles + 8 + hChart + hTable + (hAttn ? 20 + hAttn : 0) + (hEvents ? 20 + hEvents : 0) + hFoot;

  canvas.width = W * SCALE;
  canvas.height = Math.ceil(H * SCALE);
  const ctx = canvas.getContext("2d")!;
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  const font = (size: number, weight = 400, family = sans) => (ctx.font = `${weight} ${size}px ${family}`);
  const text = (s: string, x: number, y: number, color = C.text, align: CanvasTextAlign = "left") => {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  };

  // ── шапка ──
  let y = P;
  font(12, 600);
  text(company.toUpperCase(), P, y + 12, C.brand);
  font(24, 700);
  const period = week
    ? `Отчёт за неделю · ${fmtDayShort(r.from)} – ${fmtDay(r.to, true)}`
    : `Отчёт за день · ${fmtDay(r.from, true)}, ${fmtWeekday(r.from)}`;
  text(period, P, y + 44);
  font(13);
  const note = week && r.factTo < r.to ? ` · неделя идёт, данные по ${fmtDate(r.factTo)}` : "";
  text(`${r.scope}${note}`, P, y + 66, C.sub);
  text(`сформирован ${fmtStamp(nowStamp())}`, W - P, y + 66, C.dim, "right");
  y += hHeader;

  // ── плитки ──
  const tiles: { label: string; value: string; sub: string; tone?: string }[] = [
    { label: week ? "Лидов за неделю" : "Лидов за день", value: fmtInt(r.total.leads), sub: r.total.plan > 0 ? `план ${fmtNum(r.total.plan, 0)} · ${pct(r.total.pct)}` : "план не задан", tone: toneOf(r.total.pct) },
    { label: "Доведено / не доведено", value: `${fmtInt(r.total.done)} / ${fmtInt(r.total.failed)}`, sub: `в работе ${fmtInt(r.total.work)}` },
    { label: "Часы", value: fmtNum(r.total.hours, 0), sub: `на смене ${fmtInt(r.total.people)} чел.` },
    {
      label: "Конверсия",
      value: r.total.conv == null ? "—" : `${Math.round(r.total.conv * 100)}%`,
      sub: `норма ${Math.round(r.convNorm * 100)}%`,
      tone: r.total.conv == null ? undefined : r.total.conv >= r.convNorm ? C.green : C.red,
    },
    { label: `RR · ${fmtMonth(r.month.month).toLowerCase()}`, value: fmtInt(Math.round(r.month.rr)), sub: r.month.plan > 0 ? `${pct(r.month.rrPct)} плана ${fmtInt(r.month.plan)}` : `факт ${fmtInt(r.month.fact)}`, tone: r.month.plan > 0 ? toneOf(r.month.rrPct) : undefined },
  ];
  const gap = 10;
  const tw = (W - P * 2 - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = P + i * (tw + gap);
    roundRect(ctx, x, y, tw, hTiles - 12, 10, C.strip);
    font(12, 500);
    text(t.label, x + 14, y + 22, C.sub);
    font(26, 600, mono);
    text(t.value, x + 14, y + 55, t.tone ?? C.text);
    font(11.5);
    text(clip(ctx, t.sub, tw - 28), x + 14, y + 74, C.dim);
  });
  y += hTiles + 8;

  // ── неделя: столбики по дням ──
  if (week) {
    font(14, 600);
    text("Лиды по дням", P, y + 14);
    font(11.5);
    text("пунктир — план дня", W - P, y + 14, C.dim, "right");
    // сверху — полоса под цифру самого высокого столбика, чтобы она не налезала на заголовок
    const top = y + 48;
    const ch = 110;
    const max = Math.max(1, ...r.byDay.map((d) => Math.max(d.leads, d.plan)));
    const cw = (W - P * 2) / r.byDay.length;
    r.byDay.forEach((d, i) => {
      const cx = P + i * cw;
      const bw = Math.min(56, cw - 24);
      const bx = cx + (cw - bw) / 2;
      const bh = (d.leads / max) * ch;
      const future = d.day > r.factTo;
      roundRect(ctx, bx, top + ch - bh, bw, Math.max(bh, d.leads ? 3 : 0), 5, d.plan > 0 && d.leads >= d.plan ? C.brand : C.brandSoft);
      const py = d.plan > 0 ? top + ch - (d.plan / max) * ch : null;
      if (py != null) {
        ctx.strokeStyle = C.sub;
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx - 6, py);
        ctx.lineTo(bx + bw + 6, py);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      font(13, 600, mono);
      // цифра над столбиком; если там же проходит пунктир плана — поднимаем её над пунктиром
      let ly = top + ch - bh - 6;
      if (py != null && py > ly - 14 && py < ly + 4) ly = py - 5;
      if (!future) text(fmtInt(d.leads), cx + cw / 2, ly, C.text, "center");
      font(11.5);
      text(`${fmtWeekday(d.day)} ${d.day.slice(8, 10)}.${d.day.slice(5, 7)}`, cx + cw / 2, top + ch + 18, future ? C.dim : C.sub, "center");
    });
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(P, top + ch + 0.5);
    ctx.lineTo(W - P, top + ch + 0.5);
    ctx.stroke();
    y += hChart;
  }

  // ── операторы ──
  font(14, 600);
  text("Операторы", P, y + 14);
  y += 26;
  const cols = [
    { title: "Оператор", w: 0, align: "left" as CanvasTextAlign },
    { title: "Часы", w: 70, align: "right" as CanvasTextAlign },
    { title: "Лиды", w: 70, align: "right" as CanvasTextAlign },
    { title: "План", w: 70, align: "right" as CanvasTextAlign },
    { title: "% плана", w: 80, align: "right" as CanvasTextAlign },
    { title: "Конверсия", w: 92, align: "right" as CanvasTextAlign },
    { title: "Не доведено", w: 104, align: "right" as CanvasTextAlign },
  ];
  cols[0].w = W - P * 2 - cols.slice(1).reduce((s, c) => s + c.w, 0);
  const colX: number[] = [];
  cols.reduce((x, c) => (colX.push(x), x + c.w), P);
  const cellX = (i: number) => (cols[i].align === "right" ? colX[i] + cols[i].w - 12 : colX[i] + 12);
  roundRect(ctx, P, y, W - P * 2, rowH + 2, 8, C.strip);
  font(12, 600);
  cols.forEach((c, i) => text(c.title, cellX(i), y + 20, C.sub, c.align));
  y += rowH + 2;
  const line = (yy: number) => {
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(P, yy + 0.5);
    ctx.lineTo(W - P, yy + 0.5);
    ctx.stroke();
  };
  if (!r.rows.length) {
    font(13);
    text("Нет данных за период", P + 12, y + 20, C.dim);
    y += rowH;
  }
  r.rows.forEach((row, i) => {
    if (i) line(y);
    const mid = y + 20;
    font(13, 500);
    text(clip(ctx, shortName(row.op.name) + (row.op.status === "fired" ? " (увол.)" : ""), cols[0].w - 24), cellX(0), mid);
    font(13, 400, mono);
    text(fmtNum(row.hours, 0), cellX(1), mid, row.hours ? C.text : C.dim, "right");
    font(13, 600, mono);
    text(fmtInt(row.leads), cellX(2), mid, C.text, "right");
    font(13, 400, mono);
    text(row.plan > 0 ? fmtNum(row.plan, row.plan < 10 ? 1 : 0) : "—", cellX(3), mid, C.sub, "right");
    font(13, 600, mono);
    text(pct(row.pct), cellX(4), mid, toneOf(row.pct), "right");
    font(13, 400, mono);
    text(row.conv == null ? "—" : `${Math.round(row.conv * 100)}%`, cellX(5), mid, row.conv == null ? C.dim : row.conv >= r.convNorm ? C.green : C.red, "right");
    text(row.failed ? fmtInt(row.failed) : "—", cellX(6), mid, row.failed ? C.red : C.dim, "right");
    y += rowH;
  });
  // итого
  roundRect(ctx, P, y + 2, W - P * 2, rowH, 8, C.strip);
  const mid = y + 22;
  font(13, 700);
  text(`Итого · ${r.rows.length}`, cellX(0), mid);
  font(13, 700, mono);
  text(fmtNum(r.total.hours, 0), cellX(1), mid, C.text, "right");
  text(fmtInt(r.total.leads), cellX(2), mid, C.text, "right");
  text(r.total.plan > 0 ? fmtNum(r.total.plan, 0) : "—", cellX(3), mid, C.sub, "right");
  text(pct(r.total.pct), cellX(4), mid, toneOf(r.total.pct), "right");
  text(r.total.conv == null ? "—" : `${Math.round(r.total.conv * 100)}%`, cellX(5), mid, C.text, "right");
  text(r.total.failed ? fmtInt(r.total.failed) : "—", cellX(6), mid, r.total.failed ? C.red : C.dim, "right");
  y += rowH + 10;

  // ── на что обратить внимание ──
  if (attn.length) {
    y += 20;
    font(14, 600);
    text("На что обратить внимание", P, y + 14);
    y += 34;
    attn.forEach((a, i) => {
      font(13);
      const lines = wrap(ctx, a.items.join(", "), W - P * 2 - 32);
      const h = 24 + lines.length * 19;
      roundRect(ctx, P, y - 6, W - P * 2, h + 6, 8, a.bg);
      font(12.5, 600);
      text(`${a.title} · ${a.items.length}`, P + 16, y + 12, a.tone);
      font(13);
      lines.forEach((l, k) => text(l, P + 16, y + 32 + k * 19, C.text));
      y += h + 12;
      void i;
    });
  }

  // ── события: приём, увольнение, стажировка — отдельно от цифр отчёта ──
  if (r.events.length) {
    y += 20;
    font(14, 600);
    text("События", P, y + 14);
    y += 34;
    const hue = { hired: C.brand, passed: C.green, fired: C.red } as const;
    const label = { hired: "Приём", passed: "Стажировка", fired: "Увольнение" } as const;
    r.events.forEach((e, i) => {
      if (i) {
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(P, y - 8.5);
        ctx.lineTo(W - P, y - 8.5);
        ctx.stroke();
      }
      ctx.fillStyle = hue[e.kind];
      ctx.beginPath();
      ctx.arc(P + 5, y + 5, 4, 0, Math.PI * 2);
      ctx.fill();
      font(12.5, 600);
      text(label[e.kind], P + 18, y + 10, hue[e.kind]);
      font(12.5, 400, mono);
      text(`${e.day.slice(8, 10)}.${e.day.slice(5, 7)}`, P + 118, y + 10, C.sub);
      font(13, 500);
      const who = shortName(e.name);
      text(who, P + 170, y + 10, C.text);
      const ww = ctx.measureText(who).width;
      font(12.5);
      text(clip(ctx, e.note, W - P - (P + 170 + ww + 12)), P + 170 + ww + 12, y + 10, C.sub);
      y += EV_ROW;
    });
  }

  // ── подвал ──
  font(11.5);
  text("Лиды «не доведён» в факт не входят · конверсия = лиды ÷ часы · план — по рабочим дням месяца", P, H - P + 8, C.dim);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  if (h <= 0 || w <= 0) return;
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Обрезать строку по ширине с многоточием. */
function clip(ctx: CanvasRenderingContext2D, s: string, max: number): string {
  if (ctx.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

/** Перенос по словам. */
function wrap(ctx: CanvasRenderingContext2D, s: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const w of s.split(" ")) {
    const next = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(next).width > max && cur) {
      out.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}
