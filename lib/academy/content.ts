import RAW from "./data.json";
import type { Block, QuizQ } from "@/lib/learn";
import type { AcademyDocRaw } from "@/lib/crm/types";

/**
 * Содержимое обучения оператора: курс «Авто», «Оплата и стажировка», статусы, возражения, глоссарий.
 *
 * Исходный вариант — data.json. РОП правит его в «Редакторе обучения» (/learn/edit); правка
 * целиком ложится в kv-строку "academy" (читают все вошедшие, пишет только РОП) и с этого
 * момента её видят все — и страница обучения, и меню, и прогресс команды. Удалить правку —
 * вернуться к data.json.
 */

export interface AcadItemDoc {
  id: string;
  t: string;
  /** Тип: Урок, Регламент, Скрипт, Чек-лист, Справочник, Тест, Тренажёр, Калькулятор. */
  k: string;
  /** Сколько занимает: «5 мин». */
  m: string;
  b?: Block[];
  /** Встроенный справочник или тренажёр: st-auto, obj-auto, tr-auto, calc-op… */
  w?: string;
  quiz?: QuizQ[];
  /** Итоговая аттестация. */
  final?: number;
}

export interface AcadModuleDoc {
  t: string;
  /** Описание модуля на карте курса. */
  d?: string;
  items: AcadItemDoc[];
}

export interface AcadStatus {
  g: string;
  n: string;
  d: string;
}
export interface AcadObjection {
  t?: string;
  q: string;
  a: string;
}
export interface AcadTerm {
  t: string;
  d: string;
  g?: string;
}

export interface AcademyData {
  course: { id: string; title: string; desc: string; modules: AcadModuleDoc[]; [k: string]: unknown };
  pay: { id: string; title: string; desc: string; modules: AcadModuleDoc[]; [k: string]: unknown };
  ST_AUTO: AcadStatus[];
  OBJ: AcadObjection[];
  GLOSS: AcadTerm[];
}

/** Правка РОПа: всё содержимое целиком, кто и когда сохранил. */
export interface AcademyDoc extends AcademyDocRaw {
  data: AcademyData;
}

export const DEFAULT_ACADEMY = RAW as unknown as AcademyData;

/** Группы статусов Скорозвона — в этом порядке. */
export const STATUS_GROUPS = ["Успешные", "Промежуточные", "Недозвон", "Неуспешные"];

/** Содержимое, которое сейчас видят все: правка РОПа или исходное. */
export function academyData(doc: AcademyDocRaw | null | undefined): AcademyData {
  return doc && isAcademyData(doc.data) ? doc.data : DEFAULT_ACADEMY;
}

function isModules(x: unknown): boolean {
  return Array.isArray(x) && x.every((m) => m && typeof m === "object" && typeof (m as AcadModuleDoc).t === "string" && Array.isArray((m as AcadModuleDoc).items));
}

export function isAcademyData(x: unknown): x is AcademyData {
  const d = x as AcademyData | null;
  return (
    !!d &&
    typeof d === "object" &&
    !!d.course &&
    isModules(d.course.modules) &&
    !!d.pay &&
    isModules(d.pay.modules) &&
    Array.isArray(d.ST_AUTO) &&
    Array.isArray(d.OBJ) &&
    Array.isArray(d.GLOSS)
  );
}

/** Из kv: правка РОПа или null, если её нет или она битая. */
export function cleanAcademyDoc(x: unknown): AcademyDoc | null {
  const d = x as AcademyDoc | null;
  if (!d || typeof d !== "object" || !isAcademyData(d.data)) return null;
  return { v: 1, updatedAt: String(d.updatedAt || ""), by: String(d.by || ""), data: d.data };
}

/** Новый id материала: не совпадает ни с одним из уже существующих. */
export function newItemId(data: AcademyData, prefix = "u"): string {
  const used = new Set([...data.course.modules, ...data.pay.modules].flatMap((m) => m.items.map((i) => i.id)));
  for (;;) {
    const id = `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }
}
