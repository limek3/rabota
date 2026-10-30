import type { IconName } from "@/components/ui/icons";
import type { LearnProgress } from "@/lib/crm/types";
import { academyData, type AcademyData } from "./content";
import type { AcademyDocRaw } from "@/lib/crm/types";

/**
 * Курс «Авто» для CRM: состав, меню обучения и прогресс аккаунта.
 *
 * Тот же порядок материалов, что и в движке страницы (lib/academy/engine.js):
 * модули содержимого (правка РОПа или data.json — lib/academy/content.ts) и последним —
 * «Практика в Скорозвоне»: 5 глав тренажёра после
 * аттестации, каждая засчитывается, только когда пройдена самостоятельно.
 * Прогресс — записи learn аккаунта (courseId "op-auto"), как в прежней академии;
 * главы тренажёра — в записи "sim" (checks "auto:<глава>:try").
 */

export const ACAD_COURSE = "op-auto";

export interface AcadItem {
  id: string;
  t: string;
  k: string;
  m: string;
  quiz?: unknown[];
  final?: number;
}

/** Главы тренажёра Скорозвона. */
export const SIM_CHAPTERS = ["start", "call", "result", "transfer", "end"];
export const SIM_CHAPTER_TITLES: Record<string, string> = {
  start: "Начало смены",
  call: "Звонок и карточка клиента",
  result: "Как ставить на перезвон",
  transfer: "Перевод клиента менеджеру",
  end: "Перерыв и конец смены",
};
export const PRACTICE_TITLE = "Практика в Скорозвоне";
export const simItemId = (ch: string) => `sim-${ch}`;
const simChOf = (id: string) => (id.startsWith("sim-") ? id.slice(4) : null);

function buildModules(data: AcademyData): { t: string; items: AcadItem[]; practice?: boolean }[] {
  return [
    ...data.course.modules.map((m) => ({
      t: m.t.replace(/^Модуль \d+\.\s*/, ""),
      items: m.items.filter((i) => i.id !== "sim").map((i) => ({ id: i.id, t: i.t, k: i.k, m: i.m, quiz: i.quiz, final: i.final })),
    })),
    { t: PRACTICE_TITLE, practice: true, items: SIM_CHAPTERS.map((c) => ({ id: simItemId(c), t: SIM_CHAPTER_TITLES[c], k: "Симулятор", m: "3 мин" })) },
  ];
}

/*
 * Состав курса — живые привязки: store (lib/crm/store.tsx) вызывает setAcademyDoc при каждой новой
 * правке РОПа, и все, кто импортировал MODULES / FLAT / TESTS, видят уже новый состав.
 */
export let MODULES = buildModules(academyData(null));
export let FLAT: AcadItem[] = MODULES.flatMap((m) => m.items);
export let TESTS: AcadItem[] = FLAT.filter((i) => i.quiz);
let curDoc: AcademyDocRaw | null | undefined = null;

/** Новая правка РОПа (или её удаление) — пересобрать состав курса. */
export function setAcademyDoc(doc: AcademyDocRaw | null | undefined): void {
  if (doc === curDoc) return;
  curDoc = doc;
  MODULES = buildModules(academyData(doc));
  FLAT = MODULES.flatMap((m) => m.items);
  TESTS = FLAT.filter((i) => i.quiz);
}

/** Отметки тренажёра этого аккаунта в браузере (ключ — как в движке: sz-done:<аккаунт>). */
function localSimKeys(accountId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const d = JSON.parse(window.localStorage.getItem(`sz-done:${accountId}`) || "[]");
    return Array.isArray(d) ? d : [];
  } catch {
    return [];
  }
}

export interface AcadProgress {
  isDone: (id: string) => boolean;
  done: number;
  total: number;
  pct: number;
  testsDone: number;
  tests: number;
  next: AcadItem | null;
  /** Глав тренажёра, пройденных самостоятельно. */
  sim: number;
  /** Итоговая аттестация сдана. */
  certified: boolean;
  /**
   * Этап: start — не начинал; theory — теория и тесты; practice — аттестация сдана,
   * идёт практика в Скорозвоне; done — всё пройдено, допуск к линии.
   */
  stage: "start" | "theory" | "practice" | "done";
}

/**
 * Прогресс аккаунта по курсу «Авто». local — свой аккаунт в этом браузере: главы
 * тренажёра берём и из браузера (запись в CRM догоняет через секунду).
 */
