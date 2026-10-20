import RAW from "./ru-map.json";

/**
 * Контуры для «Карты городов»: суша и 85 регионов России из Natural Earth 50m (общественное
 * достояние, naturalearthdata.com), уже в проекции карты (lib/geo/cities.ts → project) и
 * упрощённые до ~2 км. Имя региона — как в справочнике городов (по центру региона внутри
 * контура), поэтому город → регион сопоставляется простым сравнением строк.
 * Пересборка: scripts/build-map.cjs (обрезка, проекция Ламберта, упрощение Дугласа — Пекера).
 */

export interface MapRegion {
  /** Имя, как у City.region. */
  n: string;
  iso: string;
  /** SVG-путь в единицах карты. */
  d: string;
  /** Точка подписи. */
  x: number;
  y: number;
  /** Площадь, км² (≈ единицы карты²) — какие подписи показывать при масштабе. */
  a: number;
}

const DATA = RAW as { land: string; regions: MapRegion[] };
export const LAND_PATH = DATA.land;
export const REGIONS: MapRegion[] = DATA.regions;
