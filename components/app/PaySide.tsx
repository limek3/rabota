"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useCrm } from "@/lib/crm/store";
import { monthCal } from "@/lib/crm/calc";
import type { PayPeriod, PeriodRow } from "@/lib/crm/payperiod";
import { TAX_PCT, hasBonus, isHourlyTiered, isSalary, isSvVolume, isTiered, type PayRow } from "@/lib/crm/payroll";
import { ADJ_LABEL, GRADE_LABEL, NO_GROUP_LABEL, PAY_LABEL, TRACK_LABEL, type Adjustment, type AdjustmentType, type DayKey } from "@/lib/crm/types";
import { WEEKDAYS_SHORT, addDays, fmtDate, fmtMonth, isoWeekday } from "@/lib/crm/dates";
import { PAYOUTS, fmtInt, fmtMoney, fmtNum, fmtPct, plural } from "@/lib/crm/format";
import { canEditPay } from "@/lib/crm/access";
import { Avatar } from "@/components/ui/kit";
import { Icon, type IconName } from "@/components/ui/icons";
import { TaxSum } from "@/components/app/TaxSum";
import { usePayouts } from "@/components/app/PayoutHistory";
import { PayslipModal, PeriodPayslipModal } from "@/components/app/Payslip";

/**
 * Закреплённая панель сотрудника на странице «Зарплата» (стиль «Операторов»): сколько осталось
 * выплатить и кнопка «Выплатить», расчёт строками, начисления, история выплат. Полный расчёт
 * (условия месяца, ступени сетки) — в выезжающей карточке, кнопка «Подробный расчёт».
 */

export const ADJ_HUE: Record<AdjustmentType, string> = {
  accrual: "green", bonus: "green", compensation: "teal", correction: "indigo", deduction: "red", advance: "amber", payout: "amber",
};
const dm = (d: string) => fmtDate(d).slice(0, 5);
const wd = (d: string) => WEEKDAYS_SHORT[isoWeekday(d) - 1];

/* ── мелкие части ──────────────────────────────────────────────────── */

/** Строка расчёта: «+» начисления, «−» удержания и выплаты, «=» итоги. */
function Calc({ label, formula, value, kind = "plus" }: { label: ReactNode; formula?: ReactNode; value: number; kind?: "plus" | "minus" | "total" }) {
  return (
    <div className={`ps-line ${kind}`}>
      <span className="k">
        {label}
        {formula && <small>{formula}</small>}
      </span>
      <span className="v num">
        {kind === "minus" && value ? "−" : ""}
        {fmtMoney(Math.abs(value))}
      </span>
    </div>
  );
}

function Box({ icon, title, right, children }: { icon: IconName; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="o2-box">
      <div className="o2-box-h">
        <b>
          <Icon name={icon} size={13} className="mi" />
          {title}
        </b>
        {right}
      </div>
      {children}
    </div>
  );
}

