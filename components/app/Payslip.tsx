"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import type { MonthCal } from "@/lib/crm/calc";
import { isHourlyTiered, isTiered, type PayRow } from "@/lib/crm/payroll";
import { buildPayslip, type Payslip, type SlipLine } from "@/lib/crm/payslip";
import { fmtDate, fmtMonth, fmtStamp, fmtWeekday, nowStamp } from "@/lib/crm/dates";
import { fmtInt, fmtMoney, fmtNum } from "@/lib/crm/format";
import { dataUrlBytes, jpegToPdf } from "@/lib/pdf";
import { Modal } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { tierRange } from "./RateGrids";

/**
 * Расчётный лист: картинка на canvas (как отчёт в «Отчётах») — то, что видно
 * в окне, один в один уходит в PNG и PDF. Палитра всегда светлая: лист печатают
 * и пересылают, тема CRM ему не нужна.
 */

const W = 760;
const P = 36;
const SCALE = 2;

const C = {
  bg: "#ffffff",
  text: "#28251f",
  sub: "#6b655a",
  dim: "#8a8478",
  line: "#eee9e0",
  strip: "#faf7f2",
  brand: "#3d6db3",
  brandSoft: "#e4edf9",
  green: "#2e6b45",
  red: "#ad3a33",
};

interface Handle {
  toBlob: () => Promise<Blob | null>;
  toDataURL: (type?: string, q?: number) => string;
  size: () => { w: number; h: number };
}

const PayslipCanvas = forwardRef<Handle, { slip: Payslip; company: string }>(function PayslipCanvas({ slip, company }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(ref, () => ({
    toBlob: () => new Promise((res) => (cv.current ? cv.current.toBlob((b) => res(b), "image/png") : res(null))),
    toDataURL: (type = "image/png", q?: number) => cv.current?.toDataURL(type, q) ?? "",
    size: () => ({ w: cv.current?.width ?? 0, h: cv.current?.height ?? 0 }),
  }));
  useEffect(() => {
    let alive = true;
    const sans = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
    const probe = document.createElement("span");
    probe.className = "num";
    document.body.appendChild(probe);
    const mono = getComputedStyle(probe).fontFamily || "monospace";
    probe.remove();
    void document.fonts.ready.then(() => {
      if (!alive || !cv.current) return;
      // первый проход — только узнать высоту, второй — рисовать
      const h = draw(document.createElement("canvas").getContext("2d")!, slip, company, sans, mono, true);
      const c = cv.current;
      c.width = W * SCALE;
      c.height = Math.ceil(h * SCALE);
      const ctx = c.getContext("2d")!;
      ctx.scale(SCALE, SCALE);
      draw(ctx, slip, company, sans, mono, false, h);
    });
    return () => {
      alive = false;
    };
  }, [slip, company]);
  return <canvas ref={cv} style={{ width: "100%", maxWidth: W, height: "auto", display: "block", margin: "0 auto", borderRadius: 10, boxShadow: "var(--shadow-sm)", border: "1px solid var(--ink-07)" }} />;
});

