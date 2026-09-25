import type { Lead, Settings } from "./types";

/**
 * Регионы лидов. «Основа» — обычная цена лида и апрув по проектам; «Регионы» — своя
 * цена и апрув из настроек. Лид без региона (до появления поля) считается основой,
 * поэтому старые расчёты не меняются.
 */
export type RegionSegment = "main" | "regional";

export const SEGMENT_LABEL: Record<RegionSegment, string> = { main: "основа", regional: "регионы" };
export const SEGMENT_HUE: Record<RegionSegment, string> = { main: "gray", regional: "amber" };

/** Сегмент региона; null — регион не указан. Город из «Регионов» — regional, всё остальное — основа. */
export function regionSegment(region: string | undefined, s: Settings): RegionSegment | null {
  const r = (region || "").trim();
  if (!r) return null;
  return s.regions.regional.includes(r) ? "regional" : "main";
}

/** Лид региональный — считается по цене и апруву регионов. */
export const isRegionalLead = (l: Pick<Lead, "region">, s: Settings) => regionSegment(l.region, s) === "regional";