/** Шапка панели: сотрудник, группа и схема, статус выплаты. */
function SideHead({ r, onOpen, onClose }: { r: PayRow; onOpen: () => void; onClose: () => void }) {
  const { ix } = useCrm();
  const g = r.op.groupId ? ix.groupById.get(r.op.groupId) : null;
  const st =
    r.toPay < -0.005
      ? { hue: "red", label: "Переплата" }
      : r.toPay > 0.005
        ? { hue: "amber", label: "Ждёт выплаты" }
        : r.net > 0
          ? { hue: "green", label: "Выплачено" }
          : { hue: "gray", label: "Нет начислений" };
  return (
    <div className="o2-side-h">
      <Avatar name={r.op.name} id={r.op.id} size={44} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="o2-nm-row">
          <button className="nm" onClick={onOpen} title="Подробный расчёт">
            {r.op.name}
          </button>
        </div>
        <div className="gr">
          {g ? g.name : NO_GROUP_LABEL} · {PAY_LABEL[r.payType]}
        </div>
        <span className="o2-st" data-hue={st.hue} style={{ marginTop: 8 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
          {st.label}
        </span>
      </div>
      <button className="x" onClick={onClose} aria-label="Закрыть">
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

/** Главное: остаток к выплате, сколько уже выплачено, сумма к переводу с налогом, «Выплатить». */
function Hero({ r, label, canPay, onPay }: { r: PayRow; label: string; canPay: boolean; onPay: () => void }) {
  const share = r.net > 0 ? Math.max(0, Math.min(1, r.paid / r.net)) : 0;
  return (
    <div className="ps-hero">
      <div className="l">{label}</div>
      <div className={`v num${r.toPay < -0.005 ? " o2-r" : ""}`}>{fmtMoney(r.toPay)}</div>
      <div className="t">
        <b style={{ width: `${share * 100}%` }} />
      </div>
      <div className="s">
        выплачено <b className="num">{fmtMoney(r.paid)}</b> из <b className="num">{fmtMoney(r.net)}</b>
      </div>
      {r.toPay > 0.005 && (
        <div className="tax">
          <span>С налогом +{TAX_PCT}% — к переводу</span>
          <TaxSum value={r.toPay} />
        </div>
      )}
      {canPay && r.toPay > 0.005 && (
        <button className="o2-btn pri ps-pay" onClick={onPay} title="Записать выплату на весь остаток">
          <Icon name="wallet" size={14} /> Выплатить {fmtMoney(r.toPay)}
        </button>
      )}
    </div>
  );
}

/** Записи начислений и выплат: изменить, удалить, добавить. */
function AdjBox({ title, list, canEdit, onAdj, empty }: { title: string; list: Adjustment[]; canEdit: boolean; onAdj?: (a?: Adjustment) => void; empty: string }) {
  const { deleteAdjustment, confirm } = useCrm();
  return (
    <Box
      icon="wallet"
      title={title}
      right={
        canEdit && onAdj ? (
          <button className="o2-link" style={{ textDecoration: "none" }} onClick={() => onAdj()}>
            <Icon name="plus" size={12} /> Добавить
          </button>
        ) : undefined
      }
    >
      {list.length === 0 ? (
        <div className="ps-empty">{empty}</div>
      ) : (
        <div className="ps-list">
          {list.map((a) => (
            <div key={a.id} className="ps-it">
              <span className="d num">{dm(a.date)}</span>
              <span className="ps-chip" data-hue={ADJ_HUE[a.type]}>
                {ADJ_LABEL[a.type]}
              </span>
              <span className="c" title={a.comment || undefined}>
                {a.comment || ""}
              </span>
              <b className="num">{fmtMoney(a.amount)}</b>
              {canEdit && (
                <span className="acts">
                  {onAdj && (
                    <button className="o2-kebab" style={{ width: 22, height: 22 }} title="Изменить" onClick={() => onAdj(a)}>
                      <Icon name="edit" size={12} />
                    </button>
                  )}
                  <button
                    className="o2-kebab"
                    style={{ width: 22, height: 22 }}
                    title="Удалить"
                    onClick={async () => {
                      if (await confirm({ title: "Удалить запись?", text: `${ADJ_LABEL[a.type]} ${fmtMoney(a.amount)}`, ok: "Удалить", danger: true })) void deleteAdjustment(a.id);
                    }}
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </Box>
  );
}

/** История выплат сотрудника: последние пять, всего — в подписи. */
function HistoryBox({ opId }: { opId: string }) {
  const list = usePayouts(opId);
  const [all, setAll] = useState(false);
  const total = useMemo(() => list.reduce((s, a) => s + a.amount, 0), [list]);
  const shown = all ? list : list.slice(0, 5);
  return (
    <Box
      icon="clock"
      title="История выплат"
      right={
        list.length > 0 ? (
          <span className="o2-muted num" style={{ fontSize: 11.5 }}>
            {fmtMoney(total)} · {fmtInt(list.length)} {plural(list.length, PAYOUTS)}
          </span>
        ) : undefined
      }
    >
      {list.length === 0 ? (
        <div className="ps-empty">Выплат пока не было.</div>
      ) : (
        <div className="ps-list">
          {shown.map((a) => (
            <div key={a.id} className="ps-it">
              <span className="d num">{fmtDate(a.date)}</span>
              <span className="ps-chip" data-hue={a.type === "advance" ? "amber" : "green"}>
                {ADJ_LABEL[a.type]}
              </span>
              <span className="c">за {fmtMonth(a.month).toLowerCase()}</span>
              <b className="num">{fmtMoney(a.amount)}</b>
            </div>
          ))}
          {list.length > 5 && (
            <button className="o2-link" style={{ alignSelf: "flex-start", marginTop: 4 }} onClick={() => setAll((v) => !v)}>
              {all ? "Свернуть" : `Показать все · ${fmtInt(list.length)}`}
            </button>
          )}
        </div>
      )}
    </Box>
  );
}

function Actions({ onSlip, onOpen }: { onSlip: () => void; onOpen: () => void }) {
  return (
    <div className="ps-acts">
      <button className="o2-btn" onClick={onSlip} title="Разбор начислений — PDF или картинкой, чтобы отдать сотруднику">
        <Icon name="doc" size={14} /> Расчётный лист
      </button>
      <button className="o2-btn" onClick={onOpen} title="Все строки расчёта, ступени сетки и условия">
        <Icon name="external" size={14} /> Подробнее
      </button>
    </div>
  );
}

/* ── за период выплаты ─────────────────────────────────────────────── */

export function PeriodSide({
  r,
  period,
  start,
  onPay,
  onAdj,
  onOpen,
  onClose,
}: {
  r: PeriodRow;
  period: PayPeriod;
  start: DayKey;
  onPay: () => void;
  onAdj?: (a?: Adjustment) => void;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { data, access } = useCrm();
  const s = data.settings;
  const canEdit = canEditPay(access, r.op.id);
  const [slip, setSlip] = useState(false);
  const kpiSum = r.kpi.reduce((a, k) => a + k.amount, 0);
  const bonus = r.leadPay - kpiSum;
  const closed = r.segments.filter((g) => g.hours || g.leads || g.base || g.leadPay);
  const open = r.segments.filter((g) => g.openFrom);
  const baseFormula = isHourlyTiered(r.payType)
    ? "часы каждой смены × ставка её ступени"
    : isSalary(r.payType) || isSvVolume(r.payType)
      ? `оклад ${fmtMoney(r.salary)} × доля за дни периода`
      : `${fmtNum(r.hours)} ч × ${fmtMoney(r.hourlyRate)}`;

  return (
    <aside className="card o2-side ps-side">
      <SideHead r={r} onOpen={onOpen} onClose={onClose} />
      <Hero r={r} label={`Остаток к выплате · ${dm(period.pay)} (${wd(period.pay)})`} canPay={canEdit} onPay={onPay} />

      <Box icon="calc" title="Расчёт за период" right={<span className="o2-muted num" style={{ fontSize: 11.5 }}>{dm(start)} – {dm(period.to)}</span>}>
        <div className="ps-lines">
          <Calc label={isSalary(r.payType) || isSvVolume(r.payType) ? "Оклад" : "Почасовая оплата"} formula={baseFormula} value={r.base} />
          {hasBonus(r.payType) && <Calc label="Бонус за лиды" formula={isTiered(r.payType) ? `${fmtInt(r.leads)} лид. · по ступени смены` : `${fmtInt(r.leads)} × ${fmtMoney(r.leadBonus)}`} value={bonus} />}
          {r.kpi.map((k) => (
            <Calc key={k.month} label={`KPI за ${fmtMonth(k.month).toLowerCase()}`} formula="бонус за объём группы" value={k.amount} />
          ))}
          {r.adj.accrual !== 0 && <Calc label="Доп. начисления" value={r.adj.accrual} />}
          {r.adj.bonus !== 0 && <Calc label="Премии" value={r.adj.bonus} />}
          {r.adj.compensation !== 0 && <Calc label="Компенсации" value={r.adj.compensation} />}
          {r.adj.correction !== 0 && <Calc label="Корректировки" value={r.adj.correction} />}
          <Calc label="Начислено" value={r.gross} kind="total" />
          <Calc label={`Удержание ${s.withholdPct}%`} formula={`от ${fmtMoney(r.withholdBase)}, без компенсаций`} value={r.withhold} kind="minus" />
          {r.deductions !== 0 && <Calc label="Удержания" value={r.deductions} kind="minus" />}
          <Calc label="К выплате за период" value={r.net} kind="total" />
          {r.adj.advance !== 0 && <Calc label="Аванс" value={r.adj.advance} kind="minus" />}
          {r.adj.payout !== 0 && <Calc label="Выплачено" value={r.adj.payout} kind="minus" />}
        </div>
        {r.kpiPending && <div className="ps-note">KPI за {fmtMonth(r.kpiPending).toLowerCase()} придёт после закрытия месяца — в выплату, куда попадёт 1-е число следующего.</div>}
      </Box>

      <Box icon="calendar" title="Из каких дней">
        <div className="ps-list">
          {closed.map((g) => {
            const to = g.openFrom ? addDays(g.openFrom, -1) : g.to;
            return (
              <div key={g.month} className="ps-it">
                <span className="d num">
                  {dm(g.from)} – {dm(to)}
                </span>
                <span className="c">
                  {fmtNum(g.hours)} ч · {fmtInt(g.leads)} лид.
                </span>
                <b className="num">{fmtMoney(g.base + g.leadPay)}</b>
              </div>
            );
          })}
          {open.map((g) => (
            <div key={`o${g.month}`} className="ps-it dim">
              <span className="d num">
                {dm(g.openFrom!)} – {dm(g.to)}
              </span>
              <span className="c">дни ещё не закрыты — войдут в эту выплату</span>
            </div>
          ))}
          {closed.length === 0 && open.length === 0 && <div className="ps-empty">Смен и лидов в периоде нет.</div>}
        </div>
      </Box>

      <AdjBox title="Начисления периода" list={r.adjustments} canEdit={canEdit} onAdj={onAdj} empty="В этом периоде записей нет." />
      <HistoryBox opId={r.op.id} />
      <Actions onSlip={() => setSlip(true)} onOpen={onOpen} />
      {slip && <PeriodPayslipModal row={r} period={period} start={start} onClose={() => setSlip(false)} />}
    </aside>
  );
}

/* ── за месяц ──────────────────────────────────────────────────────── */

export function MonthSide({ r, onPay, onAdj, onOpen, onClose }: { r: PayRow; onPay: () => void; onAdj?: (a?: Adjustment) => void; onOpen: () => void; onClose: () => void }) {
  const { data, month, access, today } = useCrm();
  const s = data.settings;
  const canEdit = canEditPay(access, r.op.id);
  const [slip, setSlip] = useState(false);
  const baseFormula = isSvVolume(r.payType)
    ? `${fmtMoney(r.salary)} × ${fmtPct(r.salaryShare)} рабочих дней по графику`
    : isHourlyTiered(r.payType)
      ? "часы каждой смены × ставка её ступени"
      : isSalary(r.payType)
        ? s.prorateSalary
          ? `${fmtMoney(r.salary)} × ${fmtNum(r.hours)} ч / ${fmtNum(r.normHours)} ч`
          : "оклад полностью"
        : `${fmtNum(r.hours)} ч × ${fmtMoney(r.hourlyRate)}`;
  const sv = r.sv;

  return (
    <aside className="card o2-side ps-side">
      <SideHead r={r} onOpen={onOpen} onClose={onClose} />
      <Hero r={r} label={`Остаток к выплате · ${fmtMonth(month).toLowerCase()}`} canPay={canEdit} onPay={onPay} />

      <Box icon="calc" title="Расчёт за месяц" right={<span className="o2-muted" style={{ fontSize: 11.5 }}>{r.explicitTerms ? "условия зафиксированы" : "условия из карточки"}</span>}>
        <div className="ps-lines">
          <Calc label={isSalary(r.payType) ? "Оклад" : "Почасовая оплата"} formula={baseFormula} value={r.base} />
          {hasBonus(r.payType) && <Calc label="Бонус за лиды" formula={isTiered(r.payType) ? "по ступени каждой смены" : `${fmtInt(r.leads)} × ${fmtMoney(r.leadBonus)}`} value={r.leadPay} />}
          {sv && <Calc label="Бонус за объём группы" formula={sv.belowMin ? `${fmtInt(sv.leads)} лидов — меньше порога` : `ступень ${fmtInt(sv.step)} · апрув ×${String(sv.kApprove).replace(".", ",")}`} value={r.leadPay} />}
          {r.adj.accrual !== 0 && <Calc label="Доп. начисления" value={r.adj.accrual} />}
          {r.adj.bonus !== 0 && <Calc label="Премии" value={r.adj.bonus} />}
          {r.adj.compensation !== 0 && <Calc label="Компенсации" value={r.adj.compensation} />}
          {r.adj.correction !== 0 && <Calc label="Корректировки" value={r.adj.correction} />}
          <Calc label="Начислено" value={r.gross} kind="total" />
          <Calc label={`Удержание ${s.withholdPct}%`} formula={`от ${fmtMoney(r.withholdBase)}, без компенсаций`} value={r.withhold} kind="minus" />
          {r.deductions !== 0 && <Calc label="Удержания" value={r.deductions} kind="minus" />}
          <Calc label="К выплате всего" value={r.net} kind="total" />
          {r.adj.advance !== 0 && <Calc label="Аванс" value={r.adj.advance} kind="minus" />}
          {r.adj.payout !== 0 && <Calc label="Выплачено" value={r.adj.payout} kind="minus" />}
        </div>
      </Box>

      {sv && (
        <Box icon="userStar" title="Бонус за объём группы" right={<span className="o2-pill" data-hue={sv.bonus > 0 ? "green" : "red"}>{fmtMoney(sv.bonus)}</span>}>
          <div className="ps-grid">
            <div>
              <span>Лидов групп</span>
              <b className="num">{fmtInt(sv.leads)}</b>
            </div>
            <div>
              <span>Ступень</span>
              <b className="num">{sv.belowMin ? "нет" : fmtInt(sv.step)}</b>
            </div>
            <div>
              <span>Апрув</span>
              <b className="num">{fmtInt(sv.approvePct)}%</b>
            </div>
            <div>
              <span>Динамика</span>
              <b className={sv.kGrowth < 1 ? "o2-r" : "o2-g"}>{sv.growth ? "рост" : "без роста"}</b>
            </div>
          </div>
          <div className="ps-note">
            {GRADE_LABEL[sv.grade]} · {TRACK_LABEL[sv.track]}
            {sv.next ? ` · до ступени ${fmtInt(sv.next.from)} осталось ${fmtInt(sv.next.from - sv.leads)} лид.` : ""}
          </div>
        </Box>
      )}

      <AdjBox title="Начисления и выплаты" list={r.adjustments} canEdit={canEdit} onAdj={onAdj} empty="Корректировок нет." />
      <HistoryBox opId={r.op.id} />

      <Box icon="doc" title={`Условия на ${fmtMonth(month).toLowerCase()}`} right={canEdit ? <button className="o2-link" onClick={onOpen}>Изменить</button> : undefined}>
        <div className="o2-kv">
          <span>Схема</span>
          <b>{PAY_LABEL[r.payType]}</b>
          {isSalary(r.payType) ? (
            <>
              <span>Оклад</span>
              <b>{fmtMoney(r.salary)}</b>
            </>
          ) : (
            <>
              <span>Ставка</span>
              <b>{isHourlyTiered(r.payType) ? "по сетке" : `${fmtMoney(r.hourlyRate)}/ч`}</b>
            </>
          )}
          {hasBonus(r.payType) && (
            <>
              <span>Бонус за лид</span>
              <b>{isTiered(r.payType) ? "по сетке" : fmtMoney(r.leadBonus)}</b>
            </>
          )}
          <span>Часы / норма</span>
          <b>
            {fmtNum(r.hours)} / {fmtNum(r.normHours, 0)} ч
          </b>
        </div>
      </Box>

      <Actions onSlip={() => setSlip(true)} onOpen={onOpen} />
      {slip && <PayslipModal row={r} cal={monthCal(month, data.settings, today)} onClose={() => setSlip(false)} />}
    </aside>
  );
}
