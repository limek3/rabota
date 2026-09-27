import type { DayKey, ID, OpNote } from "./types";
import type { Index, MonthCal, OpRow } from "./calc";
import { addDays } from "./dates";
import { fmtInt, fmtNum, fmtPct, safeDiv, shortName } from "./format";

/**
 * Подсказки супервайзеру: кто отстаёт, почему и что с этим делать. Чистые функции
 * поверх модели месяца (monthModel) и индекса — ничего не хранят. Всё сравнивается
 * с медианой отдела за этот же месяц, а не с придуманными нормами: у каждого отдела
 * свой нормальный уровень часов и лидов в час.
 */

/** Сравниваем с медианой только при достаточном числе людей: на двоих медиана — не норма. */
const MIN_PEOPLE = 3;
/** Ниже медианы на столько — это уже причина отставания. */
const LOW_SHARE = 0.85;
/** Тренд: сколько последних отработанных дней сравниваем с таким же числом до них. */
const TREND_DAYS = 5;

export interface Medians {
  /** Лидов на отработанный час. */
  lph: number | null;
  /** Часов на прошедший рабочий день (прогулы тянут вниз — так и задумано). */
  hpd: number | null;
}

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const counted = (r: OpRow) => !r.op.deletedAt && r.op.status === "active" && r.inWindow && r.hours > 0 && r.pace.elapsedW > 0;

export function teamMedians(rows: OpRow[]): Medians {
  const live = rows.filter(counted);
  if (live.length < MIN_PEOPLE) return { lph: null, hpd: null };
  return { lph: median(live.map((r) => r.pace.fact / r.hours)), hpd: median(live.map((r) => r.hours / r.pace.elapsedW)) };
}

/* ── темп последних смен ───────────────────────────────────────────── */

export interface Tempo {
  /** Лидов в среднем за последние TREND_DAYS отработанных дней. */
  last: number;
  /** …и за столько же дней до них. */
  prev: number;
  /** last / prev − 1; null — сравнивать не с чем. */
  change: number | null;
  /** Сколько последних смен подряд без единого лида (смена = отмечены часы). */
  zeroStreak: number;
  /** Часы тех смен без лидов — для подсказки. */
  zeroHours: number[];
}

/**
 * Отработанный день — есть часы или лиды. Сегодняшний день не берём: он не закончен
 * и занизил бы темп. Смотрим и в прошлый месяц — иначе в начале месяца тренда не было бы.
 */
export function tempo(opId: ID, ix: Index, cal: MonthCal): Tempo {
  const hours = ix.hoursOpDay.get(opId);
  const leads = ix.opDay.get(opId);
  const lastDay = cal.phase === "current" ? addDays(cal.today, -1) : cal.ref;
  const days: { leads: number; hours: number }[] = [];
  for (let d: DayKey = lastDay, i = 0; i < 62 && days.length < TREND_DAYS * 2; i++, d = addDays(d, -1)) {
    const h = hours?.get(d) ?? 0;
    const l = leads?.get(d) ?? 0;
    if (h > 0 || l > 0) days.push({ leads: l, hours: h });
  }
  let zeroStreak = 0;
  const zeroHours: number[] = [];
  for (const x of days) {
    if (x.hours <= 0 || x.leads > 0) break;
    zeroStreak++;
    zeroHours.push(x.hours);
  }
  const avg = (a: typeof days) => safeDiv(a.reduce((s, x) => s + x.leads, 0), a.length);
  const lastPart = days.slice(0, TREND_DAYS);
  const prevPart = days.slice(TREND_DAYS, TREND_DAYS * 2);
  const last = avg(lastPart);
  const prev = avg(prevPart);
  // меньше пяти лидов за пять смен — слишком мало, чтобы говорить о тренде
  const enough = prevPart.length === TREND_DAYS && prev * TREND_DAYS >= 5;
  return { last, prev, change: enough ? last / prev - 1 : null, zeroStreak, zeroHours };
}

/* ── почему отстаёт ────────────────────────────────────────────────── */

export type LagKind = "hours" | "lph" | "both" | "plan";

export const LAG_LABEL: Record<LagKind, string> = {
  hours: "Мало часов",
  lph: "Низкий л/ч",
  both: "Часы и л/ч",
  plan: "Высокий план",
};
export const LAG_HUE: Record<LagKind, string> = { hours: "amber", lph: "purple", both: "red", plan: "gray" };
export const LAG_HINT: Record<LagKind, string> = {
  hours: "Работает меньше часов, чем другие: разобрать график и смены",
  lph: "Часы в норме, но лидов в час меньше, чем у других: прослушка и разбор скрипта",
  both: "Меньше часов и меньше лидов в час, чем у других",
  plan: "Часы и лиды в час на уровне команды — план выше, чем позволяет обычная работа",
};

export interface LagReason {
  kind: LagKind;
  /** Сколько лидов отставания к дате из-за часов (отрицательное — не хватает). */
  hoursImpact: number;
  /** …и из-за лидов в час. В сумме — отставание к дате. */
  lphImpact: number;
  hpd: number;
  lph: number;
}

