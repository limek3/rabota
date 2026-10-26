import PHOTOS from "./photos.json";

/**
 * Фото моделей «Марок авто»: public/cars/<id>.jpg, автор и лицензия — lib/cars/photos.json
 * (scripts/build-car-photos.cjs). base — адрес сайта: окну поверх всех (Picture-in-Picture)
 * относительные пути не годятся, у него свой пустой документ.
 */

export type CarPhoto = { file: string; page: string; host: string; by?: string; lic?: string };

export const photoOf = (id: string): CarPhoto | null => (PHOTOS as Record<string, CarPhoto>)[id] ?? null;

export const photoSrc = (id: string, base = "") => (photoOf(id) ? `${base}/cars/${id}.jpg` : null);
