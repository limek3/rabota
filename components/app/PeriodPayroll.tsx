"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCrm } from "@/lib/crm/store";
import { goneLast, isGone, sumRange } from "@/lib/crm/calc";
import { dataStart, defaultPeriod, periodAt, periodIndexOf, periodPayroll, periodsUpTo, type PayPeriod, type PeriodRow } from "@/lib/crm/payperiod";
import { TAX_PCT, rowsTotal, withTax } from "@/lib/crm/payroll";
import { NO_GROUP_LABEL, PAY_LABEL, type Settings } from "@/lib/crm/types";
import { WEEKDAYS_SHORT, addDays, addMonths, fmtDate, fmtMonth, isoWeekday, monthOf, monthStart } from "@/lib/crm/dates";
import { fmtInt, fmtMoney, fmtNum, shortName } from "@/lib/crm/format";
import { Avatar, Chip, Empty, GoneSepRow, GoneTag, Kpi, Modal, Swatch, foldRow, useFoldGroups, useWheelHScroll } from "@/components/ui/kit";
import { PayScheduleSection } from "@/components/app/PaySchedule";
import { PeriodDrawer } from "@/components/app/PeriodDrawer";
import { TaxSum } from "@/components/app/TaxSum";
import { Select, dot, type Opt } from "@/components/ui/select";
import { canEditPay, canTouchOp } from "@/lib/crm/access";
import { Icon } from "@/components/ui/icons";

/**
 * Зарплата по периодам выплат (lib/crm/payperiod.ts): кому и сколько выплатить в день
 * выплаты. Период — две недели, выплата — через несколько дней после его конца.
 * Помесячная ведомость остаётся отдельной вкладкой — для ФОТ и аналитики.
 */

const NO_GROUP = "__none__";
const INFO_KEY = "payroll.periodInfo";
const wd = (d: string) => WEEKDAYS_SHORT[isoWeekday(d) - 1];
const dm = (d: string) => fmtDate(d).slice(0, 5);

export function periodLabel(p: PayPeriod, start?: string): string {
  const from = p.first && start && start < p.from ? `${dm(start)}` : dm(p.from);
  return `${from} – ${dm(p.to)} · выплата ${dm(p.pay)} (${wd(p.pay)})`;
}

