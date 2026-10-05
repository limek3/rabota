"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { probation } from "@/lib/crm/calc";
import { isHourlyTiered, isTiered, payrollRow, tierFor } from "@/lib/crm/payroll";
import { TierTable, tierRange } from "@/components/app/RateGrids";
import { NO_GROUP_LABEL, type RateTier } from "@/lib/crm/types";
import { fmtDay, fmtMonth, fmtWeekday, monthEnd, monthStart, nowHour } from "@/lib/crm/dates";
import { LEADS, fmtHours, fmtInt, fmtMoney, fmtNum, fmtPct, fmtPhone, fmtSigned, plural, safeDiv, surnameAndName } from "@/lib/crm/format";
import { Avatar, Chip, Empty, LeadLinkButton, LeadStatusChip, MonthSwitcher, PageHead } from "@/components/ui/kit";
import { LearnCard } from "@/components/learn/Progress";
import { Icon } from "@/components/ui/icons";
import { TelegramCard } from "@/components/app/TelegramCard";
import { PayoutHistory } from "@/components/app/PayoutHistory";
import { PayslipModal } from "@/components/app/Payslip";
import { StickyHead, planItems } from "@/components/app/StickyHead";

/**
 * «Мой кабинет» оператора (и супервайзера, который сам звонит) — про «сейчас» и деньги:
 * заработок, сегодняшняя смена и ступень, сегодняшние лиды, стажировка, обучение, выплаты.
 * Как идёт месяц подробно (план, графики, смены) — в «Моих показателях» (/stats).
 */
