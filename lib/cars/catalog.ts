import { BRANDS, MODELS } from "./data";

/**
 * Каталог «Марок авто»: марки и модели из lib/cars/data.ts в удобном виде и быстрый поиск
 * по нему — по-русски и латиницей, в чужой раскладке, с опечатками и народными названиями
 * («крузак», «рафик»). Всё считается на месте, без сети — работает и офлайн, в приложении.
 */

export type Body = "sed" | "hat" | "lb" | "wag" | "suv" | "off" | "cpe" | "cab" | "mpv" | "pu" | "van" | "com";
export type Power = "g" | "h" | "p" | "r" | "e";

export interface Brand {
  id: string;
  name: string;
  /** Как называют по-русски. */
  ru: string[];
  country: string;
  /** Китайская марка. */
  cn: boolean;
  /** Местная марка на базе китайских моделей (Tenet, Belgee, Москвич…). */
  cnLocal: boolean;
  /** Премиум, которого нет в списках проектов. */
  prem: boolean;
  wiki: string;
}

export interface Model {
  /** «toyota-camry» — и имя файла фото. */
  id: string;
  brand: Brand;
  name: string;
  /** «Toyota Camry». */
  full: string;
  aliases: string[];
  from: number;
  to: number | null;
  bodies: Body[];
  /** Спорткар — «как Ford Mustang». */
  sport: boolean;
  power: Power[];
  notes: string;
  wiki: string;
}

export const BODY_LABEL: Record<Body, string> = {
  sed: "седан",
  hat: "хэтчбек",
  lb: "лифтбек",
  wag: "универсал",
  suv: "кроссовер",
  off: "внедорожник",
  cpe: "купе",
  cab: "кабриолет",
  mpv: "минивэн",
  pu: "пикап",
  van: "фургон",
  com: "коммерческий",
};

export const POWER_LABEL: Record<Power, string> = {
  g: "бензин / дизель",
  h: "гибрид",
  p: "подзаряжаемый гибрид",
  r: "электро с запасом хода",
  e: "электро",
};

const RU_LAT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** id модели латиницей — он же имя файла фото: «Классика» → «klassika». */
const slug = (s: string) =>
  s
    .toLowerCase()
    .split("")
    .map((ch) => RU_LAT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const cyr = /[а-яё]/i;

export const BRAND_LIST: Brand[] = BRANDS.map(([id, name, ru, country, flags, wiki]) => ({
  id,
  name,
  ru: ru.split(",").map((s) => s.trim()).filter(Boolean),
  country,
  cn: /\bcn\b/.test(flags),
  cnLocal: /\bcnl\b/.test(flags),
  prem: /\bprem\b/.test(flags),
  wiki: wiki ?? name,
}));

const brandById = new Map(BRAND_LIST.map((b) => [b.id, b]));

function parseModels(): Model[] {
  const out: Model[] = [];
  const seen = new Set<string>();
  for (const [bid, text] of Object.entries(MODELS)) {
    const brand = brandById.get(bid);
    if (!brand) continue;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const f = line.split("|").map((s) => s.trim());
      const [name, aliases = "", years = "", bodies = "", power = "g"] = f;
      // особенности пишутся по-русски; латиница на их месте — это уже статья Википедии
      let notes = f[5] ?? "";
      let wiki = f[6] ?? "";
      if (!wiki && notes && !cyr.test(notes)) {
        wiki = notes;
        notes = "";
      }
      const [from, to] = years.split("-").map((y) => Number(y) || 0);
      const tags = bodies.split(/\s+/).filter(Boolean);
      let id = `${bid}-${slug(name)}`;
      while (seen.has(id)) id += "-2";
      seen.add(id);
      out.push({
        id,
        brand,
        name,
        full: `${brand.name} ${name}`,
        aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean),
        from: from || 0,
        to: to || null,
        bodies: tags.filter((t): t is Body => t in BODY_LABEL),
        sport: tags.includes("sp"),
        power: power.split(/\s+/).filter((p): p is Power => p in POWER_LABEL),
        notes,
        wiki: wiki || `${brand.wiki} ${name}`,
      });
    }
  }
  return out;
}

