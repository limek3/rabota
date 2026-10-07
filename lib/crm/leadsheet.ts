import type { DayKey, ID, Lead } from "./types";
import { fmtDate, monthName } from "./dates";

/**
 * Таблица лидов для ОКК («Авто недозвоны» в Google): все лиды за день или период, по одному на строку,
 * лист месяца «Октябрь Борис». Выгружают руками («Лиды» → «Таблица ОКК» — Excel или Google) и сама
 * база каждый день в 13:00 и 19:00 по Москве (Edge Function leads-sheet).
 * Столбцы и строки собираются одинаково здесь и в supabase/functions/leads-sheet/index.ts —
 * меняете одно, меняйте и другое.
 */

export const LEAD_SHEET_HEAD = ["Дата", "Ссылка", "Телефон", "Имя", "Оператор", "Доведен", "Если не доведен, почему", "Проверка ОКК"];
/** Столбец «Доведен» — выпадающий список. */
export const LEAD_SHEET_DONE = ["Да", "Нет"];
/** Номер столбца (с 0) со ссылкой на лид в Скорозвоне — в таблице он кликабельный. */
export const LEAD_SHEET_LINK = 1;

/** Телефон для таблицы: 79XXXXXXXXX. */
export function sheetPhone(p: string): string {
  const d = (p || "").replace(/\D+/g, "");
  return d.length === 11 && /^[78]/.test(d) ? `7${d.slice(1)}` : d.length === 10 ? `7${d}` : (p || "").trim();
}

/** Подпись ссылки: «лид 60500425092» для ссылки Скорозвона, иначе «открыть». */
export function linkLabel(url: string): string {
  const id = /\/leads\/(\d+)/.exec(url)?.[1];
  return id ? `лид ${id}` : "открыть";
}

/**
 * Строки таблицы: лиды по времени записи. «Доведен», «Если не доведен, почему» и «Проверка ОКК»
 * CRM оставляет пустыми — их заполняет человек в таблице. opName — ФИО оператора.
 */
export function leadSheetRows(leads: Lead[], opName: (id: ID) => string): string[][] {
  return [...leads]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((l) => [
      fmtDate(l.at.slice(0, 10)),
      (l.link ?? "").trim(),
      sheetPhone(l.phone),
      l.client.trim(),
      opName(l.operatorId),
      "",
      "",
      "",
    ]);
}

/** Лист месяца: «Октябрь Борис». owner — чей лист (из настроек). */
export const leadSheetTab = (day: DayKey, owner: string): string => `${monthName(day)} ${owner.trim()}`.trim();
