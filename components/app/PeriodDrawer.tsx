"use client";

import { useState, type ReactNode } from "react";
import { useCrm } from "@/lib/crm/store";
import type { PayPeriod, PeriodRow } from "@/lib/crm/payperiod";
import { hasBonus, isHourlyTiered, isSalary, isSvVolume, isTiered } from "@/lib/crm/payroll";
import { ADJ_LABEL, PAY_LABEL, type AdjustmentType, type DayKey } from "@/lib/crm/types";
import { WEEKDAYS_SHORT, addDays, fmtDate, fmtMonth, isoWeekday } from "@/lib/crm/dates";
import { fmtInt, fmtMoney, fmtNum, fmtPct } from "@/lib/crm/format";
import { Avatar, Chip, Drawer } from "@/components/ui/kit";
import { canEditPay } from "@/lib/crm/access";
import { Icon } from "@/components/ui/icons";
import { tierRange } from "@/components/app/RateGrids";
import { PayoutHistory } from "@/components/app/PayoutHistory";
import { PeriodPayslipModal } from "@/components/app/Payslip";

/**
 * Карточка сотрудника за период выплаты — как в зарплате за месяц: расчёт строками,
 * из каких дней по месяцам сложилась сумма, разбор по ступеням сетки, начисления периода
 * и история выплат.
 */

const ADJ_HUE: Record<AdjustmentType, string> = {
  accrual: "green", bonus: "green", compensation: "teal", correction: "indigo", deduction: "red", advance: "amber", payout: "amber",
};
const dm = (d: string) => fmtDate(d).slice(0, 5);
const wd = (d: string) => WEEKDAYS_SHORT[isoWeekday(d) - 1];