/**
 * Раскладка отставания: факт = часы × лиды в час, «как у всех» = нужные часы × медиана л/ч.
 * ln(факт / план к дате) = ln(часы / нужные часы) + ln(л/ч / медиана) — отставание делится
 * между часами и эффективностью пропорционально этим слагаемым.
 */
export function lagReason(r: OpRow, med: Medians): LagReason | null {
  if (!med.lph || !med.hpd || !r.hasShifts || r.hours <= 0 || r.pace.elapsedW <= 0) return null;
  if (r.status !== "lagging" && r.status !== "critical") return null;
  const target = r.pace.planToDate;
  const gap = r.pace.fact - target;
  if (target <= 0 || gap > -1) return null;
  const hpd = r.hours / r.pace.elapsedW;
  const lph = r.pace.fact / r.hours;
  // ноль лидов — логарифм не определён; берём малую долю медианы, чтобы вина легла на л/ч
  const a = Math.log(r.hours / (target / med.lph));
  const b = Math.log(Math.max(lph, med.lph * 0.05) / med.lph);
  const t = a + b;
  const hoursImpact = Math.abs(t) < 1e-6 ? 0 : (gap * a) / t;
  const lowH = hpd < med.hpd * LOW_SHARE;
  const lowL = lph < med.lph * LOW_SHARE;
  const kind: LagKind = lowH && lowL ? "both" : lowH ? "hours" : lowL ? "lph" : "plan";
  return { kind, hoursImpact, lphImpact: gap - hoursImpact, hpd, lph };
}

/** Реально ли закрыть план: во сколько раз «нужно в день» больше его среднего. null — не считается. */
export function planRealism(r: OpRow): number | null {
  // на паузе и уволенным «нужно в день» не к кому применить
  if (r.op.status !== "active") return null;
  const need = r.pace.needPerDay;
  if (need == null || need <= 0) return null;
  if (r.avgPerWorkday <= 0) return r.pace.elapsedW >= 3 ? Infinity : null;
  return need / r.avgPerWorkday;
}

/* ── сигналы «требует внимания» ────────────────────────────────────── */

export type SignalKind = "zero" | "unreal" | "drop" | "hours" | "lph" | "rise";

export interface Signal {
  kind: SignalKind;
  /** 3 — сегодня, 2 — на этой неделе, 1 — хорошая новость. */
  sev: 1 | 2 | 3;
  hue: string;
  title: string;
  detail: string;
  /** Что сделать СВ. */
  todo: string;
}

export interface OpInsight {
  tempo: Tempo;
  reason: LagReason | null;
  realism: number | null;
  signals: Signal[];
}

const pct = (x: number) => fmtPct(Math.abs(x));

function signalsOf(r: OpRow, t: Tempo, reason: LagReason | null, real: number | null, med: Medians): Signal[] {
  const s: Signal[] = [];
  const behind = r.status === "lagging" || r.status === "critical";
  if (t.zeroStreak >= 2)
    s.push({
      kind: "zero",
      sev: 3,
      hue: "red",
      title: `${t.zeroStreak} смены подряд без лидов`,
      detail: `часы отмечены: ${t.zeroHours.map((h) => fmtNum(h) + " ч").join(", ")}`,
      todo: "Позвонить сегодня: звонит ли и что с базой",
    });
  if (behind && real != null && real >= 1.5)
    s.push({
      kind: "unreal",
      sev: 3,
      hue: "red",
      title: real === Infinity ? "План не закрыть без лидов" : `План почти нереален · ×${fmtNum(real)}`,
      detail: `нужно ${fmtNum(r.pace.needPerDay ?? 0)} в день, делает ${fmtNum(r.avgPerWorkday)}`,
      todo: "Добавить смены или пересмотреть план",
    });
  if (t.change != null && t.change <= -0.2)
    s.push({
      kind: "drop",
      sev: 2,
      hue: "amber",
      title: `Темп упал на ${pct(t.change)}`,
      detail: `последние ${TREND_DAYS} смен: ${fmtNum(t.last)} в день, до них ${fmtNum(t.prev)}`,
      todo: "Послушать звонки за последние дни",
    });
  if (reason && (reason.kind === "hours" || reason.kind === "both") && med.hpd)
    s.push({
      kind: "hours",
      sev: 2,
      hue: "amber",
      title: "Мало часов",
      detail: `${fmtNum(reason.hpd)} ч в рабочий день, у команды ${fmtNum(med.hpd)}`,
      todo: "Разобрать график: сколько смен готов брать",
    });
  if (reason && (reason.kind === "lph" || reason.kind === "both") && med.lph)
    s.push({
      kind: "lph",
      sev: 2,
      hue: "purple",
      title: "Низкий л/ч",
      detail: `${fmtNum(reason.lph, 2)} лида в час, у команды ${fmtNum(med.lph, 2)}`,
      todo: "Прослушка и разбор скрипта",
    });
  if (t.change != null && t.change >= 0.25 && r.status !== "critical")
    s.push({
      kind: "rise",
      sev: 1,
      hue: "green",
      title: `Ускоряется · +${pct(t.change)}`,
      detail: `последние ${TREND_DAYS} смен: ${fmtNum(t.last)} в день, до них ${fmtNum(t.prev)}`,
      todo: "Похвалить",
    });
  return s;
}

