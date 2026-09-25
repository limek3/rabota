"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { buildIndex, dailyRows, monthModel, probation, PACE_HUE } from "@/lib/crm/calc";
import { isHourlyTiered, isTiered, payrollRow, tierFor } from "@/lib/crm/payroll";
import { TierTable, tierRange } from "@/components/app/RateGrids";
import { NO_GROUP_LABEL, type RateTier } from "@/lib/crm/types";
import { addDays, fmtDay, fmtMonth, fmtWeekday, monthEnd, monthStart, nowHour } from "@/lib/crm/dates";
import { LEADS, fmtHours, fmtInt, fmtMoney, fmtNum, fmtPct, fmtPhone, fmtSigned, plural, safeDiv, surnameAndName } from "@/lib/crm/format";
import { Avatar, Chip, Conv, Empty, Kpi, LeadLinkButton, LeadStatusChip, MonthSwitcher, PageHead, Progress, StatusChip } from "@/components/ui/kit";
import { DailyBars } from "@/components/ui/charts";
import { LearnCard } from "@/components/learn/Progress";
import { Icon } from "@/components/ui/icons";
import { TelegramCard } from "@/components/app/TelegramCard";
import { PayoutHistory } from "@/components/app/PayoutHistory";
import { PayslipModal } from "@/components/app/Payslip";

/**
 * Личный кабинет оператора (и супервайзера, который сам звонит).
 * Только своё: сколько передал сегодня, как идёт месяц, часы и заработок.
 */
