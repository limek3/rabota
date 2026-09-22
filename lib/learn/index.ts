import raw from "./content.json";
import type { AccountRole, LearnProgress } from "@/lib/crm/types";
import type { IconName } from "@/components/ui/icons";

/**
 * «Академия обзвона» внутри платформы.
 *
 * Структура — один в один как в исходных материалах: роль → программа (курс) →
 * модуль → материал, плюс разделы «В звонке», «Справочники» и «Личное».
 * Контент лежит в content.json и обновляется скриптом scripts/import-academy.mjs;
 * руками его не правим, чтобы обновление исходников не затиралось.
 */

export type NoteKind = "tip" | "warn" | "err" | "ok";

export type Block =
  | { p: string; first?: number }
  | { h: string }
  | { ul: string[] }
  | { ol: string[] }
  | { n: { k: NoteKind; t: string; b: string } }
  | { tb: { h: string[]; r: string[][] } }
  /** Реплика скрипта: подпись, время, текст «говорим дословно». */
  | { s: { l: string; t?: string; b: string } }
  /** Диалог: ["cl" | "op", реплика]. */
  | { d: [string, string][] }
  /** Чек-лист с отметками. */
  | { ck: { id: string; items: string[] } };

export interface QuizQ {
  q: string;
  o: string[];
  /** Индекс правильного варианта. */
  a: number;
  /** Разбор ответа. */
  w?: string;
}

export type WidgetId =
  | "st-re" | "st-auto" | "prices" | "obj-re" | "obj-auto" | "gloss"
  | "auto-prices" | "auto-cities" | "calc-op" | "calc-sv"
  | "tr-re" | "tr-auto" | "tr-all" | "tr-st";

export interface LearnItem {
  id: string;
  t: string;
  /** Тип материала: Урок, Тест, Справочник, Тренажёр, Калькулятор, Регламент, Скрипт, Чек-лист. */
  k?: string;
  /** Сколько занимает: «5 мин». */
  m?: string;
  b?: Block[];
  w?: WidgetId;
  quiz?: QuizQ[];
  /** Итоговая аттестация курса. */
  final?: number;
  /** Материал показан повторно (взят из другого модуля). */
  from?: string;
}

export interface LearnModule {
  t: string;
  items: LearnItem[];
}

export interface Course {
  id: string;
  group: string;
  role: "operator" | "supervisor" | "both";
  track: string;
  icon: string;
  title: string;
  desc: string;
  tags: string[];
  modules: LearnModule[];
}

export interface Refs {
  prices: { zone: string; transfer: string; city: string; s: string; k1: string; k2: string; k3: string }[];
  statusesRealty: { g: string; n: string; d: string }[];
  statusesAuto: { g: string; n: string; d: string }[];
  objections: { t: string; q: string; a: string }[];
  glossary: { t: string; d: string; g: string }[];
  autoPrices: { name: string; aliases: string; price: number; segment: string; country: string; power: string }[];
  autoCities: { city: string; km: number; hub: string }[];
}

/** Оболочка исходника тоже своя у каждой роли — берётся из файла при импорте. */
export interface Features {
  /** Режим «Только реплики» у скриптов: говорим одной колонкой, пояснения свёрнуты. */
  runMode: boolean;
  /** Кнопка «Скопировать» у реплик и диалогов. */
  copy: boolean;
}

const content = raw as unknown as {
  /** Все версии курсов; ключ — id, а если у ролей курс разный — id@роль. */
  library: (Course & { key: string })[];
  roles: Record<AcademyRole, { courses: string[]; features: Features; source: string; importedAt: string }>;
  refs: Refs;
  dataAsOf: string;
  dataSrc: Record<string, string>;
  importedAt: string;
};

export const REFS: Refs = content.refs;
export const DATA_AS_OF: string = content.dataAsOf;
export const DATA_SRC: Record<string, string> = content.dataSrc;
export const IMPORTED_AT: string = content.importedAt;

/* ── академия роли и её индексы ─────────────────────────────────── */

export type AcademyRole = "operator" | "supervisor";

/**
 * Академия одной роли: оператор учится по операторскому файлу, супервайзер и РОП —
 * по супервайзерскому. id курсов и материалов у ролей общие (прогресс один),
 * а тексты, состав модулей и оболочка могут различаться.
 */
