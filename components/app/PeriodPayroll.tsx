"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCrm } from "@/lib/crm/store";
import { goneLast, isGone, sumRange } from "@/lib/crm/calc";
import { dataStart, defaultPeriod, periodAt, periodIndexOf, periodPayroll, periodsUpTo, type PayPeriod, type PeriodRow } from "@/lib/crm/payperiod";
import { TAX_PCT, rowsTotal, withTax } from "@/lib/crm/payroll";
import { NO_GROUP_LABEL, PAY_LABEL, type Adjustment, type Operator, type Settings } from "@/lib/crm/types";
import { WEEKDAYS_SHORT, addDays, addMonths, fmtDate, fmtMonth, isoWeekday, monthOf, monthStart } from "@/lib/crm/dates";
import { fmtInt, fmtMoney, fmtNum, shortName } from "@/lib/crm/format";
import { Avatar, Collapse, Empty, GoneTag, Modal, Swatch, foldRow, useFoldGroups } from "@/components/ui/kit";
import { PayScheduleSection } from "@/components/app/PaySchedule";
import { PeriodDrawer } from "@/components/app/PeriodDrawer";
import { RegistryModal } from "@/components/app/RegistryModal";
import { TaxSum } from "@/components/app/TaxSum";
import { PeriodSide } from "@/components/app/PaySide";
import { SideEmpty, Tile } from "@/components/app/V2Kit";
import { Popover } from "@/components/app/OperatorsV2";
import { Select, dot, type Opt } from "@/components/ui/select";
import { useColumnDrag, useColumnOrder, useColumnVisibility } from "@/components/ui/ColumnOrder";
import { canEditPay, canTouchOp } from "@/lib/crm/access";
import { Icon } from "@/components/ui/icons";

/**
 * Зарплата по периодам выплат (lib/crm/payperiod.ts): кому и сколько выплатить в день
 * выплаты. Период — две недели, выплата — через несколько дней после его конца.
 * Помесячная ведомость остаётся отдельной вкладкой — для ФОТ и аналитики.
 *
 * Вид — как «Операторы»: полоса показателей, фильтры, таблица и закреплённая панель
 * сотрудника справа (PaySide). Полный расчёт — PeriodDrawer.
 */

const NO_GROUP = "__none__";
const INFO_KEY = "payroll.periodInfo";
const wd = (d: string) => WEEKDAYS_SHORT[isoWeekday(d) - 1];
const dm = (d: string) => fmtDate(d).slice(0, 5);

export function periodLabel(p: PayPeriod, start?: string): string {
  const from = p.first && start && start < p.from ? `${dm(start)}` : dm(p.from);
  return `${from} – ${dm(p.to)} · выплата ${dm(p.pay)} (${wd(p.pay)})`;
}

/** Премии и доп. начисления: всё, что увеличивает начисление сверх базы и бонусов. */
const extra = (a: Record<string, number>) => (a.bonus ?? 0) + (a.accrual ?? 0) + (a.compensation ?? 0) + (a.correction ?? 0);

/* ── период: выбор, расчёт, статус, выплата ─────────────────────────── */

