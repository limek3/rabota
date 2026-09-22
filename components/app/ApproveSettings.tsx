"use client";

import { useEffect, useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import type { SvBonusGrid } from "@/lib/crm/types";
import { approvePctFor } from "@/lib/crm/calc";
import { fmtMonth } from "@/lib/crm/dates";
import { fmtInt } from "@/lib/crm/format";
import { Chip, Field, MonthSwitcher, NumInput, SaveBar, Swatch, useDraft } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";

/**
 * Апрув заказчика — доля принятых заказчиком лидов. От него зависит бонус
 * супервайзера: коэффициент по ступеням (30% и выше — ×1, ниже 20% — бонуса нет).
 *
 * ApproveRules — правила (часть настроек системы, сохраняются общей кнопкой вкладки).
 * ApproveMonthEditor — фактический апрув за месяц по проектам (отдельные записи,
 * своя кнопка «Сохранить»).
 */

/** Апрув по умолчанию и коэффициенты бонуса — поля общей формы настроек. */
export function ApproveRules({ value, onChange }: { value: SvBonusGrid; onChange: (v: SvBonusGrid) => void }) {
  const steps = value.approve;
  const set = (i: number, patch: Partial<(typeof steps)[number]>) => onChange({ ...value, approve: steps.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="grid3">
        <Field label="Апрув по умолчанию, %" hint="Если за месяц апрув не проставлен">
          <NumInput value={value.defaultApprovePct} onChange={(v) => onChange({ ...value, defaultApprovePct: v ?? 0 })} max={100} step={0.5} />
        </Field>
      </div>
      <div>
        <div className="field-label" style={{ marginBottom: 6 }}>
          Коэффициент бонуса супервайзера по апруву
        </div>
        <div className="tbl-wrap" style={{ maxWidth: 520 }}>
          <table className="tbl tbl-fit">
            <thead>
              <tr>
                <th>Условие</th>
                <th className="r">Апрув от, %</th>
                <th className="r">Коэффициент</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {steps.map((a, i) => (
                <tr key={i}>
                  <td className="muted">
                    {a.k === 0 ? "бонус обнуляется" : a.k === 1 ? "бонус полностью" : `бонус × ${String(a.k).replace(".", ",")}`}
                  </td>
                  <td className="r">
                    <NumInput className="inp inp-sm num" style={{ width: 72, textAlign: "right" }} value={a.from} max={100} step={0.5} onChange={(v) => set(i, { from: v ?? 0 })} />
                  </td>
                  <td className="r">
                    <NumInput className="inp inp-sm num" style={{ width: 72, textAlign: "right" }} value={a.k} max={5} step={0.01} onChange={(v) => set(i, { k: v ?? 0 })} />
                  </td>
                  <td className="r">
                    {steps.length > 1 && (
                      <button className="btn btn-ghost btn-sm btn-icon" title="Убрать ступень" onClick={() => onChange({ ...value, approve: steps.filter((_, j) => j !== i) })}>
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          className="btn btn-sm"
          style={{ marginTop: 8 }}
          onClick={() => onChange({ ...value, approve: [...steps, { from: 0, k: 1 }] })}
        >
          <Icon name="plus" size={13} /> Ступень
        </button>
      </div>
    </div>
  );
}

/**
 * Апрув за месяц по проектам. Пустое поле — у проекта нет своего процента, берётся
 * общий на месяц (а если нет и его — «по умолчанию» из настроек).
 */
export function ApproveMonthEditor({ monthSwitcher = false, onDirty }: { monthSwitcher?: boolean; onDirty?: (dirty: boolean) => void }) {
  const { month: appMonth } = useCrm();
  const [ownMonth, setOwnMonth] = useState(appMonth);
  const [dirty, setDirty] = useState(false);
  const month = monthSwitcher ? ownMonth : appMonth;
  useEffect(() => onDirty?.(dirty), [dirty, onDirty]);
  const pickMonth = (m: string) => {
    if (dirty && !window.confirm("Апрув за этот месяц не сохранён. Перейти к другому месяцу без сохранения?")) return;
    setOwnMonth(m);
  };
  // таблица пересоздаётся на каждый месяц — черновик одного месяца не попадёт в другой
  return <ApproveMonthTable key={month} month={month} switcher={monthSwitcher ? <MonthSwitcher value={ownMonth} onChange={pickMonth} /> : null} onDirty={setDirty} />;
}

function ApproveMonthTable({ month, switcher, onDirty }: { month: string; switcher: React.ReactNode; onDirty: (dirty: boolean) => void }) {
  const { data, ix, saveApprove, deleteApprove, access, toast } = useCrm();
  const canEdit = access.can.editPayroll;

  const leadsByProject = useMemo(() => {
    const out = new Map<string, number>();
    for (const [pid, days] of ix.projectDay) {
      let n = 0;
      for (const [d, c] of days) if (d.slice(0, 7) === month) n += c;
      if (n) out.set(pid, n);
    }
    return out;
  }, [ix, month]);

  const recs = data.approves.filter((a) => a.month === month);
  const projects = data.projects.filter((p) => !p.deletedAt && (p.active || leadsByProject.has(p.id))).sort((a, b) => (leadsByProject.get(b.id) ?? 0) - (leadsByProject.get(a.id) ?? 0));
  // черновик: проект → процент или null (свой не задан); "" — общий на месяц
  const source = useMemo(() => {
    const m: Record<string, number | null> = { "": recs.find((a) => !a.projectId)?.pct ?? null };
    for (const p of projects) m[p.id] = recs.find((a) => a.projectId === p.id)?.pct ?? null;
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(recs), JSON.stringify(projects.map((p) => p.id)), month]);
  const { draft, setDraft, dirty, reset } = useDraft(source);
  const [busy, setBusy] = useState(false);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const weighted = approvePctFor(data, ix, month);
  const fallback = draft[""] ?? data.settings.svBonus.defaultApprovePct;
  const noProject = leadsByProject.get("__none__") ?? 0;

  const save = async () => {
    setBusy(true);
    try {
      for (const [pid, v] of Object.entries(draft)) {
        const rec = recs.find((a) => (a.projectId || "") === pid);
        if (v == null) {
          if (rec) await deleteApprove(rec.id);
        } else if (!rec || rec.pct !== v) await saveApprove(month, pid, v, rec?.comment ?? "");
      }
      toast(`Апрув за ${fmtMonth(month).toLowerCase()} сохранён`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        {switcher}
        <span style={{ fontSize: 12.5, color: "var(--text-sub)" }}>
          Средневзвешенный по проектам за {fmtMonth(month).toLowerCase()} — идёт в бонус супервайзера
        </span>
        <Chip hue={weighted >= 30 ? "green" : weighted >= 20 ? "amber" : "red"} dot>
          {fmtInt(weighted)}%
        </Chip>
      </div>
      <div className="tbl-wrap">
        <table className="tbl tbl-fit">
          <thead>
            <tr>
              <th>Проект</th>
              <th className="r">Лидов за месяц</th>
              <th className="r">Апрув, %</th>
              <th className="r">В расчёте</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>
                  <span className="row" style={{ gap: 8 }}>
                    <Swatch hue={p.color} />
                    {p.name}
                  </span>
                </td>
                <td className="r num">{fmtInt(leadsByProject.get(p.id) ?? 0)}</td>
                <td className="r">
                  {canEdit ? (
                    <NumInput
                      value={draft[p.id] ?? null}
                      onChange={(v) => setDraft((d) => ({ ...d, [p.id]: v }))}
                      max={100}
                      step={0.5}
                      allowEmpty
                      className="inp inp-sm r num"
                      style={{ width: 84 }}
                      placeholder="общий"
                    />
                  ) : (
                    <span className="num">{draft[p.id] == null ? "—" : `${fmtInt(draft[p.id]!)}%`}</span>
                  )}
                </td>
                <td className="r num muted">{fmtInt(draft[p.id] ?? fallback)}%</td>
              </tr>
            ))}
            {noProject > 0 && (
              <tr>
                <td className="muted">Без проекта</td>
                <td className="r num">{fmtInt(noProject)}</td>
                <td className="r muted">—</td>
                <td className="r num muted">{fmtInt(fallback)}%</td>
              </tr>
            )}
            <tr>
              <td>
                <b>Общий на месяц</b>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  там, где у проекта свой не задан
                </div>
              </td>
              <td className="r num">{fmtInt(Array.from(leadsByProject.values()).reduce((a, b) => a + b, 0))}</td>
              <td className="r">
                {canEdit ? (
                  <NumInput
                    value={draft[""] ?? null}
                    onChange={(v) => setDraft((d) => ({ ...d, "": v }))}
                    max={100}
                    step={0.5}
                    allowEmpty
                    className="inp inp-sm r num"
                    style={{ width: 84 }}
                    placeholder={`${fmtInt(data.settings.svBonus.defaultApprovePct)}`}
                  />
                ) : (
                  <span className="num">{draft[""] == null ? "—" : `${fmtInt(draft[""]!)}%`}</span>
                )}
              </td>
              <td className="r num muted">{fmtInt(fallback)}%</td>
            </tr>
          </tbody>
        </table>
      </div>
      {canEdit && <SaveBar dirty={dirty} busy={busy} onSave={() => void save()} onReset={reset} />}
    </div>
  );
}
