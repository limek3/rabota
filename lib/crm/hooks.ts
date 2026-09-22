"use client";

import { useMemo } from "react";
import { useCrm } from "./store";
import { monthModel, type MonthModel } from "./calc";
import type { MonthKey } from "./types";

/** Модель выбранного месяца: считается один раз на изменение данных/месяца/дня. */
export function useMonthModel(month?: MonthKey): MonthModel {
  const { data, ix, month: m, today } = useCrm();
  const key = month ?? m;
  return useMemo(() => monthModel(data, ix, key, today), [data, ix, key, today]);
}
