"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Report, ReportGroup, ReportRow } from "@/lib/crm/report";
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

/** Светлая — поверхности и акценты светлой темы CRM (app/theme.css). */
export const LIGHT = {
  bg: "#ffffff",
  text: "#17152b",
  sub: "#5e5b74",
  dim: "#8c89a0",
  line: "#e7e6ef",
  strip: "#f8f8fb",
  brand: "#6a45f5",
  brandSoft: "#f1edff",
  green: "#0f7a48",
  greenBg: "#e7f6ee",
  red: "#cc2f47",
  redBg: "#fdecef",
  amber: "#9c5800",
  amberBg: "#fff4e2",
};

/** Тёмная — те же поверхности и акценты, что у тёмной темы CRM (app/theme.css). */
export const DARK: typeof LIGHT = {
  bg: "#191823",
  text: "#edecf4",
  sub: "#a3a1b6",
  dim: "#737188",
  line: "#282736",
  strip: "#1e1d2a",
  brand: "#a993ff",
  brandSoft: "#251d44",
  green: "#4ccf8c",
  greenBg: "#122e1f",
  red: "#ff7184",
  redBg: "#3a1820",
  amber: "#f2b146",
  amberBg: "#33270f",
};

export type Palette = typeof LIGHT;

/** Тема CRM сейчас: следим за data-theme на <html>, чтобы перерисовать при переключении. */
export function useDarkTheme(): boolean {
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

type ColKey = "name" | "people" | "shifts" | "hours" | "leads" | "plan" | "pct" | "rr" | "rrFull" | "conv" | "failed";
/** Значения строки таблицы — оператора, группы или итога. */
interface Vals {
  name: string;
  people?: number;
  shifts?: number;
  hours: number;
  leads: number;
  plan: number;
  pct: number | null;
  rr?: number;
  rrPct?: number | null;
  conv: number | null;
  failed: number;
}

/** Цвет метки группы — тот же токен чипа, что в CRM (--c-<цвет>-fg). */
function cssHue(color: string, C: Palette): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--c-${color}-fg`).trim();
  return v || C.sub;
}

/** «Лучшие месяца»: больше всех лидов, лучшая конверсия (от 16 ч), выше всех к плану — по три места. */
function bestOf(r: Report): { title: string; items: { name: string; value: string }[] }[] {
  const live = r.rows.filter((x) => x.op.status !== "fired" && !x.op.deletedAt && !x.sv);
  const top = <T,>(list: T[], by: (x: T) => number) => [...list].sort((a, b) => by(b) - by(a)).slice(0, 3);
  return [
    { title: "Больше всех лидов", items: top(live.filter((x) => x.leads > 0), (x) => x.leads).map((x) => ({ name: x.op.name, value: fmtInt(x.leads) })) },
    { title: "Лучшая конверсия", items: top(live.filter((x) => x.conv != null && x.hours >= 16), (x) => x.conv ?? 0).map((x) => ({ name: x.op.name, value: pct(x.conv) })) },
    { title: "Выше всех к плану", items: top(live.filter((x) => x.pct != null && x.plan >= 1), (x) => x.pct ?? 0).map((x) => ({ name: x.op.name, value: pct(x.pct) })) },
  ];
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
      if (alive && cv.current) draw(cv.current, report, company, sans, mono, dark ? DARK : LIGHT, (c) => cssHue(c, dark ? DARK : LIGHT));
    });
    return () => {
      alive = false;
    };
  }, [report, company, dark]);

  return <canvas ref={cv} style={{ width: "100%", maxWidth: W, height: "auto", display: "block", borderRadius: 10, boxShadow: "var(--shadow-sm)", border: "1px solid var(--ink-07)" }} />;
});

function draw(canvas: HTMLCanvasElement, r: Report, company: string, sans: string, mono: string, C: Palette, hue: (color: string) => string) {
  const toneOf = (v: number | null) => (v == null ? C.text : v >= 1 ? C.green : v >= 0.8 ? C.amber : C.red);
  const week = r.kind === "week";
  const month = r.kind === "month";
  // месяц идёт: план и % — к сегодняшнему дню, прогноз — к концу месяца
  const open = r.factTo < r.to;
  const rowH = 30;
  const attn = [
    r.attention.noLeads.length ? { title: "На смене, но без лидов", tone: C.red, bg: C.redBg, items: r.attention.noLeads.map(shortName) } : null,
    r.attention.lagging.length
      ? { title: open ? "Отстают от плана на сегодня" : "Не выполнили план", tone: C.amber, bg: C.amberBg, items: r.attention.lagging.map((x) => `${shortName(x.name)} — ${Math.round(x.pct * 100)}%`) }
      : null,
    r.attention.lowConv.length
      ? { title: `Конверсия ниже нормы ${Math.round(r.convNorm * 100)}%`, tone: C.red, bg: C.redBg, items: r.attention.lowConv.map((x) => `${shortName(x.name)} — ${Math.round(x.conv * 100)}%`) }
      : null,
  ].filter(Boolean) as { title: string; tone: string; bg: string; items: string[] }[];

  // месяц: таблица операторов разбита по группам, если их в отчёте больше одной
  const grouped = month && r.groups.length > 1;
  // лучшие месяца: три колонки по три места
  const best = month ? bestOf(r) : [];

  // ── раскладка по высоте ──
  const hHeader = 78;
  const hTiles = 96;
  // заголовок, полоса под подписи столбиков, столбики, подписи дней
  const hChart = week ? 208 : month ? 214 : 0;
  // группы: заголовок блока + шапка + строки
  const hGroups = grouped ? 26 + (rowH + 2) + rowH * r.groups.length + 26 : 0;
  // заголовок блока + шапка таблицы + строки (+ строки групп) + итого
  const hTable = 26 + (rowH + 2) + rowH * Math.max(1, r.rows.length + (grouped ? r.groups.length : 0)) + rowH + 14;
  const BEST_ROW = 21;
  const hBest = best.length ? 20 + 34 + 30 + 3 * BEST_ROW + 12 : 0;
  const ctx0 = document.createElement("canvas").getContext("2d")!;
  ctx0.font = `13px ${sans}`;
  const attnLines = attn.map((a) => wrap(ctx0, a.items.join(", "), W - P * 2 - 32).length);
  const hAttn = attn.length ? 34 + attnLines.reduce((s, n) => s + 24 + n * 19 + 12, 0) : 0;
  // кадровые события — строкой на событие: заголовок блока + строки
  const EV_ROW = 26;
  const hEvents = r.events.length ? 34 + r.events.length * EV_ROW + 6 : 0;
  const hFoot = 44;
  const H = P + hHeader + hTiles + 8 + hChart + hGroups + hTable + hBest + (hAttn ? 20 + hAttn : 0) + (hEvents ? 20 + hEvents : 0) + hFoot;

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
  const period = month
    ? `Отчёт за месяц · ${fmtMonth(r.month.month)}`
    : week
      ? `Отчёт за неделю · ${fmtDayShort(r.from)} – ${fmtDay(r.to, true)}`
      : `Отчёт за день · ${fmtDay(r.from, true)}, ${fmtWeekday(r.from)}`;
  text(period, P, y + 44);
  font(13);
  const note = (week || month) && open ? ` · ${month ? "месяц" : "неделя"} идёт, данные по ${fmtDate(r.factTo)}` : "";
  text(`${r.scope}${note}`, P, y + 66, C.sub);
  text(`сформирован ${fmtStamp(nowStamp())}`, W - P, y + 66, C.dim, "right");
  y += hHeader;

  // ── плитки ──
  const shifts = r.rows.reduce((a, x) => a + x.shifts, 0);
  const monthTiles: { label: string; value: string; sub: string; tone?: string }[] = [
    {
      label: "Лидов за месяц",
      value: fmtInt(r.total.leads),
      sub: r.total.plan > 0 ? `${open ? `план к ${r.factTo.slice(8, 10)}.${r.factTo.slice(5, 7)}` : "план"} ${fmtNum(r.total.plan, 0)} · ${pct(r.total.pct)}` : "план не задан",
      tone: toneOf(r.total.pct),
    },
    open
      ? { label: "Прогноз к концу месяца", value: fmtInt(Math.round(r.month.rr)), sub: r.month.plan > 0 ? `${pct(r.month.rrPct)} плана ${fmtInt(r.month.plan)}` : "план не задан", tone: r.month.plan > 0 ? toneOf(r.month.rrPct) : undefined }
      : { label: "План месяца", value: r.month.plan > 0 ? pct(r.month.fact / r.month.plan) : "—", sub: r.month.plan > 0 ? `${fmtInt(r.month.fact)} из ${fmtInt(r.month.plan)}` : "план не задан", tone: r.month.plan > 0 ? toneOf(r.month.fact / r.month.plan) : undefined },
    { label: "Доведено / не доведено", value: `${fmtInt(r.total.done)} / ${fmtInt(r.total.failed)}`, sub: `в работе ${fmtInt(r.total.work)}` },
    { label: "Часы", value: fmtInt(Math.round(r.total.hours)), sub: `${fmtInt(r.total.people)} чел. · ${fmtInt(shifts)} смен` },
    {
      label: "Конверсия",
      value: r.total.conv == null ? "—" : `${Math.round(r.total.conv * 100)}%`,
      sub: `норма ${Math.round(r.convNorm * 100)}%`,
      tone: r.total.conv == null ? undefined : r.total.conv >= r.convNorm ? C.green : C.red,
    },
  ];
  const tiles: { label: string; value: string; sub: string; tone?: string }[] = month ? monthTiles : [
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

  // ── неделя и месяц: столбики по дням ──
  if (week || month) {
    font(14, 600);
    text("Лиды по дням", P, y + 14);
    font(11.5);
    const bd = month && r.bestDay ? ` · лучший день ${r.bestDay.day.slice(8, 10)}.${r.bestDay.day.slice(5, 7)} — ${fmtInt(r.bestDay.leads)}` : "";
    text(`пунктир — план дня${bd}`, W - P, y + 14, C.dim, "right");
    // сверху — полоса под цифру самого высокого столбика, чтобы она не налезала на заголовок
    const top = y + 48;
    const ch = month ? 116 : 110;
    const max = Math.max(1, ...r.byDay.map((d) => Math.max(d.leads, d.plan)));
    const cw = (W - P * 2) / r.byDay.length;
    r.byDay.forEach((d, i) => {
      const cx = P + i * cw;
      // месяц — до 31 столбика: узкие, с зазором, чтобы ряд читался по дням
      const bw = month ? Math.max(6, cw - 9) : Math.min(56, cw - 24);
      const bx = cx + (cw - bw) / 2;
      const bh = (d.leads / max) * ch;
      const future = d.day > r.factTo;
      roundRect(ctx, bx, top + ch - bh, bw, Math.max(bh, d.leads ? 3 : 0), month ? 3 : 5, d.plan > 0 && d.leads >= d.plan ? C.brand : C.brandSoft);
      const py = d.plan > 0 ? top + ch - (d.plan / max) * ch : null;
      if (py != null) {
        const ext = month ? 2 : 6;
        ctx.strokeStyle = C.sub;
        ctx.setLineDash(month ? [3, 2] : [4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(bx - ext, py);
        ctx.lineTo(bx + bw + ext, py);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      font(month ? 10.5 : 13, 600, mono);
      // цифра над столбиком; если там же проходит пунктир плана — поднимаем её над пунктиром
      let ly = top + ch - bh - (month ? 5 : 6);
      if (py != null && py > ly - 14 && py < ly + 4) ly = py - 5;
      if (!future && (!month || d.leads > 0)) text(fmtInt(d.leads), cx + cw / 2, ly, C.text, "center");
      if (month) {
        const off = fmtWeekday(d.day) === "сб" || fmtWeekday(d.day) === "вс";
        font(11, 500, mono);
        text(String(Number(d.day.slice(8))), cx + cw / 2, top + ch + 16, future || off ? C.dim : C.sub, "center");
        font(9.5);
        text(fmtWeekday(d.day), cx + cw / 2, top + ch + 29, off ? C.amber : C.dim, "center");
      } else {
        font(11.5);
        text(`${fmtWeekday(d.day)} ${d.day.slice(8, 10)}.${d.day.slice(5, 7)}`, cx + cw / 2, top + ch + 18, future ? C.dim : C.sub, "center");
      }
    });
    ctx.strokeStyle = C.line;
    ctx.beginPath();
    ctx.moveTo(P, top + ch + 0.5);
    ctx.lineTo(W - P, top + ch + 0.5);
    ctx.stroke();
    y += hChart;
  }

  // ── таблицы: столбцы по ключам — у дня и недели свой набор, у месяца свой ──
  type Col = { k: ColKey; title: string; w: number };
  const R_ = "right" as CanvasTextAlign;
  const layout = (cols: Col[]) => {
    cols[0].w = W - P * 2 - cols.slice(1).reduce((s, c) => s + c.w, 0);
    const xs: number[] = [];
    cols.reduce((x, c) => (xs.push(x), x + c.w), P);
    return (i: number) => (i === 0 ? xs[0] + 12 : xs[i] + cols[i].w - 12);
  };
  const line = (yy: number) => {
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(P, yy + 0.5);
    ctx.lineTo(W - P, yy + 0.5);
    ctx.stroke();
  };
  const head = (cols: Col[], cellX: (i: number) => number) => {
    roundRect(ctx, P, y, W - P * 2, rowH + 2, 8, C.strip);
    font(12, 600);
    cols.forEach((c, i) => text(c.title, cellX(i), y + 20, C.sub, i === 0 ? "left" : R_));
    y += rowH + 2;
  };
  /** Строка таблицы; bold — строка группы или итог. dot — цвет метки группы. */
  const drawRow = (cols: Col[], cellX: (i: number) => number, v: Vals, mid: number, bold = false, dot?: string) => {
    const w = bold ? 700 : 400;
    cols.forEach((c, i) => {
      const x = cellX(i);
      switch (c.k) {
        case "name": {
          font(13, bold ? 700 : 500);
          let nx = x;
          if (dot) {
            roundRect(ctx, x, mid - 9, 9, 9, 3, dot);
            nx += 16;
          }
          text(clip(ctx, v.name, c.w - 24 - (nx - x)), nx, mid);
          break;
        }
        case "people":
        case "shifts": {
          const n = c.k === "people" ? v.people : v.shifts;
          font(13, w, mono);
          text(n ? fmtInt(n) : "—", x, mid, n ? C.sub : C.dim, R_);
          break;
        }
        case "hours":
          font(13, w, mono);
          text(fmtNum(v.hours, 0), x, mid, v.hours ? C.text : C.dim, R_);
          break;
        case "leads":
          font(13, bold ? 700 : 600, mono);
          text(fmtInt(v.leads), x, mid, C.text, R_);
          break;
        case "plan":
          font(13, w, mono);
          text(v.plan > 0 ? fmtNum(v.plan, v.plan < 10 ? 1 : 0) : "—", x, mid, C.sub, R_);
          break;
        case "pct":
          font(13, bold ? 700 : 600, mono);
          text(pct(v.pct), x, mid, toneOf(v.pct), R_);
          break;
        case "rr":
          font(13, w, mono);
          text(v.rr ? fmtInt(Math.round(v.rr)) : "—", x, mid, v.rrPct == null ? (v.rr ? C.text : C.dim) : toneOf(v.rrPct), R_);
          break;
        case "rrFull":
          font(13, w, mono);
          text(v.rr ? `${fmtInt(Math.round(v.rr))}${v.rrPct != null ? ` · ${pct(v.rrPct)}` : ""}` : "—", x, mid, v.rrPct == null ? C.text : toneOf(v.rrPct), R_);
          break;
        case "conv":
          font(13, w, mono);
          text(v.conv == null ? "—" : `${Math.round(v.conv * 100)}%`, x, mid, v.conv == null ? C.dim : bold && !month ? C.text : v.conv >= r.convNorm ? C.green : C.red, R_);
          break;
        case "failed":
          font(13, w, mono);
          text(v.failed ? fmtInt(v.failed) : "—", x, mid, v.failed ? C.red : C.dim, R_);
          break;
      }
    });
  };
  const opVals = (row: ReportRow): Vals => ({
    name: shortName(row.op.name) + (row.op.status === "fired" ? " (увол.)" : ""),
    shifts: row.shifts,
    hours: row.hours,
    leads: row.leads,
    plan: row.plan,
    pct: row.pct,
    rr: row.rr,
    rrPct: row.monthPlan > 0 ? row.rr / row.monthPlan : null,
    conv: row.conv,
    failed: row.failed,
  });
  const groupVals = (g: ReportGroup): Vals => ({
    name: g.name,
    people: g.people,
    shifts: g.rows.reduce((a, x) => a + x.shifts, 0),
    hours: g.hours,
    leads: g.leads,
    plan: g.plan,
    pct: g.pct,
    rr: g.rr,
    rrPct: g.rrPct,
    conv: g.conv,
    failed: g.failed,
  });

  // ── месяц: группы ──
  if (grouped) {
    font(14, 600);
    text("Группы", P, y + 14);
    y += 26;
    const gc: Col[] = [
      { k: "name", title: "Группа", w: 0 },
      { k: "people", title: "Чел.", w: 56 },
      { k: "hours", title: "Часы", w: 68 },
      { k: "leads", title: "Лиды", w: 68 },
      { k: "plan", title: open ? "План к дате" : "План", w: 96 },
      { k: "pct", title: "% плана", w: 80 },
      ...(open ? [{ k: "rrFull" as ColKey, title: "Прогноз", w: 116 }] : []),
      { k: "conv", title: "Конверсия", w: 92 },
      { k: "failed", title: "Не доведено", w: 104 },
    ];
    const gx = layout(gc);
    head(gc, gx);
    r.groups.forEach((g, i) => {
      if (i) line(y);
      drawRow(gc, gx, groupVals(g), y + 20, false, hue(g.color));
      y += rowH;
    });
    y += 26;
  }

  // ── операторы ──
  font(14, 600);
  text("Операторы", P, y + 14);
  y += 26;
  const cols: Col[] = month
    ? [
        { k: "name", title: "Оператор", w: 0 },
        { k: "shifts", title: "Смен", w: 60 },
        { k: "hours", title: "Часы", w: 66 },
        { k: "leads", title: "Лиды", w: 66 },
        { k: "plan", title: "План", w: 66 },
        { k: "pct", title: "% плана", w: 80 },
        ...(open ? [{ k: "rr" as ColKey, title: "Прогноз", w: 84 }] : []),
        { k: "conv", title: "Конверсия", w: 92 },
        { k: "failed", title: "Не доведено", w: 104 },
      ]
    : [
        { k: "name", title: "Оператор", w: 0 },
        { k: "hours", title: "Часы", w: 70 },
        { k: "leads", title: "Лиды", w: 70 },
        { k: "plan", title: "План", w: 70 },
        { k: "pct", title: "% плана", w: 80 },
        { k: "conv", title: "Конверсия", w: 92 },
        { k: "failed", title: "Не доведено", w: 104 },
      ];
  const cellX = layout(cols);
  head(cols, cellX);
  if (!r.rows.length) {
    font(13);
    text("Нет данных за период", P + 12, y + 20, C.dim);
    y += rowH;
  }
  if (grouped) {
    // строка группы — с её итогами, под ней операторы группы
    r.groups.forEach((g) => {
      roundRect(ctx, P, y + 1, W - P * 2, rowH - 2, 6, C.strip);
      drawRow(cols, cellX, { ...groupVals(g), name: `${g.name} · ${g.rows.length}` }, y + 20, true, hue(g.color));
      y += rowH;
      g.rows.forEach((row, i) => {
        if (i) line(y);
        drawRow(cols, cellX, opVals(row), y + 20);
        y += rowH;
      });
    });
  } else
    r.rows.forEach((row, i) => {
      if (i) line(y);
      drawRow(cols, cellX, opVals(row), y + 20);
      y += rowH;
    });
  // итого
  roundRect(ctx, P, y + 2, W - P * 2, rowH, 8, C.strip);
  drawRow(
    cols,
    cellX,
    {
      name: `Итого · ${r.rows.length}`,
      shifts,
      hours: r.total.hours,
      leads: r.total.leads,
      plan: r.total.plan,
      pct: r.total.pct,
      rr: r.month.rr,
      rrPct: r.month.plan > 0 ? r.month.rrPct : null,
      conv: r.total.conv,
      failed: r.total.failed,
    },
    y + 22,
    true,
  );
  y += rowH + 10;

  // ── месяц: лучшие ──
  if (best.length) {
    y += 20;
    font(14, 600);
    text("Лучшие месяца", P, y + 14);
    y += 34;
    const gapB = 10;
    const bw = (W - P * 2 - gapB * (best.length - 1)) / best.length;
    const bh = 30 + 3 * BEST_ROW + 6;
    best.forEach((b, i) => {
      const x = P + i * (bw + gapB);
      roundRect(ctx, x, y, bw, bh, 10, C.strip);
      font(12, 600);
      text(b.title, x + 14, y + 21, C.sub);
      b.items.forEach((it, k) => {
        const ly = y + 30 + (k + 1) * BEST_ROW - 4;
        font(12, 600, mono);
        text(String(k + 1), x + 14, ly, k === 0 ? C.green : C.dim);
        font(13, k === 0 ? 600 : 500);
        const val = it.value;
        font(13, 600, mono);
        const vw = ctx.measureText(val).width;
        text(val, x + bw - 14, ly, k === 0 ? C.green : C.text, "right");
        font(13, k === 0 ? 600 : 500);
        text(clip(ctx, shortName(it.name), bw - 14 - 30 - vw - 12), x + 30, ly, C.text);
      });
      if (!b.items.length) {
        font(12.5);
        text("пока некого отметить", x + 14, y + 30 + BEST_ROW - 4, C.dim);
      }
    });
    y += bh + 6;
  }

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
  text(`Лиды «не доведён» — в факте, но не в зарплате · конверсия = лиды ÷ часы · план — по рабочим дням месяца${month && open ? " · прогноз — по темпу" : ""}`, P, H - P + 8, C.dim);
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
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
export function clip(ctx: CanvasRenderingContext2D, s: string, max: number): string {
  if (ctx.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

/** Перенос по словам. */
export function wrap(ctx: CanvasRenderingContext2D, s: string, max: number): string[] {
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