/** Подсказки по всем строкам месяца. Сигналы — только для текущего месяца и работающих. */
export function buildInsights(rows: OpRow[], ix: Index, cal: MonthCal): { med: Medians; byOp: Map<ID, OpInsight> } {
  const med = teamMedians(rows);
  const byOp = new Map<ID, OpInsight>();
  for (const r of rows) {
    if (!r.inWindow || r.op.deletedAt) continue;
    const t = tempo(r.op.id, ix, cal);
    const reason = lagReason(r, med);
    const real = planRealism(r);
    const live = cal.phase === "current" && r.op.status === "active" && r.pace.elapsedW >= 3;
    byOp.set(r.op.id, { tempo: t, reason, realism: real, signals: live ? signalsOf(r, t, reason, real, med) : [] });
  }
  return { med, byOp };
}

/* ── заметки супервайзера: помог ли разговор ───────────────────────── */

export interface NoteEffect {
  /** Рано судить: после заметки меньше 3 смен. */
  early: boolean;
  daysAfter: number;
  before: number;
  after: number;
  change: number | null;
}

/**
 * Показатель до и после заметки: по 10 отработанных дней в каждую сторону.
 * День заметки — уже «после»: разговор обычно в начале смены.
 */
export function noteEffect(n: Pick<OpNote, "operatorId" | "date" | "metric">, ix: Index, today: DayKey): NoteEffect {
  const hours = ix.hoursOpDay.get(n.operatorId);
  const leads = ix.opDay.get(n.operatorId);
  const worked = (d: DayKey) => (hours?.get(d) ?? 0) > 0 || (leads?.get(d) ?? 0) > 0;
  const collect = (from: DayKey, step: 1 | -1, stop: (d: DayKey) => boolean) => {
    const out: DayKey[] = [];
    for (let d = from, i = 0; i < 62 && out.length < 10 && !stop(d); i++, d = addDays(d, step)) if (worked(d)) out.push(d);
    return out;
  };
  const before = collect(addDays(n.date, -1), -1, () => false);
  // сегодняшний день не закончен — в «после» не берём
  const after = collect(n.date, 1, (d) => d >= today);
  const val = (ds: DayKey[]) => {
    const h = ds.reduce((s, d) => s + (hours?.get(d) ?? 0), 0);
    const l = ds.reduce((s, d) => s + (leads?.get(d) ?? 0), 0);
    if (n.metric === "hours") return safeDiv(h, ds.length);
    if (n.metric === "leads") return safeDiv(l, ds.length);
    return safeDiv(l, h);
  };
  const b = val(before);
  const a = val(after);
  const early = after.length < 3;
  return { early, daysAfter: after.length, before: b, after: a, change: !early && before.length >= 3 && b > 0 ? a / b - 1 : null };
}

export const NOTE_METRIC_LABEL: Record<OpNote["metric"], string> = { lph: "лиды в час", hours: "часы за смену", leads: "лиды за смену" };

/** Значение показателя заметки для подписи. */
export const fmtNoteMetric = (m: OpNote["metric"], v: number) => (m === "lph" ? fmtNum(v, 2) : fmtNum(v));

/* ── сводка по группе: разброс внутри ──────────────────────────────── */

export interface GroupSpread {
  /** Темп к дате по людям группы (активные, с планом: пауза и уволенные исказили бы разброс). */
  people: { id: ID; name: string; ratio: number; status: OpRow["status"] }[];
  lo: number | null;
  hi: number | null;
  /** Доля лидов группы у лучшего, 0…1. */
  topShare: number;
  topName: string;
  attention: number;
}

export function groupSpread(members: OpRow[], byOp: Map<ID, OpInsight>): GroupSpread {
  const people = members
    .filter((r) => !r.op.deletedAt && r.op.status === "active" && r.inWindow && r.terms.plan > 0 && r.pace.planToDate > 0)
    .map((r) => ({ id: r.op.id, name: shortName(r.op.name), ratio: r.pace.paceRatio, status: r.status }));
  const fact = members.reduce((a, r) => a + r.pace.fact, 0);
  const top = members.reduce<OpRow | null>((a, r) => (!a || r.pace.fact > a.pace.fact ? r : a), null);
  const ratios = people.map((p) => p.ratio);
  return {
    people,
    lo: ratios.length ? Math.min(...ratios) : null,
    hi: ratios.length ? Math.max(...ratios) : null,
    topShare: top && fact > 0 ? top.pace.fact / fact : 0,
    topName: top ? shortName(top.op.name) : "",
    attention: members.filter((r) => byOp.get(r.op.id)?.signals.some((s) => s.sev >= 2)).length,
  };
}

/** Коротко для подсказки строки: «−12 из-за часов, −5 из-за л/ч». */
export function fmtImpact(n: number): string {
  const v = Math.round(n);
  return v === 0 ? "0" : v > 0 ? `+${fmtInt(v)}` : `−${fmtInt(-v)}`;
}