export interface Lib {
  role: AcademyRole;
  courses: Course[];
  features: Features;
  byId: Map<string, LearnItem>;
  itemCourse: Map<string, Course>;
  itemModule: Map<string, LearnModule>;
  courseIndex: Map<string, Course>;
  /** Все материалы без повторов (пункт-ссылка из другого модуля не в счёт). */
  flat: LearnItem[];
}

function buildLib(role: AcademyRole): Lib {
  const byKey = new Map(content.library.map((c) => [c.key, c]));
  const r = content.roles[role];
  const courses = r.courses.map((k) => byKey.get(k)).filter(Boolean) as Course[];
  const L: Lib = {
    role,
    courses,
    features: r.features,
    byId: new Map(),
    itemCourse: new Map(),
    itemModule: new Map(),
    courseIndex: new Map(),
    flat: [],
  };
  for (const c of courses) {
    L.courseIndex.set(c.id, c);
    for (const m of c.modules)
      for (const it of m.items) {
        L.byId.set(it.id, it);
        L.itemCourse.set(it.id, c);
        L.itemModule.set(it.id, m);
        if (!it.from) L.flat.push(it);
      }
  }
  return L;
}

const LIBS: Record<AcademyRole, Lib> = { operator: buildLib("operator"), supervisor: buildLib("supervisor") };

/** Академия роли. */
export const lib = (role: AcademyRole): Lib => LIBS[role];

export const courseById = (role: AcademyRole, id: string): Course | undefined => LIBS[role].courseIndex.get(id);
export const itemById = (role: AcademyRole, id: string): LearnItem | undefined => LIBS[role].byId.get(id);

export function allItems(c: Course): LearnItem[] {
  return c.modules.flatMap((m) => m.items);
}

/** Материалы курса, которые считаются его программой (без повторов). */
export function realItems(c: Course): LearnItem[] {
  return allItems(c).filter((i) => !i.from);
}

/** Прежнее имя realItems — чтобы не ломать вызовы. */
export const countable = realItems;

/* ── роли и программы ───────────────────────────────────────────── */

/** В академии две роли. РОП смотрит академию глазами супервайзера. */
export const academyRole = (role: AccountRole): AcademyRole => (role === "operator" ? "operator" : "supervisor");

export const ROLES: Record<AcademyRole, string> = { operator: "Оператор", supervisor: "Супервайзер" };

export const PROGRAMS: Record<AcademyRole, string[]> = {
  operator: ["op-realty", "op-auto"],
  supervisor: ["sv-hire", "sv-manage", "sv-money"],
};

export const PROGNAME: Record<string, string> = {
  realty: "Недвижимость",
  auto: "Авто",
  both: "Недвижимость и Авто",
  sv: "Супервайзер",
};

/** Курсы программы роли. */
export function roleCourses(role: AcademyRole): Course[] {
  return PROGRAMS[role].map((id) => courseById(role, id)).filter(Boolean) as Course[];
}

export function itemKind(i: LearnItem): string {
  return i.k || (i.quiz ? "Тест" : i.w ? "Справочник" : "Урок");
}

/** Иконка типа материала — как в исходных материалах. */
export const KIND: Record<string, IconName> = {
  Урок: "doc",
  Скрипт: "chat",
  Регламент: "rules",
  "Чек-лист": "clip",
  Справочник: "book",
  Тест: "test",
  Тренажёр: "bolt",
  Калькулятор: "calc",
};

export const kindIcon = (i: LearnItem): IconName => KIND[itemKind(i)] ?? "doc";

/** Оттенок чипа по типу материала — чтобы дерево читалось с одного взгляда. */
export function kindHue(kind: string): string {
  if (kind === "Тест") return "amber";
  if (kind === "Тренажёр") return "purple";
  if (kind === "Калькулятор") return "teal";
  if (kind === "Справочник") return "blue";
  if (kind === "Регламент") return "indigo";
  if (kind === "Скрипт") return "pink";
  if (kind === "Чек-лист") return "green";
  return "gray";
}

/* ── разделы ────────────────────────────────────────────────────── */

export type SectionId =
  | "home" | "courses" | "tests" | "progress"
  | "scripts" | "objections" | "statuses" | "checklists"
  | "regs" | "money" | "bases" | "opmat"
  | "realty" | "autoprices" | "cities" | "pay" | "gloss"
  | "notes" | "team";