export function usePeriodPayroll() {
  const { data, ix, today, saveAdjustment, confirm, access } = useCrm();
  const s = data.settings;
  const all = useMemo(() => periodsUpTo(s, addDays(today, s.payPeriodDays)), [s, today]);
  const [idx, setIdx] = useState(() => defaultPeriod(s, today).idx);
  const period = all[Math.min(idx, all.length - 1)] ?? periodAt(s, 0);
  const prAll = useMemo(() => periodPayroll(data, ix, today, period), [data, ix, today, period]);
  // супервайзер видит выплаты только своих людей
  const rows = useMemo(() => (access.isHead ? prAll.rows : prAll.rows.filter((r) => canTouchOp(access, r.op.id))), [prAll, access]);
  const t = useMemo(() => rowsTotal(rows), [rows]);
  const firstFrom = useMemo(() => dataStart(data), [data]);
  const periodOpts = useMemo<Opt[]>(
    () => [...all].reverse().map((p) => ({ value: String(p.idx), label: periodLabel(p, p.first ? firstFrom : undefined), hint: p.idx === periodIndexOf(s, today) ? "идёт" : today > p.pay ? "прошла" : "" })),
    [all, s, today, firstFrom],
  );

  // статус периода: идёт / закрыт, ждёт реестра / реестр сегодня / ждёт выплаты / день выплаты / выплата прошла
  const daysTo = Math.round((Date.parse(period.pay) - Date.parse(today)) / 86_400_000);
  const status =
    today <= period.to
      ? { hue: "blue", text: `Идёт период · до ${dm(period.to)} · реестр ${dm(period.registry)} (${wd(period.registry)})` }
      : today < period.registry
        ? { hue: "amber", text: `Закрыт · реестр ${dm(period.registry)} (${wd(period.registry)})` }
        : today === period.registry && today < period.pay
          ? { hue: "amber", text: "Сегодня подать реестр" }
          : today < period.pay
            ? { hue: "amber", text: `Реестр подан · выплата через ${daysTo} ${daysTo === 1 ? "день" : daysTo < 5 ? "дня" : "дней"}` }
            : today === period.pay
              ? { hue: "amber", text: "Сегодня день выплаты" }
              : t.toPay > 0.005
                ? { hue: "red", text: "Выплата прошла · есть остаток" }
                : { hue: "green", text: "Выплачено" };

  /**
   * «Выплатить»: запись «Выплата» на остаток периода. Дата — между концом периода и концом
   * следующего: выплата относится к периоду, закончившемуся до её даты (adjustmentPeriod).
   */
  const payRest = async (r: PeriodRow) => {
    const sum = Math.round(r.toPay * 100) / 100;
    if (sum <= 0) return;
    const ok = await confirm({
      title: `Выплатить ${fmtMoney(sum)}?`,
      text: `${r.op.name} · остаток за период ${dm(prAll.start)} – ${dm(period.to)}. Запишется выплата — остаток станет 0 ₽, она появится в истории выплат.`,
      ok: "Выплатить",
    });
    if (!ok) return;
    const after = addDays(period.to, 1);
    const nextTo = periodAt(s, period.idx + 1).to;
    const date = today < after ? after : today > nextTo ? nextTo : today;
    await saveAdjustment({ month: monthOf(date), operatorId: r.op.id, type: "payout", amount: sum, date, comment: `Выплата за ${dm(prAll.start)} – ${dm(period.to)}` });
  };

  return { all, period, setIdx, prAll, rows, t, status, periodOpts, payRest };
}
export type PeriodState = ReturnType<typeof usePeriodPayroll>;

/** Выбор периода в шапке страницы: ‹ 16.09 – 05.10 · выплата 09.10 (пт) › */
export function PeriodNav({ pp }: { pp: PeriodState }) {
  const { period, all, setIdx, periodOpts } = pp;
  return (
    <div className="o2-date">
      <button className="o2-ib" disabled={period.idx === 0} onClick={() => setIdx(period.idx - 1)} aria-label="Предыдущий период">
        <Icon name="chevL" size={15} />
      </button>
      <Select value={String(period.idx)} options={periodOpts} onChange={(v) => setIdx(Number(v))} width={262} minPopWidth={320} ariaLabel="Период выплаты" />
      <button className="o2-ib" disabled={period.idx >= all.length - 1} onClick={() => setIdx(period.idx + 1)} aria-label="Следующий период">
        <Icon name="chevR" size={15} />
      </button>
    </div>
  );
}

/* ── столбцы таблицы ────────────────────────────────────────────────── */

