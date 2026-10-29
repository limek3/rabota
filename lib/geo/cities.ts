import RAW from "./ru-cities.json";
import type { DataState } from "../crm/types";

/**
 * Города России для «Карты городов»: поиск города клиента и ближайшие города, где мы
 * работаем. Справочник — открытый датасет hflabs/city (MIT, github.com/hflabs/city):
 * 1117 городов с координатами, регионом, населением и часовым поясом. Собран в
 * ru-cities.json (scripts/build-cities.cjs): [имя, № региона, широта, долгота, население, UTC±, центр региона].
 * Всё считается на месте, без внешних сервисов — работает и офлайн, в приложении.
 */

export interface City {
  id: number;
  name: string;
  region: string;
  lat: number;
  lon: number;
  pop: number;
  /** Часовой пояс: UTC+N. */
  utc: number;
  /** Центр региона (или город федерального значения). */
  capital: boolean;
}

const DATA = RAW as { regions: string[]; cities: [string, number, number, number, number, number, number][] };

/** Все города, крупные — первыми. */
export const CITIES: City[] = DATA.cities.map(([name, r, lat, lon, pop, utc, cap], id) => ({
  id,
  name,
  region: DATA.regions[r] ?? "",
  lat,
  lon,
  pop,
  utc,
  capital: cap === 1,
}));