export interface SectionNode {
  id: SectionId;
  t: string;
  i: IconName;
}

export const SECTIONS: Record<AcademyRole, { g: string; items: SectionNode[] }[]> = {
  operator: [
    {
      g: "Обучение",
      items: [
        { id: "home", t: "Главная", i: "home" },
        { id: "courses", t: "Курсы", i: "book" },
        { id: "tests", t: "Тесты", i: "test" },
        { id: "progress", t: "Мой прогресс", i: "chart" },
      ],
    },
    {
      g: "В звонке",
      items: [
        { id: "scripts", t: "Скрипты", i: "doc" },
        { id: "objections", t: "Возражения", i: "chat" },
        { id: "statuses", t: "Статусы", i: "list" },
        { id: "checklists", t: "Чек-листы", i: "clip" },
      ],
    },
    {
      g: "Справочники",
      items: [
        { id: "realty", t: "Новостройки: цены", i: "build" },
        { id: "autoprices", t: "Авто: цены", i: "car" },
        { id: "cities", t: "Города и расстояния", i: "pin" },
        { id: "pay", t: "Оплата и оформление", i: "money" },
        { id: "gloss", t: "Глоссарий", i: "book" },
      ],
    },
    { g: "Личное", items: [{ id: "notes", t: "Мои заметки", i: "note" }] },
  ],
  supervisor: [
    {
      g: "Обучение",
      items: [
        { id: "home", t: "Главная", i: "home" },
        { id: "courses", t: "Курсы", i: "book" },
        { id: "tests", t: "Тесты", i: "test" },
        { id: "progress", t: "Мой прогресс", i: "chart" },
      ],
    },
    {
      g: "В работе",
      items: [
        { id: "scripts", t: "Скрипт интервью", i: "doc" },
        { id: "checklists", t: "Чек-листы", i: "clip" },
        { id: "regs", t: "Регламенты", i: "rules" },
        { id: "money", t: "Мотивация и бонус", i: "money" },
        { id: "bases", t: "Базы и лиды", i: "base" },
      ],
    },
    { g: "Для группы", items: [{ id: "opmat", t: "Материалы операторов", i: "users" }] },
    { g: "Личное", items: [{ id: "notes", t: "Мои заметки", i: "note" }] },
  ],
};

/** Раздел «Обучение команды» — наш, платформенный: кто из сотрудников что прошёл. */
export const TEAM_SECTION: SectionNode = { id: "team", t: "Обучение команды", i: "users" };

export function sectionsFor(role: AccountRole): { g: string; items: SectionNode[] }[] {
  const base = SECTIONS[academyRole(role)];
  if (role === "operator") return base;
  return base.map((g) => (g.g === "Для группы" ? { ...g, items: [...g.items, TEAM_SECTION] } : g));
}

export function sectionName(role: AccountRole, id: SectionId): string {
  for (const g of sectionsFor(role)) for (const n of g.items) if (n.id === id) return n.t;
  return "Раздел";
}

const pick = (role: AcademyRole, ids: string[]): LearnItem[] => ids.map((x) => LIBS[role].byId.get(x)).filter(Boolean) as LearnItem[];

/** Материалы роли: всё, что входит в её программы. */
export function roleItems(role: AcademyRole): LearnItem[] {
  return roleCourses(role).flatMap((c) => realItems(c));
}

/** Набор материалов раздела — ровно как в исходной академии. */
export function sectionItems(role: AcademyRole, sec: SectionId): LearnItem[] {
  const R = roleItems(role);
  const P = (ids: string[]) => pick(role, ids);
  switch (sec) {
    case "courses":
      return R;
    case "scripts":
      return role === "supervisor" ? P(["s22", "s24", "s23"]) : R.filter((i) => i.k === "Скрипт");
    case "checklists":
      return R.filter((i) => i.k === "Чек-лист");
    case "regs":
      return R.filter((i) => i.k === "Регламент");
    case "tests":
      return R.filter((i) => i.quiz);
    case "money":
      return P(["s61", "s62", "s63"]);
    case "bases":
      return P(["s71", "s72"]);
    case "objections":
      return P(["r41", "r42", "r43", "a33", "a34", "t1"]);
    case "statuses":
      return P(["r23", "a22", "t2"]);
    case "realty":
      return P(["r33"]);
    case "pay":
      return P(["r51", "r52", "r53", "a41"]);
    case "autoprices":
      return P(["auto-prices", "a12", "auto-terms"]);
    case "cities":
      return P(["auto-cities"]);
    case "gloss":
      return P(["f2"]);
    case "opmat": {
      const out: LearnItem[] = [];
      for (const id of ["op-realty", "op-auto", "ref", "train"]) {
        const c = courseById(role, id);
        if (c) out.push(...realItems(c));
      }
      return out;
    }
    default:
      return [];
  }
}

