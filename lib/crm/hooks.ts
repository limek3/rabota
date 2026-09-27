"use client";

import { useMemo } from "react";
import { useCrm } from "./store";
import { monthModel, type MonthModel } from "./calc";
import { buildInsights } from "./insights";
import type { MonthKey } from "./types";

/** Модель выбранного месяца: считается один раз на изменение данных/месяца/дня. */
export function useMonthModel(month?: MonthKey): MonthModel {
  const { data, ix, month: m, today } = useCrm();
  const key = month ?? m;
  return useMemo(() => monthModel(data, ix, key, today), [data, ix, key, today]);
}

/** Подсказки по операторам месяца (тренд, причина отставания, сигналы). Медианы — по тем, кого видит аккаунт. */
export function useInsights(m: MonthModel) {
  const { ix } = useCrm();
  return useMemo(() => buildInsights(m.ops, ix, m.cal), [m, ix]);
}
