"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { dailyRows, monthCal, probation, type OpRow } from "@/lib/crm/calc";
import { NO_GROUP_LABEL, PAY_LABEL, ROLE_LABEL, STATUS_LABEL, type OperatorStatus } from "@/lib/crm/types";
import { fmtDate, fmtMonth, fmtStamp, monthEnd, monthStart } from "@/lib/crm/dates";
import { fmtHours, fmtInt, fmtMoney, fmtNum, fmtPct, fmtPhone, fmtSigned } from "@/lib/crm/format";
import { Avatar, Chip, Drawer, Kpi, LeadStatusChip, Progress, StatusChip } from "@/components/ui/kit";
import { Select, dot, type Opt } from "@/components/ui/select";
import { canManageOperator } from "@/lib/crm/access";
import { CumulativeChart, Legend } from "@/components/ui/charts";
import { Icon } from "@/components/ui/icons";
import { hasBonus, isHourlyTiered, isSalary, isTiered } from "@/lib/crm/payroll";
import { learnSummary } from "@/components/learn/Progress";

const EMP_HUE: Record<OperatorStatus, string> = { active: "green", pause: "indigo", fired: "gray" };

export function OperatorDrawer({ row, onClose }: { row: OpRow; onClose: () => void }) {
  const { data, ix, month, openOperator, openLead, setOperatorStatus, moveOperator, deleteOperator, restoreOperator, confirm, access } = useCrm();
  const op = ix.opById.get(row.op.id) ?? row.op;
  const group = op.groupId ? ix.groupById.get(op.groupId) : null;
  const groups = data.groups.filter((g) => !g.deletedAt && (access.isHead || access.ownGroups.has(g.id)));
  const canManage = canManageOperator(access, op);

  return (
    <Drawer onClose={onClose}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, padding: "18px 20px 14px", borderBottom: "1px solid var(--ink-06)" }}>
        <Avatar name={op.name} id={op.id} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{op.name}</div>
          <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
            <Chip hue={EMP_HUE[op.status]}>{STATUS_LABEL[op.status]}</Chip>
            {op.deletedAt && <Chip hue="red">Удалён</Chip>}
            <StatusChip status={row.status} />
            {row.isLeader && (
              <Chip hue="amber">
                <Icon name="star" size={11} stroke={2} /> Лучший результат
              </Chip>
            )}
            <span style={{ fontSize: 12, color: "var(--dim)" }}>
              {ROLE_LABEL[op.role]} · {group ? group.name : NO_GROUP_LABEL}
            </span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* действия */}
        <div className="toolbar">
          {!op.deletedAt && (
            <>
              {access.can.createLeads && (
                <button className="btn btn-sm btn-primary" onClick={() => openLead(null, { operatorId: op.id })} disabled={op.status === "fired"}>
                  <Icon name="plus" size={13} stroke={2.2} /> Лид от оператора
                </button>
              )}
              {canManage && (
              <button className="btn btn-sm" onClick={() => openOperator(op)}>
                <Icon name="edit" size={13} /> Изменить
              </button>
              )}
              {canManage && (
              <Select
                size="sm"
                width={180}
                value={op.groupId ?? ""}
                options={[
                  ...(access.isHead ? [{ value: "", label: `→ ${NO_GROUP_LABEL}`, icon: dot("gray") }] : []),
                  ...groups.map<Opt>((g) => ({ value: g.id, label: `→ ${g.name}`, icon: dot(g.color) })),
                ]}
                onChange={(v) => void moveOperator(op.id, v || null)}
                ariaLabel="Перевести в группу"
                title="Перевести в группу"
              />
              )}
              {canManage && (
              <Select<OperatorStatus>
                size="sm"
                width={140}
                value={op.status}
                options={(Object.keys(STATUS_LABEL) as OperatorStatus[]).map((st) => ({ value: st, label: STATUS_LABEL[st] }))}
                onChange={async (st) => {
                  if (st === "fired" && !(await confirm({ title: "Уволить оператора?", text: "Дата увольнения — сегодня (можно поменять в карточке). История лидов, смен и начислений сохранится, аккаунт будет выключен.", ok: "Уволить" }))) return;
                  void setOperatorStatus(op.id, st);
                }}
                ariaLabel="Статус"
                title="Статус сотрудника"
              />
              )}
            </>
          )}
          <Link className="btn btn-sm btn-ghost" href={`/leads?op=${encodeURIComponent(op.id)}&from=${monthStart(month)}&to=${monthEnd(month)}`}>
            <Icon name="leads" size={13} /> Лиды за месяц
          </Link>
          <span className="spacer" />
          {!canManage ? null : op.deletedAt ? (
            <button className="btn btn-sm" onClick={() => void restoreOperator(op.id)}>
              <Icon name="restore" size={13} /> Восстановить
            </button>
          ) : (
            <button
              className="btn btn-sm btn-danger"
              onClick={async () => {
                if (
                  await confirm({
                    title: `Удалить «${op.name}»?`,
                    text: "Оператор пропадёт из списков и форм и будет считаться уволенным с сегодняшнего дня: в графике — «У», запланированные наперёд смены снимутся. Лиды, отработанные смены и начисления останутся в истории. Перед удалением сохранится резервная копия.",
                    ok: "Удалить",
                    danger: true,
                  })
                ) {
                  await deleteOperator(op.id);
                  onClose();
                }
              }}
            >
              <Icon name="trash" size={13} /> Удалить
            </button>
          )}
        </div>

        <OperatorStats row={row} />
      </div>
    </Drawer>
  );
}

