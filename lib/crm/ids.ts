import type { DayKey, ID, MonthKey, PlanScope } from "./types";

/**
 * Стабильные уникальные ID.
 *
 * Префикс сущности + время + случайная часть: читается в экспорте («op_…» —
 * оператор), сортируется по времени создания и не повторяется даже при
 * массовом создании в одну миллисекунду (счётчик + crypto-random).
 */

let seq = 0;

function rand(n: number): string {
  const abc = "0123456789abcdefghijklmnopqrstuvwxyz";
  let out = "";
  try {
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    for (let i = 0; i < n; i++) out += abc[buf[i] % 36];
  } catch {
    for (let i = 0; i < n; i++) out += abc[Math.floor(Math.random() * 36)];
  }
  return out;
}

export function newId(prefix: "op" | "gr" | "pr" | "ld" | "adj" | "bk" | "acc"): ID {
  seq = (seq + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36).padStart(2, "0")}${rand(6)}`;
}

/** Генерирует ID, которого точно нет в наборе (защита от дублей). */
export function uniqueId(prefix: Parameters<typeof newId>[0], taken: { has(id: string): boolean }): ID {
  let id = newId(prefix);
  while (taken.has(id)) id = newId(prefix);
  return id;
}

/** Смена — одна на оператора в день, поэтому ID детерминированный. */
export function shiftId(date: DayKey, operatorId: ID): ID {
  return `${date}|${operatorId}`;
}

export function planId(month: MonthKey, scope: PlanScope, targetId: ID | null): ID {
  return scope === "team" ? `${month}|team` : `${month}|${scope}|${targetId}`;
}