/** В каком разделе материал «живёт» по умолчанию. */
export function naturalSection(role: AcademyRole, id: string): SectionId {
  const it = LIBS[role].byId.get(id);
  const c = LIBS[role].itemCourse.get(id);
  if (!it || !c) return "home";
  const mine = PROGRAMS[role].includes(c.id);
  if (!mine) return role === "supervisor" ? "opmat" : "courses";
  if (it.quiz) return "tests";
  if (it.k === "Скрипт") return "scripts";
  if (it.k === "Чек-лист") return "checklists";
  if (it.k === "Регламент" && role === "supervisor") return "regs";
  return "courses";
}

/* ── боковая панель «под рукой» ─────────────────────────────────── */

export interface AsideRow {
  t: string;
  s: string;
  /** Куда ведёт: материал (`item:<id>`) или виджет-справочник. */
  d: string;
  i: IconName;
}

export const ASIDE: Record<string, { call: AsideRow[]; near: AsideRow[] }> = {
  realty: {
    call: [
      { t: "Скрипт звонка", s: "Открытие и квалификация", d: "item:r31", i: "doc" },
      { t: "Статусы", s: "Что ставить после разговора", d: "st-re", i: "list" },
      { t: "Возражения", s: "Готовые ответы клиенту", d: "obj-re", i: "chat" },
    ],
    near: [
      { t: "Вилки цен по городам", s: "31 город, зоны перевода", d: "prices", i: "build" },
      { t: "Перевод клиента", s: "Пять параметров менеджеру", d: "item:r34", i: "route" },
      { t: "Чек-лист перед переводом", s: "Шесть пунктов за 20 секунд", d: "item:r35", i: "clip" },
      { t: "Глоссарий", s: "ПВ, уникальность, Т1 и Т2", d: "gloss", i: "book" },
    ],
  },
  auto: {
    call: [
      { t: "Скрипт Авто.ру", s: "Девять вопросов без подбора", d: "item:a31", i: "doc" },
      { t: "Статусы", s: "Коды автотемы", d: "st-auto", i: "list" },
      { t: "Возражения", s: "Ответы по автотеме", d: "obj-auto", i: "chat" },
    ],
    near: [
      { t: "Цены по маркам", s: "41 марка, стартовые цены", d: "auto-prices", i: "car" },
      { t: "Города и расстояния", s: "До ДЦ Москвы и СПб", d: "auto-cities", i: "pin" },
      { t: "Кузов и привод", s: "Термины простыми словами", d: "item:auto-terms", i: "book" },
      { t: "Глоссарий", s: "Кроссовер, привод, трейд-ин", d: "gloss", i: "book" },
      { t: "Чек-лист звонка", s: "Проверка перед переводом", d: "item:auto-check", i: "clip" },
    ],
  },
  sv: {
    call: [
      { t: "Скрипт интервью", s: "Разговор с кандидатом", d: "item:s22", i: "doc" },
      { t: "Чек-лист интервью", s: "Техника, условия, дата обучения", d: "item:s23", i: "clip" },
      { t: "Отставание от плана", s: "Что делать сегодня", d: "item:s54", i: "rules" },
    ],
    near: [
      { t: "Оформление новичка", s: "Документы и доступы", d: "item:s34", i: "doc" },
      { t: "Первый день оператора", s: "Чек-лист вывода в линию", d: "item:s33", i: "clip" },
      { t: "Сетка бонусов", s: "Грейды, апрув, коэффициенты", d: "item:s61", i: "money" },
      { t: "Базы и лиды", s: "Откуда база и сколько её", d: "item:s71", i: "base" },
    ],
  },
};