export const MODEL_LIST: Model[] = parseModels();
export const modelById = new Map(MODEL_LIST.map((m) => [m.id, m]));
export const modelsOf = (brandId: string) => MODEL_LIST.filter((m) => m.brand.id === brandId);

export const yearsLabel = (m: Model) => (m.from ? (m.to ? `${m.from}–${m.to}` : `с ${m.from}`) : "");

/* ── поиск ─────────────────────────────────────────────────────────────── */


/** Строчные, ё → е, без знаков; «2.0» и «1-й» не мешают. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();
}

/**
 * «Звучание» слова латиницей, грубо: русские буквы — транслитом, похожие звуки и гласные
 * сводятся вместе. «тайота», «тойота» и «toyota» дают одно и то же, «камри» = «camry».
 */
export function sound(word: string): string {
  let s = word
    .split("")
    .map((ch) => RU_LAT[ch] ?? ch)
    .join("");
  s = s
    .replace(/ph/g, "f")
    .replace(/kh/g, "h")
    .replace(/ck/g, "k")
    .replace(/qu/g, "kv")
    .replace(/q/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/x/g, "ks")
    .replace(/w/g, "v")
    .replace(/j/g, "y")
    .replace(/[aoeiuy]+/g, (v) => (/[ie]/.test(v[0]) && v.length === 1 ? "i" : "a"))
    .replace(/(.)\1+/g, "$1");
  return s;
}

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = "йцукенгшщзхъфывапролджэячсмитьбюё";
/** Набрали в другой раскладке: «nfqjnf» → «тайота», «щьщвф» → «omoda». */
export function swapLayout(s: string): string {
  return s
    .toLowerCase()
    .split("")
    .map((ch) => {
      const i = EN.indexOf(ch);
      if (i >= 0) return RU[i];
      const j = RU.indexOf(ch);
      return j >= 0 ? EN[j] : ch;
    })
    .join("");
}

/** Расстояние правки (Дамерау–Левенштейн, с перестановкой соседних букв), не дальше max. */
function dist(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
      best = Math.min(best, v);
    }
    if (best > max) return max + 1;
    prev2.splice(0, prev2.length, ...prev);
    prev = cur;
  }
  return prev[b.length];
}

/** «Звучание» слов каталога считаем один раз. */
const soundCache = new Map<string, string>();
function snd(w: string): string {
  let v = soundCache.get(w);
  if (v === undefined) soundCache.set(w, (v = sound(w)));
  return v;
}

/** Слово запроса против слова каталога: 0 — нет, иначе чем больше, тем лучше. */
function wordScore(q: string, w: string): number {
  if (!q || !w) return 0;
  if (w === q) return 10;
  // код модели латиницей / кириллицей / с переставленными буквами: «сх5», «cx90» → XC90
  if (sameCode(q, w)) return 9;
  if (w.startsWith(q)) return q.length >= 2 || /\d/.test(q) ? 8 : 3;
  const sq = snd(q);
  const sw = snd(w);
  if (sq && sw === sq) return 8;
  // начало «по звучанию» — с трёх звуков: «то» и «той» не должны находить Tundra и Tank
  if (sq.length >= 3 && sw.startsWith(sq)) return 6;
  // опечатки — только в словах подлиннее, иначе «х5» найдёт всё подряд
  if (q.length >= 4) {
    const max = q.length >= 7 ? 2 : 1;
    if (dist(q, w.slice(0, q.length + 1), max) <= max) return 4;
    // по звучанию — только если звуков хватает: у коротких любая буква меняет всё («тайот» ≠ «фиат»)
    if (sq.length >= 4 && dist(sq, sw.slice(0, sq.length + 1), 1) <= 1) return 4;
  }
  return 0;
}

