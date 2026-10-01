import RAW from "./data.json";
import type { IconName } from "@/components/ui/icons";
import type { LearnProgress } from "@/lib/crm/types";

/**
 * Курс «Авто» для CRM: состав, меню обучения и прогресс аккаунта.
 *
 * Тот же порядок материалов, что и в движке страницы (lib/academy/engine.js):
 * модули из data.json, тренажёр Скорозвона — первым пунктом модуля про Скорозвон.
 * Прогресс — записи learn аккаунта (courseId "op-auto"), как в прежней академии.
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

interface RawModule {
  t: string;
  items: AcadItem[];
}

const SIM: AcadItem = { id: "sim", t: "Тренажёр Скорозвона: смена, звонок, результат, перевод", k: "Симулятор", m: "15 мин" };

export const MODULES: { t: string; items: AcadItem[] }[] = (RAW.course.modules as unknown as RawModule[]).map((m) => {
  const items: AcadItem[] = m.items.map((i) => ({ id: i.id, t: i.t, k: i.k, m: i.m, quiz: i.quiz, final: i.final }));
  if (/Скорозвон/.test(m.t) && !items.some((i) => i.id === "sim")) items.unshift(SIM);
  return { t: m.t.replace(/^Модуль \d+\.\s*/, ""), items };
});

export const FLAT: AcadItem[] = MODULES.flatMap((m) => m.items);
export const TESTS: AcadItem[] = FLAT.filter((i) => i.quiz);

/** Главы тренажёра Скорозвона, пройденные самостоятельно (хранит сам тренажёр в браузере). */
export const SIM_CHAPTERS = ["start", "call", "result", "transfer", "end"];
export const SIM_CHAPTER_TITLES: Record<string, string> = {
  start: "Начало смены",
  call: "Звонок и карточка клиента",
  result: "Как ставить на перезвон",
  transfer: "Перевод клиента менеджеру",
  end: "Перерыв и конец смены",
};
export function simChaptersDone(): number {
  if (typeof window === "undefined") return 0;
  try {
    const d = JSON.parse(window.localStorage.getItem("sz-done") || "[]") as string[];
    return SIM_CHAPTERS.filter((c) => d.includes(`auto:${c}:try`)).length;
  } catch {
    return 0;
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
  sim: number;
}

/** Прогресс аккаунта по курсу «Авто». sim — главы тренажёра (только для своего аккаунта в браузере). */
export function acadProgress(learn: LearnProgress[], accountId: string, sim = 0): AcadProgress {
  const recs = new Map(learn.filter((l) => l.accountId === accountId && l.courseId === ACAD_COURSE).map((l) => [l.itemId, l]));
  // главы тренажёра: свои — из браузера, чужие — из записи "sim" (её пишет страница обучения)
  const simRec = recs.get("sim");
  sim = Math.max(sim, SIM_CHAPTERS.filter((c) => simRec?.checks?.includes(`auto:${c}:try`)).length);
  const isDone = (id: string) => {
    const r = recs.get(id);
    const it = FLAT.find((x) => x.id === id);
    if (id === "sim") return !!r?.done || sim === SIM_CHAPTERS.length;
    return it?.quiz ? !!r?.pass : !!r?.done;
  };
  const done = FLAT.filter((i) => isDone(i.id)).length;
  return {
    isDone,
    done,
    total: FLAT.length,
    pct: FLAT.length ? done / FLAT.length : 0,
    testsDone: TESTS.filter((i) => isDone(i.id)).length,
    tests: TESTS.length,
    next: FLAT.find((i) => !isDone(i.id)) ?? null,
    sim,
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
      { r: "sim", t: "Скорозвон", i: "phone", hint: "Тренажёр Скорозвона", count: (p) => `${p.sim}/5` },
      { r: "tests", t: "Тесты", i: "test", hint: "Тесты модулей и аттестация", count: (p) => `${p.testsDone}/${p.tests}` },
      { r: "progress", t: "Мой прогресс", i: "target", hint: "Что пройдено и что осталось" },
    ],
  },
  {
    g: "Во время звонка",
    items: [
      { r: "script", t: "Скрипт звонка", i: "chat", hint: "Скрипт Авто.ру и перевод" },
      { r: "objections", t: "Возражения", i: "target", hint: "Готовые ответы клиенту" },
      { r: "statuses", t: "Статусы", i: "list", hint: "Что ставить после разговора" },
      { r: "checklist", t: "Чек-лист звонка", i: "clip", hint: "Проверка перед переводом" },
    ],
  },
  {
    g: "Справочники",
    items: [
      { r: "prices", t: "Цены по маркам", i: "car", hint: "Стартовые цены по маркам" },
      { r: "cities", t: "Города и расстояния", i: "pin", hint: "До дилерских центров" },
      { r: "terms", t: "Кузов и привод", i: "book", hint: "Термины простыми словами" },
      { r: "gloss", t: "Глоссарий", i: "book", hint: "Авто и внутренние слова" },
      { r: "pay", t: "Оплата и оформление", i: "wallet", hint: "Смена, стажировка, документы" },
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
  prices: ["a12"],
  terms: ["auto-terms"],
  pay: ["r51", "r52", "r53", "a41"],
};

/** Активный пункт меню по адресу страницы обучения (#/course, #/item/a11, #/read/a31…). */
export function acadActive(hash: string): string {
  const [r, id] = (hash || "#/home").replace(/^#\/?/, "").split("/");
  if (r === "item") return "course";
  if (r === "read") return Object.keys(SEC_ITEMS).find((k) => SEC_ITEMS[k].includes(id ?? "")) ?? "";
  return r || "home";
}