export function PeriodPayroll() {
  const { data, ix, today, saveAdjustment, confirm, access } = useCrm();
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
  const s = data.settings;
  const all = useMemo(() => periodsUpTo(s, addDays(today, s.payPeriodDays)), [s, today]);
  const [idx, setIdx] = useState(() => defaultPeriod(s, today).idx);
  const period = all[Math.min(idx, all.length - 1)] ?? periodAt(s, 0);
  const prAll = useMemo(() => periodPayroll(data, ix, today, period), [data, ix, today, period]);
  // супервайзер видит выплаты только своих людей
  const rowsVisible = useMemo(() => (access.isHead ? prAll.rows : prAll.rows.filter((r) => canTouchOp(access, r.op.id))), [prAll, access]);
  const [q, setQ] = useState("");
  const [grp, setGrp] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const openRow = open ? rowsVisible.find((r) => r.op.id === open) ?? null : null;
  const wrapRef = useRef<HTMLDivElement>(null);
  const fold = useFoldGroups(wrapRef);
  useWheelHScroll(wrapRef, { auto: true, watch: rowsVisible.length > 0 });

  const led = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of data.groups) if (!g.deletedAt && g.supervisorId && !m.has(g.supervisorId)) m.set(g.supervisorId, g.id);
    return m;
  }, [data.groups]);
  const groupOf = useCallback((r: PeriodRow) => led.get(r.op.id) ?? r.op.groupId ?? NO_GROUP, [led]);
  const isSv = useCallback((r: PeriodRow) => r.op.role === "supervisor" || led.has(r.op.id), [led]);

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

  const t = rowsTotal(rowsVisible);
  const vt = rowsTotal(rows);
  const firstFrom = useMemo(() => dataStart(data), [data]);
  const periodOpts = useMemo<Opt[]>(
    () => [...all].reverse().map((p) => ({ value: String(p.idx), label: periodLabel(p, p.first ? firstFrom : undefined), hint: p.idx === periodIndexOf(s, today) ? "идёт" : today > p.pay ? "прошла" : "" })),
    [all, s, today, firstFrom],
  );

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

  return (
    <div className="stack">
      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-icon" disabled={period.idx === 0} onClick={() => setIdx(period.idx - 1)} title="Предыдущий период">
            <Icon name="chevL" size={15} />
          </button>
          <Select value={String(period.idx)} options={periodOpts} onChange={(v) => setIdx(Number(v))} width={330} ariaLabel="Период выплаты" />
          <button className="btn btn-icon" disabled={period.idx >= all.length - 1} onClick={() => setIdx(period.idx + 1)} title="Следующий период">
            <Icon name="chevR" size={15} />
          </button>
        </div>
        <Chip hue={status.hue} dot>
          {status.text}
        </Chip>
        <span className="row" style={{ gap: 6, marginLeft: "auto" }}>
          <button type="button" className={`btn btn-sm${showInfo ? "" : " btn-ghost"}`} aria-pressed={showInfo} onClick={toggleInfo} title={showInfo ? "Скрыть пояснение" : "Показать, как считается выплата"}>
            <Icon name="info" size={13} /> Как считается
          </button>
          {access.can.systemSettings && (
            <button type="button" className="btn btn-sm" onClick={() => setEditSched(true)} title="Периоды и дни выплат — поправить на любой месяц">
              <Icon name="calendar" size={13} /> График выплат
            </button>
          )}
        </span>
      </div>

      {showInfo && (
        <div className="card card-pad" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 300px)", gap: "10px 28px", fontSize: 13 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <b style={{ fontSize: 13.5 }}>
              <Icon name="info" size={14} className="title-ic" /> Как считается эта выплата
            </b>
            <Line k="Период">
              {fmtDate(prAll.start)} – {fmtDate(period.to)} · {spanDays} дн.
              {period.first && prAll.start < period.from && <span className="muted"> — первый, поэтому длиннее обычного: с первого рабочего дня, дальше по {s.payPeriodDays} дн.</span>}
            </Line>
            <Line k="Реестр">
              {fmtDate(period.registry)} ({wd(period.registry)}) — суммы к переводу: остаток + {TAX_PCT}% налога самозанятого
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
          <div style={{ display: "flex", flexDirection: "column", gap: 5, borderLeft: "1px solid var(--border)", paddingLeft: 20 }}>
            <b style={{ fontSize: 12, color: "var(--dim)", fontWeight: 600 }}>Следующие выплаты</b>
            {upcoming.map((p) => (
              <span key={p.idx} className="row num" style={{ gap: 8, fontSize: 12.5 }}>
                <span>
                  {dm(p.from)} – {dm(p.to)}
                </span>
                <span className="muted">→ реестр {dm(p.registry)} ·</span>
                <b>
                  {dm(p.pay)} ({wd(p.pay)})
                </b>
              </span>
            ))}
          </div>
        </div>
      )}
      {editSched && <ScheduleModal onClose={() => setEditSched(false)} />}

      <div className="kpi-grid">
        <Kpi label="Начислено" value={fmtMoney(t.gross)} sub={`база ${fmtMoney(t.base)} · бонусы ${fmtMoney(t.leadPay)}`} />
        <Kpi label="Удержано" value={fmtMoney(t.withhold + t.deductions)} sub={`${s.withholdPct}% — ${fmtMoney(t.withhold)}`} />
        <Kpi label="К выплате" value={fmtMoney(t.net)} sub={`в день выплаты ${dm(period.pay)}`} />
        <Kpi label="Уже выплачено" value={fmtMoney(t.paid)} sub={`аванс ${fmtMoney(t.adj.advance)}`} />
        <Kpi label="Остаток" value={fmtMoney(t.toPay)} sub={`${fmtInt(rowsVisible.filter((r) => r.toPay > 0.005).length)} чел. ждут выплаты`} tone={t.toPay > 0.005 && today > period.pay ? "bad" : undefined} />
        <Kpi
          label={`В реестр · +${TAX_PCT}%`}
          value={fmtMoney(rowsVisible.reduce((a, r) => a + withTax(r.toPay), 0))}
          sub={`подать ${dm(period.registry)} (${wd(period.registry)}) · выплата ${dm(period.pay)}`}
          title={`Сумма к переводу: остаток каждого сотрудника + ${TAX_PCT}% налога самозанятого, до рубля`}
        />
        <Kpi
          label="Лиды и часы"
          value={fmtInt(t.leads)}
          sub={
            leadsOpen > 0
              ? `${fmtNum(t.hours, 0)} ч · ещё ${fmtInt(leadsOpen)} лид. сегодня — войдут после закрытия дня`
              : leadsAll - leadsOpen > t.leads
                ? `${fmtNum(t.hours, 0)} ч · всего в отделе ${fmtInt(leadsAll)} — ${fmtInt(leadsAll - t.leads)} без оператора в ведомости`
                : `${fmtNum(t.hours, 0)} ч за период`
          }
          title={`Доведённые лиды за ${fmtDate(prAll.start)} – ${fmtDate(leadsTo)}: всего ${fmtInt(leadsAll)}, в зарплате ${fmtInt(t.leads)}. В зарплату идут только закрытые дни.`}
        />
      </div>

      {rowsVisible.length === 0 ? (
        <div className="card">
          <Empty icon="wallet" title="В этом периоде начислений нет" text="Нет смен, лидов и корректировок за этот период." />
        </div>
      ) : (
        <>
          <div className="toolbar">
            <div style={{ position: "relative", width: 260 }}>
              <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--dim)" }} />
              <input className="inp" style={{ paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Оператор" />
            </div>
            {groupOpts.length > 2 && <Select value={grp} options={groupOpts} onChange={setGrp} width={220} ariaLabel="Группа" title="Показать группу" />}
            <span style={{ fontSize: 12, color: "var(--dim)" }}>Нажмите на строку — откроется расчёт сотрудника за период</span>
          </div>
          <div ref={wrapRef} className="tbl-wrap" style={{ maxHeight: "max(300px, calc(100vh / var(--ui-scale, 1) - 360px))" }}>
            <table className="tbl tbl-fit">
              <thead>
                <tr>
                  <th className="sticky-col" style={{ minWidth: 240 }}>Оператор</th>
                  <th>Схема</th>
                  <th className="r">Часы</th>
                  <th className="r">Лиды</th>
                  <th className="r bl" title="Оклад за дни периода или часы × ставка">База</th>
                  <th className="r" title="Бонус за лиды; у супервайзера — KPI за закрытый месяц">Бонус / KPI</th>
                  <th className="r" title="Премии, доп. начисления, компенсации, корректировки">Премии и доп.</th>
                  <th className="r" style={{ fontWeight: 700 }}>Начислено</th>
                  <th className="r bl">Удержано</th>
                  <th className="r">К выплате</th>
                  <th className="r">Выплачено</th>
                  <th className="r" style={{ fontWeight: 700 }}>Остаток</th>
                  <th className="r" title={`Остаток + ${TAX_PCT}% налога самозанятого — сумма к переводу`}>Налог +{TAX_PCT}%</th>
                  <th />
                </tr>
              </thead>
              {sections.map((sec) => {
                const closed = fold.isClosed(sec.id);
                const phase = fold.phase(sec.id);
                return (
                  <tbody key={sec.id} data-fold={sec.id}>
                    <tr className="grp-head" onClick={() => fold.toggle(sec.id)} aria-expanded={!closed}>
                      <td className="sticky-col">
                        <span className="row" style={{ gap: 8 }}>
                          <Icon name="chevR" size={14} className={`grp-chev${closed || phase === "out" ? "" : " open"}`} />
                          <Swatch hue={sec.color} />
                          <span>{sec.name}</span>
                          <span className="grp-head-sub">{sec.rows.length} чел.</span>
                        </span>
                      </td>
                      <td />
                      <td className="r num">{fmtNum(sec.total.hours)}</td>
                      <td className="r num">{fmtInt(sec.total.leads)}</td>
                      <td className="r num bl">{fmtMoney(sec.total.base)}</td>
                      <td className="r num">{fmtMoney(sec.total.leadPay)}</td>
                      <td className="r num">{fmtMoney(extra(sec.total.adj))}</td>
                      <td className="r num">{fmtMoney(sec.total.gross)}</td>
                      <td className="r num bl">{fmtMoney(sec.total.withhold + sec.total.deductions)}</td>
                      <td className="r num">{fmtMoney(sec.total.net)}</td>
                      <td className="r num">{fmtMoney(sec.total.paid)}</td>
                      <td className="r num">{fmtMoney(sec.total.toPay)}</td>
                      <td className="r num"><TaxSum value={sec.total.toPay} copy={false} /></td>
                      <td />
                    </tr>
                    {!closed &&
                      sec.rows.map((r, i) => {
                        const f = foldRow(phase, i);
                        const firstGone = isGone(r.op) && (i === 0 || !isGone(sec.rows[i - 1].op));
                        return (
                          <Fragment key={r.op.id}>
                            {firstGone && <GoneSepRow count={sec.rows.filter((x) => isGone(x.op)).length} colSpan={14} indent={28} />}
                            <tr className={`clickable ${f.className}`} style={f.style} onClick={() => setOpen(r.op.id)}>
                              <td className="sticky-col" style={{ paddingLeft: 28 }}>
                                <span className="row" style={{ gap: 8 }}>
                                  <Avatar name={r.op.name} id={r.op.id} size={24} />
                                  {shortName(r.op.name)}
                                  {isSv(r) && <Chip hue="indigo">СВ</Chip>}
                                  <GoneTag op={r.op} />
                                </span>
                              </td>
                              <td className="muted">{PAY_LABEL[r.payType]}</td>
                              <td className="r num">{fmtNum(r.hours)}</td>
                              <td className="r num">{fmtInt(r.leads)}</td>
                              <td className="r num bl">{fmtMoney(r.base)}</td>
                              <td className="r num">
                                {r.leadPay ? fmtMoney(r.leadPay) : <span className="muted">—</span>}
                                {r.kpiPending && <span className="muted" style={{ display: "block", fontSize: 11 }}>KPI за {fmtMonth(r.kpiPending).toLowerCase()} — позже</span>}
                              </td>
                              <td className="r num">{extra(r.adj) ? fmtMoney(extra(r.adj)) : <span className="muted">—</span>}</td>
                              <td className="r num" style={{ fontWeight: 600 }}>{fmtMoney(r.gross)}</td>
                              <td className="r num bl">{fmtMoney(r.withhold + r.deductions)}</td>
                              <td className="r num">{fmtMoney(r.net)}</td>
                              <td className="r num">{r.paid ? fmtMoney(r.paid) : <span className="muted">—</span>}</td>
                              <td className="r num" style={{ fontWeight: 600, color: r.toPay < -0.005 ? "var(--c-red-fg)" : r.toPay <= 0.005 && r.net > 0 ? "var(--c-green-fg)" : undefined }}>
                                {r.toPay <= 0.005 && r.net > 0 ? "✓ 0 ₽" : fmtMoney(r.toPay)}
                              </td>
                              <td className="r num" style={{ fontWeight: 600 }}><TaxSum value={r.toPay} /></td>
                              <td className="r" onClick={(e) => e.stopPropagation()}>
                                {canEditPay(access, r.op.id) && r.toPay > 0.005 && (
                                  <span className="row-actions">
                                    <button className="btn btn-ghost btn-sm" title={`Выплатить остаток ${fmtMoney(r.toPay)}`} onClick={() => void payRest(r)}>
                                      <Icon name="wallet" size={13} /> Выплатить
                                    </button>
                                  </span>
                                )}
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
                  <td className="sticky-col">
                    Итого · {rows.length}
                    {rows.length !== rowsVisible.length && <span className="muted"> из {rowsVisible.length}</span>}
                  </td>
                  <td />
                  <td className="r num">{fmtNum(vt.hours)}</td>
                  <td className="r num">{fmtInt(vt.leads)}</td>
                  <td className="r num bl">{fmtMoney(vt.base)}</td>
                  <td className="r num">{fmtMoney(vt.leadPay)}</td>
                  <td className="r num">{fmtMoney(extra(vt.adj))}</td>
                  <td className="r num">{fmtMoney(vt.gross)}</td>
                  <td className="r num bl">{fmtMoney(vt.withhold + vt.deductions)}</td>
                  <td className="r num">{fmtMoney(vt.net)}</td>
                  <td className="r num">{fmtMoney(vt.paid)}</td>
                  <td className="r num">{fmtMoney(vt.toPay)}</td>
                  <td className="r num"><TaxSum value={vt.toPay} copy={false} /></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
      {openRow && <PeriodDrawer row={openRow} period={period} start={prAll.start} onClose={() => setOpen(null)} onPay={() => void payRest(openRow)} />}
    </div>
  );
}

/** Премии и доп. начисления: всё, что увеличивает начисление сверх базы и бонусов. */
const extra = (a: Record<string, number>) => (a.bonus ?? 0) + (a.accrual ?? 0) + (a.compensation ?? 0) + (a.correction ?? 0);

/** Строка описания выплаты: подпись слева, текст справа. */
function Line({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="row" style={{ gap: 10, alignItems: "baseline" }}>
      <span className="muted" style={{ minWidth: 108, flex: "none" }}>{k}</span>
      <span style={{ minWidth: 0 }}>{children}</span>
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