/** Группы глоссария — заголовки и пояснения как в источнике. */
export const GGRP = [
  { v: "re", t: "Недвижимость", s: "Слова из скрипта недвижимости: так говорит клиент и так описываем объект менеджеру." },
  { v: "auto", t: "Авто", s: "Кузов, привод и условия покупки — чтобы понимать клиента по автотеме и ничего не обещать лишнего." },
  { v: "int", t: "Внутренние слова", s: "Наша кухня: метрики, системы и сокращения, которые звучат внутри группы, но не в разговоре с клиентом." },
];

export const SEG: Record<string, string> = {
  budget: "Доступные",
  middle: "Средний сегмент",
  premium: "Премиум",
  unavailable: "Нет в наличии",
};

/* ── прогресс ───────────────────────────────────────────────────── */

/** Порог сдачи теста. */
export const PASS_PCT = 0.8;

export type ProgMap = Map<string, LearnProgress>;

/** Записи прогресса аккаунта, разложенные по материалам. */
export function progMap(learn: LearnProgress[], accountId: string): ProgMap {
  const m: ProgMap = new Map();
  for (const l of learn) if (l.accountId === accountId) m.set(l.itemId, l);
  return m;
}

export const isDone = (p: ProgMap, id: string): boolean => !!p.get(id)?.done;

export function courseProg(p: ProgMap, c: Course) {
  const items = realItems(c);
  const d = items.filter((i) => isDone(p, i.id)).length;
  return { d, n: items.length, p: items.length ? Math.round((d / items.length) * 100) : 0 };
}

/** Курсы программы: у оператора её можно сузить до одного направления. */
export function progIds(role: AcademyRole, prog?: string): string[] {
  if (role === "supervisor") return PROGRAMS.supervisor;
  return prog === "auto" ? ["op-auto"] : prog === "realty" ? ["op-realty"] : PROGRAMS.operator;
}

export function progCourses(role: AcademyRole, prog?: string): Course[] {
  return progIds(role, prog).map((id) => courseById(role, id)).filter(Boolean) as Course[];
}

export function programItems(role: AcademyRole, prog?: string): LearnItem[] {
  return progCourses(role, prog).flatMap((c) => realItems(c));
}

export function progressAll(p: ProgMap, role: AcademyRole, prog?: string) {
  const it = programItems(role, prog);
  const d = it.filter((i) => isDone(p, i.id)).length;
  return { d, n: it.length, p: it.length ? Math.round((d / it.length) * 100) : 0 };
}

export const progLabel = (role: AcademyRole, prog?: string): string =>
  role === "supervisor" ? PROGNAME.sv : PROGNAME[prog || "both"];

/** Материал закрыт, пока не пройден предыдущий в своей программе. */
export function blockerOf(p: ProgMap, role: AcademyRole, id: string): LearnItem | null {
  const c = LIBS[role].itemCourse.get(id);
  if (!c || !PROGRAMS[role].includes(c.id)) return null;
  const arr = realItems(c);
  const i = arr.findIndex((x) => x.id === id);
  if (i <= 0) return null;
  for (let k = 0; k < i; k++) if (!isDone(p, arr[k].id)) return arr[k];
  return null;
}

export function neighbours(role: AcademyRole, item: LearnItem) {
  const c = LIBS[role].itemCourse.get(item.id);
  const arr = c ? realItems(c) : [];
  const i = arr.findIndex((x) => x.id === item.id);
  return { prev: arr[i - 1], next: arr[i + 1], pos: i + 1, total: arr.length };
}

/** Следующий непройденный материал программы. */
export function nextUp(p: ProgMap, role: AcademyRole, prog?: string): LearnItem | null {
  for (const id of progIds(role, prog)) {
    const c = courseById(role, id);
    const it = c ? realItems(c).find((x) => !isDone(p, x.id)) : undefined;
    if (it) return it;
  }
  return null;
}

/** Строка результата теста — формат исходной академии. */
export function quizLine(r?: LearnProgress): string {
  if (!r || r.last == null) return "";
  const d = r.at ? new Date(r.at).toLocaleDateString("ru-RU") : "";
  const n = r.tries ?? 1;
  const tries = n === 1 ? "1 попытка" : n < 5 ? `${n} попытки` : `${n} попыток`;
  return `Последний результат ${r.last}% · лучший ${r.best ?? r.last}% · ${tries}${d ? ` · ${d}` : ""}`;
}

