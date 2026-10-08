import type { DayKey, ID } from "./types";
import { TAX_PCT, withTax } from "./payroll";

/**
 * Реестры выплат самозанятым через YouDo (бухгалтер Юлия). Два файла Google — «ОПЕРАТОРЫ» (ОКЦ)
 * и «Супервайзеры» (СВ); на каждый период — лист «План ОКЦ (06.10-18.10)» до выплаты и
 * «Факт ОКЦ (06.10-18.10)» после закрытия периода, колонки — как у Юлии (14 + комментарий,
 * сумма на руки, налог).
 *
 * CRM шлёт только имя и суммы. ФИО полностью и ИНН скрипт берёт из её же таблиц
 * («Реестр исполнителей» и прошлые листы реестров) — ИНН в CRM не хранится и не попадает.
 * Порядок строк — как в листе плана этого периода (Юлия подгружает реестр заново, порядок
 * менять нельзя), иначе — как в последнем листе файла; новые люди — в конец.
 *
 * Отправка — через Edge Function registry-sheet (браузер не читает ответ Google после
 * переадресации), ссылка и секрет — Настройки → Данные → «Реестры выплат YouDo».
 */

export type RegistryProject = "okc" | "sv";
export type RegistryKind = "plan" | "fact";

export const PROJECT_LABEL: Record<RegistryProject, string> = { okc: "ОКЦ", sv: "СВ" };
export const KIND_LABEL: Record<RegistryKind, string> = { plan: "План", fact: "Факт" };

export interface RegistryLine {
  opId: ID;
  name: string;
  /** На руки, ₽ (целые). */
  net: number;
  /** В YouDo: на руки ÷ 0,94, до рубля. */
  sum: number;
}

export interface RegistryPayload {
  project: RegistryProject;
  kind: RegistryKind;
  tab: string;
  /** Конец периода «дд.мм» — по нему скрипт находит лист плана этого периода. */
  periodTo: string;
  /** Даты задания в YouDo «дд.мм.гггг» (для факта скрипт берёт даты из листа плана). */
  from: string;
  to: string;
  rows: { name: string; net: number; sum: number }[];
  /** Лист уже есть — перезаписать (статусы YouDo внизу листа сохраняются). */
  replace?: boolean;
}

export interface RegistryReply {
  ok: boolean;
  error?: string;
  /** Лист с таким названием уже есть, ничего не записано — спросить и прислать replace. */
  exists?: boolean;
  tab?: string;
  created?: boolean;
  rows?: number;
  total?: number;
  /** Лист плана этого периода, с которым сверялся факт. */
  plan?: string | null;
  /** Лист, откуда взят порядок строк и тексты задания. */
  source?: string | null;
  /** Не нашёлся ИНН: имя и почему. */
  missing?: { name: string; why: string }[];
  /** Сумма изменилась против плана. */
  changed?: { name: string; from: number; to: number }[];
  /** Нет в плане — новое задание. */
  added?: string[];
  /** Был в плане, в факте 0. */
  zeroed?: string[];
  url?: string;
  /** Ответ от Google не пришёл, но запрос ушёл: лист, скорее всего, записан. */
  unconfirmed?: boolean;
}

const dm = (d: DayKey) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
export const ruDate = (d: DayKey) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** «План ОКЦ (06.10-18.10)». */
export const registryTab = (kind: RegistryKind, project: RegistryProject, from: DayKey, to: DayKey) =>
  `${KIND_LABEL[kind]} ${PROJECT_LABEL[project]} (${dm(from)}-${dm(to)})`;

export const registryLine = (opId: ID, name: string, net: number): RegistryLine => {
  const n = Math.max(0, Math.round(net));
  return { opId, name, net: n, sum: withTax(n) };
};

/** Строка плана: сумма в реестр — как задана (условная, факт её заменит); на руки — для справки. */
export const registryPlanLine = (opId: ID, name: string, sum: number): RegistryLine => {
  const s = Math.max(0, Math.round(sum));
  return { opId, name, net: Math.round(s * (1 - TAX_PCT / 100)), sum: s };
};

export function registryPayload(
  kind: RegistryKind,
  project: RegistryProject,
  start: DayKey,
  periodTo: DayKey,
  taskFrom: DayKey,
  taskTo: DayKey,
  lines: RegistryLine[],
): RegistryPayload {
  return {
    project,
    kind,
    tab: registryTab(kind, project, start, periodTo),
    periodTo: dm(periodTo),
    from: ruDate(taskFrom),
    to: ruDate(taskTo),
    rows: lines.map((l) => ({ name: l.name.trim(), net: l.net, sum: l.sum })),
  };
}
