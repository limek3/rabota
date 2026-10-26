"use client";

import { useEffect, useState } from "react";
import { PageHead } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { StickyHead } from "@/components/app/StickyHead";
import { CarFinder } from "@/components/app/CarFinder";
import { openCarMini } from "@/components/app/CarMini";
import { useCrm } from "@/lib/crm/store";
import { getVexaBridge } from "@/lib/electron";

/** «Марки авто»: машина клиента → передаём ли её по правилам проекта. */
export default function CarsPage() {
  const { data } = useCrm();
  // в приложении мини-окно открывается и с клавиатуры — подскажем сочетание (узнаём после загрузки: при сборке Electron нет)
  const [desktop, setDesktop] = useState(false);
  useEffect(() => setDesktop(!!getVexaBridge()?.carsMini), []);
  return (
    <div className="stack">
      <StickyHead title="Марки авто" />
      <PageHead
        title="Марки авто"
        sub="Выберите проект и введите машину клиента — покажем, передаём её или нет, и почему"
        actions={
          <button
            type="button"
            className="btn"
            onClick={() => void openCarMini(data.projects)}
            title={desktop ? "Маленькое окно поверх всех — держать рядом со Скорозвоном (Ctrl+Shift+A)" : "Маленькое окно поверх всех — держать рядом со Скорозвоном"}
          >
            <Icon name="car" size={14} /> Мини-окно{desktop ? " · Ctrl+Shift+A" : ""}
          </button>
        }
      />
      <CarFinder />
    </div>
  );
}