/** Номер сертификата — устойчивый хэш от материала и даты. */
export function certNo(id: string, iso: string): string {
  let h = 0;
  const src = `${id}|${iso}`;
  for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0;
  return `АО-${(h % 900000) + 100000}`;
}

/** Прогресс курса для карточек: тест засчитывается только сданным. */
export function courseStat(c: Course, progress: Map<string, { done: boolean }>) {
  const items = realItems(c);
  const done = items.filter((i) => progress.get(i.id)?.done).length;
  const finals = items.filter((i) => i.final);
  const passed = finals.length > 0 && finals.every((i) => progress.get(i.id)?.done) && done === items.length;
  return { total: items.length, done, pct: items.length ? done / items.length : 0, passed, hasFinal: finals.length > 0 };
}

/* ── поиск ──────────────────────────────────────────────────────── */

export const norm = (s: string): string => String(s).toLowerCase().replace(/ё/g, "е");

const widgetWords: Record<string, () => string> = {
  prices: () => REFS.prices.map((p) => p.city).join(" ") + " цены вилка",
  gloss: () => REFS.glossary.map((g) => `${g.t} ${g.d}`).join(" "),
  "st-re": () => REFS.statusesRealty.map((x) => `${x.n} ${x.d}`).join(" "),
  "st-auto": () => REFS.statusesAuto.map((x) => `${x.n} ${x.d}`).join(" "),
  "obj-re": () => REFS.objections.filter((o) => o.t === "realty").map((o) => `${o.q} ${o.a}`).join(" "),
  "obj-auto": () => REFS.objections.filter((o) => o.t === "auto").map((o) => `${o.q} ${o.a}`).join(" "),
  "auto-prices": () => REFS.autoPrices.map((a) => `${a.name} ${a.aliases || ""}`).join(" ") + " цены марки",
  "auto-cities": () => REFS.autoCities.map((c) => c.city).join(" ") + " расстояние км",
  "calc-op": () => "зарплата смена ставка",
  "calc-sv": () => "бонус грейд апрув фот",
};

function textOf(it: LearnItem): string {
  let s = `${it.t} ${it.k ?? ""}`;
  for (const b of it.b ?? []) {
    if ("p" in b) s += ` ${b.p}`;
    if ("h" in b) s += ` ${b.h}`;
    if ("n" in b) s += ` ${b.n.t} ${b.n.b}`;
    if ("s" in b) s += ` ${b.s.l} ${b.s.b}`;
    if ("ul" in b) s += ` ${b.ul.join(" ")}`;
    if ("ol" in b) s += ` ${b.ol.join(" ")}`;
    if ("tb" in b) s += ` ${b.tb.r.map((r) => r.join(" ")).join(" ")}`;
    if ("ck" in b) s += ` ${b.ck.items.join(" ")}`;
    if ("d" in b) s += ` ${b.d.map((x) => x[1]).join(" ")}`;
  }
  for (const q of it.quiz ?? []) s += ` ${q.q}`;
  if (it.w && widgetWords[it.w]) s += ` ${widgetWords[it.w]()}`;
  return norm(s);
}

const searchCache = new Map<AcademyRole, Map<string, string>>();

/** Поисковый индекс по материалам роли: id → текст. Строится один раз, при первом обращении. */
export function searchIndex(role: AcademyRole): Map<string, string> {
  let idx = searchCache.get(role);
  if (!idx) {
    idx = new Map(LIBS[role].flat.map((it) => [it.id, textOf(it)]));
    searchCache.set(role, idx);
  }
  return idx;
}

export const PAGE_KEYS: Partial<Record<SectionId, string>> = {
  scripts: "скрипт сценарий звонка разговор",
  objections: "возражения ответы дорого подумаю",
  statuses: "статусы скорозвон дубль недозвон",
  checklists: "чек-лист проверка",
  regs: "регламент правила",
  money: "мотивация бонус грейд апрув фот оклад",
  bases: "базы лиды гцк выгрузка",
  realty: "новостройки цены вилка",
  autoprices: "авто цены марки",
  cities: "города расстояния км дилерский центр",
  gloss: "глоссарий термины",
  pay: "оплата ставка сетка лид зарплата смена эффективность самозанятость документы выплаты",
  tests: "тесты аттестация проверка знаний",
  opmat: "материалы операторов обучение группы",
  notes: "заметки избранное",
  progress: "прогресс результаты",
  team: "команда прогресс сотрудников аттестации",
};