/** Для сравнения: регистр, ё, дефисы и лишние пробелы, приставки «г.», «город». */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[‐-―−-]/g, " ")
    .replace(/[^a-zа-я0-9 ]/g, " ")
    .replace(/^\s*(г|гор|город|пгт|п|с|село|пос|поселок|рп)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Набрали в английской раскладке: «vjcrdf» → «москва». */
const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = "йцукенгшщзхъфывапролджэячсмитьбюё";
export function fixLayout(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((ch) => {
      const i = EN.indexOf(ch);
      return i >= 0 ? RU[i] : ch;
    })
    .join("");
}

const N_NAME = CITIES.map((c) => norm(c.name));
const N_REGION = CITIES.map((c) => norm(c.region));

export interface Hit {
  city: City;
  /** Нашёлся по региону: «Башкортостан» → Уфа. */
  byRegion?: boolean;
}

/**
 * Подсказки по набранному: точное имя, начало имени, начало слова в имени («новгород» —
 * и Великий, и Нижний), затем регион (его центр). Внутри — крупные выше.
 */
export function searchCities(q: string, limit = 8): Hit[] {
  const run = (s: string): Hit[] => {
    const n = norm(s);
    if (!n) return [];
    const scored: { i: number; score: number; byRegion?: boolean }[] = [];
    N_NAME.forEach((name, i) => {
      let score = 0;
      if (name === n) score = 4;
      else if (name.startsWith(n)) score = 3;
      else if (name.split(" ").some((w) => w.startsWith(n))) score = 2;
      else if (n.length >= 3 && name.includes(n)) score = 1;
      if (score) scored.push({ i, score });
    });
    // регион: его центр — отдельной подсказкой, если сам центр ещё не нашёлся по имени
    if (n.length >= 3) {
      const seen = new Set(scored.map((x) => x.i));
      CITIES.forEach((c, i) => {
        if (!c.capital || seen.has(i)) return;
        const words = N_REGION[i].split(" ");
        if (N_REGION[i].startsWith(n) || words.some((w) => w.startsWith(n))) scored.push({ i, score: 0.5, byRegion: true });
      });
    }
    scored.sort((a, b) => b.score - a.score || CITIES[b.i].pop - CITIES[a.i].pop);
    return scored.slice(0, limit).map((x) => ({ city: CITIES[x.i], byRegion: x.byRegion }));
  };
  const hits = run(q);
  if (hits.length || !/[a-z]/i.test(q)) return hits;
  return run(fixLayout(q));
}

/**
 * Строка из настроек или проекта → город справочника: «Москва», «г. Самара», «Краснодарский край»
 * (центр региона), «Москва и МО» (город внутри строки). null — не нашли.
 */
export function geocode(label: string): City | null {
  const n = norm(label);
  if (!n) return null;
  // одноимённые города (Киров, Железногорск) — берём крупный: список уже по убыванию населения
  const exact = N_NAME.indexOf(n);
  if (exact >= 0) return CITIES[exact];
  const region = CITIES.findIndex((c, i) => c.capital && (N_REGION[i] === n || N_REGION[i].startsWith(n + " ") || n.startsWith(N_REGION[i])));
  if (region >= 0) return CITIES[region];
  // область без столицы в справочнике («Московская область») — её крупнейший город
  const anyIn = N_REGION.indexOf(n);
  if (anyIn >= 0) return CITIES[anyIn];
  // «Москва и МО», «Екатеринбург (ДЦ на Ленина)» — первое слово-город
  const words = ` ${n} `;
  const inside = N_NAME.findIndex((name) => name.length >= 4 && words.includes(` ${name} `));
  return inside >= 0 ? CITIES[inside] : null;
}

/** Расстояние по прямой, км. */
export function distKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Дорога примерно на четверть длиннее прямой; в среднем ~70 км/ч с остановками. */
export const roadKm = (km: number) => km * 1.25;
export const driveHours = (km: number) => roadKm(km) / 70;

/** Наш город: где он в справочнике и откуда он взялся (основа, регионы, проекты). */
export interface OurCity {
  city: City;
  /** Как записан в настройках / проекте. */
  labels: string[];
  /** Проекты, которые в нём работают (имена). Пусто — общий список настроек. */
  projects: string[];
  segment: "main" | "regional" | "project";
}

export interface OurCities {
  list: OurCity[];
  /** Не нашли в справочнике — показываем, чтобы поправили написание. */
  unknown: string[];
}

/**
 * Где мы работаем: «Основа» и «Регионы» из настроек, плюс свои города проектов (100 up — города
 * автосалонов). projectId — только города этого проекта (у проекта без своих — города настроек).
 */
export function ourCities(st: Pick<DataState, "settings" | "projects">, projectId = ""): OurCities {
  const map = new Map<number, OurCity>();
  const unknown = new Set<string>();
  const add = (label: string, segment: OurCity["segment"], project?: string) => {
    const c = geocode(label);
    if (!c) {
      if (label.trim()) unknown.add(label.trim());
      return;
    }
    let o = map.get(c.id);
    if (!o) map.set(c.id, (o = { city: c, labels: [], projects: [], segment }));
    if (!o.labels.includes(label)) o.labels.push(label);
    if (project && !o.projects.includes(project)) o.projects.push(project);
    // свой проект важнее общего списка, основа — важнее регионов
    if (segment === "main" && o.segment === "regional") o.segment = "main";
  };
  const projects = st.projects.filter((p) => !p.deletedAt && p.active);
  const general = (project?: string) => {
    st.settings.regions.main.forEach((r) => add(r, "main", project));
    st.settings.regions.regional.forEach((r) => add(r, "regional", project));
  };
  if (projectId) {
    const p = projects.find((x) => x.id === projectId);
    if (p?.regions?.length) p.regions.forEach((r) => add(r, "project", p.name));
    else general(p?.name);
  } else {
    general();
    for (const p of projects) p.regions?.forEach((r) => add(r, "project", p.name));
  }
  return { list: [...map.values()].sort((a, b) => b.city.pop - a.city.pop), unknown: [...unknown] };
}

export interface Near {
  our: OurCity;
  km: number;
}

/** Ближайшие наши города к точке, по прямой. */
export function nearest(from: { lat: number; lon: number }, ours: OurCity[], limit = 5): Near[] {
  return ours
    .map((our) => ({ our, km: distKm(from, our.city) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

/** Ближайший город справочника к точке на карте (клик мимо городов). */
export function closestCity(p: { lat: number; lon: number }): { city: City; km: number } {
  let best = CITIES[0];
  let bestKm = Infinity;
  for (const c of CITIES) {
    const km = distKm(p, c);
    if (km < bestKm) {
      bestKm = km;
      best = c;
    }
  }
  return { city: best, km: bestKm };
}

/** «МСК+2», «МСК», «МСК−1». */
export function mskOffset(utc: number): string {
  const d = utc - 3;
  return d === 0 ? "МСК" : `МСК${d > 0 ? "+" : "−"}${Math.abs(d)}`;
}

/** Местное время в поясе UTC+N сейчас: «14:05». */
export function localTime(utc: number, now: Date = new Date()): string {
  const t = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + utc * 3600000);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
}

/** «1,2 млн», «340 тыс.», «12 тыс.» */
export function fmtPop(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")} млн`;
  if (n >= 1000) return `${Math.round(n / 1000)} тыс.`;
  return String(n);
}

/* ── проекция: равноугольная коническая Ламберта — Россия выглядит привычно ── */

const RAD = Math.PI / 180;
const P1 = 52 * RAD;
const P2 = 64 * RAD;
const L0 = 100 * RAD;
const N_ = Math.log(Math.cos(P1) / Math.cos(P2)) / Math.log(Math.tan(Math.PI / 4 + P2 / 2) / Math.tan(Math.PI / 4 + P1 / 2));
const F_ = (Math.cos(P1) * Math.tan(Math.PI / 4 + P1 / 2) ** N_) / N_;
const RHO0 = F_ / Math.tan(Math.PI / 4 + (60 * RAD) / 2) ** N_;
/** Масштаб: единицы карты ~ километры. */
const K = 6371;

/** Широта/долгота → x, y карты (y вниз, как в SVG). */
export function project(lat: number, lon: number): [number, number] {
  const rho = F_ / Math.tan(Math.PI / 4 + (lat * RAD) / 2) ** N_;
  const th = N_ * (lon * RAD - L0);
  return [K * rho * Math.sin(th), -K * (RHO0 - rho * Math.cos(th))];
}

/** x, y карты → широта/долгота (клик по карте). */
export function unproject(x: number, y: number): { lat: number; lon: number } {
  const X = x / K;
  const Y = RHO0 + y / K;
  const rho = Math.sign(N_) * Math.sqrt(X * X + Y * Y);
  const th = Math.atan2(X, Y);
  const lat = (2 * Math.atan((F_ / rho) ** (1 / N_)) - Math.PI / 2) / RAD;
  const lon = (L0 + th / N_) / RAD;
  return { lat, lon };
}

/** Точка в km по прямой от from по азимуту deg (0 — север): для колец расстояний. */
export function destination(from: { lat: number; lon: number }, km: number, deg: number): { lat: number; lon: number } {
  const d = km / 6371;
  const b = deg * RAD;
  const f1 = from.lat * RAD;
  const l1 = from.lon * RAD;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return { lat: f2 / RAD, lon: l2 / RAD };
}

/** Короткое имя региона для подписи на карте: «Татарстан», «Самарская обл.», «ХМАО — Югра». */
export function shortRegion(name: string): string {
  if (name.startsWith("Ханты-Мансийский")) return "ХМАО — Югра";
  if (name.startsWith("Ямало-Ненецкий")) return "ЯНАО";
  return name
    .replace(/^Республика /, "")
    .replace(/ Республика$/, "")
    .replace(/ автономн(ый округ|ая область)/, " АО")
    .replace(/ область/, " обл.")
    .replace(/ — Кузбасс/, "");
}