interface Entry {
  car: Model;
  /** Слова марки (имя, русские названия). */
  brand: string[][];
  /** Слова модели (имя, народные названия). */
  model: string[][];
}

const words = (s: string) => norm(s).split(" ").filter(Boolean);

const INDEX: Entry[] = MODEL_LIST.map((m) => ({
  car: m,
  brand: [words(m.brand.name), ...m.brand.ru.map(words)],
  // код из нескольких слов — ещё и слитно: «CX-5» ищется и как «cx5»
  model: [words(m.name), ...m.aliases.map(words)].flatMap((v) => (v.length > 1 && /\d/.test(v.join("")) && /[a-zа-я]/.test(v.join("")) ? [v, [v.join("")]] : [v])),
}));

/** Оценка слов каталога для одного слова запроса — с памятью: одно и то же слово встречается у многих моделей. */
type Scorer = (w: string) => number;
function scorer(q: string): Scorer {
  const memo = new Map<string, number>();
  return (w) => {
    let v = memo.get(w);
    if (v === undefined) memo.set(w, (v = wordScore(q, w)));
    return v;
  };
}

/** Лучшее совпадение слова запроса с одним из вариантов названия. */
function bestIn(sc: Scorer, variants: string[][]): number {
  let best = 0;
  for (const v of variants) for (const w of v) best = Math.max(best, sc(w));
  return best;
}

/** Вариант названия, который запрос покрывает целиком: «лк 200», «санта фе». */
function phraseIn(scs: Scorer[], variants: string[][]): number {
  let best = 0;
  for (const v of variants) {
    if (v.length < 2) continue;
    let sum = 0;
    let ok = true;
    for (const w of v) {
      const s = Math.max(0, ...scs.map((sc) => sc(w)));
      if (!s) {
        ok = false;
        break;
      }
      sum += s;
    }
    if (ok) best = Math.max(best, sum / v.length + 2);
  }
  return best;
}

export interface CarHit {
  model: Model;
  score: number;
}

function run(q: string, limit: number): CarHit[] {
  const qs = words(q);
  if (!qs.length) return [];
  const scs = qs.map(scorer);
  const hits: (CarHit & { i: number })[] = [];
  INDEX.forEach((e, i) => {
    let total = 0;
    let matched = 0;
    let brandHit = 0;
    let modelHit = 0;
    for (const sc of scs) {
      const b = bestIn(sc, e.brand);
      const m = bestIn(sc, e.model);
      if (!b && !m) continue;
      matched++;
      total += Math.max(b, m);
      brandHit = Math.max(brandHit, b);
      modelHit = Math.max(modelHit, m);
    }
    // каждое слово запроса должно найтись (одно лишнее прощаем в длинном запросе)
    if (!matched || matched < qs.length - (qs.length >= 3 ? 1 : 0)) return;
    total += phraseIn(scs, e.model);
    // запрос — это народное название целиком («крузак» — это LC 200, а не «крузак 300»)
    if (e.model.some((v) => v.length === qs.length && v.every((w, i) => w === qs[i]))) total += 3;
    // только марка («тойота») — модели марки, но ниже, чем точное попадание в модель
    if (!modelHit) total -= 3;
    else if (brandHit) total += 2;
    // свежие и действующие модели — повыше
    if (!e.car.to) total += 0.5;
    hits.push({ model: e.car, score: total, i });
  });
  // при равенстве — порядок каталога: у марки сначала ходовые модели
  hits.sort((a, b) => b.score - a.score || a.i - b.i);
  // слабые совпадения рядом с сильным — шум («джолион» → не нужны Jaecoo)
  const top = hits[0]?.score ?? 0;
  return hits
    .filter((h) => h.score >= top * 0.5)
    .slice(0, limit)
    .map(({ model, score }) => ({ model, score }));
}

