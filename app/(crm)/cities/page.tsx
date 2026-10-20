"use client";

import { PageHead } from "@/components/ui/kit";
import { StickyHead } from "@/components/app/StickyHead";
import { CityFinder } from "@/components/app/CityFinder";

/** «Карта городов»: город клиента → ближайшие города, где мы работаем. Быстрое окно — клавиша G. */
export default function CitiesPage() {
  return (
    <div className="stack">
      <StickyHead title="Карта городов" />
      <PageHead
        title="Карта городов"
        sub={
          <>
            Введите город клиента — покажем ближайшие города, где мы работаем. С любой страницы — клавиша <kbd className="kbd">G</kbd>
          </>
        }
      />
      <CityFinder />
    </div>
  );
}
