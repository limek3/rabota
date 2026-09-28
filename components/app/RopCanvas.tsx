"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { CitySeg, RopReport } from "@/lib/crm/rop";
import { fmtStamp, fmtWeekday, nowStamp } from "@/lib/crm/dates";
import { fmtInt, fmtNum } from "@/lib/crm/format";
import { DARK, LIGHT, clip, roundRect, useDarkTheme, wrap, type Palette, type ReportCanvasHandle } from "./ReportCanvas";

/**
 * Отчёт РОП картинкой — тем же способом, что отчёт супервайзера (ReportCanvas):
 * рисуем сами на canvas, и то, что на экране, один в один уходит в PNG.
 * Рисуем дважды: сначала на черновом холсте — узнать высоту, потом начисто.
 *
 * Вид — по согласованному макету: заголовки разделов с иконками, плитки денег,
 * статьи расходов, полоса сегментов, группы с пометкой направления, супервайзеры,
 * полосы грейда KPI с засечками ступеней. Цифры — обычным шрифтом, не моноширинным.
 */

const W = 960;
const P = 36;
const SCALE = 2;
const ROW = 38;

/** Иконки разделов — контуры Tabler (24×24, обводка 2), рисуются через Path2D. */
const ICONS: Record<string, string[]> = {
  coin: ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0", "M14.8 9a2 2 0 0 0 -1.8 -1h-2a2 2 0 1 0 0 4h2a2 2 0 1 1 0 4h-2a2 2 0 0 1 -1.8 -1", "M12 7v10"],
  pin: ["M9 11a3 3 0 1 0 6 0a3 3 0 0 0 -6 0", "M17.657 16.657l-4.243 4.243a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z"],
  users: [
    "M10 13a2 2 0 1 0 4 0a2 2 0 0 0 -4 0",
    "M8 21v-1a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v1",
    "M15 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0",
    "M17 10h2a2 2 0 0 1 2 2v1",
    "M5 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0",
    "M3 13v-1a2 2 0 0 1 2 -2h2",
  ],
  star: [
    "M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0",
    "M6 21v-2a4 4 0 0 1 4 -4h.5",
    "M17.8 20.817l-2.172 1.138a.392 .392 0 0 1 -.568 -.41l.415 -2.411l-1.757 -1.707a.389 .389 0 0 1 .217 -.665l2.428 -.352l1.086 -2.193a.392 .392 0 0 1 .702 0l1.086 2.193l2.428 .352a.39 .39 0 0 1 .217 .665l-1.757 1.707l.414 2.41a.39 .39 0 0 1 -.567 .411l-2.172 -1.138z",
  ],
  trend: ["M3 17l6 -6l4 4l8 -8", "M14 7l7 0l0 7"],
};

/** Цвета макета: сегменты — светлые заливки с тёмным текстом в обеих темах; полосы KPI по ступени. */
const SEG: Record<CitySeg, [string, string]> = {
  msk: ["#CECBF6", "#3C3489"],
  reg: ["#FAC775", "#633806"],
  spb: ["#9FE1CB", "#085041"],
  none: ["#D3D1C7", "#444441"],
};
const KPI = { mid: "#7F77DD", top: "#1D9E75", low: "#E24B4A" };

export const RopCanvas = forwardRef<ReportCanvasHandle, { report: RopReport; company: string }>(function RopCanvas({ report, company }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  const dark = useDarkTheme();

  useImperativeHandle(ref, () => ({
    toBlob: () => new Promise((res) => (cv.current ? cv.current.toBlob((b) => res(b), "image/png") : res(null))),
    toDataURL: () => cv.current?.toDataURL("image/png") ?? "",
  }));

  useEffect(() => {
    let alive = true;
    // шрифт интерфейса без «VexaDigits»: в приложении цифры моноширинные, на картинке — как в макете, обычные
    const ui = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim();
    const sans = `${ui ? `${ui}, ` : ""}system-ui, "Segoe UI", sans-serif`;
    void document.fonts.ready.then(() => {
      if (!alive || !cv.current) return;
      const C = dark ? DARK : LIGHT;
      const draft = document.createElement("canvas");
      draft.width = W;
      draft.height = 10;
      const H = render(draft.getContext("2d")!, report, company, sans, C, dark, 0);
      const canvas = cv.current;
      canvas.width = W * SCALE;
      canvas.height = Math.ceil(H * SCALE);
      const ctx = canvas.getContext("2d")!;
      ctx.scale(SCALE, SCALE);
      render(ctx, report, company, sans, C, dark, H);
    });
    return () => {
      alive = false;
    };
  }, [report, company, dark]);

  return <canvas ref={cv} style={{ width: "100%", maxWidth: W, height: "auto", display: "block", borderRadius: 10, boxShadow: "var(--shadow-sm)", border: "1px solid var(--ink-07)" }} />;
});