const COLS = ["scheme", "hours", "leads", "base", "bonus", "extra", "gross", "withhold", "net", "paid", "toPay", "tax"] as const;
type Col = (typeof COLS)[number];
const SHOWN: Col[] = ["hours", "leads", "gross", "withhold", "paid", "toPay", "tax"];
const COL_LABEL: Record<Col, string> = {
  scheme: "Схема", hours: "Часы", leads: "Лиды", base: "База", bonus: "Бонус / KPI", extra: "Премии и доп.", gross: "Начислено",
  withhold: "Удержано", net: "К выплате", paid: "Выплачено", toPay: "Остаток", tax: "К переводу",
};
const COL_HINT: Partial<Record<Col, string>> = {
  base: "Оклад за дни периода или часы × ставка",
  bonus: "Бонус за лиды; у супервайзера — KPI за закрытый месяц",
  extra: "Премии, доп. начисления, компенсации, корректировки",
  withhold: "Процент удержания и удержания",
  net: "Начислено минус удержано",
  paid: "Аванс и выплаты",
  tax: `Остаток ÷ 0,94 (налог самозанятого ${TAX_PCT}%) — сумма к переводу`,
};

function mergeVisible(full: string[], visibleNext: string[]): string[] {
  const vis = new Set(visibleNext);
  let i = 0;
  return full.map((k) => (vis.has(k) ? visibleNext[i++] : k));
}

/* ── страница периода ──────────────────────────────────────────────── */

