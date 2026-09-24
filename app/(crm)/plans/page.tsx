"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { goneLast, isGone } from "@/lib/crm/calc";
import { planId } from "@/lib/crm/ids";
import { NO_GROUP, NO_GROUP_LABEL, type MonthPlan } from "@/lib/crm/types";
import { fmtMonth, fmtRange, isWorkday, rangeDays, weekEnd, weekStart } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct, shortName } from "@/lib/crm/format";
import { Avatar, Chip, GoneSepRow, GoneTag, MonthSwitcher, PageHead, Swatch } from "@/components/ui/kit";
import { canEditPlan } from "@/lib/crm/access";

/** Поле плана месяца: пусто — значение по умолчанию, число — отдельный план на этот месяц. */
function PlanInput({ value, placeholder, onSave, disabled }: { value: number | null; placeholder: string; onSave: (v: number | null) => void; disabled?: boolean }) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => setText(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const t = text.trim();
    const v = t === "" ? null : Math.max(0, Math.round(Number(t.replace(",", "."))));
    if (t !== "" && !Number.isFinite(v)) {
      setText(value == null ? "" : String(value));
      return;
    }
    if (v !== value) onSave(v);
  };
  return (
    <input
      className="inp inp-sm num"
      style={{ width: 90, textAlign: "right", borderColor: value != null ? "var(--brand-border)" : undefined }}
      inputMode="numeric"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setText(value == null ? "" : String(value));
      }}
      title={disabled ? "Менять планы может РОП" : value != null ? "План задан для этого месяца. Очистите поле, чтобы вернуть значение по умолчанию." : "По умолчанию. Введите число, чтобы задать план на этот месяц."}
    />
  );
}

