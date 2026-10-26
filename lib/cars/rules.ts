import type { Project } from "../crm/types";
import { BODY_LABEL, type Body, type Brand, type CarMention, type Model } from "./catalog";

/**
 * Передаём ли такое авто — по правилам проекта.
 *
 * 100 up — список «Не берём» от заказчика: премиум-марки, отдельные модели, коммерческий транспорт,
 * пикапы, минивэны, кабриолеты, спорткары «как Mustang», машины только электро или только гибрид
 * (есть и бензиновая версия — передаём).
 * Авто.ру — по городу клиента: Москва и Санкт-Петербург — любые марки, регионы и Екатеринбург — только китайские;
 * Lada — нигде; грузовые, микроавтобусы, спецтехника, фургоны — нет; Datsun, Zotye, Kaiyi — наличие не обещаем.
 *
 * Правила пока здесь, в коде; проект узнаём по названию. Потом — редактор в карточке проекта.
 */

export type VerdictKind = "ok" | "no" | "ask";

export interface Verdict {
  kind: VerdictKind;
  /** Почему «не передаём» или что уточнить; у «передаём» пусто. */
  reasons: string[];
}

export interface ZoneVerdict extends Verdict {
  /** Где действует: «Москва и Санкт-Петербург»; null — везде. */
  zone: string | null;
}

export interface CarRules {
  key: "100up" | "autoru";
  /** Что показать оператору списком. */
  list: string[];
  check: (m: Model) => ZoneVerdict[];
  /** Назвали только марку («мерседес»): вердикт, если он ясен без модели; иначе null. */
  checkBrand: (b: Brand) => ZoneVerdict[] | null;
}

export const VERDICT_LABEL: Record<VerdictKind, string> = { ok: "Передаём", no: "Не передаём", ask: "Уточнить" };

/** Несколько причин в один вердикт: хоть одна «нет» — не передаём, иначе «уточнить» — уточнить. */
function combine(parts: { kind: VerdictKind; reason: string }[]): Verdict {
  const no = parts.filter((p) => p.kind === "no");
  if (no.length) return { kind: "no", reasons: no.map((p) => p.reason) };
  const ask = parts.filter((p) => p.kind === "ask");
  if (ask.length) return { kind: "ask", reasons: ask.map((p) => p.reason) };
  return { kind: "ok", reasons: [] };
}

/* ── 100 up ─────────────────────────────────────────────────────────────── */

const UP_BRANDS = new Set(["mercedes", "bmw", "audi", "porsche", "cadillac", "infiniti", "lexus"]);
/** Модели из списка: [марка, модель]. */
const UP_MODELS: [string, string][] = [
  ["toyota", "Camry"],
  ["toyota", "Land Cruiser Prado"],
  ["toyota", "Land Cruiser 100"],
  ["toyota", "Land Cruiser 200"],
  ["kia", "Carnival"],
  ["ford", "Mustang"],
  ["gaz", "Волга"],
];
const UP_BODIES: Partial<Record<Body, string>> = {
  com: "коммерческий транспорт",
  van: "коммерческий транспорт (фургон)",
  pu: "пикап",
  mpv: "минивэн",
  cab: "кабриолет",
};

function check100up(m: Model): ZoneVerdict[] {
  const parts: { kind: VerdictKind; reason: string }[] = [];
  if (UP_BRANDS.has(m.brand.id)) parts.push({ kind: "no", reason: `${m.brand.name} — в списке «не берём»` });
  else if (m.brand.prem) parts.push({ kind: "ask", reason: `${m.brand.name} — премиум-марка, в списке её нет: уточните у РОП` });
  const listed = UP_MODELS.some(([b, n]) => b === m.brand.id && n === m.name);
  if (listed) parts.push({ kind: "no", reason: `${m.full} — в списке «не берём»` });
  // кузов: все варианты в списке — не берём; часть — уточнить, какой у клиента
  const banned = m.bodies.filter((b) => UP_BODIES[b]);
  if (banned.length && banned.length === m.bodies.length) parts.push({ kind: "no", reason: `${cap(UP_BODIES[banned[0]]!)} не берём` });
  else if (banned.length)
    parts.push({ kind: "ask", reason: `бывает ${banned.map((b) => BODY_LABEL[b]).join(", ")} — его не берём, уточните кузов` });
  if (m.sport && !listed) parts.push({ kind: "no", reason: "спорткар — как Ford Mustang, не берём" });
  // двигатель: только электро/гибрид — не берём; есть бензиновая версия — передаём
  if (!m.power.includes("g")) parts.push({ kind: "no", reason: "только электро или гибрид — не берём" });
  return [{ zone: null, ...combine(parts) }];
}

/* ── Авто.ру ────────────────────────────────────────────────────────────── */

/** Lada Авто.ру не берёт нигде. */
const AU_BANNED_BRANDS = new Set(["lada"]);
/** Наличие не обещаем — ориентируемся по актуальному справочнику цен. */
const AU_NO_PROMISE = new Set(["datsun", "zotye", "kaiyi"]);
const AU_BODIES: Partial<Record<Body, string>> = {
  com: "грузовые, микроавтобусы и спецтехнику",
  van: "фургоны",
};