/** Подсказки по набранному: прямой запрос, а если пусто — тот же в другой раскладке. */
export function searchCars(q: string, limit = 8): CarHit[] {
  if (!norm(q)) return [];
  const direct = run(q, limit);
  if (direct.length && direct[0].score >= 6) return direct;
  const swapped = run(swapLayout(q), limit);
  if (!direct.length) return swapped;
  return swapped.length && swapped[0].score > direct[0].score ? swapped : direct;
}

/** Марка по запросу («тайота» → Toyota) — для списка моделей марки. */
export function findBrand(q: string): Brand | null {
  const qs = words(q);
  if (qs.length !== 1) return null;
  let best: { b: Brand; s: number } | null = null;
  for (const b of BRAND_LIST) {
    const s = bestIn(scorer(qs[0]), [words(b.name), ...b.ru.map(words)]);
    if (s >= 8 && (!best || s > best.s)) best = { b, s };
  }
  return best?.b ?? null;
}

/* ── машина в свободном тексте (комментарий лида) ─────────────────────────── */

/**
 * Обычные слова, которые совпадают с народными названиями моделей: без марки рядом
 * («бонус», «жук», «патриот») машиной их не считаем.
 */
const PLAIN = new Set(
  "самара соль жук куб поло гольф бонус вери фора искра аура мега фри легенд пилот элемент капитан кураж атлас галакси амулет бриз смайли патриот буханка батон классика пятерка семерка шестерка девятка десятка четырка трешка двойка единичка сотка рич фит джаз хантер тан хан сил сонг чайка дельфин долфин сигал кроун марк раш мокка мока омега комбо партнер мастер трафик браво панда типо линеа эдж бронко круз круза малибу трекер монза оникс караван рэм рам калибр нитро навигатор авиатор рома тиволи муссо юник одиссей спектра соната оптима рапид мурано территори волга нива калина зубило козел головастик профи вито спринтер дамас лабо бонго портер".split(" "),
);

/** Обычные слова — по звучанию: «бонус» и «bonus» — одно и то же. */
let plainSnd: Set<string> | null = null;
// и в других падежах: «из Самары», «в Самаре» — город, а не Lada Samara
const isPlain = (w: string) => (plainSnd ??= new Set([...PLAIN].map(sound))).has(snd(w)) || [...PLAIN].some((p) => sameWord(w, p));
/** Номер-название («2114», «31105») без марки — машина, если это не год. */
const numberName = (w: string) => /^\d{4,5}$/.test(w) && !(+w >= 1950 && +w <= 2035);