/**
 * Показатели оператора за месяц: план и факт, KPI, накопительный итог, выработка,
 * последние лиды и карточка. Общие для панели супервайзера (OperatorDrawer) и
 * страницы «Мои показатели» оператора (wide — раскладка на всю ширину).
 */
export function OperatorStats({ row, wide = false }: { row: OpRow; wide?: boolean }) {
  const { data, ix, month, openLead, access } = useCrm();
  const op = ix.opById.get(row.op.id) ?? row.op;
  // стажировка считается с даты приёма по всем месяцам
  const prob = useMemo(() => probation(op, ix, data.settings), [op, ix, data.settings]);
  const p = row.pace;
  const past = p.remainingW === 0 && p.needPerDay == null;
  const recent = useMemo(
    () =>
      data.leads
        .filter((l) => l.operatorId === op.id)
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 8),
    [data.leads, op.id],
  );
  // обучение сотрудника — по его аккаунту
  const acc = data.accounts.find((a) => a.operatorId === op.id && !a.deletedAt) ?? null;
  const learn = acc ? learnSummary(acc.id, acc.role, data.learn) : null;
  const canPayView = access.can.viewPayroll;

  return (
    <>
      {/* план и факт */}
      <div className={wide ? "card card-pad" : undefined}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtMonth(month)}</span>
          <span style={{ fontSize: 12, color: "var(--dim)" }}>
            {row.terms.explicit ? "план месяца задан отдельно" : "план по карточке"}
            {!row.inWindow && " · не в штате в этом месяце"}
          </span>
        </div>
        <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: "-.02em" }}>{fmtInt(p.fact)}</span>
          <span style={{ color: "var(--text-sub)" }}>из {fmtInt(row.terms.plan)}</span>
          <span className="spacer" />
          <span style={{ fontSize: 15, fontWeight: 600 }}>{fmtPct(p.pct)}</span>
        </div>
        <Progress value={p.pct} marker={!past && row.terms.plan > 0 ? p.planToDate / row.terms.plan : undefined} height={8} style={{ marginTop: 10 }} />
      </div>

      <div className="kpi-grid" data-n={wide ? "4" : undefined} style={wide ? undefined : { gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        <Kpi label="К плану на дату" value={fmtSigned(p.deviation)} sub={`должно быть ${fmtNum(p.planToDate, 0)}`} />
        <Kpi label="Прогноз (RR)" value={fmtInt(p.rr)} sub={`${fmtPct(p.rrPct)} плана`} />
        <Kpi label="Осталось" value={fmtInt(p.remaining)} sub="до плана месяца" />
        <Kpi label="Нужно в день" value={p.needPerDay == null ? "—" : fmtNum(p.needPerDay)} sub={`сейчас ${fmtNum(row.avgPerWorkday)} в раб. день`} />
        <Kpi label="Сегодня / вчера" value={`${fmtInt(p.today)} / ${fmtInt(p.yesterday)}`} sub="лидов за день" />
        <Kpi label="Неделя / прошлая" value={`${fmtInt(p.thisWeek)} / ${fmtInt(p.prevWeek)}`} sub="лидов за неделю" />
        <Kpi
          label="Часы / норма"
          value={`${fmtNum(row.hours, 0)} / ${fmtNum(row.norm, 0)}`}
          sub={`${fmtPct(row.normPct)} нормы · ${row.hoursDelta >= 0 ? "+" : "−"}${fmtNum(Math.abs(row.hoursDelta))} ч к дате`}
        />
        <Kpi label="Лидов на час" value={row.lph == null ? "—" : fmtNum(row.lph, 2)} sub={`${row.daysWorked} смен · отсутствий ${row.absentDays}`} />
      </div>

      <div className={wide ? "cols-main" : "stack"} style={{ gap: 16 }}>
        <OperatorChart row={row} />

        <div className="card" style={{ overflow: "hidden" }}>
          <table className="tbl tbl-fit">
            <thead>
              <tr>
                <th>Выработка</th>
                <th className="r">Лидов</th>
                <th className="r">Часов</th>
                <th className="r">Лидов/час</th>
              </tr>
            </thead>
            <tbody>
              {[
                { l: "Сегодня", n: p.today, h: row.hoursToday },
                { l: "Текущая неделя", n: p.thisWeek, h: row.hoursWeek },
                { l: "Месяц", n: p.fact, h: row.hours },
              ].map((x) => (
                <tr key={x.l}>
                  <td>{x.l}</td>
                  <td className="r num">{fmtInt(x.n)}</td>
                  <td className="r num">{fmtNum(x.h)}</td>
                  <td className="r num">{x.h > 0 ? fmtNum(x.n / x.h, 2) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid2">
        <div className="card card-pad">
          <h3 className="card-title" style={{ marginBottom: 10 }}>
            Последние лиды
          </h3>
          {recent.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--dim)" }}>Лидов нет.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {recent.map((l) => (
                <button key={l.id} onClick={() => openLead(l)} className="row" style={{ gap: 8, border: "none", background: "none", padding: 0, color: "var(--text)", font: "inherit", textAlign: "left", fontSize: 12.5 }}>
                  <span className="num" style={{ color: "var(--dim)", flex: "none", whiteSpace: "nowrap" }}>
                    {fmtStamp(l.at).slice(0, 5)} {l.at.slice(11, 16)}
                  </span>
                  {/* проект — цветной точкой с подсказкой: в узкой колонке иначе не видно имени клиента */}
                  <span
                    title={l.projectId ? ix.projectById.get(l.projectId)?.name ?? "" : "Без проекта"}
                    style={{ width: 7, height: 7, borderRadius: "50%", flex: "none", background: `var(--c-${(l.projectId && ix.projectById.get(l.projectId)?.color) || "gray"}-fg)` }}
                  />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.client || fmtPhone(l.phone)}</span>
                  <LeadStatusChip lead={l} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="card card-pad" style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 7 }}>
          <h3 className="card-title" style={{ marginBottom: 4 }}>
            Карточка
          </h3>
          <Info k="Приём" v={op.hireDate ? fmtDate(op.hireDate) : "—"} />
          {op.fireDate && <Info k="Увольнение" v={fmtDate(op.fireDate)} />}
          {canPayView && <Info k="Оплата" v={PAY_LABEL[row.terms.payType]} />}
          {canPayView && isSalary(row.terms.payType) && <Info k="Оклад" v={fmtMoney(row.terms.salary)} />}
          {/* по сетке ставка и бонус зависят от лидов за смену — показываем диапазон ступеней, а не «0 ₽/ч» из карточки */}
          {canPayView && isHourlyTiered(row.terms.payType) && row.terms.tiers.length > 0 && (
            <Info k="Ставка" v={`${range(row.terms.tiers.map((t) => t.hourlyRate))} ₽/ч по ступеням`} />
          )}
          {canPayView && !isSalary(row.terms.payType) && !isTiered(row.terms.payType) && <Info k="Ставка" v={`${fmtMoney(row.terms.hourlyRate)}/ч`} />}
          {canPayView && hasBonus(row.terms.payType) && (
            <Info
              k="Бонус за лид"
              v={isTiered(row.terms.payType) && row.terms.tiers.length ? `${range(row.terms.tiers.map((t) => t.leadBonus))} ₽ по ступеням` : fmtMoney(row.terms.leadBonus)}
            />
          )}
          <Info k="Норма" v={fmtHours(row.norm)} />
          <Info k="Контакт" v={op.contact || "—"} />
          <Info k="Обучение" v={learn ? `${learn.passed} из ${learn.total} (${Math.round(learn.pct * 100)}%)` : "нет аккаунта"} />
          {prob.active && (
            <Info
              k="Стажировка"
              v={
                prob.done
                  ? `закрыта ${prob.doneAt ? fmtDate(prob.doneAt) : ""} · ${fmtInt(prob.leads)} лид. за ${fmtHours(prob.hours)}`
                  : `${fmtInt(prob.leads)} из ${fmtInt(prob.needLeads)} лид. за ${fmtHours(prob.hours)} из ${fmtHours(prob.needHours)}`
              }
            />
          )}
          {op.comment && <Info k="Комментарий" v={op.comment} />}
          {canPayView && (
            <Link href="/payroll" style={{ fontSize: 12.5, color: "var(--brand)", textDecoration: "none", marginTop: 4 }}>
              Начисления за месяц →
            </Link>
          )}
        </div>
      </div>
    </>
  );
}

/** «200–260» из значений ступеней (или одно число, если все равны). */
function range(vals: number[]): string {
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return lo === hi ? fmtInt(lo) : `${fmtInt(lo)}–${fmtInt(hi)}`;
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
      <span style={{ width: 96, flex: "none", color: "var(--dim)" }}>{k}</span>
      <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{v}</span>
    </div>
  );
}

function OperatorChart({ row }: { row: OpRow }) {
  const { data, ix, month, today } = useCrm();
  const rows = useMemo(() => {
    const c = monthCal(month, data.settings, today);
    return { rows: dailyRows(c, row.terms.plan, ix.opDay.get(row.op.id), ix.hoursOpDay.get(row.op.id)), phase: c.phase };
  }, [month, data.settings, today, row.terms.plan, ix, row.op.id]);
  return (
    <div className="card card-pad">
      <div className="card-head">
        <h3 className="card-title">Накопительный итог</h3>
        <Legend
          items={[
            { color: "var(--brand)", label: "Факт" },
            { color: "var(--text-sub3)", label: "План", dashed: true },
            ...(rows.phase === "current" ? [{ color: "var(--brand)", label: "Прогноз", dashed: true }] : []),
          ]}
        />
      </div>
      <CumulativeChart rows={rows.rows} rr={row.pace.rr} showForecast={rows.phase === "current" && row.pace.elapsedW > 0} height={200} />
    </div>
  );
}