/** Авто.ру по марке: Lada — нигде; Москва и СПб — любые; регионы и Екатеринбург — только китайские. */
function checkAutoruBrand(b: Brand): ZoneVerdict[] {
  if (AU_BANNED_BRANDS.has(b.id)) {
    const why = [`${b.name} — Авто.ру не берёт`];
    return [
      { zone: AU_CAPITALS, kind: "no", reasons: why },
      { zone: AU_REGIONS, kind: "no", reasons: why },
    ];
  }
  const note = AU_NO_PROMISE.has(b.id) ? [`${b.name}: наличие не обещаем — ориентируемся по актуальному справочнику цен`] : [];
  const regions: ZoneVerdict = b.cn
    ? { zone: AU_REGIONS, kind: "ok", reasons: note }
    : b.cnLocal
      ? { zone: AU_REGIONS, kind: "ask", reasons: [`${b.name} — местная марка на китайской базе: уточните у РОП`] }
      : { zone: AU_REGIONS, kind: "no", reasons: ["в регионах и Екатеринбурге — только китайские марки"] };
  return [{ zone: AU_CAPITALS, kind: "ok", reasons: note }, regions];
}

/** Авто.ру по модели: марка (по городу) и кузов — грузовые, микроавтобусы, спецтехнику и фургоны не берём. */
function checkAutoru(m: Model): ZoneVerdict[] {
  const banned = m.bodies.filter((b) => AU_BODIES[b]);
  if (!banned.length) return checkAutoruBrand(m.brand);
  // все варианты кузова запрещены — не берём нигде; часть — уточнить кузов (если марка проходит)
  const all = banned.length === m.bodies.length;
  const why = all ? `${cap(AU_BODIES[banned[0]]!)} не берём` : `бывает ${banned.map((b) => BODY_LABEL[b]).join(", ")} — его не берём, уточните кузов`;
  return checkAutoruBrand(m.brand).map((v) =>
    v.kind === "no" ? v : all ? { zone: v.zone, kind: "no" as const, reasons: [why] } : { zone: v.zone, kind: "ask" as const, reasons: [why, ...v.reasons] },
  );
}

/** 100 up по одной марке: ясно только про марки из списка и непонятный премиум. */
function check100upBrand(b: Brand): ZoneVerdict[] | null {
  if (UP_BRANDS.has(b.id)) return [{ zone: null, kind: "no", reasons: [`${b.name} — в списке «не берём»`] }];
  if (b.prem) return [{ zone: null, kind: "ask", reasons: [`${b.name} — премиум-марка, в списке её нет: уточните у РОП`] }];
  return null;
}

const AU_CAPITALS = "Москва и Санкт-Петербург";
const AU_REGIONS = "Регионы и Екатеринбург";

/* ── проекты ────────────────────────────────────────────────────────────── */

const RULES: CarRules[] = [
  {
    key: "100up",
    list: [
      "Mercedes-Benz, BMW, Audi, Porsche",
      "Cadillac, Infiniti, Lexus",
      "Toyota Camry, Land Cruiser Prado / 100 / 200",
      "Kia Carnival",
      "кабриолеты, «Волга», Ford Mustang и подобные",
      "коммерческий транспорт, Газели, спецтехника",
      "пикапы, минивэны",
      "машины только электро или только гибрид (есть бензиновая версия — передаём)",
    ],
    check: check100up,
    checkBrand: check100upBrand,
  },
  {
    key: "autoru",
    list: [
      "Москва и Санкт-Петербург — любые марки, кроме Lada",
      "регионы и Екатеринбург — только китайские марки",
      "Lada не берём нигде",
      "спецтехника, грузовые, микроавтобусы, фургоны — не берём",
      "Datsun, Zotye, Kaiyi — наличие не обещаем, смотрим справочник цен",
    ],
    check: checkAutoru,
    checkBrand: checkAutoruBrand,
  },
];

/**
 * Вердикт по упоминанию машины для лида: город лида выбирает зону (у Авто.ру Москва/СПб
 * и всё остальное), без города — все зоны. null — по одной марке не понять.
 */
export function mentionVerdict(rules: CarRules, m: CarMention, city: string): ZoneVerdict[] | null {
  const vs = m.model ? rules.check(m.model) : rules.checkBrand(m.brand);
  if (!vs || vs.length < 2 || !city.trim()) return vs;
  const capital = /москв|санкт|петербург|спб/i.test(city);
  return vs.filter((v) => v.zone === (capital ? AU_CAPITALS : AU_REGIONS));
}

/** Правила проекта по его названию («100 up», «Авто.ру»); нет — null. */
export function rulesFor(p: Pick<Project, "name"> | null | undefined): CarRules | null {
  const n = (p?.name ?? "").toLowerCase().replace(/[^a-zа-я0-9]+/g, "");
  if (/100(up|ап)/.test(n)) return RULES[0];
  if (/^(авто|auto)(ру|ru)$/.test(n)) return RULES[1];
  return null;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