function Line({ label, formula, value, strong, neg }: { label: ReactNode; formula?: ReactNode; value: number; strong?: boolean; neg?: boolean }) {
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

export function PeriodDrawer({ row: r, period, start, onClose, onPay }: { row: PeriodRow; period: PayPeriod; start: DayKey; onClose: () => void; onPay: () => void }) {
  const { data, access, deleteAdjustment, confirm } = useCrm();
  const s = data.settings;
  const canEdit = canEditPay(access, r.op.id);
  const [slip, setSlip] = useState(false);
  const kpiSum = r.kpi.reduce((a, k) => a + k.amount, 0);
  const bonus = r.leadPay - kpiSum;
  const closed = r.segments.filter((g) => g.hours || g.leads || g.base || g.leadPay);
  const open = r.segments.filter((g) => g.openFrom);
  const shares = closed.filter((g) => g.salaryShare > 0).map((g) => `${fmtMonth(g.month).toLowerCase()} — ${fmtPct(g.salaryShare)}`);
  const baseFormula = isSvVolume(r.payType)
    ? `оклад ${fmtMoney(r.salary)} × доля рабочих дней месяца, отработанных по графику в периоде${shares.length ? `: ${shares.join(", ")}` : ""}`
    : isHourlyTiered(r.payType)
      ? "часы каждой смены × ставка её ступени"
      : isSalary(r.payType)
        ? `оклад ${fmtMoney(r.salary)} × доля за дни периода${shares.length ? `: ${shares.join(", ")}` : ""}`
        : `${fmtNum(r.hours)} ч × ${fmtMoney(r.hourlyRate)}`;

  return (
    <Drawer onClose={onClose}>
      <div className="row" style={{ gap: 12, padding: "18px 20px 14px", borderBottom: "1px solid var(--ink-06)" }}>
        <Avatar name={r.op.name} id={r.op.id} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{r.op.name}</div>
          <div style={{ fontSize: 12, color: "var(--dim)" }}>
            {dm(start)} – {dm(period.to)} · выплата {fmtDate(period.pay)} ({wd(period.pay)}) · {PAY_LABEL[r.payType]}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => setSlip(true)} title="Разбор начислений за период — PDF или картинкой, чтобы отдать сотруднику">
          <Icon name="doc" size={13} /> Расчётный лист
        </button>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" size={16} />
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="card card-pad" style={{ fontSize: 13 }}>
          <h3 className="card-title" style={{ marginBottom: 6 }}>
            <Icon name="calc" size={15} className="title-ic" />
            Расчёт за период
          </h3>
          <Line label={isSalary(r.payType) || isSvVolume(r.payType) ? "Оклад" : "Почасовая оплата"} formula={baseFormula} value={r.base} />
          {hasBonus(r.payType) && (
            <Line label="Бонус за переданные лиды" formula={isTiered(r.payType) ? `${fmtInt(r.leads)} лид. · по ступени каждой смены` : `${fmtInt(r.leads)} × ${fmtMoney(r.leadBonus)}`} value={bonus} />
          )}
          {r.kpi.map((k) => (
            <Line key={k.month} label={`KPI супервайзера за ${fmtMonth(k.month).toLowerCase()}`} formula="бонус за объём группы — за закрытый месяц" value={k.amount} />
          ))}
          {r.adj.accrual !== 0 && <Line label="Доп. начисления" value={r.adj.accrual} />}
          {r.adj.bonus !== 0 && <Line label="Премии" value={r.adj.bonus} />}
          {r.adj.compensation !== 0 && <Line label="Компенсации" value={r.adj.compensation} />}
          {r.adj.correction !== 0 && <Line label="Корректировки" value={r.adj.correction} />}
          <Line label="Начислено" value={r.gross} strong />
          <Line label={`Удержание ${s.withholdPct}%`} formula={`от ${fmtMoney(r.withholdBase)} (без компенсаций)`} value={r.withhold} neg />
          {r.deductions !== 0 && <Line label="Удержания" value={r.deductions} neg />}
          <Line label="К выплате за период" value={r.net} strong />
          {r.adj.advance !== 0 && <Line label="Аванс" value={r.adj.advance} neg />}
          {r.adj.payout !== 0 && <Line label="Выплачено" value={r.adj.payout} neg />}
          <div className="row" style={{ paddingTop: 10, fontSize: 15, fontWeight: 700, gap: 10 }}>
            <span style={{ flex: 1 }}>Остаток к выплате {dm(period.pay)}</span>
            <span className="num">{fmtMoney(r.toPay)}</span>
            {canEdit && r.toPay > 0.005 && (
              <button className="btn btn-sm btn-primary" onClick={onPay} title="Записать выплату на весь остаток периода">
                <Icon name="wallet" size={13} /> Выплатить
              </button>
            )}
          </div>
          {r.kpiPending && (
            <div style={{ marginTop: 10, fontSize: 12, color: "var(--dim)" }}>
              KPI за {fmtMonth(r.kpiPending).toLowerCase()} посчитается после закрытия месяца и придёт в выплату, в период которой попадёт 1-е число следующего месяца.
            </div>
          )}
        </div>

        <div className="card card-pad">
          <div className="card-head" style={{ marginBottom: 8 }}>
            <div>
              <h3 className="card-title">
                <Icon name="calendar" size={15} className="title-ic" />
                Из каких дней
              </h3>
              <p className="card-sub">Период по месяцам: в зарплату идут только закрытые дни — остальные добавятся, когда отработаны</p>
            </div>
          </div>
          <table className="tbl tbl-fit" style={{ background: "transparent" }}>
            <thead>
              <tr>
                <th>Дни</th>
                <th>Месяц</th>
                <th className="r">Часы</th>
                <th className="r">Лиды</th>
                <th className="r">База</th>
                <th className="r">Бонус</th>
              </tr>
            </thead>
            <tbody>
              {closed.map((g) => {
                const to = g.openFrom ? addDays(g.openFrom, -1) : g.to;
                return (
                  <tr key={g.month}>
                    <td className="num">
                      {dm(g.from)} – {dm(to)}
                    </td>
                    <td className="muted">{fmtMonth(g.month)}</td>
                    <td className="r num">{fmtNum(g.hours)}</td>
                    <td className="r num">{fmtInt(g.leads)}</td>
                    <td className="r num">{fmtMoney(g.base)}</td>
                    <td className="r num">{g.leadPay ? fmtMoney(g.leadPay) : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
              {open.map((g) => (
                <tr key={`o${g.month}`} style={{ color: "var(--dim)" }}>
                  <td className="num">
                    {dm(g.openFrom!)} – {dm(g.to)}
                  </td>
                  <td>{fmtMonth(g.month)}</td>
                  <td colSpan={4} className="r" style={{ fontSize: 12 }}>
                    дни ещё не закрыты — попадут в эту же выплату
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isTiered(r.payType) && r.tierUse.length > 0 && (
          <div className="card card-pad">
            <div className="card-head" style={{ marginBottom: 8 }}>
              <div>
                <h3 className="card-title">
                  <Icon name="rules" size={15} className="title-ic" />
                  Разбор по ступеням
                </h3>
                <p className="card-sub">Каждая смена периода оплачена по своей ступени — по числу лидов именно в тот день</p>
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
                {r.tierUse.map((u, i) => {
                  const ti = r.tiers.findIndex((t) => t.from === u.from);
                  return (
                    <tr key={`${u.from}|${u.hourlyRate}|${u.leadBonus}`}>
                      <td>{r.tiers.length ? tierRange(r.tiers, ti >= 0 ? ti : Math.min(i, r.tiers.length - 1)) : `от ${u.from}`}</td>
                      <td className="r num">{fmtInt(u.days)}</td>
                      <td className="r num">{fmtNum(u.hours)}</td>
                      <td className="r num">{fmtInt(u.leads)}</td>
                      {isHourlyTiered(r.payType) && <td className="r num">{fmtMoney(u.hourlyRate)}</td>}
                      <td className="r num">{fmtMoney(u.leadBonus)}</td>
                      <td className="r num" style={{ fontWeight: 600 }}>
                        {fmtMoney(u.sum)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="card card-pad">
          <div className="card-head" style={{ marginBottom: 8 }}>
            <div>
              <h3 className="card-title">
                <Icon name="wallet" size={15} className="title-ic" />
                Начисления и выплаты периода
              </h3>
              <p className="card-sub">Премии, удержания и аванс — по дате записи; выплата гасит период, закончившийся до неё. Добавить — кнопка «Начисление» вверху страницы.</p>
            </div>
          </div>
          {r.adjustments.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--dim)" }}>В этом периоде записей нет.</div>
          ) : (
            <table className="tbl">
              <tbody>
                {r.adjustments.map((a) => (
                  <tr key={a.id}>
                    <td className="num muted" style={{ width: 90 }}>
                      {fmtDate(a.date)}
                    </td>
                    <td>
                      <Chip hue={ADJ_HUE[a.type]}>{ADJ_LABEL[a.type]}</Chip>
                    </td>
                    <td className="muted" style={{ whiteSpace: "normal" }}>
                      {a.comment}
                    </td>
                    <td className="r num" style={{ fontWeight: 600 }}>
                      {fmtMoney(a.amount)}
                    </td>
                    <td className="r">
                      {canEdit && (
                        <button
                          className="btn btn-ghost btn-sm btn-icon"
                          title="Удалить"
                          onClick={async () => {
                            if (await confirm({ title: "Удалить запись?", text: `${ADJ_LABEL[a.type]} ${fmtMoney(a.amount)}`, ok: "Удалить", danger: true })) void deleteAdjustment(a.id);
                          }}
                        >
                          <Icon name="trash" size={13} />
                        </button>
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
              <h3 className="card-title">
                <Icon name="clock" size={15} className="title-ic" />
                История выплат
              </h3>
              <p className="card-sub">Все авансы и выплаты сотруднику, по всем месяцам</p>
            </div>
          </div>
          <PayoutHistory opId={r.op.id} compact />
        </div>
      </div>
      {slip && <PeriodPayslipModal row={r} period={period} start={start} onClose={() => setSlip(false)} />}
    </Drawer>
  );
}