/** Кусок строки: текст, цвет, жирность. Ячейка таблицы — один или несколько кусков подряд. */
type Part = { t: string; c?: string; w?: 400 | 500 | 600 };
type Cell = Part[];
type Col = { title: string; w: number };

/** 900 000 → «900 т.р.», 1 250 000 → «1,25 млн». */
const tr = (n: number) => {
  const a = Math.abs(Math.round(n));
  const sign = n < 0 ? "−" : "";
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} млн`;
  return a >= 1000 ? `${sign}${fmtInt(Math.round(a / 1000))} т.р.` : `${sign}${fmtInt(a)} р`;
};
const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
const MONTH_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const SEG_LABEL: Record<CitySeg, string> = { msk: "МСК", reg: "Регионы", spb: "СПб", none: "Без региона" };

/** Рисует отчёт и возвращает его высоту. H = 0 — черновой проход, только считаем. */
function render(ctx: CanvasRenderingContext2D, r: RopReport, company: string, sans: string, C: Palette, dark: boolean, H: number): number {
  const font = (size: number, weight = 400) => (ctx.font = `${weight} ${size}px ${sans}`);
  const text = (s: string, x: number, y: number, color = C.text, align: CanvasTextAlign = "left") => {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  };
  const widthOf = (ps: Part[], size: number) =>
    ps.reduce((sum, p) => {
      font(size, p.w ?? 400);
      return sum + ctx.measureText(p.t).width;
    }, 0);
  /** Несколько кусков в строку; align right — строка заканчивается в x. Возвращает x конца строки. */
  const parts = (ps: Part[], x: number, y: number, size: number, align: "left" | "right" = "left") => {
    let cx = align === "right" ? x - widthOf(ps, size) : x;
    for (const p of ps) {
      font(size, p.w ?? 400);
      text(p.t, cx, y, p.c ?? C.text);
      cx += ctx.measureText(p.t).width;
    }
    return cx;
  };
  const hline = (yy: number) => {
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(P, yy + 0.5);
    ctx.lineTo(W - P, yy + 0.5);
    ctx.stroke();
  };
  const icon = (name: string, x: number, y: number, size: number, color: string) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(size / 24, size / 24);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const d of ICONS[name]) ctx.stroke(new Path2D(d));
    ctx.restore();
  };
  if (H) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.textBaseline = "alphabetic";
  const strong = C.text;
  const muted = C.sub;
  const faint = C.dim;
  const pillBg = dark ? "#2c313b" : "#eef0f5";
  let y = P;

  const section = (ic: string, title: Part[]) => {
    y += 26;
    icon(ic, P, y, 16, muted);
    parts(title, P + 24, y + 13, 13.5);
    y += 26;
  };
  const note = (s: string) => {
    font(12);
    const lines = wrap(ctx, s, W - P * 2);
    lines.forEach((l, i) => text(l, P, y + 14 + i * 17, faint));
    y += 6 + lines.length * 17;
  };

  /** Таблица как в макете: шапка приглушённая, строки через тонкую линию, первый столбец — слева. */
  const table = (cols: Col[], rows: Cell[][], after?: (row: number, x: number, y: number) => void) => {
    const flex = W - P * 2 - cols.reduce((s, c) => s + c.w, 0);
    const ws = cols.map((c) => (c.w ? c.w : flex));
    const xs: number[] = [];
    ws.reduce((x, w) => (xs.push(x), x + w), P);
    const pad = 8;
    font(12.5);
    cols.forEach((c, i) => text(c.title, i === 0 ? xs[i] + pad : xs[i] + ws[i] - pad, y + 16, muted, i === 0 ? "left" : "right"));
    y += 26;
    hline(y);
    if (!rows.length) {
      font(14);
      text("Нет данных за период", P + pad, y + 25, faint);
      y += ROW;
      hline(y);
    }
    rows.forEach((row, k) => {
      let endX = 0;
      row.forEach((cell, i) => {
        if (i === 0) endX = parts(cell, xs[i] + pad, y + 25, 15, "left");
        else parts(cell, xs[i] + ws[i] - pad, y + 25, 15, "right");
      });
      after?.(k, endX, y);
      y += ROW;
      hline(y);
    });
  };

  // ── шапка ──
  const period = r.kind === "week" ? `неделя ${r.from.slice(8, 10)}–${dm(r.to)}` : `${dm(r.from)}, ${fmtWeekday(r.from)}`;
  font(22, 600);
  text(`Отчёт РОП · ${period}`, P, y + 22);
  font(12.5, 500);
  text(company.toUpperCase(), W - P, y + 18, faint, "right");
  const sub: Part[] = [{ t: "Весь отдел · ", c: muted }];
  if (r.costTo) sub.push({ t: "факт по ", c: muted }, { t: dm(r.costTo), c: strong, w: 600 }, { t: " закрытый день", c: muted });
  else sub.push({ t: "день ещё не закрыт — часы и затраты появятся после закрытия", c: muted });
  if (r.costTo && r.factTo > r.costTo) sub.push({ t: ` · лиды по ${dm(r.factTo)}`, c: muted });
  parts(sub, P, y + 44, 13.5);
  font(12);
  text(`сформирован ${fmtStamp(nowStamp())}`, W - P, y + 44, faint, "right");
  y += 46;

  // ── деньги ──
  section("coin", [{ t: "Деньги", c: muted, w: 500 }]);
  const m = r.money;
  const tiles = [
    { label: "Выручка", value: tr(m.revenue) },
    { label: "Расходы", value: tr(m.total) },
    { label: "Прибыль", value: tr(m.profit), tone: m.profit >= 0 ? C.green : C.red },
    { label: "% расхода", value: pct(m.pct), tone: m.pct != null && m.pct > 1 ? C.red : undefined },
  ];
  const gap = 10;
  const tw = (W - P * 2 - gap * 3) / 4;
  tiles.forEach((t, i) => {
    const x = P + i * (tw + gap);
    roundRect(ctx, x, y, tw, 74, 10, C.strip);
    font(13);
    text(t.label, x + 14, y + 25, muted);
    font(25, 600);
    text(clip(ctx, t.value, tw - 28), x + 14, y + 57, t.tone ?? strong);
  });
  y += 84;
  const share = (v: number): Part[] => [{ t: pct(m.revenue > 0 ? v / m.revenue : null), w: 600 }];
  const unset: Part[] = [{ t: "не задано", c: C.amber, w: 500 }];
  const costRows: Cell[][] = [[[{ t: "Операторы (часы + бонусы)", w: 500 }], [{ t: tr(m.operators), w: 600 }], share(m.operators)]];
  if (m.supervisors) costRows.push([[{ t: "Супервайзеры", w: 500 }, { t: " ~ оклад и бонус", c: faint }], [{ t: tr(m.supervisors), w: 600 }], share(m.supervisors)]);
  costRows.push([[{ t: "Связь", w: 500 }, { t: " ~ примерно", c: faint }], m.telecom ? [{ t: `~${tr(m.telecom)}`, w: 600 }] : unset, share(m.telecom)]);
  costRows.push([[{ t: "Общие", w: 500 }, { t: " ~ аренда, софт, прочее", c: faint }], m.overhead ? [{ t: `~${tr(m.overhead)}`, w: 600 }] : unset, share(m.overhead)]);
  table([{ title: "Статья", w: 0 }, { title: "Сумма", w: 200 }, { title: "% выручки", w: 170 }], costRows);

  // ── лиды по сегментам ──
  section("pin", [
    { t: "Лиды: ", c: muted, w: 500 },
    { t: fmtInt(r.leads.total), c: strong, w: 600 },
    { t: " · по сегментам", c: muted, w: 500 },
  ]);
  const segs = (["msk", "reg", "spb"] as CitySeg[]).filter((k) => r.segments[k] > 0);
  const segSum = segs.reduce((s, k) => s + r.segments[k], 0);
  const bw = W - P * 2;
  const bh = 26;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(P, y, bw, bh, 7);
  ctx.clip();
  if (segSum > 0) {
    let x = P;
    segs.forEach((k) => {
      const w = (r.segments[k] / segSum) * bw;
      ctx.fillStyle = SEG[k][0];
      ctx.fillRect(x, y, w + 0.5, bh);
      const label: Part[] = [{ t: `${SEG_LABEL[k]} `, c: SEG[k][1] }, { t: fmtInt(r.segments[k]), c: SEG[k][1], w: 600 }];
      if (widthOf(label, 13) < w - 14) parts(label, x + 9, y + 17.5, 13);
      else if (widthOf(label.slice(1), 13) < w - 8) parts(label.slice(1), x + 4, y + 17.5, 13);
      x += w;
    });
  } else {
    // город у лидов не указан — полоса одним цветом: видно, что делить не из чего
    ctx.fillStyle = SEG.none[0];
    ctx.fillRect(P, y, bw, bh);
    parts([{ t: "Без региона ", c: SEG.none[1] }, { t: fmtInt(r.segments.none), c: SEG.none[1], w: 600 }], P + 9, y + 17.5, 13);
  }
  ctx.restore();
  y += bh + 2;
  const notes: string[] = [];
  const none = r.segments.none;
  if (segSum > 0 && none) notes.push(`${fmtInt(none)} ${none % 10 === 1 && none % 100 !== 11 ? "лид" : none % 10 >= 2 && none % 10 <= 4 && (none % 100 < 12 || none % 100 > 14) ? "лида" : "лидов"} без региона — не попали в сегменты`);
  if (segSum === 0 && r.leads.total) notes.push("у лидов не указан город — заполните регион в карточке лида, и появится деление МСК / Регионы / СПб");
  if (r.leads.re && r.leads.auto) notes.push(`недвижимость ${fmtInt(r.leads.re)}, авто ${fmtInt(r.leads.auto)}`);
  if (r.leads.failed) notes.push(`не доведено ${fmtInt(r.leads.failed)} — в факт не входят`);
  if (notes.length) note(notes.join(" · "));

  // ── группы ──
  section("users", [{ t: "Группы · себестоимость лида (только операторы)", c: muted, w: 500 }]);
  table(
    [
      { title: "Группа", w: 0 },
      { title: "Лиды", w: 110 },
      { title: "Часы", w: 110 },
      { title: "Лид/час", w: 120 },
      { title: "СС лида", w: 130 },
      { title: "Лимит", w: 120 },
    ],
    r.groups.map((g) => {
      const over = g.costPerLead != null && g.costPerLead > g.cap;
      const near = g.costPerLead != null && !over && g.costPerLead > g.cap * 0.9;
      return [
        [{ t: g.name, w: 600 }],
        [{ t: fmtInt(g.leads), w: 600 }],
        [{ t: fmtInt(Math.round(g.hours)), w: 600 }],
        [{ t: g.conv == null ? "—" : fmtNum(g.conv, 2), w: 600 }],
        [{ t: g.costPerLead == null ? "—" : `~${fmtInt(Math.round(g.costPerLead))} р`, w: 500, c: g.costPerLead == null ? faint : over ? C.red : near ? C.amber : C.green }],
        [{ t: `${fmtInt(g.cap)} р`, w: 600 }],
      ];
    }),
    // пометка направления у названия — чип, как в макете
    (k, x, ry) => {
      const label = r.groups[k].track === "auto" ? "авто" : "недв.";
      font(11.5, 500);
      const pw = ctx.measureText(label).width + 14;
      roundRect(ctx, x + 8, ry + 10, pw, 20, 10, pillBg);
      text(label, x + 15, ry + 24, muted);
    },
  );

  // ── супервайзеры ──
  section("star", [{ t: "Супервайзеры", c: muted, w: 500 }]);
  table(
    [
      { title: "СВ", w: 0 },
      { title: "Часы в оплату", w: 116 },
      { title: "Табель", w: 78 },
      { title: "Конверсия", w: 96 },
      { title: "СС лида", w: 88 },
      { title: "ФОТ", w: 64 },
      { title: "Сделки", w: 76 },
      { title: "Найм", w: 70 },
    ],
    r.groups.map((g) => {
      const sp = g.sheet.pct;
      const h = g.hire;
      const hireTone = !h.plan ? strong : h.out >= h.plan ? C.green : h.out > 0 ? C.amber : C.red;
      const over = g.costPerLead != null && g.costPerLead > g.cap;
      return [
        [{ t: g.supervisor || `РОП · ${g.name}`, w: 600, c: g.supervisor ? strong : muted }],
        [{ t: fmtInt(Math.round(g.hours)), w: 600 }],
        [{ t: pct(sp), w: 500, c: sp == null ? faint : sp >= 0.95 ? C.green : sp >= 0.8 ? C.amber : C.red }],
        [{ t: pct(g.conv), w: 600, c: g.conv != null && g.conv >= r.convNorm ? C.green : strong }],
        [{ t: g.costPerLead == null ? "—" : `${fmtInt(Math.round(g.costPerLead))} р`, w: 500, c: g.costPerLead == null ? faint : over ? C.red : strong }],
        [{ t: pct(g.fotPct), w: 600 }],
        [{ t: fmtInt(g.done), w: 600 }],
        [{ t: `${h.out} / ${h.plan || "—"}`, w: 600, c: hireTone }],
      ];
    }),
  );
  note("Табель — доля смен с проставленными часами. ФОТ — затраты на операторов группы ÷ её выручка. Сделки — доведённые лиды. Найм — вышло операторов / план на месяц.");

  // ── грейд KPI: ран-рейт против ступеней бонуса СВ ──
  section("trend", [{ t: `Грейд KPI · ран-рейт на конец ${MONTH_GEN[Number(r.month.slice(5, 7)) - 1]}`, c: muted, w: 500 }]);
  const maxRR = Math.max(0, ...r.groups.map((g) => g.kpi.rr));
  // шкала — до ступени после ближайшей недостигнутой: иначе при сетке до 2 000 полосы короткие
  const nextIdx = r.steps.findIndex((s) => s > maxRR);
  const topStep = nextIdx < 0 ? r.steps[r.steps.length - 1] ?? 0 : r.steps[Math.min(r.steps.length - 1, nextIdx + 1)];
  const scale = Math.max(maxRR, topStep) * 1.08 || 1;
  const last = r.steps[r.steps.length - 1];
  const stepNo = (v: number) => r.steps.indexOf(v) + 1;
  r.groups.forEach((g) => {
    const k = g.kpi;
    font(15, 500);
    text(g.name, P, y + 15);
    const status: Part[] = k.reached
      ? [
          { t: `ступень ${stepNo(k.reached)}`, c: C.green, w: 600 },
          { t: ` (от ${fmtInt(k.reached)}${k.next ? `, до ${fmtInt(k.next)} −${fmtInt(k.next - k.rr)}` : ""})`, c: strong },
        ]
      : [
          { t: "ниже ступени 1", c: C.red, w: 600 },
          { t: ` (от ${fmtInt(r.steps[0] ?? 0)}, −${fmtInt((r.steps[0] ?? 0) - k.rr)})`, c: strong },
        ];
    parts([{ t: `RR ~${fmtInt(k.rr)}`, w: 600 }, { t: " · ", c: muted }, ...status], W - P, y + 15, 14, "right");
    const by = y + 25;
    roundRect(ctx, P, by, bw, 7, 3.5, C.strip);
    const fill = !k.reached ? KPI.low : k.reached === last ? KPI.top : KPI.mid;
    roundRect(ctx, P, by, Math.max(7, (Math.min(k.rr, scale) / scale) * bw), 7, 3.5, fill);
    ctx.fillStyle = muted;
    r.steps.forEach((s) => {
      if (s >= scale) return;
      ctx.fillRect(Math.round(P + (s / scale) * bw), by - 4, 1, 15);
    });
    y += 48;
  });
  if (!r.groups.length) note("Нет групп с данными за период");
  note(r.steps.length ? `Засечки — пороги ступеней ${r.steps.map((_, i) => i + 1).join(" / ")} из сетки бонуса СВ: ${r.steps.map(fmtInt).join(" / ")} лидов в месяц` : "Ступени не заданы в мотивации СВ");

  if (r.missing.length) {
    y += 12;
    font(13);
    roundRect(ctx, P, y, W - P * 2, 34, 8, C.amberBg);
    text(clip(ctx, `Не заполнено в параметрах отчёта: ${r.missing.join(", ")}`, W - P * 2 - 28), P + 14, y + 22, C.amber);
    y += 34;
  }
  return y + P - 6;
}
