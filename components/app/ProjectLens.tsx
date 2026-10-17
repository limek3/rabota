"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CrmOverride, useCrm } from "@/lib/crm/store";
import { buildIndex } from "@/lib/crm/calc";
import { hueFg } from "@/components/ui/kit";

/**
 * Фильтр «Проект» на страницах статистики (сводка, динамика, отчёты): авто.ру и 100 up — отдельно.
 * По проекту делятся только лиды: часы, планы и конверсия остаются общими (часы у смены без проекта).
 * Страница внутри получает тот же стор, только в data и ix — лиды выбранного проекта; деньги
 * (ФОТ в отчёте РОПа) считаются по lens.base — без фильтра.
 */

export const LENS_ROUTES = new Set(["/dashboard", "/dynamics", "/reports"]);
const KEY = "leadup.lensProject";

function remembered(): string {
  try {
    return localStorage.getItem(KEY) || "";
  } catch {
    return "";
  }
}

export function ProjectLens({ children }: { children: ReactNode }) {
  const crm = useCrm();
  const [pick, setPick] = useState(remembered);
  const projects = useMemo(() => crm.data.projects.filter((p) => !p.deletedAt && p.active).sort((a, b) => a.sort - b.sort), [crm.data.projects]);
  // выбранный проект удалили или скрыли — показываем всё
  const pid = pick && projects.some((p) => p.id === pick) ? pick : "";
  const { data, ix } = crm;
  const openDay = ix.openDay;
  const lensed = useMemo(() => {
    if (!pid) return null;
    const d = { ...data, leads: data.leads.filter((l) => l.projectId === pid) };
    return { data: d, ix: buildIndex(d, crm.workedTo, openDay) };
  }, [pid, data, ix, crm.workedTo, openDay]);

  const choose = (id: string) => {
    setPick(id);
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  };

  const bar =
    projects.length >= 2 ? (
      <div className="lens-bar" role="group" aria-label="Проект">
        <span className="lens-l">Проект</span>
        <button type="button" className={`lens-chip${pid ? "" : " on"}`} onClick={() => choose("")}>
          Все
        </button>
        {projects.map((p) => (
          <button key={p.id} type="button" className={`lens-chip${pid === p.id ? " on" : ""}`} onClick={() => choose(pid === p.id ? "" : p.id)}>
            <i style={{ background: hueFg(p.color) }} />
            {p.name}
          </button>
        ))}
        {pid && <span className="lens-note">лиды — только этого проекта, часы и план — по всем проектам</span>}
      </div>
    ) : null;

  if (!lensed) return (
    <>
      {bar}
      {children}
    </>
  );
  return (
    <CrmOverride value={{ ...crm, data: lensed.data, ix: lensed.ix, lens: { projectId: pid, base: { data, ix } } }}>
      {bar}
      {children}
    </CrmOverride>
  );
}