/** Похожие буквы кириллицы → латиница: в кодах моделей их путают («сх5» = «cx5», «х5» = «x5»). */
const LOOK: Record<string, string> = { а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", р: "p", с: "c", т: "t", у: "y", х: "x" };
const code = (s: string) =>
  s
    .split("")
    .map((ch) => LOOK[ch] ?? RU_LAT[ch] ?? ch)
    .join("");
const digitsOf = (s: string) => s.replace(/\D/g, "");

/**
 * Код модели «буквы + цифры» («x5», «cx5», «xc90», «сх5»): то же самое латиницей; или те же цифры
 * и переставлены две соседние буквы («cx90» → XC90). Другая цифра — другая модель («x5» ≠ «x6»).
 */
function sameCode(t: string, w: string): boolean {
  if (!/\d/.test(w) || !/[a-zа-я]/.test(w) || !/\d/.test(t)) return false;
  const a = code(t);
  const b = code(w);
  if (a === b) return true;
  if (a.length < 3 || a.length !== b.length || digitsOf(a) !== digitsOf(b)) return false;
  return [...a].sort().join("") === [...b].sort().join("") && dist(a, b, 1) === 1;
}

/** Слово текста — это слово названия: так же пишется, звучит или стоит в другом падеже («весту», «крузака»). */
function sameWord(t: string, w: string): boolean {
  if (t === w) return true;
  if (sameCode(t, w)) return true;
  if (/\d/.test(w) || /\d/.test(t)) return false;
  if (w.length < 4 || t.length < 4) return false;
  if (snd(t) === snd(w)) return true;
  // другой падеж: слово названия целиком плюс окончание («крузака», «соляриса»)…
  if (t.startsWith(w) && t.length - w.length <= 2) return true;
  // …или без последней гласной («весту», «тойоты», «приору»). «москвы» — не «москвич», «некст» — не «нексия»
  return /[аяоеиыуюэ]$/.test(w) && t.startsWith(w.slice(0, -1)) && t.length - w.length <= 1;
}

/** Где в тексте стоит вариант названия (слова подряд): начало и сколько слов текста занял; null — нет. */
function findSeq(text: string[], v: string[]): { at: number; len: number } | null {
  if (!v.length) return null;
  for (let i = 0; i + v.length <= text.length; i++) {
    let ok = true;
    for (let k = 0; k < v.length && ok; k++) ok = sameWord(text[i + k], v[k]);
    if (ok) return { at: i, len: v.length };
  }
  // код модели слитно или раздельно: «cx5» = «CX-5», «xc 90» = «XC90»
  const joined = v.join("");
  if (/\d/.test(joined) && /[a-zа-я]/.test(joined)) {
    for (let i = 0; i < text.length; i++) {
      if (v.length > 1 && sameCode(text[i], joined)) return { at: i, len: 1 };
      if (i + 1 < text.length && /\d/.test(text[i + 1]) && !/\d/.test(text[i]) && sameCode(text[i] + text[i + 1], joined)) return { at: i, len: 2 };
    }
  }
  return null;
}

/** Слова названий моделей марки — чтобы узнать марку с опечаткой рядом с её моделью («kio rio»). */
const modelWordsByBrand = new Map<string, Set<string>>();
function modelWordsOf(brandId: string): Set<string> {
  let s = modelWordsByBrand.get(brandId);
  if (!s) {
    s = new Set<string>();
    for (const m of MODEL_LIST) if (m.brand.id === brandId) for (const v of [words(m.name), ...m.aliases.map(words)]) v.forEach((w) => s!.add(w));
    modelWordsByBrand.set(brandId, s);
  }
  return s;
}

export interface CarMention {
  /** Модель; нет — назвали только марку («мерседес»). */
  model: Model | null;
  brand: Brand;
  /** Как это написано в тексте. */
  said: string;
}

/**
 * Машины, о которых говорится в тексте: «хочет продать свой прадик 2012» → Toyota Land Cruiser Prado.
 * Модель без марки рядом засчитываем, только если её название ни с чем не спутать
 * (4+ буквы, не цифры, не обычное слово); иначе нужна марка рядом. Только марка — тоже находка.
 * Опечатки: код модели слитно, раздельно и с переставленными буквами («cx5», «xc 90», «cx90»),
 * короткая марка с одной ошибкой — если рядом её модель («kio rio» → Kia Rio).
 */
export function detectCars(text: string, limit = 2): CarMention[] {
  const t = norm(text).split(" ").filter(Boolean);
  if (!t.length) return [];
  // марки в тексте; exact — написано ровно как в каталоге (при споре за слово побеждает точное)
  const brandAt = new Map<string, { at: number; len: number; exact: boolean }>();
  for (const b of BRAND_LIST)
    for (const v of [words(b.name), ...b.ru.map(words)]) {
      const f = findSeq(t, v);
      if (!f || brandAt.has(b.id)) continue;
      brandAt.set(b.id, { ...f, exact: t.slice(f.at, f.at + f.len).join(" ") === v.join(" ") });
    }
  // опечатка в короткой марке («kio», «hunday»): одна ошибка, та же первая буква, и рядом — модель этой марки
  for (const b of BRAND_LIST) {
    if (brandAt.has(b.id)) continue;
    const names = [words(b.name), ...b.ru.map(words)].filter((v) => v.length === 1 && v[0].length >= 3).map((v) => v[0]);
    for (let i = 0; i < t.length && names.length; i++) {
      const w = t[i];
      if (w.length < 3 || /\d/.test(w) || !names.some((n) => n[0] === w[0] && n !== w && dist(w, n, 1) <= 1)) continue;
      const near = [t[i - 1], t[i + 1]].filter((x): x is string => !!x);
      const mw = modelWordsOf(b.id);
      if (near.some((x) => [...mw].some((m) => sameWord(x, m)))) {
        brandAt.set(b.id, { at: i, len: 1, exact: false });
        break;
      }
    }
  }
  const found: (CarMention & { at: number; len: number; score: number })[] = [];
  for (const m of MODEL_LIST) {
    let best: { at: number; len: number; words: number; chars: number } | null = null;
    for (const v of [words(m.name), ...m.aliases.map(words)]) {
      const f = findSeq(t, v);
      if (!f) continue;
      const joined = v.join("");
      const withBrand = brandAt.has(m.brand.id);
      const isCode = /\d/.test(joined) && /[a-zа-я]/.test(joined);
      const distinct =
        numberName(joined) ||
        // код вроде «xc90», «cx5» без марки — машина, если он не короче трёх знаков («x5» без BMW — мало ли)
        (isCode && joined.length >= 3 && !/^\d+$/.test(joined)) ||
        (joined.length >= 4 && !/^\d+$/.test(joined) && !(v.length === 1 && (isPlain(v[0]) || isPlain(t[f.at]))));
      if (!withBrand && !distinct) continue;
      if (!best || v.length > best.words || (v.length === best.words && joined.length > best.chars)) best = { ...f, words: v.length, chars: joined.length };
    }
    if (!best) continue;
    const b = brandAt.get(m.brand.id);
    // марка вплотную к модели — и её в цитату: «volvo cx90», а не «cx90»
    const from = b && b.at + b.len === best.at ? b.at : best.at;
    const to = b && best.at + best.len === b.at ? b.at + b.len : best.at + best.len;
    found.push({
      model: m,
      brand: m.brand,
      at: best.at,
      len: best.len,
      said: t.slice(from, to).join(" "),
      score: best.words + best.chars / 10 + (b ? 10 : 0) - (m.to ? 0.5 : 0),
    });
  }
  // одно место текста — одна машина: из «лк 200» не нужны ещё Prado и 300, из «газель некст» — Nexia
  found.sort((a, b) => b.score - a.score);
  const taken = new Set<number>();
  const cells = (at: number, len: number) => Array.from({ length: len }, (_, k) => at + k);
  const out: (CarMention & { at: number })[] = [];
  for (const f of found) {
    const own = cells(f.at, f.len);
    if (own.some((c) => taken.has(c))) continue;
    own.forEach((c) => taken.add(c));
    // слово марки этой модели тоже занято: «hyundai solaris» — не ещё и Honda на «hyundai»
    const b = brandAt.get(f.brand.id);
    if (b) cells(b.at, b.len).forEach((c) => taken.add(c));
    out.push(f);
  }
  // марка без модели — сначала написанные точно; одно слово — одна марка
  const brands = [...brandAt].sort((a, b) => Number(b[1].exact) - Number(a[1].exact) || a[1].at - b[1].at);
  for (const [id, b] of brands) {
    if (out.some((o) => o.brand.id === id) || cells(b.at, b.len).some((c) => taken.has(c))) continue;
    cells(b.at, b.len).forEach((c) => taken.add(c));
    const brand = BRAND_LIST.find((x) => x.id === id)!;
    out.push({ model: null, brand, at: b.at, said: t.slice(b.at, b.at + b.len).join(" ") });
  }
  return out
    .sort((a, b) => a.at - b.at)
    .slice(0, limit)
    .map(({ model, brand, said }) => ({ model, brand, said }));
}