export default function MePage() {
  const { data, full, ix, access, me, month, setMonth, today, openLead, remote } = useCrm();
  const m = useMonthModel();
  const [slipOpen, setSlipOpen] = useState(false);
  const s = data.settings;
  const opId = access.opId;
  const row = useMemo(() => m.ops.find((r) => r.op.id === opId) ?? null, [m.ops, opId]);
  const O = s.access.operator;

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

  // прогресс группы — если РОП разрешил операторам его видеть
  const groupProgress = useMemo(() => {
    // в Supabase оператору приходят только его записи — прогресс группы из них не посчитать
    if (!row?.op.groupId || !(O.viewGroupProgress || O.viewTeamProgress) || access.isHead || (remote && access.isOp)) return null;
    const fm = monthModel(full, buildIndex(full), month, today);
    const g = fm.groups.find((x) => x.key === row.op.groupId) ?? null;
    return { group: g, team: O.viewTeamProgress ? fm.team : null, myShare: g ? safeDiv(row.pace.fact, g.pace.fact) : 0 };
  }, [row, O.viewGroupProgress, O.viewTeamProgress, access.isHead, access.isOp, remote, full, month, today]);

  // ступень сегодняшней смены: ставка и бонус зависят от числа лидов именно сегодня
  const tierToday = useMemo(() => {
    if (!row || !isTiered(row.terms.payType) || !row.terms.tiers.length) return null;
    const tiers = row.terms.tiers;
    const leads = row.pace.today;
    const cur = tierFor(tiers, leads);
    const next = tiers.find((t) => t.from > leads) ?? null;
    const hoursToday = row.hoursToday;
    return {
      tiers,
      cur,
      next,
      leads,
      need: next ? next.from - leads : 0,
      earnedToday: (isHourlyTiered(row.terms.payType) ? hoursToday * cur.hourlyRate : 0) + leads * cur.leadBonus,
      withHourly: isHourlyTiered(row.terms.payType),
    };
  }, [row]);

  const chart = useMemo(() => (row ? dailyRows(m.cal, row.terms.plan, ix.opDay.get(row.op.id), ix.hoursOpDay.get(row.op.id)) : []), [row, m.cal, ix]);

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

  return (
    <div className="stack">
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

      {/* сегодня */}
      <div className="card hero-grid">
        <div>
          <div style={{ fontSize: 12.5, color: "var(--text-sub)", marginBottom: 4 }}>Передано сегодня</div>
          <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 52, fontWeight: 600, letterSpacing: "-.03em", lineHeight: 1 }}>{fmtInt(doneToday)}</span>
            <span style={{ fontSize: 15, color: "var(--text-sub)" }}>дневная цель {fmtNum(dayPlan)}</span>
          </div>
          <Progress value={safeDiv(doneToday, dayPlan)} height={8} style={{ margin: "14px 0 10px" }} />
          {m.cal.isWork(today) ? (
            leftToday > 0 ? (
              <Chip hue="amber" dot>
                Осталось до дневной цели: {leftToday} {plural(leftToday, LEADS)}
              </Chip>
            ) : (
              <Chip hue="green" dot>
                Дневная цель выполнена
              </Chip>
            )
          ) : (
            <Chip hue="gray" dot>
              Сегодня выходной
            </Chip>
          )}
        </div>
        <div className="grid3" style={{ gap: 10 }}>
          <Tile label="Мой план на месяц" value={fmtInt(row.terms.plan)} sub={`факт ${fmtInt(p.fact)} · ${fmtPct(p.pct)}`} />
          <Tile label="Осталось до плана" value={fmtInt(p.remaining)} sub={p.needPerDay == null ? "месяц закрыт" : `по ${fmtNum(p.needPerDay)} в день`} />
          <Tile label="К плану на сегодня" value={fmtSigned(p.deviation)} tone={p.deviation >= 0 ? "good" : "bad"} sub={`должно быть ${fmtNum(p.planToDate, 0)}`} />
          <Tile label="Прогноз месяца" value={fmtInt(p.rr)} sub={`${fmtPct(p.rrPct)} плана`} />
          <Tile label="Мой темп" value={fmtNum(row.avgPerWorkday)} sub="лидов за смену" />
          <Tile label="Конверсия" value={<Conv value={row.lph} />} sub={`лиды ÷ ${fmtNum(row.hours, 0)} ч за месяц`} />
        </div>
      </div>

      {remote && <TelegramCard compact />}

      {prob.active && !prob.done && (
        <div className="card card-pad">
          <div className="card-head">
            <div>
              <h3 className="card-title">Стажировка</h3>
              <p className="card-sub">
                Закрывается по {fmtInt(prob.needLeads)} переданным лидам за {fmtHours(prob.needHours)} работы. Оплата всё это время — по обычной сетке
              </p>
            </div>
            <Chip hue={prob.pct >= 0.7 ? "green" : "amber"}>{fmtPct(prob.pct)}</Chip>
          </div>
          <Progress value={prob.pct} />
          <div className="grid3" style={{ gap: 10, marginTop: 12 }}>
            <Tile label="Передано лидов" value={`${fmtInt(prob.leads)} из ${fmtInt(prob.needLeads)}`} sub={prob.leads >= prob.needLeads ? "норма набрана" : `осталось ${fmtInt(prob.needLeads - prob.leads)}`} tone={prob.leads >= prob.needLeads ? "good" : undefined} />
            <Tile label="Отработано часов" value={`${fmtNum(prob.hours, 0)} из ${fmtNum(prob.needHours, 0)}`} sub={prob.hours >= prob.needHours ? "часы набраны" : `осталось ${fmtNum(prob.needHours - prob.hours, 0)} ч`} tone={prob.hours >= prob.needHours ? "good" : undefined} />
            <Tile
              label="Эффективность"
              value={prob.hours > 0 ? fmtPct(prob.leads / prob.hours) : "—"}
              sub="лиды ÷ часы, норма 60%"
              tone={prob.hours > 0 ? (prob.leads / prob.hours >= 0.6 ? "good" : "bad") : undefined}
            />
          </div>
        </div>
      )}

      <div className="kpi-grid">
        <Kpi label="Вчера" value={fmtInt(p.yesterday)} sub={`${fmtDay(addDays(today, -1))}, ${fmtWeekday(addDays(today, -1))}`} />
        <Kpi label="Эта неделя" value={fmtInt(p.thisWeek)} sub={`прошлая ${fmtInt(p.prevWeek)}`} />
        <Kpi label="Смен отработано" value={fmtInt(row.daysWorked)} sub={row.absentDays ? `отпуск/больничный: ${row.absentDays}` : undefined} />
        <Kpi label="Часы" value={fmtNum(row.hours, 0)} sub={`норма ${fmtNum(row.norm, 0)} ч`} />
        <Kpi label="Оценка темпа" value={<StatusChip status={row.status} />} sub={`порог «по плану» — ${s.normalPct}%`} />
      </div>

      {tierToday && (
        <div className="card card-pad">
          <div className="card-head">
            <div>
              <h3 className="card-title">Ставка этой смены</h3>
              <p className="card-sub">Ставка за час и бонус за лид зависят от того, сколько лидов вы передали сегодня</p>
            </div>
            {access.can.viewPayroll && <Chip hue="green" dot>За сегодня: {fmtMoney(tierToday.earnedToday)}</Chip>}
          </div>
          <div className="tier-shift">
            <div className="stack" style={{ gap: 14, minWidth: 0 }}>
              <div className="tier-tiles">
                {tierToday.withHourly && <Tile label="Ставка сейчас" value={`${fmtInt(tierToday.cur.hourlyRate)} ₽/ч`} sub={tierRange(tierToday.tiers, tierToday.tiers.indexOf(tierToday.cur))} />}
                <Tile label="Бонус за лид сейчас" value={`${fmtInt(tierToday.cur.leadBonus)} ₽`} sub={`сегодня ${fmtInt(tierToday.leads)} ${plural(tierToday.leads, LEADS)}`} />
                {tierToday.next ? (
                  <Tile
                    label="До следующей ступени"
                    value={`${fmtInt(tierToday.need)} ${plural(tierToday.need, LEADS)}`}
                    tone="good"
                    sub={`станет ${tierToday.withHourly ? `${fmtInt(tierToday.next.hourlyRate)} ₽/ч и ` : ""}${fmtInt(tierToday.next.leadBonus)} ₽ за лид`}
                  />
                ) : (
                  <Tile label="Ступень" value="Максимальная" tone="good" sub="выше уже некуда" />
                )}
              </div>
              <TierLadder tiers={tierToday.tiers} leads={tierToday.leads} withHourly={tierToday.withHourly} />
            </div>
            <TierTable tiers={tierToday.tiers} highlight={tierToday.cur.from} withHourly={tierToday.withHourly} />
          </div>
        </div>
      )}

      <div className="cols-main">
        <div className="stack">
          <div className="card card-pad">
            <div className="card-head">
              <div>
                <h3 className="card-title">Мои лиды по дням</h3>
                <p className="card-sub">Пунктир — дневная цель ({fmtNum(dayPlan)})</p>
              </div>
            </div>
            <DailyBars rows={chart} dailyPlan={dayPlan} height={220} />
          </div>

          <div className="card card-tbl" style={{ overflow: "hidden" }}>
            <div className="card-head" style={{ padding: "14px 18px 0" }}>
              <div>
                <h3 className="card-title">Сегодняшние лиды</h3>
                <p className="card-sub">{myLeadsToday.length ? `Передано ${myLeadsToday.length}` : "Пока ни одного"}</p>
              </div>
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
              <table className="tbl">
                <tbody>
                  {myLeadsToday.map((l) => (
                    <tr key={l.id} className="clickable" onClick={() => openLead(l)}>
                      <td className="num muted" style={{ width: 60 }}>
                        {l.at.slice(11, 16)}
                      </td>
                      <td style={{ width: 1 }}>
                        <LeadStatusChip lead={l} />
                      </td>
                      <td>{l.client || <span className="muted">без имени</span>}</td>
                      <td className="num">{fmtPhone(l.phone)}</td>
                      <td style={{ width: 1 }}>
                        <LeadLinkButton link={l.link} />
                      </td>
                      <td>{l.projectId ? <Chip hue={ix.projectById.get(l.projectId)?.color ?? "gray"}>{ix.projectById.get(l.projectId)?.name}</Chip> : <span className="muted">—</span>}</td>
                      <td className="muted" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {l.comment || ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="stack">
          {pay && (
            <div className="card card-pad">
              <div className="card-head">
                <div>
                  <h3 className="card-title">Мой заработок</h3>
                  <p className="card-sub">{fmtMonth(month)}{m.cal.phase === "past" ? "" : " · предварительно"}</p>
                </div>
                <button className="btn btn-sm" onClick={() => setSlipOpen(true)} title="Разбор начислений за месяц — PDF или картинкой">
                  <Icon name="doc" size={13} /> Расчётный лист
                </button>
              </div>
              <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.02em" }}>{fmtMoney(pay.net)}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12, fontSize: 13 }}>
                <Line
                  k={pay.payType.startsWith("salary") ? "Оклад" : isHourlyTiered(pay.payType) ? `Часы по ступеням (${fmtNum(pay.hours)} ч)` : `Часы × ставка (${fmtNum(pay.hours)} ч)`}
                  v={fmtMoney(pay.base)}
                />
                {(pay.payType.endsWith("bonus") || isTiered(pay.payType)) && (
                  <Line k={isTiered(pay.payType) ? `Бонус за лиды (${fmtInt(pay.leads)}, по ступеням)` : `Бонус за лиды (${fmtInt(pay.leads)} × ${fmtMoney(pay.leadBonus)})`} v={fmtMoney(pay.leadPay)} />
                )}
                {pay.adj.bonus + pay.adj.accrual + pay.adj.compensation + pay.adj.correction !== 0 && (
                  <Line k="Премии и доплаты" v={fmtMoney(pay.adj.bonus + pay.adj.accrual + pay.adj.compensation + pay.adj.correction)} />
                )}
                {pay.withhold + pay.deductions > 0 && <Line k="Удержано" v={`− ${fmtMoney(pay.withhold + pay.deductions)}`} />}
                {pay.paid > 0 && <Line k="Уже выплачено (аванс)" v={`− ${fmtMoney(pay.paid)}`} />}
                <div className="row" style={{ borderTop: "1px solid var(--ink-06)", paddingTop: 8, fontWeight: 600 }}>
                  <span style={{ flex: 1 }}>Остаток к выплате</span>
                  <span className="num">{fmtMoney(pay.toPay)}</span>
                </div>
              </div>
              {(pay.payType.endsWith("bonus") || isTiered(pay.payType)) && (
                <div style={{ marginTop: 10, fontSize: 12.5, color: "var(--text-sub)" }}>
                  Следующий лид сегодня: <b style={{ color: "var(--c-green-fg)" }}>+{fmtMoney(tierToday ? tierFor(tierToday.tiers, tierToday.leads + 1).leadBonus : pay.leadBonus)}</b>
                </div>
              )}
              {payForecast != null && (
                <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--dim)" }}>
                  При текущем темпе и полном графике к концу месяца выйдет ≈ {fmtMoney(payForecast)}
                </div>
              )}
            </div>
          )}

          <LearnCard />

          {groupProgress?.group && (
            <div className="card card-pad">
              <div className="card-head">
                <div>
                  <h3 className="card-title">Моя группа · {groupProgress.group.name}</h3>
                  <p className="card-sub">Мой вклад: {fmtPct(groupProgress.myShare)} от результата группы</p>
                </div>
                <StatusChip status={groupProgress.group.status} />
              </div>
              <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
                <span style={{ fontSize: 24, fontWeight: 600 }}>{fmtInt(groupProgress.group.pace.fact)}</span>
                <span style={{ color: "var(--text-sub)", fontSize: 13 }}>из {fmtInt(groupProgress.group.plan)}</span>
              </div>
              <Progress value={groupProgress.group.pace.pct} marker={groupProgress.group.plan ? groupProgress.group.pace.planToDate / groupProgress.group.plan : undefined} hue={PACE_HUE[groupProgress.group.status]} style={{ marginTop: 8 }} />
              {groupProgress.team && (
                <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--text-sub)" }}>
                  Отдел: {fmtInt(groupProgress.team.pace.fact)} из {fmtInt(groupProgress.team.plan)} ({fmtPct(groupProgress.team.pace.pct)})
                </div>
              )}
            </div>
          )}

          {pay && (
            <div className="card card-pad">
              <div className="card-head" style={{ marginBottom: 8 }}>
                <div>
                  <h3 className="card-title">Мои выплаты</h3>
                  <p className="card-sub">Авансы и выплаты по всем месяцам</p>
                </div>
              </div>
              <PayoutHistory opId={pay.op.id} compact />
            </div>
          )}

          <div className="card card-pad" style={{ fontSize: 12.5, color: "var(--text-sub)", lineHeight: 1.6 }}>
            <div className="row" style={{ gap: 10, marginBottom: 8 }}>
              <Avatar name={me.name} id={me.id} size={34} />
              <div>
                <div style={{ fontWeight: 600, color: "var(--text)" }}>{me.name}</div>
                <div style={{ fontSize: 12, color: "var(--dim)" }}>{me.login || "логин не задан"}</div>
              </div>
            </div>
            Личные настройки — в{" "}
            <Link href="/settings?tab=profile" style={{ color: "var(--brand)" }}>
              профиле
            </Link>
            : тема, стартовая страница, проект по умолчанию в форме лида.
          </div>
        </div>
      </div>
      {slipOpen && pay && <PayslipModal row={pay} cal={m.cal} onClose={() => setSlipOpen(false)} />}
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--ink-06)", minWidth: 0, height: "100%" }}>
      <div style={{ fontSize: 11.5, color: "var(--text-sub)", lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 2, color: tone === "good" ? "var(--c-green-fg)" : tone === "bad" ? "var(--c-red-fg)" : "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--dim)", lineHeight: 1.3 }}>{sub}</div>}
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

function Line({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <span style={{ flex: 1, color: "var(--text-sub)" }}>{k}</span>
      <span className="num">{v}</span>
    </div>
  );
}