export function acadProgress(learn: LearnProgress[], accountId: string, local = false): AcadProgress {
  const recs = new Map(learn.filter((l) => l.accountId === accountId && l.courseId === ACAD_COURSE).map((l) => [l.itemId, l]));
  const simKeys = new Set([...(recs.get("sim")?.checks ?? []), ...(local ? localSimKeys(accountId) : [])]);
  const tried = (ch: string) => simKeys.has(`auto:${ch}:try`);
  const isDone = (id: string) => {
    const ch = simChOf(id);
    if (ch) return tried(ch);
    const r = recs.get(id);
    const it = FLAT.find((x) => x.id === id);
    return it?.quiz ? !!r?.pass : !!r?.done;
  };
  const done = FLAT.filter((i) => isDone(i.id)).length;
  const next = FLAT.find((i) => !isDone(i.id)) ?? null;
  const fin = FLAT.find((i) => i.final);
  const certified = !!fin && isDone(fin.id);
  return {
    isDone,
    done,
    total: FLAT.length,
    pct: FLAT.length ? done / FLAT.length : 0,
    testsDone: TESTS.filter((i) => isDone(i.id)).length,
    tests: TESTS.length,
    next,
    sim: SIM_CHAPTERS.filter(tried).length,
    certified,
    stage: !next ? "done" : certified ? "practice" : done > 0 || simKeys.size > 0 ? "theory" : "start",
  };
}

/** Меню обучения — те же разделы, что в отдельной обучалке. r — маршрут страницы (/learn#/r). */
export interface AcadNavItem {
  r: string;
  t: string;
  i: IconName;
  hint: string;
  count?: (p: AcadProgress, notes: number) => string;
}

export const ACAD_NAV: { g: string; items: AcadNavItem[] }[] = [
  {
    g: "Обучение",
    items: [
      { r: "home", t: "Главная", i: "home", hint: "Рабочий стол: следующий шаг и прогресс" },
      { r: "course", t: "Курс «Авто»", i: "cap", hint: "Все модули по порядку", count: (p) => `${p.done}/${p.total}` },
      { r: "sim", t: "Скорозвон", i: "phone", hint: "Тренажёр Скорозвона — в курсе это практика после аттестации", count: (p) => `${p.sim}/5` },
      { r: "tests", t: "Тесты", i: "test", hint: "Тесты модулей и аттестация", count: (p) => `${p.testsDone}/${p.tests}` },
      { r: "progress", t: "Мой прогресс", i: "target", hint: "Что пройдено и что осталось" },
    ],
  },
  {
    g: "Во время звонка",
    items: [
      { r: "script", t: "Скрипт звонка", i: "chat", hint: "Скрипт Авто.ру, перевод и запись лида" },
      { r: "projects", t: "Проекты и условия", i: "rules", hint: "Авто.ру, 100 up и Дмитровка: марки, города, перевод или форма" },
      { r: "cars", t: "Марки авто", i: "car", hint: "Машина клиента → передаём её по проекту или нет" },
      { r: "cities", t: "Карта городов", i: "map", hint: "Город клиента → ближайшие города, где мы работаем" },
      { r: "objections", t: "Возражения", i: "target", hint: "Готовые ответы клиенту" },
      { r: "statuses", t: "Статусы", i: "list", hint: "Что ставить после разговора" },
      { r: "checklist", t: "Чек-лист звонка", i: "clip", hint: "Проверка перед переводом" },
    ],
  },
  {
    g: "Справочники",
    items: [
      { r: "terms", t: "Кузов и привод", i: "book", hint: "Термины простыми словами" },
      { r: "gloss", t: "Глоссарий", i: "book", hint: "Авто и внутренние слова" },
      { r: "pay", t: "Оплата и стажировка", i: "wallet", hint: "Как считается смена и стажировка" },
    ],
  },
  {
    g: "Тренажёры",
    items: [
      { r: "tr-obj", t: "Возражения", i: "bolt", hint: "Тренажёр возражений" },
      { r: "tr-st", t: "Статусы", i: "bolt", hint: "Тренажёр статусов" },
    ],
  },
  { g: "Личное", items: [{ r: "notes", t: "Мои заметки", i: "note", hint: "Заметки к материалам", count: (_p, n) => (n ? String(n) : "") }] },
];

/** Разделы-материалы: какой пункт меню подсвечивать, когда открыт материал раздела (#/read/…). */
const SEC_ITEMS: Record<string, string[]> = {
  script: ["a31", "a32"],
  checklist: ["auto-check"],
  projects: ["a13", "a12"],
  terms: ["auto-terms"],
  pay: ["r51", "r52", "r53"],
};

/** Активный пункт меню по адресу страницы обучения (#/course, #/item/a11, #/read/a31…). */
export function acadActive(hash: string): string {
  const [r, id] = (hash || "#/home").replace(/^#\/?/, "").split("/");
  if (r === "item") return "course";
  if (r === "read") return Object.keys(SEC_ITEMS).find((k) => SEC_ITEMS[k].includes(id ?? "")) ?? "";
  return r || "home";
}