export default function PlansPage() {
  const { data, ix, month, setMonth, savePlan, today, access } = useCrm();
  const m = useMonthModel();
  const s = data.settings;
  const cal = m.cal;
  const rec = (id: string): MonthPlan | undefined => ix.planById.get(id);

  // план на неделю и к дате — пропорционально рабочим дням
  const refDay = cal.phase === "current" ? today : cal.days[0];
  const ws = weekStart(refDay);
  const we = weekEnd(refDay);
  const weekW = rangeDays(ws, we).filter((d) => d.slice(0, 7) === month && isWorkday(d, s)).length;
  const share = (plan: number) => ({ day: plan / cal.W, week: (plan * weekW) / cal.W });

  const teamRec = rec(planId(month, "team", null));
  const teamDefault = s.teamPlan > 0 ? s.teamPlan : m.groups.reduce((a, g) => a + g.plan, 0);
  const sumOps = m.ops.filter((r) => !r.op.deletedAt).reduce((a, r) => a + r.terms.plan, 0);
  const sumGroups = m.groups.reduce((a, g) => a + g.plan, 0);

  const ops = useMemo(
    () =>
      [...m.ops]
        .filter((r) => !r.op.deletedAt || r.pace.fact > 0)
        .sort((a, b) => {
          const ga = a.groupKey === NO_GROUP ? "я" : ix.groupById.get(a.groupKey)?.name ?? "";
          const gb = b.groupKey === NO_GROUP ? "я" : ix.groupById.get(b.groupKey)?.name ?? "";
          // уволенные — в конце всего списка, за разделителем
          return goneLast(a.op, b.op) || ga.localeCompare(gb, "ru") || a.op.name.localeCompare(b.op.name, "ru");
        }),
    [m.ops, ix],
  );

  return (
    <div className="stack">
      <PageHead
        title="Планы"
        sub={`${fmtMonth(month)} · главный план — переданные лиды. Пустое поле — значение по умолчанию, число — план именно на этот месяц.`}
        actions={<MonthSwitcher value={month} onChange={setMonth} />}
      />

      <div className="card card-pad">
        <div className="row" style={{ gap: 24, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>
              План команды на месяц
            </div>
            <div className="row" style={{ gap: 8 }}>
              <PlanInput value={teamRec ? teamRec.plan : null} placeholder={String(teamDefault)} onSave={(v) => void savePlan(month, "team", null, v)} disabled={!access.can.editTeamPlan} />
              <span style={{ fontSize: 12, color: "var(--dim)" }}>
                {teamRec ? "задан на месяц" : s.teamPlan > 0 ? "из настроек" : "сумма планов групп"}
              </span>
            </div>
          </div>
          <Stat label="Сейчас в расчёте" value={fmtInt(m.team.plan)} />
          <Stat label="В рабочий день" value={fmtNum(share(m.team.plan).day)} sub={`${cal.W} раб. дней`} />
          <Stat label={`На неделю ${fmtRange(ws, we)}`} value={fmtNum(share(m.team.plan).week)} sub={`${weekW} раб. дн. в этом месяце`} />
          <Stat label="К сегодня" value={fmtNum(m.team.pace.planToDate)} sub={`факт ${fmtInt(m.team.pace.fact)}`} />
        </div>
        <div className="row" style={{ gap: 6, marginTop: 14, flexWrap: "wrap" }}>
          <Chip hue={Math.abs(sumGroups - m.team.plan) < 0.5 ? "green" : "amber"}>Сумма планов групп: {fmtInt(sumGroups)}</Chip>
          <Chip hue={Math.abs(sumOps - m.team.plan) < 0.5 ? "green" : "amber"}>Сумма личных планов: {fmtInt(sumOps)}</Chip>
          {(Math.abs(sumOps - m.team.plan) >= 0.5 || Math.abs(sumGroups - m.team.plan) >= 0.5) && (
            <span style={{ fontSize: 12, color: "var(--dim)" }}>Планы не обязаны сходиться, но расхождение — повод проверить.</span>
          )}
        </div>
      </div>

      <div className="card card-tbl" style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 18px 8px" }}>
          <h3 className="card-title">Группы</h3>
          <p className="card-sub">По умолчанию — план из карточки группы, а если там 0 — сумма личных планов участников</p>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="tbl tbl-fit">
            <thead>
              <tr>
                <th>Группа</th>
                <th className="r">План месяца</th>
                <th className="r">В расчёте</th>
                <th className="r">В день</th>
                <th className="r">На неделю</th>
                <th className="r">К сегодня</th>
                <th className="r bl">Факт</th>
                <th className="r">Выполнение</th>
              </tr>
            </thead>
            <tbody>
              {m.groups.map((g) => {
                const r = g.group ? rec(planId(month, "group", g.group.id)) : undefined;
                const def = g.group && g.group.monthlyPlan > 0 ? g.group.monthlyPlan : g.members.reduce((a, x) => a + x.terms.plan, 0);
                return (
                  <tr key={g.key}>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <Swatch hue={g.color} />
                        {g.name}
                      </span>
                    </td>
                    <td className="r">
                      {g.group && !g.group.deletedAt ? (
                        <PlanInput value={r ? r.plan : null} placeholder={String(def)} onSave={(v) => void savePlan(month, "group", g.group!.id, v)} disabled={!canEditPlan(access, "group", g.group.id)} />
                      ) : (
                        <span className="muted">сумма</span>
                      )}
                    </td>
                    <td className="r num" style={{ fontWeight: 600 }}>{fmtInt(g.plan)}</td>
                    <td className="r num">{fmtNum(share(g.plan).day)}</td>
                    <td className="r num">{fmtNum(share(g.plan).week)}</td>
                    <td className="r num">{fmtNum(g.pace.planToDate)}</td>
                    <td className="r num bl">{fmtInt(g.pace.fact)}</td>
                    <td className="r num">{fmtPct(g.pace.pct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-tbl" style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 18px 8px" }}>
          <h3 className="card-title">Операторы</h3>
          <p className="card-sub">
            По умолчанию — личный план из карточки{s.defaultOperatorPlan > 0 ? ` (или ${s.defaultOperatorPlan} из настроек)` : ""}; принятым или уволенным посреди месяца план уменьшается пропорционально рабочим дням.
          </p>
        </div>
        <div style={{ overflowX: "auto", maxHeight: 560 }}>
          <table className="tbl tbl-fit">
            <thead>
              <tr>
                <th className="sticky-col">Оператор</th>
                <th>Группа</th>
                <th className="r">План месяца</th>
                <th className="r">В расчёте</th>
                <th className="r">В день</th>
                <th className="r">На неделю</th>
                <th className="r">К сегодня</th>
                <th className="r bl">Факт</th>
                <th className="r">Выполнение</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((r, i) => {
                const pr = rec(planId(month, "operator", r.op.id));
                const def = r.op.monthlyPlan ?? s.defaultOperatorPlan;
                const g = r.op.groupId ? ix.groupById.get(r.op.groupId) : null;
                return (
                  <Fragment key={r.op.id}>
                  {isGone(r.op) && (i === 0 || !isGone(ops[i - 1].op)) && <GoneSepRow count={ops.filter((x) => isGone(x.op)).length} colSpan={9} />}
                  <tr className={r.op.status !== "active" ? "dim" : ""}>
                    <td className="sticky-col">
                      <span className="row" style={{ gap: 8 }}>
                        <Avatar name={r.op.name} id={r.op.id} size={22} />
                        {shortName(r.op.name)}
                        <GoneTag op={r.op} />
                      </span>
                    </td>
                    <td className="muted">{g ? g.name : NO_GROUP_LABEL}</td>
                    <td className="r">
                      <PlanInput
                        value={pr ? pr.plan : null}
                        placeholder={String(r.terms.explicit ? def : r.terms.plan)}
                        onSave={(v) => void savePlan(month, "operator", r.op.id, v)}
                        disabled={!canEditPlan(access, "operator", r.op.id)}
                      />
                    </td>
                    <td className="r num" style={{ fontWeight: 600 }}>{fmtInt(r.terms.plan)}</td>
                    <td className="r num">{fmtNum(share(r.terms.plan).day)}</td>
                    <td className="r num">{fmtNum(share(r.terms.plan).week)}</td>
                    <td className="r num">{fmtNum(r.pace.planToDate)}</td>
                    <td className="r num bl">{fmtInt(r.pace.fact)}</td>
                    <td className="r num">{fmtPct(r.pace.pct)}</td>
                  </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="field-label">{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--dim)" }}>{sub}</div>}
    </div>
  );
}
