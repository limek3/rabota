import type { ID, Operator } from "./types";

/**
 * Дубли карточек сотрудников. Один человек — одна карточка: из неё строятся график,
 * список операторов, зарплата; к ней привязан аккаунт. Дубль появлялся, когда стажёру
 * заводили карточку ради доступа, а при приёме в штат — ещё одну.
 *
 * Сравниваем ФИО без учёта регистра, «ё», лишних пробелов и порядка слов:
 * «Иванова Анна» и «анна  иванова» — один человек.
 */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

/** Живые карточки с тем же ФИО (кроме exceptId). */
export function sameNameOps(ops: Operator[], name: string, exceptId?: ID | null): Operator[] {
  const key = normName(name);
  if (!key) return [];
  return ops.filter((o) => !o.deletedAt && o.id !== exceptId && normName(o.name) === key);
}

/** Группы живых карточек с одинаковым ФИО — кандидаты на объединение. */
export function duplicateGroups(ops: Operator[]): Operator[][] {
  const by = new Map<string, Operator[]>();
  for (const o of ops) {
    if (o.deletedAt) continue;
    const k = normName(o.name);
    if (!k) continue;
    const list = by.get(k);
    if (list) list.push(o);
    else by.set(k, [o]);
  }
  return Array.from(by.values())
    .filter((l) => l.length > 1)
    .sort((a, b) => a[0].name.localeCompare(b[0].name, "ru"));
}