export default function MePage() {
  const { data, ix, access, me, month, setMonth, today, openLead, remote } = useCrm();
  const m = useMonthModel();
  const [slipOpen, setSlipOpen] = useState(false);
  const s = data.settings;
  const opId = access.opId;
  const row = useMemo(() => m.ops.find((r) => r.op.id === opId) ?? null, [m.ops, opId]);

  const myLeadsToday = useMemo(
    () =>
      data.leads
        .filter((l) => l.operatorId === opId && l.at.slice(0, 10) === today)
        .sort((a, b) => b.at.localeCompare(a.at)),
    [data.leads, opId, today],
  );

  const pay = useMemo(() => {
    if (!row || !access.can.viewPayroll) return null;
    const adj = data.adjustments.filter((a) => a.month === month && a.operatorId === row.op.id);
    return payrollRow(row.op, m.cal, data, ix, adj);
  }, [row, access.can.viewPayroll, data, month, m.cal, ix]);

  // прогноз заработка к концу месяца по текущему темпу и графику
  const payForecast = useMemo(() => {
    if (!pay || !row || m.cal.phase !== "current") return null;
    const leftDays = row.pace.remainingW;
    const hours = pay.hours + leftDays * s.dayHours;
    const leads = Math.round(row.pace.rr);
    // по сетке прогноз считаем по ступени текущего дневного темпа
    const perDay = row.pace.avgPerDay;
    const tier = isTiered(pay.payType) ? tierFor(pay.tiers, Math.round(perDay)) : null;
    const rate = tier && isHourlyTiered(pay.payType) ? tier.hourlyRate : pay.hourlyRate;
    const bonusRate = tier ? tier.leadBonus : pay.leadBonus;
    const base = pay.payType.startsWith("salary")
      ? s.prorateSalary && pay.normHours > 0
        ? pay.salary * Math.min(1, hours / pay.normHours)
        : pay.salary
      : pay.base + leftDays * s.dayHours * rate;
    const bonus = pay.payType.endsWith("bonus") || isTiered(pay.payType) ? pay.leadPay + Math.max(0, leads - pay.leads) * bonusRate : 0;
    return base + bonus + pay.adj.accrual + pay.adj.bonus + pay.adj.compensation + pay.adj.correction - pay.withhold - pay.deductions;
  }, [pay, row, m.cal.phase, s]);

  // ступень сегодняшней смены: ставка и бонус зависят от числа лидов именно сегодня
  const tierToday = useMemo(() => {
    if (!row || !isTiered(row.terms.payType) || !row.terms.tiers.length) return null;
    const tiers = row.terms.tiers;
    const leads = row.pace.today;
    const cur = tierFor(tiers, leads);
    const next = tiers.find((t) => t.from > leads) ?? null;
    // прикидка за текущую смену — по часам из графика: в часы и зарплату смена попадёт после закрытия дня
    const hoursToday = ix.plannedOpDay.get(row.op.id)?.get(m.cal.ref) ?? 0;
    return {
      tiers,
      cur,
      next,
      leads,
      need: next ? next.from - leads : 0,
      earnedToday: (isHourlyTiered(row.terms.payType) ? hoursToday * cur.hourlyRate : 0) + leads * cur.leadBonus,
      withHourly: isHourlyTiered(row.terms.payType),
    };
  }, [row, ix, m.cal.ref]);


  if (!opId) {
    return (
      <div className="card">
        <Empty icon="user" title="Аккаунт не привязан к карточке оператора" text="Попросите руководителя связать ваш аккаунт с карточкой сотрудника — тогда здесь появятся ваши показатели." />
      </div>
    );
  }
  if (!row) {
    return (
      <div className="stack">
        <PageHead title={me.name} sub={`${fmtMonth(month)} · данных за этот месяц нет`} actions={<MonthSwitcher value={month} onChange={setMonth} />} />
        <div className="card">
          <Empty icon="calendar" title="В этом месяце вы не работали" text="Выберите другой месяц." />
        </div>
      </div>
    );
  }

  const p = row.pace;
  const prob = probation(row.op, ix, data.settings);
  const dayPlan = p.dailyPlan;
  const doneToday = p.today;
  const leftToday = Math.max(0, Math.ceil(dayPlan - doneToday));
  const hour = nowHour();
  const greet = hour < 6 ? "Доброй ночи" : hour < 12 ? "Доброе утро" : hour < 18 ? "Добрый день" : "Добрый вечер";
  const group = row.op.groupId ? ix.groupById.get(row.op.groupId) : null;
  const cur = m.cal.phase === "current";
  const workToday = m.cal.isWork(today);
  const nextLead = pay && (pay.payType.endsWith("bonus") || isTiered(pay.payType)) ? (tierToday ? tierFor(tierToday.tiers, tierToday.leads + 1).leadBonus : pay.leadBonus) : null;
  const extras = pay ? pay.adj.bonus + pay.adj.accrual + pay.adj.compensation + pay.adj.correction : 0;
  return (
    <div className="stack">
      <StickyHead
        title={surnameAndName(me.name) || me.name}
        ctx={fmtMonth(month)}
        items={[
          ...(pay ? [{ l: "Заработок", v: fmtMoney(pay.net) }] : []),
          ...planItems(p, row.lph, data.settings.convNormPct / 100),
          ...(dayPlan > 0 && cur ? [{ l: "Сегодня", v: `${fmtInt(doneToday)} из ${fmtInt(Math.ceil(dayPlan))}`, tone: doneToday >= dayPlan ? ("green" as const) : undefined }] : []),
        ]}
      />
      <PageHead
        title={`${greet}, ${surnameAndName(me.name) || me.name}`}
        sub={`${fmtDay(today)}, ${fmtWeekday(today)} · ${group ? group.name : NO_GROUP_LABEL} · ${fmtMonth(month)}`}
        actions={
          <>
            <MonthSwitcher value={month} onChange={setMonth} />
            {access.can.createLeads && (
              <button className="btn btn-primary btn-lg" onClick={() => openLead()}>
                <Icon name="plus" size={16} stroke={2.2} /> Лид передан
                <span className="kbd">N</span>
              </button>
            )}
          </>
        }
      />

      <div className="d2">
        {/* ── мой заработок: главный блок, наверху ─────────────────── */}
        {pay && (
          <section className="card me-money">
            <div className="me-money-top">
              <div>
                <div className="d2-fact-l">
                  <Icon name="coin" size={13} className="mi" />
                  Мой заработок · {fmtMonth(month).toLowerCase()}
                  {m.cal.phase === "past" ? "" : " · предварительно"}
                </div>
                <div className="me-money-n num">{fmtMoney(pay.net)}</div>
                <div className="me-money-s">
                  к выплате <b className={pay.toPay < -0.005 ? "d2-red" : undefined}>{fmtMoney(pay.toPay)}</b>
                  {pay.paid > 0 && <> · выплачено {fmtMoney(pay.paid)}</>}
                </div>
              </div>
              {cur && (
                <div className="me-money-today">
                  <div className="d2-fact-l">
                    <Icon name="bolt" size={13} className="mi" />
                    Заработано сегодня
                  </div>
                  <div className="me-money-t num">{tierToday ? fmtMoney(tierToday.earnedToday) : `${fmtInt(doneToday)} ${plural(doneToday, LEADS)}`}</div>
                  <div className="me-money-s">
                    {nextLead != null && (
                      <>
                        следующий лид <b className="d2-green">+{fmtMoney(nextLead)}</b>
                      </>
                    )}
                    {tierToday?.next && (
                      <>
                        <br />
                        ещё {fmtInt(tierToday.need)} {plural(tierToday.need, LEADS)} — ступень {fmtInt(tierToday.next.leadBonus)} ₽ за лид
                      </>
                    )}
                  </div>
                </div>
              )}
              <div className="me-money-fc">
                {payForecast != null ? (
                  <>
                    <div className="d2-fact-l">
                      <Icon name="trend" size={13} className="mi" />
                      Прогноз к концу месяца
                    </div>
                    <div className="me-money-t num">≈ {fmtMoney(payForecast)}</div>
                    <div className="me-money-bar" title={`Заработано ${fmtPct(safeDiv(pay.net, payForecast))} от прогноза`}>
                      <i style={{ width: `${Math.min(100, safeDiv(pay.net, payForecast) * 100)}%` }} />
                    </div>
                    <div className="me-money-s">при текущем темпе и полном графике</div>
                  </>
                ) : (
                  <div className="me-money-s">Прогноз считается только для текущего месяца</div>
                )}
                <button type="button" className="btn btn-sm" onClick={() => setSlipOpen(true)} title="Разбор начислений за месяц — PDF или картинкой">
                  <Icon name="doc" size={13} /> Расчётный лист
                </button>
              </div>
            </div>
            <div className="me-money-parts">
              <span>
                {pay.payType.startsWith("salary") ? "Оклад" : isHourlyTiered(pay.payType) ? `Часы по ступеням · ${fmtNum(pay.hours)} ч` : `Часы × ставка · ${fmtNum(pay.hours)} ч`}
                <b>{fmtMoney(pay.base)}</b>
              </span>
              {(pay.payType.endsWith("bonus") || isTiered(pay.payType)) && (
                <span>
                  Бонус за лиды · {fmtInt(pay.leads)}
                  <b>{fmtMoney(pay.leadPay)}</b>
                </span>
              )}
              {extras !== 0 && (
                <span>
                  Премии и доплаты
                  <b>{fmtMoney(extras)}</b>
                </span>
              )}
              {pay.withhold + pay.deductions > 0 && (
                <span>
                  Удержано
                  <b className="d2-red">− {fmtMoney(pay.withhold + pay.deductions)}</b>
                </span>
              )}
              {pay.paid > 0 && (
                <span>
                  Выплачено
                  <b>− {fmtMoney(pay.paid)}</b>
                </span>
              )}
              <span className="tot">
                Остаток
                <b className={pay.toPay < -0.005 ? "d2-red" : undefined} title={pay.toPay < -0.005 ? "Выплачено больше, чем начислено: аванс закроется следующими начислениями" : undefined}>
                  {fmtMoney(pay.toPay)}
                </b>
              </span>
            </div>
          </section>
        )}

        {/* ── сегодня: сколько передал к дневной цели и ставка смены ─── */}
        {cur && (
          <section className="card d2-pp">
            <div className="d2-pp-h" style={{ justifyContent: "space-between" }}>
              <h3 className="d2-h">
                <Icon name="bolt" size={15} className="title-ic" />
                Сегодня
              </h3>
              {workToday ? (
                leftToday > 0 ? (
                  <span className="d2-tasks" data-hue="amber">до дневной цели {fmtInt(leftToday)} {plural(leftToday, LEADS)}</span>
                ) : (
                  <span className="d2-tasks" data-ok="true" style={{ color: "var(--c-green-fg)" }}>дневная цель выполнена</span>
                )
              ) : (
                <span className="d2-tasks" data-ok="true">выходной по графику</span>
              )}
            </div>
            <div className="me-today">
              <div className="me-today-n">
                <span className="num">{fmtInt(doneToday)}</span>
                <small>
                  {plural(doneToday, LEADS)} передано{workToday && dayPlan > 0 ? ` · цель ${fmtNum(dayPlan)}` : ""}
                </small>
              </div>
              {workToday && dayPlan > 0 && (
                <div className="me-money-bar">
                  <i style={{ width: `${Math.min(100, safeDiv(doneToday, dayPlan) * 100)}%` }} />
                </div>
              )}
              <div className="me-money-s">
                вчера {fmtInt(p.yesterday)} · на этой неделе {fmtInt(p.thisWeek)}
                {myLeadsToday[0] ? ` · последний лид в ${myLeadsToday[0].at.slice(11, 16)}` : ""}
              </div>
            </div>
            {tierToday && (
              <div className="me-tier">
                <div style={{ minWidth: 0 }}>
                  <div className="d2-strip me-strip" style={{ "--n": tierToday.withHourly ? 3 : 2 } as CSSProperties}>
                    {tierToday.withHourly && <StripKpi l="Ставка сейчас" v={`${fmtInt(tierToday.cur.hourlyRate)} ₽/ч`} u={tierRange(tierToday.tiers, tierToday.tiers.indexOf(tierToday.cur))} />}
                    <StripKpi l="Бонус за лид сейчас" v={`${fmtInt(tierToday.cur.leadBonus)} ₽`} u={`сегодня ${fmtInt(tierToday.leads)} ${plural(tierToday.leads, LEADS)}`} />
                    {tierToday.next ? (
                      <StripKpi
                        l="До следующей ступени"
                        v={`${fmtInt(tierToday.need)} ${plural(tierToday.need, LEADS)}`}
                        tone="green"
                        u={`станет ${tierToday.withHourly ? `${fmtInt(tierToday.next.hourlyRate)} ₽/ч и ` : ""}${fmtInt(tierToday.next.leadBonus)} ₽ за лид`}
                      />
                    ) : (
                      <StripKpi l="Ступень" v="Максимальная" tone="green" u="выше уже некуда" />
                    )}
                  </div>
                  <div style={{ padding: "14px 4px 2px" }}>
                    <TierLadder tiers={tierToday.tiers} leads={tierToday.leads} withHourly={tierToday.withHourly} />
                  </div>
                </div>
                <TierTable tiers={tierToday.tiers} highlight={tierToday.cur.from} withHourly={tierToday.withHourly} />
              </div>
            )}
          </section>
        )}

        {/* ── мой месяц коротко; подробно — в «Моих показателях» ──────── */}
        <Link href="/stats" className="card me-month" title="Открыть «Мои показатели»">
          <div className="d2-strip" style={{ "--n": 5 } as CSSProperties}>
            <StripKpi l="Факт за месяц" v={`${fmtInt(p.fact)} из ${fmtInt(row.terms.plan)}`} u={row.terms.plan > 0 ? `${fmtPct(p.pct)} плана` : "план не задан"} />
            <StripKpi l="К плану на сегодня" v={fmtSigned(Math.round(p.deviation))} u={`должно быть ${fmtNum(p.planToDate, 0)}`} tone={row.terms.plan > 0 ? (p.deviation < -0.5 ? "red" : "green") : undefined} />
            <StripKpi l="Нужно в день" v={p.needPerDay == null ? "—" : fmtNum(p.needPerDay)} u={p.needPerDay == null ? "месяц закрыт" : "чтобы закрыть план"} />
            <StripKpi l="Прогноз" v={p.elapsedW > 0 ? fmtInt(Math.round(p.rr)) : "—"} u={row.terms.plan > 0 && p.elapsedW > 0 ? `${fmtPct(p.rrPct)} плана` : "по темпу"} tone={row.terms.plan > 0 && p.elapsedW > 0 ? (p.rrPct >= 1 ? "green" : "red") : undefined} />
            <StripKpi l="Конверсия" v={row.lph == null ? "—" : fmtPct(row.lph)} u={`${fmtNum(row.hours, 0)} ч за месяц`} tone={row.lph == null || s.convNormPct <= 0 ? undefined : row.lph >= s.convNormPct / 100 ? "green" : "red"} />
          </div>
          <span className="me-month-go">
            Мои показатели <Icon name="arrowR" size={13} />
          </span>
        </Link>

        {/* ── стажировка ──────────────────────────────────────────────── */}
        {prob.active && !prob.done && (
          <section className="card d2-pp">
            <div className="d2-pp-h">
              <h3 className="d2-h">
                <Icon name="cap" size={15} className="title-ic" />
                Стажировка · {fmtPct(prob.pct)}
              </h3>
              <span className="d2-pp-sub">
                закрывается по {fmtInt(prob.needLeads)} переданным лидам за {fmtHours(prob.needHours)} работы; оплата всё это время — по обычной сетке
              </span>
            </div>
            <div className="me-money-bar" style={{ margin: "12px 0 4px" }}>
              <i style={{ width: `${Math.min(100, prob.pct * 100)}%` }} />
            </div>
            <div className="d2-strip me-strip" style={{ "--n": 3 } as CSSProperties}>
              <StripKpi l="Передано лидов" v={`${fmtInt(prob.leads)} из ${fmtInt(prob.needLeads)}`} u={prob.leads >= prob.needLeads ? "норма набрана" : `осталось ${fmtInt(prob.needLeads - prob.leads)}`} tone={prob.leads >= prob.needLeads ? "green" : undefined} />
              <StripKpi l="Отработано часов" v={`${fmtNum(prob.hours, 0)} из ${fmtNum(prob.needHours, 0)}`} u={prob.hours >= prob.needHours ? "часы набраны" : `осталось ${fmtNum(prob.needHours - prob.hours, 0)} ч`} tone={prob.hours >= prob.needHours ? "green" : undefined} />
              <StripKpi
                l="Эффективность"
                v={prob.hours > 0 ? fmtPct(prob.leads / prob.hours) : "—"}
                u="лиды ÷ часы, норма 60%"
                tone={prob.hours > 0 ? (prob.leads / prob.hours >= 0.6 ? "green" : "red") : undefined}
              />
            </div>
          </section>
        )}

        {remote && <TelegramCard compact />}

        <div className="cols-main">
          <div className="stack">
            <section className="card d2-pp" style={{ padding: 0, overflow: "hidden" }}>
              <div className="d2-pp-h" style={{ padding: "12px 14px", justifyContent: "space-between" }}>
                <h3 className="d2-h">
                  <Icon name="leads" size={15} className="title-ic" />
                  Сегодняшние лиды<small>{myLeadsToday.length ? `передано ${myLeadsToday.length}` : "пока ни одного"}</small>
                </h3>
                <Link className="btn btn-sm btn-ghost" href={`/leads?op=${encodeURIComponent(opId)}&from=${monthStart(month)}&to=${monthEnd(month)}`}>
                  Все мои лиды <Icon name="chevR" size={13} />
                </Link>
              </div>
              {myLeadsToday.length === 0 ? (
                <Empty
                  icon="phone"
                  title="Ни одного лида сегодня"
                  text={access.can.createLeads ? "Передали лид менеджеру — запишите его сразу, чтобы не потерять." : undefined}
                  action={
                    access.can.createLeads ? (
                      <button className="btn btn-primary" onClick={() => openLead()}>
                        <Icon name="plus" size={14} /> Лид передан
                      </button>
                    ) : undefined
                  }
                />
              ) : (
                <table className="d2-tbl" style={{ marginBottom: 8 }}>
                  <tbody>
                    {myLeadsToday.map((l) => (
                      <tr key={l.id} onClick={() => openLead(l)}>
                        <td className="d2-dim" style={{ width: 60 }}>
                          {l.at.slice(11, 16)}
                        </td>
                        <td style={{ width: 1 }}>
                          <LeadStatusChip lead={l} />
                        </td>
                        <td>{l.client || <span className="d2-dim">без имени</span>}</td>
                        <td>{fmtPhone(l.phone)}</td>
                        <td style={{ width: 1 }}>
                          <LeadLinkButton link={l.link} />
                        </td>
                        <td>{l.projectId ? <Chip hue={ix.projectById.get(l.projectId)?.color ?? "gray"}>{ix.projectById.get(l.projectId)?.name}</Chip> : <span className="d2-dim">—</span>}</td>
                        <td className="d2-dim" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {l.comment || ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          <div className="stack">
            <LearnCard />

            {pay && (
              <section className="card d2-pp">
                <div className="d2-pp-h">
                  <h3 className="d2-h">
                    <Icon name="wallet" size={15} className="title-ic" />
                    Мои выплаты
                  </h3>
                  <span className="d2-pp-sub">авансы и выплаты по всем месяцам</span>
                </div>
                <div style={{ marginTop: 8 }}>
                  <PayoutHistory opId={pay.op.id} compact />
                </div>
              </section>
            )}

            <section className="card d2-pp me-prof">
              <Avatar name={me.name} id={me.id} size={34} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--text)" }}>{me.name}</div>
                <div className="d2-dim" style={{ fontSize: 12 }}>{me.login || "логин не задан"}</div>
                <div style={{ marginTop: 6 }}>
                  Тема, стартовая страница и проект по умолчанию — в{" "}
                  <Link href="/settings?tab=profile" style={{ color: "var(--text)", textDecoration: "underline" }}>
                    профиле
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
      {slipOpen && pay && <PayslipModal row={pay} cal={m.cal} onClose={() => setSlipOpen(false)} />}
    </div>
  );
}

/** Показатель в полосе — как в «Сводке»: подпись, число, пояснение. */
function StripKpi({ l, v, u, tone }: { l: string; v: ReactNode; u?: string; tone?: "red" | "green" }) {
  return (
    <div className="d2-kpi">
      <div className="d2-kpi-l">{l}</div>
      <div className={`d2-kpi-v${tone === "red" ? " d2-red" : tone === "green" ? " d2-green" : ""}`}>{v}</div>
      {u && <div className="d2-kpi-u">{u}</div>}
    </div>
  );
}

/**
 * Лестница ступеней сегодняшней смены: сегмент на ступень, заполнено — пройдено,
 * текущая ступень заполнена пропорционально пути до следующей.
 */
function TierLadder({ tiers, leads, withHourly }: { tiers: RateTier[]; leads: number; withHourly: boolean }) {
  return (
    <div className="tier-ladder">
      {tiers.map((t, i) => {
        const next = tiers[i + 1]?.from;
        // путь к порогу следующей ступени: 0–5 при 3 лидах — половина, на 6-м лиде сегмент полон
        const fill = leads < t.from ? 0 : next == null ? 1 : Math.min(1, (leads - t.from) / (next - t.from));
        const cur = leads >= t.from && (next == null || leads < next);
        const range = next == null ? `${t.from}+` : next - t.from === 1 ? `${t.from}` : `${t.from}–${next - 1}`;
        return (
          <div key={t.from} className={cur ? "tier-step on" : "tier-step"}>
            <div className="tier-bar">
              <span style={{ width: `${Math.round(fill * 100)}%` }} />
            </div>
            <div className="tier-step-range">{range} {plural(next == null ? t.from : next - 1, LEADS)}</div>
            <div className="tier-step-rate num">
              {withHourly ? `${fmtInt(t.hourlyRate)} ₽/ч · ` : ""}
              {fmtInt(t.leadBonus)} ₽
            </div>
          </div>
        );
      })}
    </div>
  );
}