/** Рисует лист; возвращает высоту. dry — только посчитать высоту. */
function draw(ctx: CanvasRenderingContext2D, s: Payslip, company: string, sans: string, mono: string, dry: boolean, H = 0): number {
  const r = s.row;
  const font = (size: number, weight = 400, family = sans) => (ctx.font = `${weight} ${size}px ${family}`);
  const text = (t: string, x: number, y: number, color = C.text, align: CanvasTextAlign = "left") => {
    if (dry) return;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(t, x, y);
  };
  const box = (x: number, y: number, w: number, h: number, rad: number, fill: string) => {
    if (!dry) roundRect(ctx, x, y, w, h, rad, fill);
  };
  const hr = (y: number) => {
    if (dry) return;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(P, y + 0.5);
    ctx.lineTo(W - P, y + 0.5);
    ctx.stroke();
  };
  if (!dry) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";
  }
  const inner = W - P * 2;
  let y = P;

  // ── шапка ──
  font(12, 600);
  text((company || "LEADUP CRM").toUpperCase(), P, y + 12, C.brand);
  font(24, 700);
  text(`Расчётный лист · ${fmtMonth(s.month)}`, P, y + 44);
  font(15, 600);
  text(clip(ctx, r.op.name, inner * 0.62), P, y + 70);
  font(12.5);
  text(clip(ctx, `${s.group} · ${s.scheme}`, inner * 0.62), P, y + 90, C.sub);
  const stamp = fmtStamp(nowStamp());
  font(12.5, 600);
  text(s.preliminary ? `Предварительно, на ${fmtDate(s.asOf)}` : "Итог за месяц", W - P, y + 70, s.preliminary ? C.brand : C.green, "right");
  font(11.5);
  text(`сформирован ${stamp}`, W - P, y + 90, C.dim, "right");
  y += 110;

  // ── плитки ──
  const held = r.withhold + r.deductions;
  const tiles: { label: string; value: string; tone?: string; bg?: string }[] = [
    { label: "Начислено", value: fmtMoney(r.gross) },
    { label: "Удержано", value: held ? `− ${fmtMoney(held)}` : fmtMoney(0) },
    { label: "Уже выплачено", value: r.paid ? `− ${fmtMoney(r.paid)}` : fmtMoney(0) },
    { label: "Остаток к выплате", value: fmtMoney(r.toPay), tone: C.brand, bg: C.brandSoft },
  ];
  const gap = 10;
  const tw = (inner - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = P + i * (tw + gap);
    box(x, y, tw, 70, 10, t.bg ?? C.strip);
    font(12, 500);
    text(t.label, x + 14, y + 22, C.sub);
    font(19, 600, mono);
    text(clip(ctx, t.value, tw - 24), x + 14, y + 52, t.tone ?? C.text);
  });
  y += 84;

  // ── отработано ──
  box(P, y, inner, 34, 8, C.strip);
  font(12.5);
  const work = [
    `Смен: ${fmtInt(s.shifts)}`,
    `часов: ${fmtNum(r.hours)}${r.normHours ? ` из ${fmtNum(r.normHours)} по норме` : ""}`,
    `лидов в оплату: ${fmtInt(r.leads)}`,
    ...(r.sv ? [`лидов групп: ${fmtInt(r.sv.leads)}`] : []),
  ].join(" · ");
  text(clip(ctx, work, inner - 28), P + 14, y + 22, C.text);
  y += 50;

  // ── расчёт ──
  font(14, 600);
  text("Расчёт", P, y + 14);
  y += 26;
  const lineH = (l: SlipLine) => (l.kind === "grand" ? 44 : l.note ? 40 : 28);
  s.lines.forEach((l, i) => {
    const h = lineH(l);
    const prev = s.lines[i - 1];
    if (l.kind === "total") box(P, y, inner, h, 8, C.strip);
    else if (l.kind === "grand") box(P, y + 4, inner, h - 4, 10, C.brandSoft);
    else if (prev && prev.kind !== "total") hr(y);
    const mid = l.kind === "grand" ? y + 29 : l.note ? y + 18 : y + 19;
    font(l.kind === "grand" ? 15 : 13, l.kind === "plus" || l.kind === "minus" ? 500 : 700);
    text(l.label, P + 12, mid, l.kind === "grand" ? C.brand : C.text);
    if (l.note) {
      font(11.5);
      text(clip(ctx, l.note, inner - 190), P + 12, y + 33, C.dim);
    }
    const neg = l.kind === "minus";
    const v = neg ? (l.value ? `− ${fmtMoney(l.value)}` : fmtMoney(0)) : l.value < 0 ? `− ${fmtMoney(-l.value)}` : fmtMoney(l.value);
    font(l.kind === "grand" ? 17 : 13.5, l.kind === "plus" || l.kind === "minus" ? 500 : 700, mono);
    text(v, W - P - 12, mid, l.kind === "grand" ? C.brand : neg ? C.red : C.text, "right");
    y += h;
  });
  y += 14;

  // ── разбор по ступеням ──
  if (isTiered(r.payType) && r.tierUse.length) {
    const hourly = isHourlyTiered(r.payType);
    y += 10;
    font(14, 600);
    text("По ступеням сетки", P, y + 14);
    font(11.5);
    text("ставка и бонус зависят от числа лидов в смене", W - P, y + 14, C.dim, "right");
    y += 26;
    const cols = table(
      [
        { title: "Ступень", w: 0 },
        { title: "Смен", w: 60 },
        { title: "Часы", w: 66 },
        { title: "Лиды", w: 60 },
        ...(hourly ? [{ title: "Ставка", w: 84 }] : []),
        { title: "За лид", w: 76 },
        { title: "Начислено", w: 104 },
      ],
      inner,
    );
    y = head(cols, y);
    r.tierUse.forEach((u, i) => {
      if (i) hr(y);
      const idx = r.tiers.findIndex((t) => t.from === u.from);
      const vals = [
        tierRange(r.tiers, idx >= 0 ? idx : 0),
        fmtInt(u.days),
        fmtNum(u.hours),
        fmtInt(u.leads),
        ...(hourly ? [`${fmtInt(u.hourlyRate)} ₽/ч`] : []),
        fmtMoney(u.leadBonus),
        fmtMoney(u.sum),
      ];
      row(cols, vals, y, vals.length - 1);
      y += 26;
    });
    y += 12;
  }

  // ── по сменам ──
  if (s.days.length) {
    const withRate = s.days.some((d) => d.rate > 0);
    const withBonus = s.days.some((d) => d.bonus > 0);
    const withSum = s.days.some((d) => d.sum != null);
    y += 10;
    font(14, 600);
    text("По сменам", P, y + 14);
    y += 26;
    const cols = table(
      [
        { title: "Дата", w: 0 },
        { title: "Часы", w: 70 },
        { title: "Лиды", w: 64 },
        ...(withRate ? [{ title: "Ставка", w: 90 }] : []),
        ...(withBonus ? [{ title: "За лид", w: 80 }] : []),
        ...(withSum ? [{ title: "Начислено", w: 110 }] : []),
      ],
      inner,
    );
    y = head(cols, y);
    s.days.forEach((d, i) => {
      if (i) hr(y);
      const vals = [
        `${fmtDate(d.day)}, ${fmtWeekday(d.day)}`,
        d.hours ? fmtNum(d.hours) : "—",
        fmtInt(d.leads),
        ...(withRate ? [d.rate ? `${fmtInt(d.rate)} ₽/ч` : "—"] : []),
        ...(withBonus ? [d.bonus ? fmtMoney(d.bonus) : "—"] : []),
        ...(withSum ? [d.sum == null ? "—" : fmtMoney(d.sum)] : []),
      ];
      row(cols, vals, y, withSum ? vals.length - 1 : -1);
      y += 24;
    });
    y += 10;
  }

  // ── подвал ──
  y += 12;
  font(11.5);
  const foot = [
    "Лиды «не доведён» не оплачиваются.",
    s.preliminary ? "Месяц идёт — расчёт предварительный и меняется с новыми сменами и лидами." : "",
    "Вопросы по расчёту — руководителю.",
  ]
    .filter(Boolean)
    .join(" ");
  const lines = wrap(ctx, foot, inner);
  lines.forEach((l, i) => text(l, P, y + 12 + i * 17, C.dim));
  y += lines.length * 17 + P;
  return y;

  /* ── таблицы ── */
  function table(cols: { title: string; w: number }[], width: number) {
    cols[0].w = width - cols.slice(1).reduce((a, c) => a + c.w, 0);
    const xs: number[] = [];
    cols.reduce((x, c) => (xs.push(x), x + c.w), P);
    return cols.map((c, i) => ({ ...c, x: xs[i], right: i > 0 }));
  }
  function head(cols: ReturnType<typeof table>, yy: number) {
    box(P, yy, inner, 28, 8, C.strip);
    font(12, 600);
    cols.forEach((c) => text(c.title, c.right ? c.x + c.w - 12 : c.x + 12, yy + 18, C.sub, c.right ? "right" : "left"));
    return yy + 30;
  }
  function row(cols: ReturnType<typeof table>, vals: string[], yy: number, strong: number) {
    cols.forEach((c, i) => {
      if (i === 0) font(12.5, 500);
      else font(12.5, i === strong ? 600 : 400, mono);
      const v = i === 0 ? clip(ctx, vals[i], c.w - 20) : vals[i];
      text(v, c.right ? c.x + c.w - 12 : c.x + 12, yy + 17, vals[i] === "—" ? C.dim : C.text, c.right ? "right" : "left");
    });
  }
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

