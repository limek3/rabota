"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import type { MonthModel } from "@/lib/crm/calc";
import { addDays, fmtDayShort, isWorkday } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct } from "@/lib/crm/format";
import { Avatar } from "@/components/ui/kit";
import { Icon, type IconName } from "@/components/ui/icons";

/**
 * «Утро руководителя»: три списка, которые иначе собирают глазами —
 * кто сегодня без смены, кто на смене без лидов и кто вчера отработал ниже нормы.
 * Норма конверсии — из настроек (по регламенту не ниже 60%).
 */
export function MorningCard({ m }: { m: MonthModel }) {
  const { data, ix, today } = useCrm();
  const s = data.settings;

  const view = useMemo(() => {
    if (m.cal.phase !== "current") return null;
    const yest = addDays(today, -1);
    const normLph = s.convNormPct / 100;
    const workday = isWorkday(today, s);

    const noShift: typeof m.ops = [];
    const noLeads: typeof m.ops = [];
    const weak: { r: (typeof m.ops)[number]; lph: number; leads: number; hours: number }[] = [];

    for (const r of m.ops) {
      const op = r.op;
      if (op.deletedAt || op.status !== "active") continue;
      if (op.hireDate && op.hireDate > today) continue;
      if (op.fireDate && op.fireDate < today) continue;

      const sh = ix.shift.get(`${today}|${op.id}`);
      const worksToday = !!sh && (sh.type === "work" || sh.type === "training") && sh.hours > 0;
      const leadsToday = ix.opDay.get(op.id)?.get(today) ?? 0;
      if (workday && !sh) noShift.push(r);
      else if (worksToday && leadsToday === 0) noLeads.push(r);

      const hoursY = ix.hoursOpDay.get(op.id)?.get(yest) ?? 0;
      const leadsY = ix.opDay.get(op.id)?.get(yest) ?? 0;
      if (hoursY > 0 && normLph > 0 && leadsY / hoursY < normLph) weak.push({ r, lph: leadsY / hoursY, leads: leadsY, hours: hoursY });
    }
    weak.sort((a, b) => a.lph - b.lph);
    return { noShift, noLeads, weak, yest, normLph, workday };
  }, [m, ix, today, s]);

  if (!view) return null;
  const total = view.noShift.length + view.noLeads.length + view.weak.length;

  return (
    <div className="card card-pad">
      <div className="card-head">
        <div>
          <h3 className="card-title">Утро руководителя</h3>
          <p className="card-sub">
            {view.workday ? "Что разобрать сегодня" : "Сегодня выходной — смотрим вчерашний день"} · норма конверсии{" "}
            {fmtPct(view.normLph)}
          </p>
        </div>
        {total === 0 && (
          <span className="chip" style={{ ["--chip-fg" as string]: "var(--c-green-fg)", ["--chip-bg" as string]: "var(--c-green-bg)", ["--chip-bd" as string]: "var(--c-green-bd)" }}>
            Всё в порядке
          </span>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {view.workday && (
          <Bucket
            icon="calendar"
            hue="amber"
            title="Нет смены на сегодня"
            hint="в графике пусто — поставьте смену или отметьте выходной"
            people={view.noShift.map((r) => ({ id: r.op.id, name: r.op.name }))}
            empty="у всех есть смена"
          />
        )}
        <Bucket
          icon="phone"
          hue="red"
          title="На смене, но без лидов"
          hint="с начала дня ни одного переданного лида"
          people={view.noLeads.map((r) => ({ id: r.op.id, name: r.op.name }))}
          empty="лиды идут у всех"
        />
        <Bucket
          icon="trend"
          hue="purple"
          title={`Вчера ниже нормы · ${fmtDayShort(view.yest)}`}
          hint="конверсия лид/час ниже нормы стажировки"
          people={view.weak.map((w) => ({
            id: w.r.op.id,
            name: w.r.op.name,
            note: `${fmtPct(w.lph)} · ${fmtInt(w.leads)} лид. за ${fmtNum(w.hours, 0)} ч`,
          }))}
          empty="вчера все отработали в норме"
        />
      </div>
    </div>
  );
}

function Bucket({
  icon,
  hue,
  title,
  hint,
  people,
  empty,
}: {
  icon: IconName;
  hue: string;
  title: string;
  hint: string;
  people: { id: string; name: string; note?: string }[];
  empty: string;
}) {
  return (
    <div>
      <div className="row" style={{ gap: 7, marginBottom: 6 }}>
        <span style={{ color: `var(--c-${hue}-fg)`, display: "flex" }}>
          <Icon name={icon} size={14} />
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</span>
        <span className="num" style={{ fontSize: 12, color: "var(--dim)" }}>
          {people.length}
        </span>
      </div>
      {people.length === 0 ? (
        <div style={{ fontSize: 11.5, color: "var(--dimmer)" }}>{empty}</div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {people.map((p) => (
              <Link
                key={p.id}
                href={`/operators?id=${encodeURIComponent(p.id)}`}
                className="row"
                style={{ gap: 6, padding: "3px 8px 3px 3px", borderRadius: 999, border: "1px solid var(--ink-08)", textDecoration: "none", color: "var(--text)", fontSize: 12 }}
                title={p.note ? `${p.name}: ${p.note}` : p.name}
              >
                <Avatar name={p.name} id={p.id} size={20} />
                {p.name.split(" ").slice(0, 2).join(" ")}
                {p.note && (
                  <span className="num" style={{ color: "var(--dim)" }}>
                    {p.note.split(" · ")[0]}
                  </span>
                )}
              </Link>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--dimmer)", marginTop: 5 }}>{hint}</div>
        </>
      )}
    </div>
  );
}
