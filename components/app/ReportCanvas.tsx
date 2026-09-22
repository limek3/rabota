"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { Report } from "@/lib/crm/report";
import { fmtDate, fmtDay, fmtDayShort, fmtMonth, fmtWeekday } from "@/lib/crm/dates";
import { fmtInt, fmtNum } from "@/lib/crm/format";

/**
 * Отчёт картинкой: рисуем на canvas сами, без библиотек — поэтому то, что видно
 * на странице, один в один уходит в PNG (скачать / скопировать в чат). Всегда
 * светлая палитра: картинку смотрят в мессенджере, а не в теме CRM.
 */

export interface ReportCanvasHandle {
  toBlob: () => Promise<Blob | null>;
  toDataURL: () => string;
}

const W = 960; // ширина картинки, CSS-пикселей
const P = 36; // поля
const SCALE = 2; // чёткость для экранов с плотными пикселями

const C = {
  bg: "#ffffff",
  text: "#37352f",
  sub: "#787774",
  dim: "#9b9a97",
  line: "#ecebea",
  strip: "#f7f7f5",
  brand: "#7b4ff0",
  brandSoft: "#e9e1fd",
  green: "#2e8a57",
  greenBg: "#e8f4ec",
  red: "#c94a48",
  redBg: "#fbeaea",
  amber: "#b7791f",
  amberBg: "#fbf3e1",
};

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const toneOf = (v: number | null) => (v == null ? C.text : v >= 1 ? C.green : v >= 0.8 ? C.amber : C.red);

export const ReportCanvas = forwardRef<ReportCanvasHandle, { report: Report; company: string }>(function ReportCanvas({ report, company }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);

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
      if (alive && cv.current) draw(cv.current, report, company, sans, mono);
    });
    return () => {
      alive = false;
    };
  }, [report, company]);

  return <canvas ref={cv} style={{ width: "100%", maxWidth: W, height: "auto", display: "block", borderRadius: 12, boxShadow: "var(--shadow-sm)", border: "1px solid var(--ink-07)" }} />;
});

function draw(canvas: HTMLCanvasElement, r: Report, company: string, sans: string, mono: string) {
  const week = r.kind === "week";
  const rowH = 30;
  const attn = [
    r.attention.noShift.length ? { title: "Нет смены в графике", tone: C.amber, bg: C.amberBg, items: r.attention.noShift } : null,
    r.attention.noLeads.length ? { title: "На смене, но без лидов", tone: C.red, bg: C.redBg, items: r.attention.noLeads } : null,
    r.attention.lowConv.length
      ? { title: `Конверсия ниже нормы ${Math.round(r.convNorm * 100)}%`, tone: C.red, bg: C.redBg, items: r.attention.lowConv.map((x) => `${x.name} — ${Math.round(x.conv * 100)}%`) }
      : null,
  ].filter(Boolean) as { title: string; tone: string; bg: string; items: string[] }[];

  // ── раскладка по высоте ──
  const hHeader = 78;
  const hTiles = 96;
  const hChart = week ? 190 : 0;
  // заголовок блока + шапка таблицы + строки + итого
  const hTable = 26 + (rowH + 2) + rowH * Math.max(1, r.rows.length) + rowH + 14;
  const ctx0 = document.createElement("canvas").getContext("2d")!;
  ctx0.font = `13px ${sans}`;
  const attnLines = attn.map((a) => wrap(ctx0, a.items.join(", "), W - P * 2 - 32).length);
  const hAttn = attn.length ? 34 + attnLines.reduce((s, n) => s + 24 + n * 19 + 12, 0) : 0;
  const hFoot = 44;
  const H = P + hHeader + hTiles + 8 + hChart + hTable + (hAttn ? 20 + hAttn : 0) + hFoot;

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
  const now = new Date();
  text(`сформирован ${fmtDate(now.toISOString().slice(0, 10))} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`, W - P, y + 66, C.dim, "right");
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
    const top = y + 30;
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
      if (d.plan > 0) {
        const py = top + ch - (d.plan / max) * ch;
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
      if (!future) text(fmtInt(d.leads), cx + cw / 2, top + ch - bh - 6, C.text, "center");
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
    text(clip(ctx, row.op.name + (row.op.status === "fired" ? " (увол.)" : ""), cols[0].w - 24), cellX(0), mid);
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