function clip(ctx: CanvasRenderingContext2D, s: string, max: number): string {
  if (ctx.measureText(s).width <= max) return s;
  let t = s;
  while (t.length > 1 && ctx.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

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
  return out;
}

/**
 * Окно «Расчётный лист»: предпросмотр и выгрузка — PDF, PNG или картинкой в буфер,
 * чтобы переслать в мессенджер. Открывается из «Моего кабинета» и из ведомости.
 */
export function PayslipModal({ row, cal, onClose }: { row: PayRow; cal: MonthCal; onClose: () => void }) {
  const { data, ix, toast } = useCrm();
  const pic = useRef<Handle>(null);
  const [busy, setBusy] = useState(false);
  const slip = useMemo(() => buildPayslip(data, ix, cal, row), [data, ix, cal, row]);
  const company = data.settings.companyName || "LEADUP CRM";
  const base = `Расчётный лист — ${row.op.name} — ${fmtMonth(cal.month)}`;

  const save = (href: string, name: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.click();
  };
  const pdf = () => {
    const url = pic.current?.toDataURL("image/jpeg", 0.93);
    const { w, h } = pic.current?.size() ?? { w: 0, h: 0 };
    if (!url || !w || !h) return toast("Лист ещё рисуется — попробуйте через секунду", "info");
    const blob = jpegToPdf(dataUrlBytes(url), w, h, base);
    const href = URL.createObjectURL(blob);
    save(href, `${base}.pdf`);
    window.setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };
  const png = () => {
    const url = pic.current?.toDataURL();
    if (url) save(url, `${base}.png`);
  };
  const copy = async () => {
    setBusy(true);
    try {
      const blob = await pic.current?.toBlob();
      if (!blob) throw new Error("картинка не готова");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("Картинка скопирована — вставьте в чат (Ctrl+V)");
    } catch (e) {
      toast(`Не удалось скопировать: ${e instanceof Error ? e.message : String(e)}. Скачайте файл`, "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Расчётный лист"
      onClose={onClose}
      width={860}
      footer={
        <>
          <button className="btn" onClick={() => void copy()} disabled={busy}>
            <Icon name="copy" size={14} /> Скопировать картинку
          </button>
          <button className="btn" onClick={png}>
            <Icon name="download" size={14} /> PNG
          </button>
          <button className="btn btn-primary" onClick={pdf}>
            <Icon name="download" size={14} /> Скачать PDF
          </button>
        </>
      }
    >
      <PayslipCanvas ref={pic} slip={slip} company={company} />
    </Modal>
  );
}