export function PeriodPayroll({ pp, onAdj }: { pp: PeriodState; onAdj?: (opId: string, a?: Adjustment) => void }) {
  const { data, ix, today, access } = useCrm();
  const s = data.settings;
  const { period, prAll, rows: rowsVisible, t, payRest } = pp;
  // «Как считается эта выплата» — свёрнуто по умолчанию, выбор запоминаем
  const [showInfo, setShowInfo] = useState(false);
  useEffect(() => {
    try {
      setShowInfo(localStorage.getItem(INFO_KEY) === "1");
    } catch {}
  }, []);
  const toggleInfo = () =>
    setShowInfo((v) => {
      try {
        localStorage.setItem(INFO_KEY, v ? "0" : "1");
      } catch {}
      return !v;
    });
  const [editSched, setEditSched] = useState(false);
  const [showRegistry, setShowRegistry] = useState(false);
  const [q, setQ] = useState("");
  const [grp, setGrp] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const sel = selId ? rowsVisible.find((r) => r.op.id === selId) ?? null : null;
  const drawerRow = drawerId ? rowsVisible.find((r) => r.op.id === drawerId) ?? null : null;

  const vis = useColumnVisibility("payroll-period", COLS, SHOWN);
  const colOrder = useColumnOrder("payroll-period", COLS);
  const shown = useMemo(() => colOrder.order.filter((k) => vis.shown.has(k)) as Col[], [colOrder.order, vis.shown]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const colDrag = useColumnDrag({ wrapRef, order: shown, onChange: (next) => colOrder.save(mergeVisible(colOrder.order, next)) });
  const fold = useFoldGroups(wrapRef);

  const led = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data.groups) if (!g.deletedAt && g.supervisorId && !m.has(g.supervisorId)) m.set(g.supervisorId, g.id);
    return m;
  }, [data.groups]);
  const groupOf = useCallback((r: PeriodRow) => led.get(r.op.id) ?? r.op.groupId ?? NO_GROUP, [led]);
  const isSv = useCallback((r: PeriodRow) => r.op.role === "supervisor" || led.has(r.op.id), [led]);
  const isSvOp = useCallback((op: Operator) => op.role === "supervisor" || op.payType === "sv_volume" || led.has(op.id), [led]);

  const rows = useMemo(
    () => rowsVisible.filter((r) => (!q.trim() || r.op.name.toLowerCase().includes(q.trim().toLowerCase())) && (!grp || groupOf(r) === grp)),
    [rowsVisible, q, grp, groupOf],
  );
  const sections = useMemo(() => {
    const map = new Map<string, PeriodRow[]>();
    for (const r of rows) map.set(groupOf(r), [...(map.get(groupOf(r)) ?? []), r]);
    return Array.from(map.entries())
      .map(([id, list]) => {
        const g = id === NO_GROUP ? null : ix.groupById.get(id);
        const sorted = [...list].sort((a, b) => goneLast(a.op, b.op) || Number(isSv(b)) - Number(isSv(a)) || a.op.name.localeCompare(b.op.name, "ru"));
        return { id, name: g?.name ?? NO_GROUP_LABEL, color: g?.color ?? "gray", rows: sorted, total: rowsTotal(sorted) };
      })
      .sort((a, b) => Number(a.id === NO_GROUP) - Number(b.id === NO_GROUP) || a.name.localeCompare(b.name, "ru"));
  }, [rows, groupOf, isSv, ix]);
  const groupOpts = useMemo<Opt[]>(() => {
    const ids = new Set(rowsVisible.map(groupOf));
    const list = Array.from(ids)
      .map((id) => {
        const g = id === NO_GROUP ? null : ix.groupById.get(id);
        return { value: id, label: g?.name ?? NO_GROUP_LABEL, icon: dot(g?.color ?? "gray") };
      })
      .sort((a, b) => Number(a.value === NO_GROUP) - Number(b.value === NO_GROUP) || a.label.localeCompare(b.label, "ru"));
    return [{ value: "", label: "Все группы" }, ...list];
  }, [rowsVisible, groupOf, ix]);
  const vt = rowsTotal(rows);

  // для описания: длина периода, когда придёт KPI за каждый его месяц, ближайшие выплаты
  const spanDays = Math.round((Date.parse(period.to) - Date.parse(prAll.start)) / 86_400_000) + 1;
  const kpiMonths = useMemo(() => {
    const out: { month: string; pay: string }[] = [];
    for (let m = monthOf(prAll.start); m <= monthOf(period.to); m = addMonths(m, 1)) out.push({ month: m, pay: periodAt(s, periodIndexOf(s, monthStart(addMonths(m, 1)))).pay });
    return out;
  }, [s, prAll.start, period.to]);
  const upcoming = useMemo(() => {
    const cur = periodIndexOf(s, today);
    const from = Math.max(cur, period.idx + 1);
    return [0, 1, 2].map((i) => periodAt(s, from + i));
  }, [s, today, period.idx]);

  // сверка лидов: все доведённые лиды за период против тех, что попали в зарплату
  const leadsTo = period.to < today ? period.to : today;
  const leadsAll = sumRange(ix.day, prAll.start, leadsTo);
  const leadsOpen = leadsTo > ix.workedTo ? sumRange(ix.day, addDays(ix.workedTo, 1), leadsTo) : 0;
  const waiting = rowsVisible.filter((r) => r.toPay > 0.005).length;
  const overdue = t.toPay > 0.005 && today > period.pay;

  /* ── ячейки: строка сотрудника и итог группы ─────────────────────── */
  const money = (v: number) => (v ? fmtMoney(v) : <span className="o2-muted">—</span>);
  const cell = (c: Col, r: PeriodRow) => {
    switch (c) {
      case "scheme":
        return <td key={c} data-col={c} className="o2-muted">{PAY_LABEL[r.payType]}</td>;
      case "hours":
        return <td key={c} data-col={c} className="r">{fmtNum(r.hours)}</td>;
      case "leads":
        return <td key={c} data-col={c} className="r">{fmtInt(r.leads)}</td>;
      case "base":
        return <td key={c} data-col={c} className="r">{fmtMoney(r.base)}</td>;
      case "bonus":
        return (
          <td key={c} data-col={c} className="r" title={r.kpiPending ? `KPI за ${fmtMonth(r.kpiPending).toLowerCase()} — придёт позже` : undefined}>
            {money(r.leadPay)}
          </td>
        );
      case "extra":
        return <td key={c} data-col={c} className="r">{money(extra(r.adj))}</td>;
      case "gross":
        return (
          <td key={c} data-col={c} className="r" style={{ fontWeight: 600 }} title={`база ${fmtMoney(r.base)} · бонус ${fmtMoney(r.leadPay)} · премии и доп. ${fmtMoney(extra(r.adj))}`}>
            {fmtMoney(r.gross)}
          </td>
        );
      case "withhold":
        return <td key={c} data-col={c} className="r">{money(r.withhold + r.deductions)}</td>;
      case "net":
        return <td key={c} data-col={c} className="r">{fmtMoney(r.net)}</td>;
      case "paid":
        return <td key={c} data-col={c} className="r">{money(r.paid)}</td>;
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
  const totalCell = (c: Col, x: ReturnType<typeof rowsTotal>) => {
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
      case "extra":
        return <td key={c} data-col={c} className="r">{fmtMoney(extra(x.adj))}</td>;
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
    <div className="o2-body has-side">
      <div className="o2-main">
        {/* ── показатели ─────────────────────────────────────────────── */}
        <div className="card o2-kpis">
          <Tile icon="calc" label="Начислено" value={fmtMoney(t.gross)} line={`база ${fmtMoney(t.base)}`} sub={`бонусы ${fmtMoney(t.leadPay)}`} />
          <Tile icon="trend" label="Удержано" value={fmtMoney(t.withhold + t.deductions)} line={`${s.withholdPct}% — ${fmtMoney(t.withhold)}`} sub="кроме компенсаций" />
          <Tile icon="wallet" label="К выплате" value={fmtMoney(t.net)} line={`выплачено ${fmtMoney(t.paid)}`} sub={`аванс ${fmtMoney(t.adj.advance)}`} />
          <Tile
            icon="hourglass"
            label="Остаток"
            hue={t.toPay > 0.005 ? (overdue ? "red" : "amber") : "green"}
            tone={overdue ? "bad" : undefined}
            value={fmtMoney(t.toPay)}
            line={waiting ? `${fmtInt(waiting)} чел. ждут выплаты` : "все выплачены"}
            sub={`выплата ${dm(period.pay)} (${wd(period.pay)})`}
          />
          <Tile
            icon="doc"
            label={`В реестр · с налогом ${TAX_PCT}%`}
            value={fmtMoney(rowsVisible.reduce((a, r) => a + withTax(r.toPay), 0))}
            line={`подать ${dm(period.registry)} (${wd(period.registry)})`}
            sub="остаток + налог"
            title={`Сумма к переводу: остаток каждого сотрудника ÷ 0,94 (налог самозанятого ${TAX_PCT}%), до рубля`}
          />
          <Tile
            icon="leads"
            label="Лиды и часы"
            value={fmtInt(t.leads)}
            line={`${fmtNum(t.hours, 0)} ч`}
            sub={leadsOpen > 0 ? `ещё ${fmtInt(leadsOpen)} лид. сегодня` : leadsAll - leadsOpen > t.leads ? `${fmtInt(leadsAll - t.leads)} без оператора` : "закрытые дни"}
            title={`Доведённые лиды за ${fmtDate(prAll.start)} – ${fmtDate(leadsTo)}: всего ${fmtInt(leadsAll)}, в зарплате ${fmtInt(t.leads)}. В зарплату идут только закрытые дни${leadsOpen > 0 ? ` — сегодняшние ${fmtInt(leadsOpen)} войдут после закрытия дня` : ""}.`}
          />
        </div>

        {/* ── как считается ───────────────────────────────────────────── */}
        <Collapse open={showInfo}>
          <div className="card pp-info">
            <div>
              <div className="o2-box-h" style={{ marginBottom: 8 }}>
                <b>
                  <Icon name="info" size={13} className="mi" />
                  Как считается эта выплата
                </b>
                <button className="o2-kebab" onClick={toggleInfo} aria-label="Скрыть">
                  <Icon name="close" size={14} />
                </button>
              </div>
              <div className="pp-lines">
                <Line k="Период">
                  {fmtDate(prAll.start)} – {fmtDate(period.to)} · {spanDays} дн.
                  {period.first && prAll.start < period.from && <span className="o2-muted"> — первый, поэтому длиннее обычного: с первого рабочего дня, дальше по {s.payPeriodDays} дн.</span>}
                </Line>
                <Line k="Реестр">
                  {fmtDate(period.registry)} ({wd(period.registry)}) — суммы к переводу: остаток ÷ 0,94 (налог самозанятого {TAX_PCT}%)
                </Line>
                <Line k="Выплата">
                  {fmtDate(period.pay)} ({wd(period.pay)}) — через {Math.round((Date.parse(period.pay) - Date.parse(period.to)) / 86_400_000)} дн. после конца периода
                </Line>
                <Line k="Операторы">часы и лиды закрытых дней периода; ставка часа и бонус за лид — по ступени сетки каждой смены</Line>
                <Line k="Оклад">по отработанным по графику дням: оклад ÷ рабочие дни месяца × отработанные дни периода</Line>
                <Line k="KPI СВ">
                  раз в месяц, когда месяц закрыт:{" "}
                  {kpiMonths.map((k, i) => (
                    <Fragment key={k.month}>
                      {i > 0 && ", "}
                      за {fmtMonth(k.month).toLowerCase()} → выплата {dm(k.pay)}
                    </Fragment>
                  ))}
                </Line>
                <Line k="Корректировки">премии, удержания и аванс — в период по дате записи; «Выплата» гасит период, закончившийся до неё</Line>
              </div>
            </div>
            <div className="pp-next">
              <b>Следующие выплаты</b>
              {upcoming.map((p) => (
                <span key={p.idx} className="num">
                  <span>
                    {dm(p.from)} – {dm(p.to)}
                  </span>
                  <span className="o2-muted">→ реестр {dm(p.registry)} ·</span>
                  <b>
                    {dm(p.pay)} ({wd(p.pay)})
                  </b>
                </span>
              ))}
            </div>
          </div>
        </Collapse>
        {editSched && <ScheduleModal onClose={() => setEditSched(false)} />}
        {showRegistry && <RegistryModal pp={pp} isSv={isSvOp} onClose={() => setShowRegistry(false)} />}

        {/* ── фильтры ─────────────────────────────────────────────────── */}
        <div className="card o2-filters">
          <label className="o2-search">
            <Icon name="search" size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по сотруднику…" />
          </label>
          {groupOpts.length > 2 && <Select value={grp} options={groupOpts} onChange={setGrp} width={170} ariaLabel="Группа" />}
          <button type="button" className={`o2-btn${showInfo ? " pri" : ""}`} aria-pressed={showInfo} onClick={toggleInfo} title={showInfo ? "Скрыть пояснение" : "Показать, как считается выплата"}>
            <Icon name="info" size={14} /> Как считается
          </button>
          {access.can.systemSettings && (
            <button type="button" className="o2-btn" onClick={() => setEditSched(true)} title="Периоды и дни выплат — поправить на любой месяц">
              <Icon name="calendar" size={14} /> График выплат
            </button>
          )}
          {access.isHead && (
            <button type="button" className="o2-btn" onClick={() => setShowRegistry(true)} title="Суммы периода — листами «План / Факт» в реестры бухгалтера для YouDo">
              <Icon name="doc" size={14} /> Реестр YouDo
            </button>
          )}
          <span className="o2-found">Найдено: {fmtInt(rows.length)}</span>
          <Popover
            align="right"
            button={(open, toggle, ref) => (
              <button ref={ref} className="o2-ib" onClick={toggle} aria-expanded={open} title="Столбцы">
                <Icon name="dashboard" size={15} />
              </button>
            )}
          >
            <div className="tt">Столбцы</div>
            {COLS.map((k) => (
              <label key={k} title={COL_HINT[k]}>
                <input type="checkbox" className="o2-cb" checked={vis.shown.has(k)} onChange={() => vis.toggle(k)} />
                {COL_LABEL[k]}
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

        {/* ── ведомость ───────────────────────────────────────────────── */}
        <div className="card o2-card">
          {rowsVisible.length === 0 ? (
            <Empty icon="wallet" title="В этом периоде начислений нет" text="Нет смен, лидов и корректировок за этот период." />
          ) : rows.length === 0 ? (
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
                        <th key={c} {...hp} className={`${hp.className}${c === "scheme" ? "" : " r"}`} title={COL_HINT[c] ? `${COL_HINT[c]}. Перетащите, чтобы переставить` : "Перетащите, чтобы переставить столбец"}>
                          {COL_LABEL[c]}
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
                      <tr className="grp-head" onClick={() => fold.toggle(sec.id)} aria-expanded={!closed} title={closed ? "Развернуть группу" : "Свернуть группу"}>
                        <td>
                          <span className="row" style={{ gap: 8 }}>
                            <Icon name="chevR" size={14} className={`grp-chev${closed || phase === "out" ? "" : " open"}`} />
                            <Swatch hue={sec.color} />
                            <span>{sec.name}</span>
                            <span className="grp-head-sub">{sec.rows.length} чел.</span>
                          </span>
                        </td>
                        {shown.map((c) => totalCell(c, sec.total))}
                        <td />
                      </tr>
                      {!closed &&
                        sec.rows.map((r, i) => {
                          const f = foldRow(phase, i);
                          const firstGone = isGone(r.op) && (i === 0 || !isGone(sec.rows[i - 1].op));
                          const canPay = canEditPay(access, r.op.id) && r.toPay > 0.005;
                          return (
                            <Fragment key={r.op.id}>
                              {firstGone && (
                                <tr className="gone-sep">
                                  <td colSpan={shown.length + 2}>Уволены · {sec.rows.filter((x) => isGone(x.op)).length}</td>
                                </tr>
                              )}
                              <tr className={`${f.className}${sel?.op.id === r.op.id ? " sel" : ""}`} style={f.style} onClick={() => setSelId(sel?.op.id === r.op.id ? null : r.op.id)}>
                                <td>
                                  <span className="row" style={{ gap: 10 }}>
                                    <Avatar name={r.op.name} id={r.op.id} size={26} />
                                    <span className="l2-two">
                                      <span>
                                        {shortName(r.op.name)}
                                        {isSv(r) && <span className="pay-sv">СВ</span>}
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
                                          <button className="it" onClick={() => { close(); setDrawerId(r.op.id); }}>
                                            <Icon name="calc" size={14} /> Подробный расчёт
                                          </button>
                                          {canPay && (
                                            <button className="it" onClick={() => { close(); void payRest(r); }}>
                                              <Icon name="wallet" size={14} /> Выплатить {fmtMoney(r.toPay)}
                                            </button>
                                          )}
                                          {onAdj && canEditPay(access, r.op.id) && (
                                            <button className="it" onClick={() => { close(); onAdj(r.op.id); }}>
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
                      Итого · {rows.length}
                      {rows.length !== rowsVisible.length && <span className="o2-muted"> из {rowsVisible.length}</span>}
                    </td>
                    {shown.map((c) => totalCell(c, vt))}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      {sel ? (
        <PeriodSide
          key={sel.op.id}
          r={sel}
          period={period}
          start={prAll.start}
          onPay={() => void payRest(sel)}
          onAdj={onAdj ? (a) => onAdj(sel.op.id, a) : undefined}
          onOpen={() => setDrawerId(sel.op.id)}
          onClose={() => setSelId(null)}
        />
      ) : (
        <SideEmpty
          icon="wallet"
          title="Выберите сотрудника"
          text="Нажмите на строку — здесь появятся остаток к выплате, расчёт за период, начисления и история выплат."
          ghosts={["К выплате", "Расчёт за период", "Начисления периода", "История выплат"]}
        />
      )}

      {drawerRow && <PeriodDrawer row={drawerRow} period={period} start={prAll.start} onClose={() => setDrawerId(null)} onPay={() => void payRest(drawerRow)} />}
    </div>
  );
}

/** Строка описания выплаты: подпись слева, текст справа. */
function Line({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="pp-line">
      <span className="o2-muted">{k}</span>
      <span>{children}</span>
    </div>
  );
}

/** Редактор графика выплат прямо из зарплаты: те же поля, что в Настройках. */
function ScheduleModal({ onClose }: { onClose: () => void }) {
  const { data, saveSettings } = useCrm();
  const [draft, setDraft] = useState<Settings>(data.settings);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const save = async () => {
    setBusy(true);
    const ok = await saveSettings({ paySchedule: draft.paySchedule, payPeriodStart: draft.payPeriodStart, payPeriodDays: draft.payPeriodDays, payDelayDays: draft.payDelayDays });
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <Modal
      title="График выплат"
      onClose={onClose}
      width={900}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save()}>
            Сохранить
          </button>
        </>
      }
    >
      <PayScheduleSection value={draft} set={set} bare />
    </Modal>
  );
}
