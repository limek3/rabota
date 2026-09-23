"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useCrm, type AdjustmentInput } from "@/lib/crm/store";
import { approvePctFor, approvePctWhere, leadIncome, monthCal, opTerms, type MonthCal } from "@/lib/crm/calc";
import { costPerLead, fundForecast, fundStat, hasBonus, isHourlyTiered, isSalary, isSvVolume, isTiered, payroll, payrollRow, type PayRow } from "@/lib/crm/payroll";
import { TierTable, tierRange } from "@/components/app/RateGrids";
import { ADJ_LABEL, GRADE_LABEL, NO_GROUP_LABEL, PAY_LABEL, TRACK_LABEL, type Adjustment, type AdjustmentType, type Grade, type PayType, type Track } from "@/lib/crm/types";
import { fmtDate, fmtMonth, monthEnd, monthStart, todayKey } from "@/lib/crm/dates";
import { fmtInt, fmtMoney, fmtNum, fmtPct } from "@/lib/crm/format";
import { Avatar, Chip, Drawer, Empty, Field, GoneTag, Kpi, Modal, MonthSwitcher, NumInput, PageHead, Swatch, downloadText, foldRow, toCsv, useFoldGroups } from "@/components/ui/kit";
import { DateInput, Select, dot, type Opt } from "@/components/ui/select";
import { canEditPay, canTouchOp } from "@/lib/crm/access";
import { Icon } from "@/components/ui/icons";
import { ApproveMonthEditor } from "@/components/app/ApproveSettings";

const ADJ_TYPES: AdjustmentType[] = ["accrual", "bonus", "compensation", "correction", "deduction", "advance", "payout"];
const ADJ_HUE: Record<AdjustmentType, string> = {
  accrual: "green", bonus: "green", compensation: "teal", correction: "indigo", deduction: "red", advance: "amber", payout: "amber",
};
const ADJ_HINT: Record<AdjustmentType, string> = {
  accrual: "увеличивает начисление",
  bonus: "увеличивает начисление",
  compensation: "увеличивает начисление, не облагается процентом удержания",
  correction: "± к начислению, можно с минусом",
  deduction: "уменьшает сумму к выплате",
  advance: "уже выплачено — уменьшает остаток",
  payout: "уже выплачено — уменьшает остаток",
};

const NO_GROUP = "__none__";

/** Доп. начисления без премий: доплаты, компенсации, корректировки. */
const extraOf = (a: Record<AdjustmentType, number>) => a.accrual + a.compensation + a.correction;

/** Подсказка к ячейке: из каких записей сложилась сумма. */
function adjTitle(r: PayRow, types: AdjustmentType[]): string | undefined {
  const list = r.adjustments.filter((a) => types.includes(a.type));
  if (!list.length) return undefined;
  return list.map((a) => `${fmtDate(a.date)} · ${ADJ_LABEL[a.type]} ${fmtMoney(a.amount)}${a.comment ? ` — ${a.comment}` : ""}`).join("\n");
}

/** Итоги по подмножеству строк — когда часть ведомости скрыта правами. */
function payrollOf(rows: PayRow[]) {
  const zero = { accrual: 0, bonus: 0, compensation: 0, correction: 0, deduction: 0, advance: 0, payout: 0 };
  const total = { hours: 0, leads: 0, base: 0, leadPay: 0, adj: { ...zero }, gross: 0, withholdBase: 0, withhold: 0, deductions: 0, net: 0, paid: 0, toPay: 0 };
  for (const r of rows) {
    total.hours += r.hours;
    total.leads += r.leads;
    total.base += r.base;
    total.leadPay += r.leadPay;
    total.gross += r.gross;
    total.withholdBase += r.withholdBase;
    total.withhold += r.withhold;
    total.deductions += r.deductions;
    total.net += r.net;
    total.paid += r.paid;
    total.toPay += r.toPay;
    for (const k of Object.keys(total.adj) as (keyof typeof zero)[]) total.adj[k] += r.adj[k];
  }
  return { rows, total };
}

