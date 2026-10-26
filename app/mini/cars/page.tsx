"use client";

import { useCrm } from "@/lib/crm/store";
import { CarMini } from "@/components/app/CarMini";

/** Мини-окно «Марок авто»: в приложении — окно поверх всех (Ctrl+Shift+A), в браузере без «картинки в картинке» — всплывающее. */
export default function CarsMiniPage() {
  const { data } = useCrm();
  return <CarMini projects={data.projects} />;
}
