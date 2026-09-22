"use client";

/**
 * Закрытые подсказки Vexi.
 *
 * Подсказка полезна ровно один раз: человек прочитал, понял, закрыл — и больше
 * никогда её не видит. Поэтому список закрытых id живёт в localStorage, а не в
 * состоянии экрана: иначе та же фраза встречала бы человека после каждой
 * перезагрузки, и через неделю он перестал бы читать подсказки вообще.
 *
 * Почему не в Prefs (профиль в БД): под это нет колонки, а patchProfile пишет
 * только по списку PREF_COLS — ключ молча терялся бы в live-режиме. Привязка к
 * устройству здесь честнее и по смыслу: подсказки объясняют интерфейс, а не
 * данные.
 *
 * Состояние держим на модуле с подписчиками — тот же приём, что в appSettings:
 * одну и ту же подсказку может рисовать несколько экранов сразу, и закрытие
 * должно применяться ко всем немедленно, без перезагрузки.
 */

import { useCallback, useEffect, useState } from "react";

const KEY = "vexa.vexiHints";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    return Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

let state: string[] = [];
let hydrated = false;
const subs = new Set<(s: string[]) => void>();

function commit(next: string[]) {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* приватный режим — подсказка не вернётся хотя бы до перезагрузки */
  }
  subs.forEach((f) => f(next));
}

/**
 * @returns `dismissed` — список закрытых id, `dismiss` — закрыть,
 *          `restore` — вернуть все подсказки (кнопка в настройках).
 *
 * `ready` отделяет «ещё не прочитали localStorage» от «ничего не закрыто»: без
 * него первый кадр рисует все подсказки, а следующий их убирает — экран
 * моргает при каждом переходе.
 */
export function useVexiHints() {
  const [local, setLocal] = useState<string[]>(state);
  const [ready, setReady] = useState(hydrated);

  useEffect(() => {
    if (!hydrated) {
      hydrated = true;
      commit(read());
    }
    setLocal(state);
    setReady(true);
    subs.add(setLocal);
    return () => {
      subs.delete(setLocal);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    if (state.includes(id)) return;
    commit([...state, id]);
  }, []);

  const restore = useCallback(() => commit([]), []);

  return { dismissed: local, dismiss, restore, ready };
}