export default function PayrollPage() {
  const { data, ix, month, setMonth, today, saveTerms, toast, confirm, access } = useCrm();
  const cal = useMemo(() => monthCal(month, data.settings, today), [month, data.settings, today]);
  const prAll = useMemo(() => payroll(data, ix, cal), [data, ix, cal]);
  // супервайзер, видящий все группы, всё равно смотрит зарплату только своих
  const pr = useMemo(() => {
    if (access.isHead) return prAll;
    const rows = prAll.rows.filter((r) => canTouchOp(access, r.op.id));
    if (rows.length === prAll.rows.length) return prAll;
    return payrollOf(rows);
  }, [prAll, access]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adjFor, setAdjFor] = useState<{ opId: string; adj?: Adjustment } | null>(null);
  const [q, setQ] = useState("");

  const [grp, setGrp] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const fold = useFoldGroups(wrapRef);

  // группа строки: супервайзер — в группе, которую ведёт; остальные — по карточке
  const led = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data.groups) if (!g.deletedAt && g.supervisorId && !m.has(g.supervisorId)) m.set(g.supervisorId, g.id);
    return m;
  }, [data.groups]);
  const groupOf = useCallback((r: PayRow) => led.get(r.op.id) ?? r.op.groupId ?? NO_GROUP, [led]);
  // супервайзер — по роли в карточке или потому что ведёт группу
  const isSv = useCallback((r: PayRow) => r.op.role === "supervisor" || led.has(r.op.id), [led]);

  const rows = useMemo(
    () =>
      pr.rows.filter(
        (r) => (!q.trim() || r.op.name.toLowerCase().includes(q.trim().toLowerCase())) && (!grp || groupOf(r) === grp),
      ),
    [pr.rows, q, grp, groupOf],
  );

  // ведомость по группам: у каждой строка-заголовок с итогами, внутри — сначала супервайзер
  const sections = useMemo(() => {
    const map = new Map<string, PayRow[]>();
    for (const r of rows) {
      const k = groupOf(r);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return Array.from(map.entries())
      .map(([id, list]) => {
        const g = id === NO_GROUP ? null : ix.groupById.get(id);
        const sorted = [...list].sort((a, b) => Number(isSv(b)) - Number(isSv(a)) || a.op.name.localeCompare(b.op.name, "ru"));
        return {
          id,
          name: g?.name ?? NO_GROUP_LABEL,
          color: g?.color ?? "gray",
          supervisor: g ? (g.supervisorId ? ix.opById.get(g.supervisorId)?.name : null) ?? (g.supervisorName || null) : null,
          rows: sorted,
          total: payrollOf(sorted).total,
        };
      })
      .sort((a, b) => Number(a.id === NO_GROUP) - Number(b.id === NO_GROUP) || a.name.localeCompare(b.name, "ru"));
  }, [rows, groupOf, isSv, ix]);
  // итог по видимым строкам (фильтр по группе или поиску)
  const vt = useMemo(() => ({ rows: rows.length, total: payrollOf(rows).total }), [rows]);

  const groupOpts = useMemo<Opt[]>(() => {
    const ids = new Set(pr.rows.map(groupOf));
    const list = Array.from(ids)
      .map((id) => {
        const g = id === NO_GROUP ? null : ix.groupById.get(id);
        return { value: id, label: g?.name ?? NO_GROUP_LABEL, icon: dot(g?.color ?? "gray") };
      })
      .sort((a, b) => Number(a.value === NO_GROUP) - Number(b.value === NO_GROUP) || a.label.localeCompare(b.label, "ru"));
    return [{ value: "", label: "Все группы" }, ...list];
  }, [pr.rows, groupOf, ix]);
  const openRow = openId ? pr.rows.find((r) => r.op.id === openId) ?? null : null;
  const t = pr.total;
  const unfixed = pr.rows.filter((r) => !r.explicitTerms).length;

  /* ФОТ: фонд против дохода, доход = лиды × цена лида × апрув заказчика (по проектам, взвешенный по лидам) */
  const approve = useMemo(() => approvePctFor(data, ix, month), [data, ix, month]);
  const income = leadIncome(data.settings.leadRevenue, approve);
  const fund = useMemo(() => fundStat(t.gross, t.leads, income, data.settings.payrollCapPct), [t.gross, t.leads, income, data.settings.payrollCapPct]);
  /* прогноз: фонд растёт по отработанным дням, доход — по Run Rate лидов */
  const forecast = useMemo(() => {
    if (cal.phase !== "current") return null;
    const elapsed = cal.wIdx(cal.ref);
    const ahead = cal.workdays.filter((d) => d > cal.ref);
    const rr = elapsed > 0 ? Math.round((t.leads / elapsed) * cal.W) : t.leads;
    return fundForecast(t.gross, t.leads, rr, elapsed, cal.W, income, data.settings.payrollCapPct, ahead);
  }, [cal, t.gross, t.leads, income, data.settings.payrollCapPct]);

  const fundByGroup = useMemo(() => {
    const map = new Map<string, { name: string; color: string; people: number; leads: number; gross: number; ops: Set<string> }>();
    for (const r of pr.rows) {
      const key = groupOf(r);
      const g = key === NO_GROUP ? null : ix.groupById.get(key);
      const cur = map.get(key) ?? { name: g?.name ?? NO_GROUP_LABEL, color: g?.color ?? "gray", people: 0, leads: 0, gross: 0, ops: new Set<string>() };
      cur.ops.add(r.op.id);
      cur.people += 1;
      cur.leads += r.leads;
      cur.gross += r.gross;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .map(([id, v]) => {
        // апрув группы — по проектам её лидов
        const approve = approvePctWhere(data, month, (l) => v.ops.has(l.operatorId));
        return { id, ...v, approve, stat: fundStat(v.gross, v.leads, leadIncome(data.settings.leadRevenue, approve), data.settings.payrollCapPct) };
      })
      .sort((a, b) => b.gross - a.gross);
  }, [pr.rows, ix, groupOf, data, month]);

  const freezeAll = async () => {
    const ok = await confirm({
      title: "Зафиксировать условия месяца?",
      text: `План, норма часов, схема оплаты и ставки на ${fmtMonth(month)} запишутся отдельно для каждого оператора (${unfixed}). После этого изменения в карточках не повлияют на этот месяц. Прошедшие месяцы фиксируются автоматически.`,
      ok: "Зафиксировать",
    });
    if (!ok) return;
    for (const r of pr.rows) {
      if (r.explicitTerms) continue;
      await saveTerms(month, r.op.id, { plan: termsPlan(r), normHours: r.normHours, payType: r.payType, salary: r.salary, hourlyRate: r.hourlyRate, leadBonus: r.leadBonus });
    }
    toast("Условия месяца зафиксированы");
  };
  // план в ведомости не показывается, но при фиксации сохраняется тем же, что считает модель месяца
  const termsPlan = (r: PayRow) => opTerms(r.op, cal, data, ix).plan;

  const exportCsv = () => {
    const head = ["ФИО", "Схема", "Часы", "Норма", "Лиды", "Оклад/часы", "Бонус за лиды", "Доп. начисления", "Премии", "Компенсации", "Корректировки", "Начислено", `Удержание ${data.settings.withholdPct}%`, "Удержания", "К выплате", "Аванс", "Выплачено", "Остаток"];
    const body = pr.rows.map((r) => [
      r.op.name, PAY_LABEL[r.payType], r.hours, r.normHours, r.leads, r.base, r.leadPay, r.adj.accrual, r.adj.bonus, r.adj.compensation, r.adj.correction,
      r.gross, r.withhold, r.deductions, r.net, r.adj.advance, r.adj.payout, r.toPay,
    ]);
    body.push(["ИТОГО", "", t.hours, "", t.leads, t.base, t.leadPay, t.adj.accrual, t.adj.bonus, t.adj.compensation, t.adj.correction, t.gross, t.withhold, t.deductions, t.net, t.adj.advance, t.adj.payout, t.toPay]);
    downloadText(`payroll_${month}.csv`, toCsv([head, ...body]), "text/csv;charset=utf-8");
  };

  return (
    <div className="stack">
      <PageHead
        title="Зарплата"
        sub={`${fmtMonth(month)} · считается из смен, лидов и корректировок; меняется график — меняется ведомость`}
        actions={
          <>
            <MonthSwitcher value={month} onChange={setMonth} />
            {access.can.editPayroll && unfixed > 0 && cal.phase !== "future" && (
              <button className="btn" onClick={() => void freezeAll()} title="Записать условия месяца, чтобы правки карточек не меняли эту ведомость">
                <Icon name="check" size={14} /> Зафиксировать условия
              </button>
            )}
            <button className="btn" onClick={exportCsv} disabled={!pr.rows.length}>
              <Icon name="download" size={14} /> CSV
            </button>
            {access.can.editPayroll && (
              <button className="btn btn-primary" onClick={() => setAdjFor({ opId: "" })} disabled={!pr.rows.length}>
                <Icon name="plus" size={14} stroke={2.2} /> Начисление
              </button>
            )}
          </>
        }
      />

      <div className="kpi-grid">
        <Kpi label="Начислено" value={fmtMoney(t.gross)} sub={`база ${fmtMoney(t.base)} · бонусы ${fmtMoney(t.leadPay)}`} />
        <Kpi label="Удержано" value={fmtMoney(t.withhold + t.deductions)} sub={`${data.settings.withholdPct}% — ${fmtMoney(t.withhold)}`} />
        <Kpi label="К выплате всего" value={fmtMoney(t.net)} sub="начислено минус удержано" />
        <Kpi label="Уже выплачено" value={fmtMoney(t.paid)} sub={`аванс ${fmtMoney(t.adj.advance)}`} />
        <Kpi label="Остаток к выплате" value={fmtMoney(t.toPay)} sub="за вычетом выплаченного" />
        <Kpi label="Стоимость лида" value={t.leads ? fmtMoney(costPerLead(pr)) : "—"} sub={`${fmtInt(t.leads)} лидов · ${fmtNum(t.hours, 0)} ч`} title="Начислено / переданные лиды" />
        <Kpi
          label="ФОТ к доходу"
          value={fund.revenue > 0 ? fmtPct(fund.pct) : "—"}
          sub={fund.revenue > 0 ? `норматив ${data.settings.payrollCapPct}% · апрув ${fmtNum(approve)}% · доход ${fmtMoney(fund.revenue)}` : data.settings.leadRevenue > 0 ? "апрув заказчика 0%" : "укажите цену лида в настройках"}
          tone={fund.revenue > 0 ? (fund.ok ? "good" : "bad") : undefined}
          title={`Фонд оплаты труда ${fmtMoney(fund.fund)} против дохода: ${fmtInt(t.leads)} лидов × ${fmtMoney(data.settings.leadRevenue)} × апрув ${fmtNum(approve)}% = ${fmtMoney(fund.revenue)}`}
        />
      </div>

      {pr.rows.length === 0 ? (
        <div className="card">
          <Empty icon="wallet" title="Ведомость пуста" text="В этом месяце нет операторов в штате и нет начислений." />
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div style={{ position: "relative", width: 260 }}>
              <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--dim)" }} />
              <input className="inp" style={{ paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Оператор" />
            </div>
            {groupOpts.length > 2 && (
              <Select value={grp} options={groupOpts} onChange={setGrp} width={220} ariaLabel="Группа" title="Показать группу" />
            )}
            <span style={{ fontSize: 12, color: "var(--dim)" }}>
              Оклад {data.settings.prorateSalary ? "пропорционален часам, если норма не выполнена" : "платится полностью"} · удержание {data.settings.withholdPct}% (кроме компенсаций)
            </span>
          </div>
          <div ref={wrapRef} className="tbl-wrap" style={{ maxHeight: "max(300px, calc(100vh / var(--ui-scale, 1) - 360px))" }}>
            <table className="tbl tbl-fit">
              <thead>
                <tr>
                  <th className="sticky-col" style={{ minWidth: 240 }}>Оператор</th>
                  <th>Схема</th>
                  <th className="r">Часы</th>
                  <th className="r">Лиды</th>
                  <th className="r bl" title="Оклад (с учётом пропорции) или часы × ставка">База</th>
                  <th className="r" title="Лиды × бонус за лид">Бонус за лиды</th>
                  <th className="r" title="Премии за месяц">Премии</th>
                  <th className="r" title="Доп. начисления, компенсации, корректировки">Доп.</th>
                  <th className="r" style={{ fontWeight: 700 }}>Начислено</th>
                  <th className="r bl" title="Процент удержания + удержания">Удержано</th>
                  <th className="r">К выплате</th>
                  <th className="r" title="Аванс + выплаты">Выплачено</th>
                  <th className="r" style={{ fontWeight: 700 }}>Остаток</th>
                  <th />
                </tr>
              </thead>
              {sections.map((sec) => {
                const closed = fold.isClosed(sec.id);
                const phase = fold.phase(sec.id);
                return (
                  <tbody key={sec.id} data-fold={sec.id}>
                    <tr className="grp-head" onClick={() => fold.toggle(sec.id)} title={closed ? "Развернуть группу" : "Свернуть группу"} aria-expanded={!closed}>
                      <td className="sticky-col">
                        <span className="row" style={{ gap: 8 }}>
                          <Icon name="chevR" size={14} className={`grp-chev${closed || phase === "out" ? "" : " open"}`} />
                          <Swatch hue={sec.color} />
                          <span>{sec.name}</span>
                          <span className="grp-head-sub">
                            {sec.rows.length} чел.{sec.supervisor ? ` · супервайзер ${sec.supervisor}` : ""}
                          </span>
                        </span>
                      </td>
                      <td />
                      <td className="r num">{fmtNum(sec.total.hours)}</td>
                      <td className="r num">{fmtInt(sec.total.leads)}</td>
                      <td className="r num bl">{fmtMoney(sec.total.base)}</td>
                      <td className="r num">{fmtMoney(sec.total.leadPay)}</td>
                      <td className="r num">{sec.total.adj.bonus ? fmtMoney(sec.total.adj.bonus) : "—"}</td>
                      <td className="r num">{extraOf(sec.total.adj) ? fmtMoney(extraOf(sec.total.adj)) : "—"}</td>
                      <td className="r num">{fmtMoney(sec.total.gross)}</td>
                      <td className="r num bl">{fmtMoney(sec.total.withhold + sec.total.deductions)}</td>
                      <td className="r num">{fmtMoney(sec.total.net)}</td>
                      <td className="r num">{fmtMoney(sec.total.paid)}</td>
                      <td className="r num">{fmtMoney(sec.total.toPay)}</td>
                      <td />
                    </tr>
                    {!closed &&
                      sec.rows.map((r, i) => {
                        const f = foldRow(phase, i);
                        return (
                        <tr key={r.op.id} className={`clickable ${r.op.deletedAt || r.op.status === "fired" ? "dim" : ""} ${f.className}`} style={f.style} onClick={() => setOpenId(r.op.id)}>
                          <td className="sticky-col" style={{ paddingLeft: 28 }}>
                            <span className="row" style={{ gap: 8 }}>
                              <Avatar name={r.op.name} id={r.op.id} size={24} />
                              {r.op.name}
                              {isSv(r) && <Chip hue="indigo">СВ</Chip>}
                              {r.explicitTerms && <span title="Условия месяца зафиксированы" style={{ color: "var(--brand)" }}>•</span>}
                              <GoneTag op={r.op} />
                            </span>
                          </td>
                          <td className="muted">{PAY_LABEL[r.payType]}</td>
                          <td className="r num">
                            {fmtNum(r.hours)}
                            {isSalary(r.payType) && <span className="muted"> / {fmtNum(r.normHours, 0)}</span>}
                          </td>
                          <td className="r num">{fmtInt(r.leads)}</td>
                          <td className="r num bl">{fmtMoney(r.base)}</td>
                          <td className="r num">{hasBonus(r.payType) ? fmtMoney(r.leadPay) : <span className="muted">—</span>}</td>
                          <td className="r num" title={adjTitle(r, ["bonus"])}>
                            {r.adj.bonus ? <span style={{ color: "var(--c-green-fg)", fontWeight: 600 }}>+{fmtMoney(r.adj.bonus)}</span> : <span className="muted">—</span>}
                          </td>
                          <td className="r num" title={adjTitle(r, ["accrual", "compensation", "correction"])}>
                            {extraOf(r.adj) ? fmtMoney(extraOf(r.adj)) : <span className="muted">—</span>}
                          </td>
                          <td className="r num" style={{ fontWeight: 600 }}>{fmtMoney(r.gross)}</td>
                          <td className="r num bl" title={adjTitle(r, ["deduction"])}>{fmtMoney(r.withhold + r.deductions)}</td>
                          <td className="r num">{fmtMoney(r.net)}</td>
                          <td className="r num" title={adjTitle(r, ["advance", "payout"])}>{fmtMoney(r.paid)}</td>
                          <td className="r num" style={{ fontWeight: 600, color: r.toPay < 0 ? "var(--c-red-fg)" : undefined }}>{fmtMoney(r.toPay)}</td>
                          <td className="r" onClick={(e) => e.stopPropagation()}>
                            {canEditPay(access, r.op.id) && (
                              <span className="row-actions">
                                <button className="btn btn-ghost btn-sm btn-icon" title="Добавить начисление/выплату" onClick={() => setAdjFor({ opId: r.op.id })}>
                                  <Icon name="plus" size={14} />
                                </button>
                              </span>
                            )}
                          </td>
                        </tr>
                        );
                      })}
                  </tbody>
                );
              })}
              <tfoot>
                <tr>
                  <td className="sticky-col">
                    Итого · {vt.rows}
                    {vt.rows !== pr.rows.length && <span className="muted"> из {pr.rows.length}</span>}
                  </td>
                  <td />
                  <td className="r num">{fmtNum(vt.total.hours)}</td>
                  <td className="r num">{fmtInt(vt.total.leads)}</td>
                  <td className="r num bl">{fmtMoney(vt.total.base)}</td>
                  <td className="r num">{fmtMoney(vt.total.leadPay)}</td>
                  <td className="r num">{fmtMoney(vt.total.adj.bonus)}</td>
                  <td className="r num">{fmtMoney(extraOf(vt.total.adj))}</td>
                  <td className="r num">{fmtMoney(vt.total.gross)}</td>
                  <td className="r num bl">{fmtMoney(vt.total.withhold + vt.total.deductions)}</td>
                  <td className="r num">{fmtMoney(vt.total.net)}</td>
                  <td className="r num">{fmtMoney(vt.total.paid)}</td>
                  <td className="r num">{fmtMoney(vt.total.toPay)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <AdjustmentJournal rows={rows} onEdit={(a) => setAdjFor({ opId: a.operatorId, adj: a })} onAdd={access.can.editPayroll ? () => setAdjFor({ opId: "" }) : undefined} />

          <div className="card card-pad">
            <div className="card-head">
              <div>
                <h3 className="card-title">Апрув заказчика</h3>
                <p className="card-sub">Доля принятых лидов за месяц. Апрув по умолчанию и коэффициенты — в «Настройки → Система»</p>
              </div>
            </div>
            <ApproveMonthEditor />
          </div>

          {/* ФОТ по группам: фонд против дохода и норматив, который нельзя превышать */}
          <div className="card card-tbl" style={{ overflow: "hidden" }}>
            <div className="card-head" style={{ padding: "16px 18px 0" }}>
              <div>
                <h3 className="card-title">Фонд оплаты труда</h3>
                <p className="card-sub">
                  {data.settings.leadRevenue > 0
                    ? `Доход = лиды × ${fmtMoney(data.settings.leadRevenue)} × апрув заказчика (за месяц ${fmtNum(approve)}%) · норматив ФОТ — не выше ${data.settings.payrollCapPct}% дохода`
                    : `Укажите цену лида для заказчика в настройках — без неё доход и % ФОТ не считаются · норматив — не выше ${data.settings.payrollCapPct}%`}
                </p>
              </div>
              {access.can.systemSettings && (
                <Link href="/settings?tab=system" className="btn btn-sm btn-ghost">
                  Настроить <Icon name="chevR" size={13} />
                </Link>
              )}
            </div>
            {forecast && forecast.revenue > 0 && (
              <div
                className={`note-line ${forecast.ok ? "ok" : "warn"}`}
                style={{ margin: "12px 18px 0" }}
              >
                <Icon name={forecast.ok ? "check" : "alert"} size={15} stroke={2.2} />
                <span>
                  <b>
                    Прогноз на конец месяца: ФОТ {fmtMoney(forecast.fund)} при доходе {fmtMoney(forecast.revenue)} — {fmtPct(forecast.pct)}.
                  </b>{" "}
                  {forecast.ok
                    ? `Норматив ${data.settings.payrollCapPct}% держится, запас ${fmtMoney(forecast.revenue * forecast.cap - forecast.fund)}.`
                    : forecast.alreadyOver
                      ? `Норматив ${data.settings.payrollCapPct}% уже превышен: чтобы выйти в него, до конца месяца нужно ${fmtInt(forecast.leadsNeeded)} лидов вместо ${fmtInt(income > 0 ? Math.round(forecast.revenue / income) : 0)}.`
                      : forecast.crossDay
                        ? `При таком темпе выйдете за ${data.settings.payrollCapPct}% ${fmtDate(forecast.crossDay)}. Чтобы уложиться, нужно ${fmtInt(forecast.leadsNeeded)} лидов за месяц.`
                        : `Норматив ${data.settings.payrollCapPct}% будет превышен: нужно ${fmtInt(forecast.leadsNeeded)} лидов за месяц.`}
                </span>
              </div>
            )}
            <div className="tbl-wrap" style={{ border: "none", borderRadius: 0, marginTop: 12 }}>
              <table className="tbl tbl-fit">
                <thead>
                  <tr>
                    <th style={{ minWidth: 180 }}>Группа</th>
                    <th className="r">Людей</th>
                    <th className="r">Лиды</th>
                    <th className="r" title="Апрув заказчика по проектам лидов группы">Апрув</th>
                    <th className="r" title="Лиды × цена лида × апрув">Доход</th>
                    <th className="r">ФОТ</th>
                    <th className="r">% ФОТ</th>
                    <th className="r">Запас до норматива</th>
                  </tr>
                </thead>
                <tbody>
                  {fundByGroup.map((g) => {
                    const room = g.stat.revenue * g.stat.cap - g.stat.fund;
                    return (
                      <tr key={g.id}>
                        <td>
                          <span className="row" style={{ gap: 8 }}>
                            <Swatch hue={g.color} />
                            {g.name}
                          </span>
                        </td>
                        <td className="r num muted">{fmtInt(g.people)}</td>
                        <td className="r num">{fmtInt(g.leads)}</td>
                        <td className="r num muted">{fmtNum(g.approve)}%</td>
                        <td className="r num muted">{g.stat.revenue ? fmtMoney(g.stat.revenue) : "—"}</td>
                        <td className="r num">{fmtMoney(g.stat.fund)}</td>
                        <td className="r num" style={{ color: g.stat.revenue ? (g.stat.ok ? "var(--c-green-fg)" : "var(--c-red-fg)") : undefined, fontWeight: 600 }}>
                          {g.stat.revenue ? fmtPct(g.stat.pct) : "—"}
                        </td>
                        <td className="r num" style={{ color: room < 0 ? "var(--c-red-fg)" : undefined }}>
                          {g.stat.revenue ? (room >= 0 ? fmtMoney(room) : `−${fmtMoney(-room)}`) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Итого</td>
                    <td className="r num">{fmtInt(pr.rows.length)}</td>
                    <td className="r num">{fmtInt(t.leads)}</td>
                    <td className="r num">{fmtNum(approve)}%</td>
                    <td className="r num">{fund.revenue ? fmtMoney(fund.revenue) : "—"}</td>
                    <td className="r num">{fmtMoney(fund.fund)}</td>
                    <td className="r num" style={{ color: fund.revenue ? (fund.ok ? "var(--c-green-fg)" : "var(--c-red-fg)") : undefined }}>
                      {fund.revenue ? fmtPct(fund.pct) : "—"}
                    </td>
                    <td className="r num">{fund.revenue ? (fund.over > 0 ? `−${fmtMoney(fund.over)}` : fmtMoney(fund.revenue * fund.cap - fund.fund)) : "—"}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}

      {openRow && <PayDrawer row={openRow} planValue={termsPlan(openRow)} onClose={() => setOpenId(null)} onAdj={(adj) => setAdjFor({ opId: openRow.op.id, adj })} />}
      {adjFor && <AdjustmentModal opId={adjFor.opId} adj={adjFor.adj} rows={pr.rows} cal={cal} onClose={() => setAdjFor(null)} />}
    </div>
  );
}

function Line({ label, formula, value, strong, neg }: { label: string; formula?: string; value: number; strong?: boolean; neg?: boolean }) {
  return (
    <div className="row" style={{ gap: 10, padding: "6px 0", borderBottom: "1px dashed var(--ink-06)", fontWeight: strong ? 600 : 400 }}>
      <span style={{ flex: 1 }}>
        {label}
        {formula && <span style={{ display: "block", fontSize: 11.5, color: "var(--dim)", fontWeight: 400 }}>{formula}</span>}
      </span>
      <span className="num" style={{ color: neg && value ? "var(--c-red-fg)" : undefined }}>
        {neg && value ? "−" : ""}
        {fmtMoney(Math.abs(value))}
      </span>
    </div>
  );
}

function PayDrawer({ row: r, planValue, onClose, onAdj }: { row: PayRow; planValue: number; onClose: () => void; onAdj: (a?: Adjustment) => void }) {
  const { data, month, saveTerms, deleteAdjustment, confirm, access } = useCrm();
  const canEdit = canEditPay(access, r.op.id);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({
    payType: r.payType,
    salary: r.salary,
    hourlyRate: r.hourlyRate,
    leadBonus: r.leadBonus,
    normHours: r.normHours,
    grade: r.sv?.grade ?? ("mid" as Grade),
    track: r.sv?.track ?? ("re" as Track),
    approvePct: r.sv?.approvePct ?? data.settings.svBonus.defaultApprovePct,
    growth: (r.sv ? (r.explicitTerms ? r.sv.growth : null) : null) as boolean | null,
  });
  const s = data.settings;
  const baseFormula = isHourlyTiered(r.payType)
    ? "часы каждой смены × ставка её ступени"
    : isSalary(r.payType)
      ? s.prorateSalary
        ? `${fmtMoney(r.salary)} × ${fmtNum(r.hours)} ч / ${fmtNum(r.normHours)} ч (${fmtPct(r.salaryShare)}, не больше 100%)`
        : `оклад полностью`
      : `${fmtNum(r.hours)} ч × ${fmtMoney(r.hourlyRate)}`;

  return (
    <Drawer onClose={onClose}>
      <div className="row" style={{ gap: 12, padding: "18px 20px 14px", borderBottom: "1px solid var(--ink-06)" }}>
        <Avatar name={r.op.name} id={r.op.id} size={40} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{r.op.name}</div>
          <div style={{ fontSize: 12, color: "var(--dim)" }}>
            {fmtMonth(month)} · {PAY_LABEL[r.payType]} · {r.explicitTerms ? "условия месяца зафиксированы" : "условия из карточки"}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card card-pad" style={{ fontSize: 13 }}>
          <h3 className="card-title" style={{ marginBottom: 6 }}>Расчёт</h3>
          <Line label={isSalary(r.payType) ? "Оклад" : "Почасовая оплата"} formula={baseFormula} value={r.base} />
          {hasBonus(r.payType) && (
            <Line
              label="Бонус за переданные лиды"
              formula={isTiered(r.payType) ? "по ступени каждой смены" : `${fmtInt(r.leads)} × ${fmtMoney(r.leadBonus)}`}
              value={r.leadPay}
            />
          )}
          {r.sv && (
            <Line
              label="Бонус за объём группы"
              formula={
                r.sv.belowMin
                  ? `${fmtInt(r.sv.leads)} лидов — меньше порога ${fmtInt(data.settings.svBonus.minLeads)}`
                  : `ступень ${fmtInt(r.sv.step)} · ${GRADE_LABEL[r.sv.grade]} · ${TRACK_LABEL[r.sv.track]} · ${fmtMoney(r.sv.base)} × апрув ${r.sv.kApprove
                      .toString()
                      .replace(".", ",")}${r.sv.kGrowth < 1 ? ` × динамика ${String(r.sv.kGrowth).replace(".", ",")}` : ""}`
              }
              value={r.leadPay}
            />
          )}
          {r.adj.accrual !== 0 && <Line label="Доп. начисления" value={r.adj.accrual} />}
          {r.adj.bonus !== 0 && <Line label="Премии" value={r.adj.bonus} />}
          {r.adj.compensation !== 0 && <Line label="Компенсации" value={r.adj.compensation} />}
          {r.adj.correction !== 0 && <Line label="Корректировки" value={r.adj.correction} />}
          <Line label="Начислено" value={r.gross} strong />
          <Line label={`Удержание ${s.withholdPct}%`} formula={`от ${fmtMoney(r.withholdBase)} (без компенсаций)`} value={r.withhold} neg />
          {r.deductions !== 0 && <Line label="Удержания" value={r.deductions} neg />}
          <Line label="К выплате всего" value={r.net} strong />
          {r.adj.advance !== 0 && <Line label="Аванс" value={r.adj.advance} neg />}
          {r.adj.payout !== 0 && <Line label="Выплачено" value={r.adj.payout} neg />}
          <div className="row" style={{ paddingTop: 10, fontSize: 15, fontWeight: 700 }}>
            <span style={{ flex: 1 }}>Остаток к выплате</span>
            <span className="num">{fmtMoney(r.toPay)}</span>
          </div>
        </div>

        {r.sv && <SvCard r={r} />}

        {isTiered(r.payType) && r.tierUse.length > 0 && (
          <div className="card card-pad">
            <div className="card-head" style={{ marginBottom: 8 }}>
              <div>
                <h3 className="card-title">Разбор по ступеням</h3>
                <p className="card-sub">Каждая смена оплачена по своей ступени — по числу лидов именно в тот день</p>
              </div>
            </div>
            <table className="tbl tbl-fit" style={{ background: "transparent" }}>
              <thead>
                <tr>
                  <th>Ступень</th>
                  <th className="r">Смен</th>
                  <th className="r">Часы</th>
                  <th className="r">Лиды</th>
                  {isHourlyTiered(r.payType) && <th className="r">Ставка</th>}
                  <th className="r">Бонус</th>
                  <th className="r">Начислено</th>
                </tr>
              </thead>
              <tbody>
                {r.tierUse.map((u, i) => (
                  <tr key={u.from}>
                    <td>{tierRange(r.tiers, r.tiers.findIndex((t) => t.from === u.from) >= 0 ? r.tiers.findIndex((t) => t.from === u.from) : i)}</td>
                    <td className="r num">{fmtInt(u.days)}</td>
                    <td className="r num">{fmtNum(u.hours)}</td>
                    <td className="r num">{fmtInt(u.leads)}</td>
                    {isHourlyTiered(r.payType) && <td className="r num">{fmtMoney(u.hourlyRate)}</td>}
                    <td className="r num">{fmtMoney(u.leadBonus)}</td>
                    <td className="r num" style={{ fontWeight: 600 }}>{fmtMoney(u.sum)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="card card-pad">
          <div className="card-head" style={{ marginBottom: 8 }}>
            <h3 className="card-title">Начисления и выплаты</h3>
            {canEdit && (
              <button className="btn btn-sm btn-primary" onClick={() => onAdj()}>
                <Icon name="plus" size={13} /> Добавить
              </button>
            )}
          </div>
          {r.adjustments.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--dim)" }}>Корректировок нет.</div>
          ) : (
            <table className="tbl">
              <tbody>
                {r.adjustments.map((a) => (
                  <tr key={a.id}>
                    <td className="num muted" style={{ width: 90 }}>{fmtDate(a.date)}</td>
                    <td>
                      <Chip hue={ADJ_HUE[a.type]}>{ADJ_LABEL[a.type]}</Chip>
                    </td>
                    <td className="muted" style={{ whiteSpace: "normal" }}>{a.comment}</td>
                    <td className="r num" style={{ fontWeight: 600 }}>{fmtMoney(a.amount)}</td>
                    <td className="r">
                      {canEdit && (
                      <span className="row-actions">
                        <button className="btn btn-ghost btn-sm btn-icon" title="Изменить" onClick={() => onAdj(a)}>
                          <Icon name="edit" size={13} />
                        </button>
                        <button
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Удалить"
                          onClick={async () => {
                            if (await confirm({ title: "Удалить запись?", text: `${ADJ_LABEL[a.type]} ${fmtMoney(a.amount)}`, ok: "Удалить", danger: true })) void deleteAdjustment(a.id);
                          }}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card card-pad">
          <div className="card-head" style={{ marginBottom: 8 }}>
            <div>
              <h3 className="card-title">Условия на {fmtMonth(month)}</h3>
              <p className="card-sub">Изменения здесь касаются только этого месяца; карточка оператора — для следующих.</p>
            </div>
            {!edit && canEdit && (
              <button className="btn btn-sm" onClick={() => setEdit(true)}>
                <Icon name="edit" size={13} /> Изменить
              </button>
            )}
          </div>
          {edit ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div className="grid2">
                <Field label="Схема">
                  <Select<PayType>
                    value={f.payType}
                    options={(Object.keys(PAY_LABEL) as PayType[]).map((p) => ({ value: p, label: PAY_LABEL[p] }))}
                    onChange={(v) => setF({ ...f, payType: v })}
                    ariaLabel="Схема"
                  />
                </Field>
                <Field label="Норма часов">
                  <NumInput value={f.normHours} onChange={(v) => setF({ ...f, normHours: v ?? 0 })} step={0.5} max={744} />
                </Field>
                {isSvVolume(f.payType) && (
                  <>
                    <Field label="Грейд">
                      <Select<Grade>
                        value={f.grade}
                        options={(Object.keys(GRADE_LABEL) as Grade[]).map((g) => ({ value: g, label: GRADE_LABEL[g] }))}
                        onChange={(v) => setF({ ...f, grade: v })}
                        ariaLabel="Грейд"
                      />
                    </Field>
                    <Field label="Направление">
                      <Select<Track>
                        value={f.track}
                        options={(Object.keys(TRACK_LABEL) as Track[]).map((t) => ({ value: t, label: TRACK_LABEL[t] }))}
                        onChange={(v) => setF({ ...f, track: v })}
                        ariaLabel="Направление"
                      />
                    </Field>
                    <Field label="Апрув заказчика, %" hint="Ниже 20% бонус обнуляется">
                      <NumInput value={f.approvePct} onChange={(v) => setF({ ...f, approvePct: v ?? 0 })} max={100} />
                    </Field>
                    <Field label="Рост к прошлому месяцу" hint="Авто — сравниваем объём групп с прошлым месяцем">
                      <Select
                        value={f.growth === null ? "auto" : f.growth ? "yes" : "no"}
                        options={[
                          { value: "auto", label: "Считать автоматически" },
                          { value: "yes", label: "Есть рост" },
                          { value: "no", label: "Нет роста", hint: "коэффициент 0,85 (кроме Junior)" },
                        ]}
                        onChange={(v) => setF({ ...f, growth: v === "auto" ? null : v === "yes" })}
                        ariaLabel="Рост к прошлому месяцу"
                        minPopWidth={300}
                      />
                    </Field>
                  </>
                )}
                {isSalary(f.payType) ? (
                  <Field label="Оклад, ₽">
                    <NumInput value={f.salary} onChange={(v) => setF({ ...f, salary: v ?? 0 })} max={10_000_000} />
                  </Field>
                ) : (
                  <Field label="Ставка, ₽/ч">
                    <NumInput value={f.hourlyRate} onChange={(v) => setF({ ...f, hourlyRate: v ?? 0 })} step={0.5} max={100_000} />
                  </Field>
                )}
                {hasBonus(f.payType) && (
                  <Field label="Бонус за лид, ₽">
                    <NumInput value={f.leadBonus} onChange={(v) => setF({ ...f, leadBonus: v ?? 0 })} max={1_000_000} />
                  </Field>
                )}
              </div>
              <div className="row" style={{ gap: 6 }}>
                {r.explicitTerms && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={async () => {
                      await saveTerms(month, r.op.id, null);
                      setEdit(false);
                    }}
                  >
                    Вернуть условия из карточки
                  </button>
                )}
                <span className="spacer" />
                <button className="btn btn-sm" onClick={() => setEdit(false)}>
                  Отмена
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={async () => {
                    await saveTerms(month, r.op.id, { plan: planValue, ...f, tiers: r.tiers });
                    setEdit(false);
                  }}
                >
                  Сохранить для месяца
                </button>
              </div>
            </div>
          ) : (
            <div className="grid2" style={{ fontSize: 13, gap: 8 }}>
              <span className="muted">Схема</span>
              <span>{PAY_LABEL[r.payType]}</span>
              {isTiered(r.payType) && (
                <>
                  <span className="muted">Сетка</span>
                  <span style={{ gridColumn: "1 / -1" }}>
                    <TierTable tiers={r.tiers} withHourly={isHourlyTiered(r.payType)} />
                  </span>
                </>
              )}
              {isSalary(r.payType) ? (
                <>
                  <span className="muted">Оклад</span>
                  <span>{fmtMoney(r.salary)}</span>
                </>
              ) : (
                <>
                  <span className="muted">Ставка</span>
                  <span>{fmtMoney(r.hourlyRate)}/ч</span>
                </>
              )}
              {hasBonus(r.payType) && (
                <>
                  <span className="muted">Бонус за лид</span>
                  <span>{fmtMoney(r.leadBonus)}</span>
                </>
              )}
              <span className="muted">Норма часов</span>
              <span>{fmtNum(r.normHours)} ч</span>
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

/** Как сложился бонус супервайзера: объём, ступень, коэффициенты, что дальше. */
function SvCard({ r }: { r: PayRow }) {
  const { data, ix, month, today } = useCrm();
  const sv = r.sv!;
  const g = data.settings.svBonus;
  // ФОТ групп супервайзера: фонд против дохода по их лидам
  const fund = useMemo(() => {
    const cal = monthCal(month, data.settings, today);
    const p = payroll(data, ix, cal);
    const mine = new Set(data.groups.filter((x) => !x.deletedAt && x.supervisorId === r.op.id).map((x) => x.id));
    const rows = p.rows.filter((x) => x.op.groupId && mine.has(x.op.groupId));
    const gross = rows.reduce((a, x) => a + x.gross, 0);
    const leads = rows.reduce((a, x) => a + x.leads, 0);
    const ids = new Set(rows.map((x) => x.op.id));
    const approve = approvePctWhere(data, month, (l) => ids.has(l.operatorId));
    return { ...fundStat(gross, leads, leadIncome(data.settings.leadRevenue, approve), data.settings.payrollCapPct), people: rows.length, approve };
  }, [data, ix, month, today, r.op.id]);
  return (
    <div className="card card-pad">
      <div className="card-head" style={{ marginBottom: 8 }}>
        <div>
          <h3 className="card-title">Бонус за объём группы</h3>
          <p className="card-sub">
            {GRADE_LABEL[sv.grade]} · {TRACK_LABEL[sv.track]} · групп под управлением: {sv.groups}
          </p>
        </div>
        <Chip hue={sv.bonus > 0 ? "green" : "red"} dot>
          {fmtMoney(sv.bonus)}
        </Chip>
      </div>
      <div className="grid4" style={{ gap: 10 }}>
        <SvTile label="Лидов групп за месяц" value={fmtInt(sv.leads)} sub={`в прошлом месяце ${fmtInt(sv.prevLeads)}`} />
        <SvTile label="Ступень сетки" value={sv.belowMin ? "нет" : fmtInt(sv.step)} sub={sv.belowMin ? `порог ${fmtInt(g.minLeads)} лидов` : fmtMoney(sv.base)} />
        <SvTile label="Апрув заказчика" value={`${fmtInt(sv.approvePct)}%`} sub={`коэффициент ${String(sv.kApprove).replace(".", ",")}`} tone={sv.kApprove === 0 ? "bad" : undefined} />
        <SvTile
          label="Динамика к прошлому месяцу"
          value={sv.growth ? "рост" : "без роста"}
          sub={sv.kGrowth < 1 ? `коэффициент ${String(sv.kGrowth).replace(".", ",")}` : "коэффициент 1"}
          tone={sv.kGrowth < 1 ? "bad" : "good"}
        />
      </div>
      {sv.next && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-sub)" }}>
          До ступени {fmtInt(sv.next.from)} лидов осталось <b style={{ color: "var(--text)" }}>{fmtInt(sv.next.from - sv.leads)}</b> — это{" "}
          {fmtMoney(sv.next.base)} базы вместо {fmtMoney(sv.base)}.
        </div>
      )}
      <div className="grid3" style={{ gap: 10, marginTop: 10 }}>
        <SvTile label="ФОТ групп" value={fmtMoney(fund.fund)} sub={`${fund.people} чел. · доход ${fund.revenue ? fmtMoney(fund.revenue) : "—"}`} />
        <SvTile
          label="% ФОТ"
          value={fund.revenue ? fmtPct(fund.pct) : "—"}
          sub={`норматив ${data.settings.payrollCapPct}%`}
          tone={fund.revenue ? (fund.ok ? "good" : "bad") : undefined}
        />
        <SvTile
          label={fund.over > 0 ? "Сверх норматива" : "Запас до норматива"}
          value={fund.revenue ? fmtMoney(fund.over > 0 ? fund.over : fund.revenue * fund.cap - fund.fund) : "—"}
          sub={fund.over > 0 ? "нужно снижать" : "можно добрать"}
          tone={fund.over > 0 ? "bad" : undefined}
        />
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--dim)", lineHeight: 1.5 }}>
        Бонус считается по сетке, ФОТ — по фактическим начислениям групп и {data.settings.leadRevenue > 0 ? `доходу: лиды × ${fmtMoney(data.settings.leadRevenue)} × апрув ${fmtNum(fund.approve)}%` : "цене лида из настроек (пока не задана)"}. Итог
        подтверждает руководитель направления.
      </div>
    </div>
  );
}

function SvTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--bg)", border: "1px solid var(--ink-06)" }}>
      <div style={{ fontSize: 11.5, color: "var(--text-sub)", lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2, color: tone === "good" ? "var(--c-green-fg)" : tone === "bad" ? "var(--c-red-fg)" : "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--dim)" }}>{sub}</div>}
    </div>
  );
}

/** Куда запись идёт в ведомости: начисление (+), удержание (−), выплата (уже отдано). */
const ADJ_EFFECT: Record<AdjustmentType, "plus" | "minus" | "paid"> = {
  accrual: "plus", bonus: "plus", compensation: "plus", correction: "plus", deduction: "minus", advance: "paid", payout: "paid",
};

function adjAmount(a: Pick<Adjustment, "type" | "amount">) {
  const eff = ADJ_EFFECT[a.type];
  if (eff === "plus") return <span style={{ color: a.amount < 0 ? "var(--c-red-fg)" : "var(--c-green-fg)" }}>{a.amount < 0 ? "−" : "+"}{fmtMoney(Math.abs(a.amount))}</span>;
  if (eff === "minus") return <span style={{ color: "var(--c-red-fg)" }}>−{fmtMoney(a.amount)}</span>;
  return <span style={{ color: "var(--c-amber-fg)" }}>{fmtMoney(a.amount)}</span>;
}

/**
 * Все премии, начисления, удержания и выплаты месяца одним списком — видно сразу,
 * что и кому добавили, без захода в карточку. Учитывает фильтр группы и поиск.
 */
function AdjustmentJournal({ rows, onEdit, onAdd }: { rows: PayRow[]; onEdit: (a: Adjustment) => void; onAdd?: () => void }) {
  const { month, access, confirm, deleteAdjustment } = useCrm();
  const list = useMemo(
    () =>
      rows
        .flatMap((r) => r.adjustments.map((a) => ({ a, r })))
        .sort((x, y) => y.a.date.localeCompare(x.a.date) || y.a.createdAt.localeCompare(x.a.createdAt)),
    [rows],
  );
  const sum = (types: AdjustmentType[]) => list.filter((x) => types.includes(x.a.type)).reduce((s, x) => s + x.a.amount, 0);
  const bonus = sum(["bonus"]);
  const extra = sum(["accrual", "compensation", "correction"]);
  const minus = sum(["deduction"]);
  const paid = sum(["advance", "payout"]);

  return (
    <div className="card card-pad">
      <div className="card-head">
        <div>
          <h3 className="card-title">Премии, начисления и выплаты · {fmtMonth(month)}</h3>
          <p className="card-sub">
            {list.length
              ? `Премии ${fmtMoney(bonus)} · доп. начисления ${fmtMoney(extra)} · удержания ${fmtMoney(minus)} · выплачено ${fmtMoney(paid)}`
              : "Пока нет записей — премии, авансы и выплаты появятся здесь"}
          </p>
        </div>
        {onAdd && (
          <button className="btn btn-sm btn-primary" onClick={onAdd}>
            <Icon name="plus" size={13} /> Начисление
          </button>
        )}
      </div>
      {list.length > 0 && (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Дата</th>
                <th>Оператор</th>
                <th>Тип</th>
                <th>Комментарий</th>
                <th className="r">Сумма</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map(({ a, r }) => {
                const canEdit = canEditPay(access, a.operatorId);
                return (
                  <tr key={a.id} className={canEdit ? "clickable" : undefined} onClick={canEdit ? () => onEdit(a) : undefined}>
                    <td className="num muted">{fmtDate(a.date)}</td>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <Avatar name={r.op.name} id={r.op.id} size={22} />
                        {r.op.name}
                      </span>
                    </td>
                    <td>
                      <Chip hue={ADJ_HUE[a.type]}>{ADJ_LABEL[a.type]}</Chip>
                    </td>
                    <td className="muted wrap">{a.comment || "—"}</td>
                    <td className="r num" style={{ fontWeight: 600 }}>{adjAmount(a)}</td>
                    <td className="r" onClick={(e) => e.stopPropagation()}>
                      {canEdit && (
                        <span className="row-actions">
                          <button className="btn btn-ghost btn-sm btn-icon" title="Изменить" onClick={() => onEdit(a)}>
                            <Icon name="edit" size={13} />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            title="Удалить"
                            onClick={async () => {
                              if (await confirm({ title: "Удалить запись?", text: `${ADJ_LABEL[a.type]} ${fmtMoney(a.amount)} · ${r.op.name}`, ok: "Удалить", danger: true }))
                                void deleteAdjustment(a.id);
                            }}
                          >
                            <Icon name="trash" size={13} />
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Строка сравнения «было → станет» в окне начисления. */
function Delta({ label, from, to, strong }: { label: string; from: number; to: number; strong?: boolean }) {
  const changed = Math.round(from * 100) !== Math.round(to * 100);
  return (
    <div className="row" style={{ gap: 10, fontWeight: strong ? 600 : 400, color: changed ? "var(--text)" : "var(--dim)" }}>
      <span style={{ flex: 1 }}>{label}</span>
      <span className="num">
        {changed ? (
          <>
            <span style={{ color: "var(--dim)", fontWeight: 400 }}>{fmtMoney(from)} → </span>
            {fmtMoney(to)}
          </>
        ) : (
          fmtMoney(to)
        )}
      </span>
    </div>
  );
}

function AdjustmentModal({ opId, adj, rows, cal, onClose }: { opId: string; adj?: Adjustment; rows: PayRow[]; cal: MonthCal; onClose: () => void }) {
  const { month, today, saveAdjustment, data, ix } = useCrm();
  // запись относится к ведомости выбранного месяца; дата — когда начислили/выплатили
  const [f, setF] = useState<AdjustmentInput>(() =>
    adj
      ? { ...adj }
      : {
          month,
          operatorId: opId,
          type: "bonus",
          amount: 0,
          date: today.slice(0, 7) === month ? today : monthEnd(month) < todayKey() ? monthEnd(month) : monthStart(month),
          comment: "",
        },
  );
  const [tried, setTried] = useState(false);
  const errOp = !f.operatorId ? "Выберите оператора" : null;
  const errAmt = !f.amount ? "Укажите сумму" : null;

  // что изменится в ведомости: та же формула, что у строки, с черновиком записи вместо старой
  const row = rows.find((r) => r.op.id === f.operatorId) ?? null;
  const preview = useMemo(() => {
    if (!row) return null;
    const others = row.adjustments.filter((a) => a.id !== adj?.id);
    if (!f.amount) return { before: row, after: row, others };
    const draft: Adjustment = {
      ...f,
      id: adj?.id ?? "__draft__",
      amount: f.type === "correction" ? f.amount : Math.abs(f.amount),
      createdAt: adj?.createdAt ?? "",
      updatedAt: "",
    };
    return { before: row, after: payrollRow(row.op, cal, data, ix, [...others, draft]), others };
  }, [row, f, adj, cal, data, ix]);

  return (
    <Modal
      title={adj ? "Изменить запись" : "Начисление / выплата"}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button
            className="btn btn-primary"
            onClick={async () => {
              setTried(true);
              if (errOp || errAmt) return;
              await saveAdjustment({ ...f, id: adj?.id });
              onClose();
            }}
          >
            Сохранить
          </button>
        </>
      }
    >
      <Field label="Оператор" error={tried ? errOp : null}>
        <Select
          value={f.operatorId}
          options={rows.map<Opt>((r) => ({ value: r.op.id, label: r.op.name, icon: <Avatar name={r.op.name} id={r.op.id} size={20} /> }))}
          onChange={(v) => setF({ ...f, operatorId: v })}
          disabled={!!adj}
          invalid={tried && !!errOp}
          ariaLabel="Оператор"
          minPopWidth={300}
        />
      </Field>
      <Field label="Тип" hint={ADJ_HINT[f.type]}>
        <Select<AdjustmentType>
          value={f.type}
          options={ADJ_TYPES.map((t) => ({ value: t, label: ADJ_LABEL[t], hint: ADJ_HINT[t], icon: dot(ADJ_HUE[t]) }))}
          onChange={(v) => setF({ ...f, type: v })}
          ariaLabel="Тип"
          minPopWidth={340}
        />
      </Field>
      <div className="grid2">
        <Field label="Сумма, ₽" error={tried ? errAmt : null}>
          <NumInput value={f.amount} onChange={(v) => setF({ ...f, amount: v ?? 0 })} min={f.type === "correction" ? -10_000_000 : 0} max={10_000_000} step={0.01} autoFocus />
        </Field>
        <Field label="Дата" hint={`Относится к ведомости за ${fmtMonth(f.month)}`}>
          <DateInput value={f.date} onChange={(d) => d && setF({ ...f, date: d })} ariaLabel="Дата" />
        </Field>
      </div>
      <Field label="Комментарий">
        <input className="inp" value={f.comment} onChange={(e) => setF({ ...f, comment: e.target.value })} placeholder="За что / основание" />
      </Field>

      {preview && (
        <div className="adj-preview">
          <div className="adj-preview-title">
            {preview.before.op.name} · {fmtMonth(f.month)}
          </div>
          {preview.others.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              <span style={{ color: "var(--dim)" }}>Уже в этом месяце:</span>
              {preview.others.map((a) => (
                <Chip key={a.id} hue={ADJ_HUE[a.type]} title={a.comment || undefined}>
                  {ADJ_LABEL[a.type]} {fmtMoney(a.amount)}
                </Chip>
              ))}
            </div>
          )}
          <Delta label="Премии" from={preview.before.adj.bonus} to={preview.after.adj.bonus} />
          <Delta label="Доп. начисления" from={extraOf(preview.before.adj)} to={extraOf(preview.after.adj)} />
          <Delta label="Начислено" from={preview.before.gross} to={preview.after.gross} />
          <Delta label="Удержано" from={preview.before.withhold + preview.before.deductions} to={preview.after.withhold + preview.after.deductions} />
          <Delta label="Выплачено (аванс и выплаты)" from={preview.before.paid} to={preview.after.paid} />
          <Delta label="Остаток к выплате" from={preview.before.toPay} to={preview.after.toPay} strong />
        </div>
      )}
    </Modal>
  );
}
