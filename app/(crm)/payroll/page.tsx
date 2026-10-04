"use client";

import { Fragment, useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useCrm, type AdjustmentInput } from "@/lib/crm/store";
import { approvePctFor, approvePctWhere, goneLast, incomeBySegment, incomePerLead, isGone, monthCal, opTerms, type MonthCal } from "@/lib/crm/calc";
import { costPerLead, fundForecast, fundStat, hasBonus, isHourlyTiered, isSalary, isSvVolume, isTiered, payroll, payrollRow, TAX_PCT, type PayRow } from "@/lib/crm/payroll";
import { TierTable, tierRange } from "@/components/app/RateGrids";
import { ADJ_LABEL, GRADE_LABEL, NO_GROUP_LABEL, PAY_LABEL, TRACK_LABEL, type Adjustment, type AdjustmentType, type Grade, type PayType, type Track } from "@/lib/crm/types";
import { fmtDate, fmtDayShort, fmtMonth, monthEnd, monthStart, todayKey } from "@/lib/crm/dates";
import { PAYOUTS, fmtInt, fmtMoney, fmtNum, fmtPct, plural, shortName } from "@/lib/crm/format";
import { Avatar, Chip, Drawer, Empty, Field, GoneTag, Modal, NumInput, Pager, Swatch, downloadText, foldRow, toCsv, useFoldGroups } from "@/components/ui/kit";
import { DateInput, Select, dot, type Opt } from "@/components/ui/select";
import { useColumnDrag, useColumnOrder, useColumnVisibility } from "@/components/ui/ColumnOrder";
import { canEditPay, canTouchOp } from "@/lib/crm/access";
import { Icon } from "@/components/ui/icons";
import { ApproveMonthEditor } from "@/components/app/ApproveSettings";
import { PayslipModal } from "@/components/app/Payslip";
import { PayoutHistory, usePayouts } from "@/components/app/PayoutHistory";
import { PeriodNav, PeriodPayroll, usePeriodPayroll } from "@/components/app/PeriodPayroll";
import { MonthSide } from "@/components/app/PaySide";
import { MonthNav, SideEmpty, Tile } from "@/components/app/V2Kit";
import { Popover } from "@/components/app/OperatorsV2";
import { REGISTRY_DAYS } from "@/lib/crm/payperiod";
import { TaxSum } from "@/components/app/TaxSum";

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

/* ── столбцы помесячной ведомости ─────────────────────────────────── */
const MCOLS = ["scheme", "hours", "leads", "base", "bonus", "prem", "extra", "gross", "withhold", "net", "paid", "toPay", "tax"] as const;
type MCol = (typeof MCOLS)[number];
const MSHOWN: MCol[] = ["hours", "leads", "gross", "withhold", "paid", "toPay", "tax"];
const MCOL_LABEL: Record<MCol, string> = {
  scheme: "Схема", hours: "Часы", leads: "Лиды", base: "База", bonus: "Бонус за лиды", prem: "Премии", extra: "Доп.", gross: "Начислено",
  withhold: "Удержано", net: "К выплате", paid: "Выплачено", toPay: "Остаток", tax: "К переводу",
};
const MCOL_HINT: Partial<Record<MCol, string>> = {
  base: "Оклад (с учётом пропорции) или часы × ставка",
  bonus: "Лиды × бонус за лид",
  prem: "Премии за месяц",
  extra: "Доп. начисления, компенсации, корректировки",
  withhold: "Процент удержания + удержания",
  net: "Начислено минус удержано",
  paid: "Аванс + выплаты",
  tax: `Остаток + ${TAX_PCT}% налога самозанятого — сумма к переводу`,
};

function mergeVisible(full: string[], visibleNext: string[]): string[] {
  const vis = new Set(visibleNext);
  let i = 0;
  return full.map((k) => (vis.has(k) ? visibleNext[i++] : k));
}

type View = "periods" | "sheet" | "payouts";
const VIEWS: { value: View; label: string }[] = [
  { value: "periods", label: "По периодам" },
  { value: "sheet", label: "За месяц" },
  { value: "payouts", label: "Выплаты" },
];

export default function PayrollPage() {
  const { data, ix, month, setMonth, today, workedTo, saveTerms, saveAdjustment, toast, confirm, access } = useCrm();
  // «По периодам» — кому и сколько выплатить в день выплаты (главный вид);
  // «За месяц» — начисления месяца для ФОТ и аналитики; «История выплат» — все выплаты
  const [view, setView] = useState<View>("periods");
  const pp = usePeriodPayroll();
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
  const [selId, setSelId] = useState<string | null>(null);
  const [adjFor, setAdjFor] = useState<{ opId: string; adj?: Adjustment } | null>(null);
  const [q, setQ] = useState("");

  const [grp, setGrp] = useState("");
  const vis = useColumnVisibility("payroll-month", MCOLS, MSHOWN);
  const colOrder = useColumnOrder("payroll-month", MCOLS);
  const shown = useMemo(() => colOrder.order.filter((k) => vis.shown.has(k)) as MCol[], [colOrder.order, vis.shown]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const colDrag = useColumnDrag({ wrapRef, order: shown, onChange: (next) => colOrder.save(mergeVisible(colOrder.order, next)) });
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
        const sorted = [...list].sort((a, b) => goneLast(a.op, b.op) || Number(isSv(b)) - Number(isSv(a)) || a.op.name.localeCompare(b.op.name, "ru"));
        return {
          id,
          name: g?.name ?? NO_GROUP_LABEL,
          color: g?.color ?? "gray",
          supervisor: g ? shortName((g.supervisorId ? ix.opById.get(g.supervisorId)?.name : null) ?? g.supervisorName) || null : null,
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
  const selRow = selId ? pr.rows.find((r) => r.op.id === selId) ?? null : null;
  const t = pr.total;
  const unfixed = pr.rows.filter((r) => !r.explicitTerms).length;

  /* ФОТ: фонд против дохода. Доход = лиды × цена × апрув: основа — цена лида и апрув по проектам,
     регионы — цена регионального лида и апрув регионов из настроек */
  const approve = useMemo(() => approvePctFor(data, ix, month), [data, ix, month]);
  const income = useMemo(() => incomePerLead(data, month), [data, month]);
  const fund = useMemo(() => fundStat(t.gross, t.leads, income, data.settings.payrollCapPct), [t.gross, t.leads, income, data.settings.payrollCapPct]);

  /**
   * Выплатить остаток одной кнопкой: запись «Выплата» на сумму остатка ведомости, датой сегодня.
   * Ведомость и история пересчитываются сразу — остаток становится 0.
   */
  const payRest = async (r: PayRow) => {
    const sum = Math.round(r.toPay * 100) / 100;
    if (sum <= 0) return;
    const ok = await confirm({
      title: `Выплатить ${fmtMoney(sum)}?`,
      text: `${r.op.name} · остаток по ведомости за ${fmtMonth(month).toLowerCase()}. Запишется выплата датой ${fmtDate(today)} — остаток станет 0 ₽, выплата появится в истории.`,
      ok: "Выплатить",
    });
    if (!ok) return;
    await saveAdjustment({ month, operatorId: r.op.id, type: "payout", amount: sum, date: today, comment: "Остаток по ведомости" });
  };

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

  const sub =
    view === "periods"
      ? data.settings.paySchedule.length
        ? `Кому и сколько выплатить · реестр за ${REGISTRY_DAYS} дня до выплаты, остаток + ${TAX_PCT}%`
        : `Выплаты раз в ${data.settings.payPeriodDays} дней, через ${data.settings.payDelayDays} дн. после конца периода`
      : view === "payouts"
        ? "Все авансы и выплаты — по дате выплаты"
        : // до закрытия дня сегодняшние смены ещё идут — в ведомости их нет, и это надо видеть
          workedTo < today && month === today.slice(0, 7)
          ? `${fmtMonth(month)} · по ${fmtDayShort(workedTo)} включительно — смены за сегодня войдут в ${data.settings.dayCloseHour}:00`
          : `${fmtMonth(month)} · из смен, лидов и корректировок`;
  const stHue = pp.status.hue === "blue" ? "gray" : pp.status.hue;

  /* ── ячейки помесячной ведомости ───────────────────────────────────── */
  const dash = <span className="o2-muted">—</span>;
  const cell = (c: MCol, r: PayRow) => {
    switch (c) {
      case "scheme":
        return <td key={c} data-col={c} className="o2-muted">{PAY_LABEL[r.payType]}</td>;
      case "hours":
        return (
          <td key={c} data-col={c} className="r" title={isSalary(r.payType) ? `норма ${fmtNum(r.normHours, 0)} ч` : undefined}>
            {fmtNum(r.hours)}
          </td>
        );
      case "leads":
        return <td key={c} data-col={c} className="r">{fmtInt(r.leads)}</td>;
      case "base":
        return <td key={c} data-col={c} className="r">{fmtMoney(r.base)}</td>;
      case "bonus":
        return <td key={c} data-col={c} className="r">{hasBonus(r.payType) ? fmtMoney(r.leadPay) : dash}</td>;
      case "prem":
        return (
          <td key={c} data-col={c} className="r" title={adjTitle(r, ["bonus"])}>
            {r.adj.bonus ? <span style={{ color: "var(--c-green-fg)", fontWeight: 600 }}>+{fmtMoney(r.adj.bonus)}</span> : dash}
          </td>
        );
      case "extra":
        return (
          <td key={c} data-col={c} className="r" title={adjTitle(r, ["accrual", "compensation", "correction"])}>
            {extraOf(r.adj) ? fmtMoney(extraOf(r.adj)) : dash}
          </td>
        );
      case "gross":
        return (
          <td key={c} data-col={c} className="r" style={{ fontWeight: 600 }} title={`база ${fmtMoney(r.base)} · бонус ${fmtMoney(r.leadPay)} · премии ${fmtMoney(r.adj.bonus)} · доп. ${fmtMoney(extraOf(r.adj))}`}>
            {fmtMoney(r.gross)}
          </td>
        );
      case "withhold":
        return (
          <td key={c} data-col={c} className="r" title={adjTitle(r, ["deduction"])}>
            {r.withhold + r.deductions ? fmtMoney(r.withhold + r.deductions) : dash}
          </td>
        );
      case "net":
        return <td key={c} data-col={c} className="r">{fmtMoney(r.net)}</td>;
      case "paid":
        return (
          <td key={c} data-col={c} className="r" title={adjTitle(r, ["advance", "payout"])}>
            {r.paid ? fmtMoney(r.paid) : dash}
          </td>
        );
      case "toPay":
        return (
          <td key={c} data-col={c} className="r" style={{ fontWeight: 600, color: r.toPay < -0.005 ? "var(--c-red-fg)" : r.toPay <= 0.005 && r.net > 0 ? "var(--c-green-fg)" : undefined }}>
            {r.toPay <= 0.005 && r.net > 0 ? "✓ 0 ₽" : fmtMoney(r.toPay)}
          </td>
        );
      case "tax":
        return (
          <td key={c} data-col={c} className="r" style={{ fontWeight: 600 }}>
            <TaxSum value={r.toPay} />
          </td>
        );
    }
  };
  const totalCell = (c: MCol, x: ReturnType<typeof payrollOf>["total"]) => {
    switch (c) {
      case "scheme":
        return <td key={c} data-col={c} />;
      case "hours":
        return <td key={c} data-col={c} className="r">{fmtNum(x.hours)}</td>;
      case "leads":
        return <td key={c} data-col={c} className="r">{fmtInt(x.leads)}</td>;
      case "base":
        return <td key={c} data-col={c} className="r">{fmtMoney(x.base)}</td>;
      case "bonus":
        return <td key={c} data-col={c} className="r">{fmtMoney(x.leadPay)}</td>;
      case "prem":
        return <td key={c} data-col={c} className="r">{x.adj.bonus ? fmtMoney(x.adj.bonus) : "—"}</td>;
      case "extra":
        return <td key={c} data-col={c} className="r">{extraOf(x.adj) ? fmtMoney(extraOf(x.adj)) : "—"}</td>;
      case "gross":
        return <td key={c} data-col={c} className="r">{fmtMoney(x.gross)}</td>;
      case "withhold":
        return <td key={c} data-col={c} className="r">{fmtMoney(x.withhold + x.deductions)}</td>;
      case "net":
        return <td key={c} data-col={c} className="r">{fmtMoney(x.net)}</td>;
      case "paid":
        return <td key={c} data-col={c} className="r">{fmtMoney(x.paid)}</td>;
      case "toPay":
        return <td key={c} data-col={c} className="r">{fmtMoney(x.toPay)}</td>;
      case "tax":
        return (
          <td key={c} data-col={c} className="r">
            <TaxSum value={x.toPay} copy={false} />
          </td>
        );
    }
  };

  return (
    <div className="stack" style={{ gap: 0 }}>
      {/* ── заголовок ─────────────────────────────────────────────── */}
      <div className="o2-head">
        <div className="o2-head-l">
          <h1 className="o2-title">Зарплата</h1>
          <div className="o2-sub" title={view === "periods" ? `${pp.status.text} · ${sub}` : sub}>
            {view === "periods" ? (
              <>
                <i className="o2-sub-dot" data-hue={stHue} />
                {pp.status.text}
              </>
            ) : (
              sub
            )}
          </div>
        </div>
        <div className="o2-tools">
          {view === "periods" ? <PeriodNav pp={pp} /> : <MonthNav month={month} onChange={setMonth} />}
          <div className="o2-seg" role="group">
            {VIEWS.map((v) => (
              <button key={v.value} className={view === v.value ? "on" : ""} onClick={() => setView(v.value)}>
                {v.label}
              </button>
            ))}
          </div>
          {access.can.editPayroll && (
            <button className="o2-btn pri" onClick={() => setAdjFor({ opId: "" })} disabled={!pr.rows.length}>
              <Icon name="plus" size={14} stroke={2.2} /> Начисление
            </button>
          )}
        </div>
      </div>

      {view === "periods" ? (
        <PeriodPayroll pp={pp} onAdj={access.can.editPayroll ? (opId, adj) => setAdjFor({ opId, adj }) : undefined} />
      ) : view === "payouts" ? (
        <PayoutsView month={month} toPay={t.toPay} q={q} setQ={setQ} />
      ) : (
        <div className="o2-body has-side">
          <div className="o2-main">
            {/* ── показатели месяца ─────────────────────────────────── */}
            <div className="card o2-kpis">
              <Tile icon="calc" label="Начислено" value={fmtMoney(t.gross)} line={`база ${fmtMoney(t.base)}`} sub={`бонусы ${fmtMoney(t.leadPay)}`} />
              <Tile icon="trend" label="Удержано" value={fmtMoney(t.withhold + t.deductions)} line={`${data.settings.withholdPct}% — ${fmtMoney(t.withhold)}`} sub="кроме компенсаций" />
              <Tile icon="wallet" label="К выплате" value={fmtMoney(t.net)} line={`выплачено ${fmtMoney(t.paid)}`} sub={`аванс ${fmtMoney(t.adj.advance)}`} />
              <Tile
                icon="hourglass"
                label="Остаток"
                hue={t.toPay > 0.005 ? "amber" : "green"}
                value={fmtMoney(t.toPay)}
                line={`${fmtInt(pr.rows.filter((r) => r.toPay > 0.005).length)} чел. ждут`}
                sub="после выплат"
              />
              <Tile icon="coin" label="Стоимость лида" value={t.leads ? fmtMoney(costPerLead(pr)) : "—"} line={`${fmtInt(t.leads)} лидов`} sub={`${fmtNum(t.hours, 0)} ч`} title="Начислено / переданные лиды" />
              <Tile
                icon="target"
                label="ФОТ к доходу"
                hue={fund.revenue > 0 ? (fund.ok ? "green" : "red") : undefined}
                tone={fund.revenue > 0 ? (fund.ok ? "good" : "bad") : undefined}
                value={fund.revenue > 0 ? fmtPct(fund.pct) : "—"}
                line={fund.revenue > 0 ? `норматив ${data.settings.payrollCapPct}%` : data.settings.leadRevenue > 0 ? "апрув заказчика 0%" : "нет цены лида"}
                sub={fund.revenue > 0 ? `апрув ${fmtNum(approve)}%` : "в настройках"}
                title={`Фонд оплаты труда ${fmtMoney(fund.fund)} против дохода ${fmtMoney(fund.revenue)}`}
              />
            </div>

            {pr.rows.length === 0 ? (
              <div className="card">
                <Empty icon="wallet" title="Ведомость пуста" text="В этом месяце нет операторов в штате и нет начислений." />
              </div>
            ) : (
              <>
                {/* ── фильтры ───────────────────────────────────────── */}
                <div className="card o2-filters">
                  <label className="o2-search">
                    <Icon name="search" size={14} />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по сотруднику…" />
                  </label>
                  {groupOpts.length > 2 && <Select value={grp} options={groupOpts} onChange={setGrp} width={170} ariaLabel="Группа" />}
                  {access.can.editPayroll && unfixed > 0 && cal.phase !== "future" && (
                    <button className="o2-btn" onClick={() => void freezeAll()} title="Записать условия месяца, чтобы правки карточек не меняли эту ведомость">
                      <Icon name="check" size={14} /> Зафиксировать условия
                    </button>
                  )}
                  <button className="o2-btn" onClick={exportCsv} title="Выгрузить ведомость месяца">
                    <Icon name="download" size={14} /> CSV
                  </button>
                  <span className="o2-found" title={`Оклад ${data.settings.prorateSalary ? "пропорционален часам, если норма не выполнена" : "платится полностью"} · удержание ${data.settings.withholdPct}% (кроме компенсаций)`}>
                    Найдено: {fmtInt(rows.length)}
                  </span>
                  <Popover
                    align="right"
                    button={(open, toggle, ref) => (
                      <button ref={ref} className="o2-ib" onClick={toggle} aria-expanded={open} title="Столбцы">
                        <Icon name="dashboard" size={15} />
                      </button>
                    )}
                  >
                    <div className="tt">Столбцы</div>
                    {MCOLS.map((k) => (
                      <label key={k} title={MCOL_HINT[k]}>
                        <input type="checkbox" className="o2-cb" checked={vis.shown.has(k)} onChange={() => vis.toggle(k)} />
                        {MCOL_LABEL[k]}
                      </label>
                    ))}
                    <div className="sep" />
                    <div className="tt">Порядок — перетащите заголовок столбца</div>
                    {vis.custom && (
                      <button className="it" onClick={vis.reset}>
                        <Icon name="check" size={13} /> По умолчанию
                      </button>
                    )}
                    {colOrder.custom && (
                      <button className="it" onClick={colOrder.reset}>
                        <Icon name="refresh" size={13} /> Вернуть порядок столбцов
                      </button>
                    )}
                  </Popover>
                </div>

                {/* ── ведомость ─────────────────────────────────────── */}
                <div className="card o2-card">
                  {rows.length === 0 ? (
                    <div style={{ padding: 28, textAlign: "center", color: "var(--dim)", fontSize: 13 }}>Никого не нашли — поменяйте поиск или группу.</div>
                  ) : (
                    <div className="o2-scroll" ref={wrapRef}>
                      <table className="o2-tbl pay-tbl">
                        <thead>
                          <tr>
                            <th>Сотрудник</th>
                            {shown.map((c) => {
                              const hp = colDrag.headProps(c);
                              return (
                                <th key={c} {...hp} className={`${hp.className}${c === "scheme" ? "" : " r"}`} title={MCOL_HINT[c] ? `${MCOL_HINT[c]}. Перетащите, чтобы переставить` : "Перетащите, чтобы переставить столбец"}>
                                  {MCOL_LABEL[c]}
                                </th>
                              );
                            })}
                            <th style={{ width: 44 }} />
                          </tr>
                        </thead>
                        {sections.map((sec) => {
                          const closed = fold.isClosed(sec.id);
                          const phase = fold.phase(sec.id);
                          return (
                            <tbody key={sec.id} data-fold={sec.id}>
                              <tr className="grp-head" onClick={() => fold.toggle(sec.id)} title={closed ? "Развернуть группу" : "Свернуть группу"} aria-expanded={!closed}>
                                <td>
                                  <span className="row" style={{ gap: 8 }}>
                                    <Icon name="chevR" size={14} className={`grp-chev${closed || phase === "out" ? "" : " open"}`} />
                                    <Swatch hue={sec.color} />
                                    <span>{sec.name}</span>
                                    <span className="grp-head-sub" title={sec.supervisor ? `Супервайзер: ${sec.supervisor}` : undefined}>
                                      {sec.rows.length} чел.
                                    </span>
                                  </span>
                                </td>
                                {shown.map((c) => totalCell(c, sec.total))}
                                <td />
                              </tr>
                              {!closed &&
                                sec.rows.map((r, i) => {
                                  const f = foldRow(phase, i);
                                  // уволенные — в конце группы, за разделителем
                                  const firstGone = isGone(r.op) && (i === 0 || !isGone(sec.rows[i - 1].op));
                                  const canPay = canEditPay(access, r.op.id);
                                  return (
                                    <Fragment key={r.op.id}>
                                      {firstGone && (
                                        <tr className="gone-sep">
                                          <td colSpan={shown.length + 2}>Уволены · {sec.rows.filter((x) => isGone(x.op)).length}</td>
                                        </tr>
                                      )}
                                      <tr
                                        className={`${f.className}${selRow?.op.id === r.op.id ? " sel" : ""}${r.op.status === "fired" ? " dim" : ""}`}
                                        style={f.style}
                                        onClick={() => setSelId(selRow?.op.id === r.op.id ? null : r.op.id)}
                                      >
                                        <td>
                                          <span className="row" style={{ gap: 10 }}>
                                            <Avatar name={r.op.name} id={r.op.id} size={26} />
                                            <span className="l2-two">
                                              <span>
                                                {shortName(r.op.name)}
                                                {isSv(r) && <span className="pay-sv">СВ</span>}
                                                {r.explicitTerms && (
                                                  <span title="Условия месяца зафиксированы" style={{ color: "var(--text-sub)", marginLeft: 4 }}>
                                                    •
                                                  </span>
                                                )}
                                                <GoneTag op={r.op} />
                                              </span>
                                                    </span>
                                          </span>
                                        </td>
                                        {shown.map((c) => cell(c, r))}
                                        <td className="r" onClick={(e) => e.stopPropagation()}>
                                          <span className="pay-acts">
                                            <Popover
                                              align="right"
                                              button={(open, toggle, ref) => (
                                                <button ref={ref} className="o2-kebab" onClick={toggle} aria-expanded={open} aria-label="Действия">
                                                  <Icon name="list" size={15} />
                                                </button>
                                              )}
                                            >
                                              {(close) => (
                                                <>
                                                  <button className="it" onClick={() => { close(); setSelId(r.op.id); }}>
                                                    <Icon name="info" size={14} /> Показать справа
                                                  </button>
                                                  <button className="it" onClick={() => { close(); setOpenId(r.op.id); }}>
                                                    <Icon name="calc" size={14} /> Подробный расчёт и условия
                                                  </button>
                                                  {canPay && r.toPay > 0.005 && (
                                                    <button className="it" onClick={() => { close(); void payRest(r); }}>
                                                      <Icon name="wallet" size={14} /> Выплатить {fmtMoney(r.toPay)}
                                                    </button>
                                                  )}
                                                  {canPay && (
                                                    <button className="it" onClick={() => { close(); setAdjFor({ opId: r.op.id }); }}>
                                                      <Icon name="plus" size={14} /> Начисление / выплата
                                                    </button>
                                                  )}
                                                </>
                                              )}
                                            </Popover>
                                          </span>
                                        </td>
                                      </tr>
                                    </Fragment>
                                  );
                                })}
                            </tbody>
                          );
                        })}
                        <tfoot>
                          <tr>
                            <td>
                              Итого · {vt.rows}
                              {vt.rows !== pr.rows.length && <span className="o2-muted"> из {pr.rows.length}</span>}
                            </td>
                            {shown.map((c) => totalCell(c, vt.total))}
                            <td />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>

                <FundCard pr={pr} groupOf={groupOf} />
              </>
            )}
          </div>

          {selRow ? (
            <MonthSide
              key={selRow.op.id}
              r={selRow}
              onPay={() => void payRest(selRow)}
              onAdj={access.can.editPayroll ? (a) => setAdjFor({ opId: selRow.op.id, adj: a }) : undefined}
              onOpen={() => setOpenId(selRow.op.id)}
              onClose={() => setSelId(null)}
            />
          ) : (
            <SideEmpty
              icon="wallet"
              title="Выберите сотрудника"
              text="Нажмите на строку — здесь появятся остаток к выплате, расчёт за месяц, начисления и история выплат."
              ghosts={["К выплате", "Расчёт за месяц", "Начисления и выплаты", "Условия месяца"]}
            />
          )}
        </div>
      )}

      {openRow && <PayDrawer row={openRow} planValue={termsPlan(openRow)} onClose={() => setOpenId(null)} onAdj={(adj) => setAdjFor({ opId: openRow.op.id, adj })} onPay={() => void payRest(openRow)} />}
      {adjFor && <AdjustmentModal opId={adjFor.opId} adj={adjFor.adj} rows={pr.rows} cal={cal} onClose={() => setAdjFor(null)} />}
    </div>
  );
}

/** «Доход и ФОТ»: откуда доход (основа и регионы), фонд против норматива, прогноз, разрез по группам, апрув. */
function FundCard({ pr, groupOf }: { pr: ReturnType<typeof payrollOf>; groupOf: (r: PayRow) => string }) {
  const { data, ix, month, access } = useCrm();
  const cal = useMemo(() => monthCal(month, data.settings, todayKey()), [month, data.settings]);
  const t = pr.total;
  const approve = useMemo(() => approvePctFor(data, ix, month), [data, ix, month]);
  const income = useMemo(() => incomePerLead(data, month), [data, month]);
  const seg = useMemo(() => incomeBySegment(data, month), [data, month]);
  const rg = data.settings.regions;
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
        const ap = approvePctWhere(data, month, (l) => v.ops.has(l.operatorId));
        return { id, ...v, approve: ap, stat: fundStat(v.gross, v.leads, incomePerLead(data, month, (l) => v.ops.has(l.operatorId)), data.settings.payrollCapPct) };
      })
      .sort((a, b) => b.gross - a.gross);
  }, [pr.rows, ix, groupOf, data, month]);
  const cap = data.settings.payrollCapPct;
  const fundHue = fund.revenue ? (fund.ok ? "green" : "red") : "gray";

  return (
    <div className="card pf-card">
      <div className="pf-head">
        <div style={{ minWidth: 0 }}>
          <div className="d2-h">
            <Icon name="coin" size={15} className="title-ic" />
            Доход и ФОТ
          </div>
          <div className="pf-sub">
            {fmtMonth(month)} · доход = лиды × цена лида × апрув заказчика · норматив ФОТ — не выше {cap}% дохода
          </div>
        </div>
        {access.can.systemSettings && (
          <Link href="/settings?tab=system" className="o2-btn" style={{ textDecoration: "none" }} title="Цены лидов, апрув регионов и норматив ФОТ">
            Цены и норматив <Icon name="chevR" size={13} />
          </Link>
        )}
      </div>

      {/* итог: фонд, доля, запас */}
      <div className="pf-sum">
        <div>
          <span>ФОТ</span>
          <b className="num">{fmtMoney(fund.fund)}</b>
        </div>
        <div>
          <span>Доход</span>
          <b className="num">{fund.revenue ? fmtMoney(fund.revenue) : "—"}</b>
        </div>
        <div>
          <span>ФОТ к доходу</span>
          <b className={`num ${fund.revenue ? (fund.ok ? "o2-g" : "o2-r") : ""}`}>{fund.revenue ? fmtPct(fund.pct) : "—"}</b>
        </div>
        <div>
          <span>{fund.over > 0 ? "Превышение" : "Запас до норматива"}</span>
          <b className={`num ${fund.over > 0 ? "o2-r" : ""}`}>{fund.revenue ? fmtMoney(fund.over > 0 ? fund.over : fund.revenue * fund.cap - fund.fund) : "—"}</b>
        </div>
      </div>
      {!data.settings.leadRevenue && <div className="pf-note" data-hue="red">Укажите цену лида основы в настройках — без неё доход не считается.</div>}
      {forecast && forecast.revenue > 0 && (
        <div className="pf-note" data-hue={forecast.ok ? "green" : "red"}>
          <Icon name={forecast.ok ? "check" : "alert"} size={15} stroke={2.2} />
          <span>
            <b>
              Прогноз на конец месяца: ФОТ {fmtMoney(forecast.fund)} при доходе {fmtMoney(forecast.revenue)} — {fmtPct(forecast.pct)}.
            </b>{" "}
            {forecast.ok
              ? `Норматив ${cap}% держится, запас ${fmtMoney(forecast.revenue * forecast.cap - forecast.fund)}.`
              : forecast.alreadyOver
                ? `Норматив ${cap}% уже превышен: чтобы выйти в него, до конца месяца нужно ${fmtInt(forecast.leadsNeeded)} лидов вместо ${fmtInt(income > 0 ? Math.round(forecast.revenue / income) : 0)}.`
                : forecast.crossDay
                  ? `При таком темпе выйдете за ${cap}% ${fmtDate(forecast.crossDay)}. Чтобы уложиться, нужно ${fmtInt(forecast.leadsNeeded)} лидов за месяц.`
                  : `Норматив ${cap}% будет превышен: нужно ${fmtInt(forecast.leadsNeeded)} лидов за месяц.`}
          </span>
        </div>
      )}

      {/* откуда доход: основа и регионы */}
      <div className="o2-scroll">
        <table className="o2-tbl">
          <thead>
            <tr>
              <th>Сегмент</th>
              <th className="r">Лиды</th>
              <th className="r">Цена лида</th>
              <th className="r" title="Основа — средневзвешенный по проектам её лидов; регионы — из настроек">Апрув</th>
              <th className="r">Доход с лида</th>
              <th className="r">Доход</th>
            </tr>
          </thead>
          <tbody>
            {(["main", "regional"] as const).map((k) => {
              const g = seg[k];
              if (k === "regional" && !g.leads) return null;
              return (
                <tr key={k} className="static">
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <span className="l2-tag">{k === "main" ? "основа" : "регионы"}</span>
                      <span className="o2-muted" style={{ fontSize: 12, whiteSpace: "normal" }}>
                        {(k === "main" ? rg.main : rg.regional).join(", ")}
                      </span>
                    </span>
                  </td>
                  <td className="r">{fmtInt(g.leads)}</td>
                  <td className="r">{g.price > 0 ? fmtMoney(g.price) : <span className="o2-r">не задана</span>}</td>
                  <td className="r">{fmtNum(g.approve)}%</td>
                  <td className="r o2-muted">{fmtMoney((g.price * g.approve) / 100)}</td>
                  <td className="r" style={{ fontWeight: 600 }}>{g.revenue ? fmtMoney(g.revenue) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Итого доход</td>
              <td className="r">{fmtInt(seg.main.leads + seg.regional.leads)}</td>
              <td />
              <td />
              <td className="r o2-muted">{fmtMoney(income)}</td>
              <td className="r">{fund.revenue ? fmtMoney(fund.revenue) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ФОТ по группам */}
      <div className="o2-scroll" style={{ borderTop: "1px solid var(--ink-06)" }}>
        <table className="o2-tbl">
          <thead>
            <tr>
              <th>Группа</th>
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
                <tr key={g.id} className="static">
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <Swatch hue={g.color} />
                      {g.name}
                    </span>
                  </td>
                  <td className="r o2-muted">{fmtInt(g.people)}</td>
                  <td className="r">{fmtInt(g.leads)}</td>
                  <td className="r o2-muted">{fmtNum(g.approve)}%</td>
                  <td className="r o2-muted">{g.stat.revenue ? fmtMoney(g.stat.revenue) : "—"}</td>
                  <td className="r">{fmtMoney(g.stat.fund)}</td>
                  <td className={`r ${g.stat.revenue ? (g.stat.ok ? "o2-g" : "o2-r") : ""}`} style={{ fontWeight: 600 }}>
                    {g.stat.revenue ? fmtPct(g.stat.pct) : "—"}
                  </td>
                  <td className={`r ${room < 0 ? "o2-r" : ""}`}>{g.stat.revenue ? (room >= 0 ? fmtMoney(room) : `−${fmtMoney(-room)}`) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td>Итого</td>
              <td className="r">{fmtInt(pr.rows.length)}</td>
              <td className="r">{fmtInt(t.leads)}</td>
              <td className="r">{fmtNum(approve)}%</td>
              <td className="r">{fund.revenue ? fmtMoney(fund.revenue) : "—"}</td>
              <td className="r">{fmtMoney(fund.fund)}</td>
              <td className={`r ${fundHue === "green" ? "o2-g" : fundHue === "red" ? "o2-r" : ""}`}>{fund.revenue ? fmtPct(fund.pct) : "—"}</td>
              <td className="r">{fund.revenue ? (fund.over > 0 ? `−${fmtMoney(fund.over)}` : fmtMoney(fund.revenue * fund.cap - fund.fund)) : "—"}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="pf-approve">
        <div className="o2-box-h" style={{ marginBottom: 2 }}>
          <b>
            <Icon name="checkc" size={13} className="mi" />
            Апрув основы за {fmtMonth(month).toLowerCase()} — по проектам
          </b>
        </div>
        <div className="pf-sub" style={{ marginBottom: 8 }}>
          Факт от заказчика: из него доход основы и коэффициент бонуса супервайзера. Регионы — свой апрув из настроек
        </div>
        <ApproveMonthEditor />
      </div>
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

function PayDrawer({ row: r, planValue, onClose, onAdj, onPay }: { row: PayRow; planValue: number; onClose: () => void; onAdj: (a?: Adjustment) => void; onPay: () => void }) {
  const { data, month, saveTerms, deleteAdjustment, confirm, access, today } = useCrm();
  const canEdit = canEditPay(access, r.op.id);
  const [edit, setEdit] = useState(false);
  const [slip, setSlip] = useState(false);
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
  const baseFormula = isSvVolume(r.payType)
    ? `${fmtMoney(r.salary)} × ${fmtPct(r.salaryShare)} рабочих дней месяца, отработанных по графику (не больше оклада)`
    : isHourlyTiered(r.payType)
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
        <button className="btn btn-sm" onClick={() => setSlip(true)} title="Разбор начислений — PDF или картинкой, чтобы отдать сотруднику">
          <Icon name="doc" size={13} /> Расчётный лист
        </button>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card card-pad" style={{ fontSize: 13 }}>
          <h3 className="card-title" style={{ marginBottom: 6 }}><Icon name="calc" size={15} className="title-ic" />Расчёт</h3>
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
          <div className="row" style={{ paddingTop: 10, fontSize: 15, fontWeight: 700, gap: 10 }}>
            <span style={{ flex: 1 }}>Остаток к выплате</span>
            <span className="num">{fmtMoney(r.toPay)}</span>
            {canEdit && r.toPay > 0.005 && (
              <button className="btn btn-sm btn-primary" onClick={onPay} title="Записать выплату на весь остаток, датой сегодня">
                <Icon name="wallet" size={13} /> Выплатить
              </button>
            )}
          </div>
          {r.toPay > 0.005 && (
            <div className="row" style={{ paddingTop: 6, fontSize: 13.5, gap: 10 }}>
              <span style={{ flex: 1 }}>
                С налогом +{TAX_PCT}%
                <span style={{ display: "block", fontSize: 11.5, color: "var(--dim)" }}>сумма к переводу самозанятому</span>
              </span>
              <span className="num" style={{ fontWeight: 600 }}><TaxSum value={r.toPay} /></span>
            </div>
          )}
        </div>

        {r.sv && <SvCard r={r} />}

        {isTiered(r.payType) && r.tierUse.length > 0 && (
          <div className="card card-pad">
            <div className="card-head" style={{ marginBottom: 8 }}>
              <div>
                <h3 className="card-title"><Icon name="rules" size={15} className="title-ic" />Разбор по ступеням</h3>
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
            <h3 className="card-title"><Icon name="wallet" size={15} className="title-ic" />Начисления и выплаты</h3>
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
              <h3 className="card-title"><Icon name="clock" size={15} className="title-ic" />История выплат</h3>
              <p className="card-sub">Все авансы и выплаты сотруднику, по всем месяцам</p>
            </div>
          </div>
          <PayoutHistory opId={r.op.id} compact />
        </div>

        <div className="card card-pad">
          <div className="card-head" style={{ marginBottom: 8 }}>
            <div>
              <h3 className="card-title"><Icon name="doc" size={15} className="title-ic" />Условия на {fmtMonth(month)}</h3>
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
      {slip && <PayslipModal row={r} cal={monthCal(month, data.settings, today)} onClose={() => setSlip(false)} />}
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
    return { ...fundStat(gross, leads, incomePerLead(data, month, (l) => ids.has(l.operatorId)), data.settings.payrollCapPct), people: rows.length, approve };
  }, [data, ix, month, today, r.op.id]);
  return (
    <div className="card card-pad">
      <div className="card-head" style={{ marginBottom: 8 }}>
        <div>
          <h3 className="card-title"><Icon name="userStar" size={15} className="title-ic" />Бонус за объём группы</h3>
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
    <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--ink-06)" }}>
      <div style={{ fontSize: 11.5, color: "var(--text-sub)", lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, marginTop: 2, color: tone === "good" ? "var(--c-green-fg)" : tone === "bad" ? "var(--c-red-fg)" : "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--dim)" }}>{sub}</div>}
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
  // ведомость на странице — за текущий месяц; запись другого месяца с ней не сравниваем
  const row = f.month === month ? rows.find((r) => r.op.id === f.operatorId) ?? null : null;
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
          options={rows.map<Opt>((r) => ({ value: r.op.id, label: shortName(r.op.name), icon: <Avatar name={r.op.name} id={r.op.id} size={20} /> }))}
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
            {shortName(preview.before.op.name)} · {fmtMonth(f.month)}
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

/**
 * «История выплат» на странице зарплаты: выплаты зоны по всем месяцам — сверху итоги
 * выбранного месяца (по дате выплаты), ниже — таблица с поиском и страницами.
 */
function PayoutsView({ month, toPay, q, setQ }: { month: string; toPay: number; q: string; setQ: (v: string) => void }) {
  const { ix } = useCrm();
  const all = usePayouts();
  const [scope, setScope] = useState<"month" | "all">("month");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter(
      (a) => (scope === "all" || a.date.slice(0, 7) === month) && (!needle || (ix.opById.get(a.operatorId)?.name ?? "").toLowerCase().includes(needle)),
    );
  }, [all, scope, month, q, ix]);
  const inMonth = useMemo(() => all.filter((a) => a.date.slice(0, 7) === month), [all, month]);
  const sum = (xs: Adjustment[]) => xs.reduce((acc, a) => acc + a.amount, 0);
  const people = new Set(inMonth.map((a) => a.operatorId)).size;
  const nAdv = inMonth.filter((a) => a.type === "advance").length;
  const nPay = inMonth.filter((a) => a.type === "payout").length;
  const pages = Math.max(1, Math.ceil(list.length / size));
  const cur = Math.min(page, pages);
  const total = sum(list);
  return (
    <div className="o2-body">
      <div className="o2-main">
        <div className="card o2-kpis" data-n="4">
          <Tile icon="wallet" label={`Выплачено · ${fmtMonth(month).toLowerCase()}`} value={fmtMoney(sum(inMonth))} line={`${fmtInt(inMonth.length)} ${plural(inMonth.length, PAYOUTS)}`} sub={`${fmtInt(people)} чел.`} />
          <Tile icon="clock" label="Авансы" value={fmtMoney(sum(inMonth.filter((a) => a.type === "advance")))} line={`${fmtInt(nAdv)} ${plural(nAdv, ["запись", "записи", "записей"])}`} sub="за этот месяц" />
          <Tile icon="check" hue="green" label="Выплаты" value={fmtMoney(sum(inMonth.filter((a) => a.type === "payout")))} line={`${fmtInt(nPay)} ${plural(nPay, ["запись", "записи", "записей"])}`} sub="за этот месяц" />
          <Tile
            icon="hourglass"
            label="Остаток по ведомости"
            hue={toPay > 0.5 ? "amber" : "green"}
            value={fmtMoney(toPay)}
            line={toPay > 0.5 ? "ещё не выплачено" : "всё выплачено"}
            sub={`за ${fmtMonth(month).toLowerCase()}`}
          />
        </div>

        <div className="card o2-filters">
          <label className="o2-search">
            <Icon name="search" size={14} />
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Поиск по сотруднику…"
            />
          </label>
          <div className="o2-seg" role="group">
            {(
              [
                ["month", fmtMonth(month)],
                ["all", "Все месяцы"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                className={scope === k ? "on" : ""}
                onClick={() => {
                  setScope(k);
                  setPage(1);
                }}
              >
                {l}
              </button>
            ))}
          </div>
          <span className="o2-muted" style={{ fontSize: 12 }}>
            По дате выплаты · «Выплатить» в ведомости записывает остаток одной кнопкой
          </span>
          <span className="o2-found">Найдено: {fmtInt(list.length)}</span>
        </div>

        <div className="card o2-card">
          {list.length === 0 ? (
            <Empty icon="wallet" title="Выплат нет" text="Выплаты появятся здесь, как только их отметят в ведомости — кнопкой «Выплатить» или записью «Аванс» / «Выплата»." />
          ) : (
            <>
              <div className="o2-scroll">
                <table className="o2-tbl">
                  <thead>
                    <tr>
                      <th>Дата</th>
                      <th>Сотрудник</th>
                      <th>Тип</th>
                      <th>За ведомость</th>
                      <th>Комментарий</th>
                      <th className="r">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.slice((cur - 1) * size, cur * size).map((a) => {
                      const op = ix.opById.get(a.operatorId);
                      return (
                        <tr key={a.id} className="static">
                          <td>
                            <b style={{ fontWeight: 600 }}>{fmtDate(a.date)}</b>
                          </td>
                          <td>
                            <span className="row" style={{ gap: 10 }}>
                              <Avatar name={op?.name ?? "?"} id={a.operatorId} size={26} />
                              <span>{shortName(op?.name ?? "—")}</span>
                            </span>
                          </td>
                          <td>
                            <span className="o2-st" data-hue={a.type === "advance" ? "amber" : "green"}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
                              {ADJ_LABEL[a.type]}
                            </span>
                          </td>
                          <td className="o2-muted">{fmtMonth(a.month)}</td>
                          <td className="o2-muted" style={{ whiteSpace: "normal" }}>{a.comment || "—"}</td>
                          <td className="r" style={{ fontWeight: 600 }}>{fmtMoney(a.amount)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5}>
                        Итого · {fmtInt(list.length)} {plural(list.length, PAYOUTS)}
                      </td>
                      <td className="r">{fmtMoney(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {list.length > 25 && (
                <div className="l2-foot">
                  <span style={{ flex: 1 }} />
                  <Pager
                    page={cur}
                    size={size}
                    total={list.length}
                    onPage={setPage}
                    onSize={(v) => {
                      setSize(v);
                      setPage(1);
                    }}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
