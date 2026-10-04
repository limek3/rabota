"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { dailyRows, monthCal, probation, WORKED_TYPES, type MonthCal, type OpRow } from "@/lib/crm/calc";
import { NO_GROUP_LABEL, PAY_LABEL, ROLE_LABEL, STATUS_LABEL, type OperatorStatus } from "@/lib/crm/types";
import { fmtDate, fmtMonth, fmtStamp, isoWeekday, monthEnd, monthStart } from "@/lib/crm/dates";
import { fmtHours, fmtInt, fmtMoney, fmtNum, fmtPct, fmtPhone, fmtSigned, telegramUser } from "@/lib/crm/format";
import { PayoutHistory } from "@/components/app/PayoutHistory";
import { Avatar, Chip, Conv, EmploymentTag, Kpi, LeadLinkButton, LeadStatusChip, Progress, Sheet, StatusChip } from "@/components/ui/kit";
import { Select, dot, type Opt } from "@/components/ui/select";
import { canManageOperator, canSeePay } from "@/lib/crm/access";
import { CumulativeChart, Legend, ShiftLeadsChart } from "@/components/ui/charts";
import { Icon } from "@/components/ui/icons";
import { hasBonus, isHourlyTiered, isSalary, isTiered } from "@/lib/crm/payroll";
import { learnSummary } from "@/components/learn/Progress";
import { OperatorInsight, OperatorNotes, useOpNotes } from "@/components/app/OperatorCoach";
import { GapCard, Hero, WeekCard } from "@/components/app/DashboardV2";

/** Временный переключатель: карточка в стиле новой «Сводки». false — прежний вид. */
const CARD_V2 = true;

const EMP_HUE: Record<OperatorStatus, string> = { active: "green", pause: "indigo", fired: "gray" };

/**
 * Карточка оператора для руководителя — почти на весь экран, одной страницей без вкладок:
 * слева цифры месяца и графики, справа разбор, заметки СВ и данные сотрудника.
 */
export function OperatorDrawer({ row, onClose }: { row: OpRow; onClose: () => void }) {
  const { data, ix, month, openOperator, openLead, setOperatorStatus, moveOperator, deleteOperator, restoreOperator, confirm, access } = useCrm();
  const op = ix.opById.get(row.op.id) ?? row.op;
  const group = op.groupId ? ix.groupById.get(op.groupId) : null;
  const groups = data.groups.filter((g) => !g.deletedAt && (access.isHead || access.ownGroups.has(g.id)));
  const canManage = canManageOperator(access, op);

  const head = (
    <>
      <Avatar name={op.name} id={op.id} size={44} />
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <div style={{ fontSize: 18, fontWeight: 600 }}>{op.name}</div>
        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
          <Chip hue={EMP_HUE[op.status]}>{STATUS_LABEL[op.status]}</Chip>
          {op.deletedAt && <Chip hue="red">Удалён</Chip>}
          <EmploymentTag op={op} size="md" />
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
      <div className="toolbar op-sheet-actions">
        {!op.deletedAt && access.can.createLeads && (
          <button className="btn btn-sm btn-primary" onClick={() => openLead(null, { operatorId: op.id })} disabled={op.status === "fired"}>
            <Icon name="plus" size={13} stroke={2.2} /> Лид от оператора
          </button>
        )}
        {!op.deletedAt && canManage && (
          <button className="btn btn-sm" onClick={() => openOperator(op)}>
            <Icon name="edit" size={13} /> Изменить
          </button>
        )}
        {!op.deletedAt && canManage && (
          <Select
            size="sm"
            width={170}
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
        {!op.deletedAt && canManage && (
          <Select<OperatorStatus>
            size="sm"
            width={130}
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
        <Link className="btn btn-sm btn-ghost" href={`/leads?op=${encodeURIComponent(op.id)}&from=${monthStart(month)}&to=${monthEnd(month)}`}>
          <Icon name="leads" size={13} /> Лиды за месяц
        </Link>
        {canManage &&
          (op.deletedAt ? (
            <button className="btn btn-sm" onClick={() => void restoreOperator(op.id)}>
              <Icon name="restore" size={13} /> Восстановить
            </button>
          ) : (
            <button
              className="btn btn-sm btn-ghost btn-icon"
              title="Удалить оператора"
              aria-label="Удалить оператора"
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
              <Icon name="trash" size={14} />
            </button>
          ))}
      </div>
    </>
  );

  return (
    <Sheet onClose={onClose} head={head}>
      <div className="op-sheet">
        <div className="op-sheet-main">
          {CARD_V2 ? (
            <MainV2 row={row} canPay={canSeePay(access, op.id)} />
          ) : (
            <>
              <div className="card card-pad op-hero">
                <PlanFact row={row} />
                <KpiGrid row={row} n={4} />
              </div>
              <div className="op-pair">
                <CumulativeCard row={row} />
                <ShiftsCard row={row} coach />
              </div>
              <div className="op-pair">
                <OutputCard row={row} />
                <RecentLeadsCard opId={op.id} />
              </div>
              {canSeePay(access, op.id) && <PayoutsCard opId={op.id} />}
            </>
          )}
        </div>
        {/* разбор и заметки — только руководителям: в «Моих показателях» оператора их нет */}
        <div className="op-sheet-side">
          <OperatorInsight row={row} />
          <OperatorNotes opId={op.id} variant="card" />
          <InfoCard row={row} />
        </div>
      </div>
    </Sheet>
  );
}

/**
 * «Мои показатели» оператора: те же блоки, что в карточке руководителя, но без разбора
 * и заметок СВ — раскладка на всю ширину страницы.
 */
export function OperatorStats({ row }: { row: OpRow; wide?: boolean }) {
  const { access } = useCrm();
  return (
    <>
      <div className="card card-pad op-hero">
        <PlanFact row={row} />
        <KpiGrid row={row} n={4} />
      </div>
      <div className="op-pair">
        <CumulativeCard row={row} />
        <ShiftsCard row={row} />
      </div>
      <div className="op-pair">
        <OutputCard row={row} />
        <RecentLeadsCard opId={row.op.id} />
      </div>
      <InfoCard row={row} />
      {canSeePay(access, row.op.id) && <PayoutsCard opId={row.op.id} />}
    </>
  );
}

/* ── карточка в стиле «Сводки» (CARD_V2) ───────────────────────────── */

const DOW_V2 = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const ABSENT_V2: Record<string, string> = { vacation: "О", sick: "Б", platform: "П" };

function MainV2({ row, canPay }: { row: OpRow; canPay: boolean }) {
  const { data, ix, month, today } = useCrm();
  const cal = useMemo(() => monthCal(month, data.settings, today), [month, data.settings, today]);
  const d = useDaily(row);
  const ref = cal.phase === "future" ? cal.days[0] : cal.ref;
  return (
    <div className="d2">
      <Hero cal={cal} plan={row.terms.plan} p={row.pace} who="op" />
      <OpStrip row={row} />
      <div className="d2-charts">
        <GapCard rows={d.rows} cal={cal} p={row.pace} />
        <WeekCard cal={cal} p={row.pace} ref_={ref} counts={ix.opDay.get(row.op.id)} />
      </div>
      <ShiftStrip row={row} cal={cal} />
      <div className="op-pair">
        <OutputCard row={row} />
        <RecentLeadsCard opId={row.op.id} />
      </div>
      {canPay && <PayoutsCard opId={row.op.id} />}
    </div>
  );
}

/** Оперативные цифры одной строкой — как показатели в шапке «Сводки». */
function OpStrip({ row }: { row: OpRow }) {
  const p = row.pace;
  const items: { l: string; v: ReactNode; u: string; tone?: "red" | "green" }[] = [
    { l: "Сегодня / вчера", v: `${fmtInt(p.today)} / ${fmtInt(p.yesterday)}`, u: "лидов за день" },
    { l: "Неделя / прошлая", v: `${fmtInt(p.thisWeek)} / ${fmtInt(p.prevWeek)}`, u: "лидов за неделю" },
    { l: "Часы", v: fmtNum(row.hours, 0), u: `к дате ${fmtNum(row.normToDate, 0)} · норма ${fmtNum(row.norm, 0)}`, tone: row.norm > 0 && row.hoursDelta < -0.5 ? "red" : undefined },
    { l: "Конверсия", v: <Conv value={row.lph} />, u: `${row.daysWorked} смен · отсутствий ${row.absentDays}` },
    { l: "Среднее за смену", v: fmtNum(row.avgPerWorkday), u: "лидов в рабочий день" },
    { l: "Лучший день", v: p.best ? fmtInt(p.best.count) : "—", u: p.best ? fmtDate(p.best.day).slice(0, 5) : "лидов пока нет" },
  ];
  return (
    <section className="card d2-strip">
      {items.map((k) => (
        <div key={k.l} className="d2-kpi">
          <div className="d2-kpi-l">{k.l}</div>
          <div className={`d2-kpi-v${k.tone === "red" ? " d2-red" : k.tone === "green" ? " d2-green" : ""}`}>{k.v}</div>
          <div className="d2-kpi-u">{k.u}</div>
        </div>
      ))}
    </section>
  );
}

/**
 * Месяц одной полосой, как строка тепловой карты в «Сводке»: лиды и часы по дням,
 * красный 0 — смена без лидов, точка над днём — заметка СВ (видно «до» и «после» разговора).
 */
function ShiftStrip({ row, cal }: { row: OpRow; cal: MonthCal }) {
  const { ix } = useCrm();
  const notes = useOpNotes(row.op.id);
  const noteOn = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const n of notes) m.set(n.date, [...(m.get(n.date) ?? []), n.text]);
    return m;
  }, [notes]);
  const id = row.op.id;
  const counts = ix.opDay.get(id);
  const hours = ix.hoursOpDay.get(id);
  const days = cal.days;
  let max = 1;
  for (const d of days) max = Math.max(max, counts?.get(d) ?? 0);
  const todayIdx = cal.phase === "current" ? days.indexOf(cal.today) : -1;
  const NAME_W = 64;
  const daily = row.pace.dailyPlan;
  const future = (d: string) => cal.phase === "future" || d > cal.ref;
  const shade = (v: number): CSSProperties => {
    const k = Math.min(1, v / max);
    return { background: `color-mix(in srgb, var(--text) ${Math.round(8 + 62 * k)}%, var(--bg-panel))`, color: k > 0.5 ? "var(--bg-panel)" : "var(--text)" };
  };
  const dow = (d: string) => DOW_V2[isoWeekday(d) - 1];

  return (
    <section className="card d2-hm">
      <div className="d2-hm-head">
        <div>
          <h3 className="d2-h" style={{ marginTop: 3 }}>Смены и лиды за месяц</h3>
          <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 2 }}>
            {daily > 0 ? `План дня ${fmtNum(daily)} · ` : ""}точка над днём — заметка СВ
          </div>
        </div>
        <div className="d2-leg" style={{ marginTop: 6 }}>
          <span>
            <i style={{ width: 9, height: 9, borderRadius: "50%", background: "color-mix(in srgb, var(--text) 20%, var(--bg-panel))" }} />
            <i style={{ width: 9, height: 9, borderRadius: "50%", background: "color-mix(in srgb, var(--text) 70%, var(--bg-panel))", marginLeft: -3 }} />
            Больше лидов
          </span>
          <span><i style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--c-red-fg)" }} />0 лидов на смене</span>
          <span><i style={{ width: 10, height: 0, borderTop: "1.5px dashed var(--dim)" }} />Нет смены</span>
          <span><i style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--brand)" }} />Заметка</span>
        </div>
      </div>
      <div className="d2-hm-scroll">
        <div className="d2-grid" style={{ gridTemplateColumns: `${NAME_W}px repeat(${days.length}, minmax(20px, 1fr))`, minWidth: 640 }}>
          <div className="dh" />
          {days.map((d, i) => {
            const n = noteOn.get(d);
            return (
              <div key={d} className="dh" data-off={String(!cal.isWork(d))} data-today={String(i === todayIdx)} title={n ? `Заметка: ${n.join(" · ")}` : undefined} style={{ position: "relative" }}>
                {n && <span style={{ position: "absolute", top: 0, left: "50%", transform: "translateX(-50%)", width: 5, height: 5, borderRadius: "50%", background: "var(--brand)" }} />}
                {Number(d.slice(8))}
                <br />
                {dow(d)}
              </div>
            );
          })}
          <div className="nm" style={{ color: "var(--text-sub)" }}>Лиды</div>
          {days.map((d) => {
            if (future(d)) return <div key={d} className="c f">—</div>;
            const v = counts?.get(d) ?? 0;
            const sh = ix.shift.get(`${d}|${id}`);
            const tip = `${Number(d.slice(8))} ${dow(d)}: ${v} лид.${daily > 0 && v > 0 ? ` (${fmtPct(v / daily)} плана дня)` : ""}`;
            if (v > 0) return <div key={d} className="c" style={shade(v)} title={tip}>{v}</div>;
            if (sh && WORKED_TYPES.has(sh.type) && sh.hours > 0) return <div key={d} className="c z" title={`${tip} · смена ${sh.hours} ч`}>0</div>;
            if (sh && ABSENT_V2[sh.type]) return <div key={d} className="c a" title={tip}>{ABSENT_V2[sh.type]}</div>;
            return <div key={d} className="c n">—</div>;
          })}
          <div className="nm" style={{ color: "var(--text-sub)" }}>Часы</div>
          {days.map((d) => {
            if (future(d)) {
              const sh = ix.shift.get(`${d}|${id}`);
              // наперёд — запланированные смены, бледно
              return <div key={d} className="c f" title={sh ? `по графику ${sh.hours} ч` : undefined}>{sh && sh.hours > 0 ? fmtNum(sh.hours, 0) : "—"}</div>;
            }
            const h = hours?.get(d) ?? 0;
            return h > 0 ? <div key={d} className="c" style={{ background: "var(--ink-05)", color: "var(--text-sub)" }}>{fmtNum(h, 0)}</div> : <div key={d} className="c n">—</div>;
          })}
          {todayIdx >= 0 && (
            <div className="d2-today" style={{ left: `calc(${NAME_W}px + (100% - ${NAME_W}px) * ${todayIdx} / ${days.length})`, width: `calc((100% - ${NAME_W}px) / ${days.length})` }} />
          )}
        </div>
      </div>
    </section>
  );
}


/* ── блоки карточки ────────────────────────────────────────────────── */

function PlanFact({ row }: { row: OpRow }) {
  const { month } = useCrm();
  const p = row.pace;
  const past = p.remainingW === 0 && p.needPerDay == null;
  return (
    <div className="op-plan">
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{fmtMonth(month)}</span>
        <span style={{ fontSize: 11.5, color: "var(--dim)", textAlign: "right" }}>
          {row.terms.explicit ? "план месяца задан отдельно" : "план по карточке"}
          {!row.inWindow && " · не в штате"}
        </span>
      </div>
      <div className="row" style={{ alignItems: "baseline", gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-.02em", lineHeight: 1 }}>{fmtInt(p.fact)}</span>
        <span style={{ color: "var(--text-sub)" }}>из {fmtInt(row.terms.plan)}</span>
        <span className="spacer" />
        <span style={{ fontSize: 16, fontWeight: 600 }}>{fmtPct(p.pct)}</span>
      </div>
      <Progress value={p.pct} marker={!past && row.terms.plan > 0 ? p.planToDate / row.terms.plan : undefined} height={8} style={{ marginTop: 12 }} />
      <div className="row" style={{ justifyContent: "space-between", fontSize: 12, color: "var(--dim)", marginTop: 8 }}>
        <span>должно быть {fmtNum(p.planToDate, 0)}</span>
        <span style={{ color: p.deviation >= 0 ? "var(--c-green-fg)" : "var(--c-red-fg)" }}>{fmtSigned(p.deviation)} к плану на дату</span>
      </div>
    </div>
  );
}

function KpiGrid({ row, n }: { row: OpRow; n: 4 }) {
  const p = row.pace;
  return (
    <div className="kpi-grid" data-n={String(n)}>
      <Kpi label="Прогноз (RR)" value={fmtInt(p.rr)} sub={`${fmtPct(p.rrPct)} плана`} />
      <Kpi label="Осталось" value={fmtInt(p.remaining)} sub="до плана месяца" />
      <Kpi label="Нужно в день" value={p.needPerDay == null ? "—" : fmtNum(p.needPerDay)} sub={`сейчас ${fmtNum(row.avgPerWorkday)} в раб. день`} />
      <Kpi label="Конверсия" title="Лиды ÷ отработанные часы" value={<Conv value={row.lph} />} sub={`${row.daysWorked} смен · отсутствий ${row.absentDays}`} />
      <Kpi label="Сегодня / вчера" value={`${fmtInt(p.today)} / ${fmtInt(p.yesterday)}`} sub="лидов за день" />
      <Kpi label="Неделя / прошлая" value={`${fmtInt(p.thisWeek)} / ${fmtInt(p.prevWeek)}`} sub="лидов за неделю" />
      <Kpi label="Часы" value={fmtNum(row.hours, 0)} sub={`норма ${fmtNum(row.norm, 0)} ч`} />
      <Kpi label="Лучший день" value={p.best ? fmtInt(p.best.count) : "—"} sub={p.best ? fmtDate(p.best.day).slice(0, 5) : "лидов пока нет"} />
    </div>
  );
}

function useDaily(row: OpRow) {
  const { data, ix, month, today } = useCrm();
  return useMemo(() => {
    const c = monthCal(month, data.settings, today);
    return { rows: dailyRows(c, row.terms.plan, ix.opDay.get(row.op.id), ix.hoursOpDay.get(row.op.id)), phase: c.phase };
  }, [month, data.settings, today, row.terms.plan, ix, row.op.id]);
}

function CumulativeCard({ row }: { row: OpRow }) {
  const d = useDaily(row);
  return (
    <div className="card card-pad">
      <div className="card-head">
        <h3 className="card-title"><Icon name="trend" size={15} className="title-ic" />Накопительный итог</h3>
        <Legend
          items={[
            { color: "var(--brand)", label: "Факт" },
            { color: "var(--text-sub3)", label: "План", dashed: true },
            ...(d.phase === "current" ? [{ color: "var(--brand)", label: "Прогноз", dashed: true }] : []),
          ]}
        />
      </div>
      <CumulativeChart rows={d.rows} rr={row.pace.rr} showForecast={d.phase === "current" && row.pace.elapsedW > 0} height={210} />
    </div>
  );
}

/** Лиды за каждую смену — видно ритм: где рос, где провалился, где смена прошла без лидов. */
function ShiftsCard({ row, coach = false }: { row: OpRow; coach?: boolean }) {
  const d = useDaily(row);
  // заметки СВ — отметками на графике: видно, что было до разговора и после
  const notes = useOpNotes(row.op.id);
  const marks = coach ? notes.map((n, i) => ({ day: n.date, label: String(notes.length - i) })) : [];
  return (
    <div className="card card-pad">
      <div className="card-head">
        <h3 className="card-title"><Icon name="chart" size={15} className="title-ic" />Лиды по сменам</h3>
        <Legend
          items={[
            ...(row.pace.dailyPlan > 0 ? [{ color: "var(--text-sub3)", label: `План дня ${fmtNum(row.pace.dailyPlan, 1)}`, dashed: true }] : []),
            { color: "var(--c-red-fg)", label: "Без лидов", bar: true },
            ...(marks.length ? [{ color: "var(--brand)", label: "Заметка", bar: true }] : []),
          ]}
        />
      </div>
      <ShiftLeadsChart rows={d.rows} dayPlan={row.pace.dailyPlan} height={210} marks={marks} />
    </div>
  );
}

function OutputCard({ row }: { row: OpRow }) {
  const { ix, today } = useCrm();
  const p = row.pace;
  // день ещё не закрыт: часы сегодняшней смены войдут в расчёт в час закрытия (Настройки)
  const open = today > ix.workedTo;
  // лиды в час — по закрытым дням: сегодняшние лиды без сегодняшних часов завысили бы результат
  const closedWeek = open ? p.thisWeek - p.today : p.thisWeek;
  return (
    <div className="card" style={{ overflow: "hidden", alignSelf: "start" }}>
      <table className="tbl tbl-fit">
        <thead>
          <tr>
            <th>Выработка</th>
            <th className="r">Лидов</th>
            <th className="r">Часов</th>
            <th className="r" title="Лиды ÷ часы, в процентах (0,75 лид/ч = 75%)">Конверсия</th>
          </tr>
        </thead>
        <tbody>
          {[
            { l: "Сегодня", n: p.today, h: row.hoursToday, c: p.today },
            { l: "Текущая неделя", n: p.thisWeek, h: row.hoursWeek, c: closedWeek },
            { l: "Месяц", n: p.fact, h: row.hours, c: row.factClosed },
          ].map((x) => (
            <tr key={x.l}>
              <td>{x.l}</td>
              <td className="r num">{fmtInt(x.n)}</td>
              {open && x.l === "Сегодня" ? (
                <td className="r" colSpan={2} style={{ color: "var(--dim)", fontSize: 12 }} title="Часы сегодняшней смены войдут в расчёт после закрытия дня">
                  смена идёт
                </td>
              ) : (
                <>
                  <td className="r num">{fmtNum(x.h)}</td>
                  <td className="r num" title={x.h > 0 ? `${fmtNum(x.c / x.h, 2)} лид/ч` : undefined}>{x.h > 0 ? fmtPct(x.c / x.h) : "—"}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Лидов на страницу: больше шести карточка вытягивается и ломает раскладку рядом. */
const LEADS_PAGE = 6;

function RecentLeadsCard({ opId }: { opId: string }) {
  const { data, ix, openLead } = useCrm();
  const all = useMemo(() => data.leads.filter((l) => l.operatorId === opId).sort((a, b) => b.at.localeCompare(a.at)), [data.leads, opId]);
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(all.length / LEADS_PAGE));
  // лидов стало меньше (удалили, сменили оператора) — не остаёмся на пустой странице
  const pg = Math.min(page, pages - 1);
  const recent = all.slice(pg * LEADS_PAGE, pg * LEADS_PAGE + LEADS_PAGE);
  return (
    <div className="card card-pad">
      <div className="row" style={{ justifyContent: "space-between", gap: 8, marginBottom: 10, minHeight: 26 }}>
        <h3 className="card-title"><Icon name="leads" size={15} className="title-ic" />Последние лиды</h3>
        {pages > 1 && (
          <div className="row" style={{ gap: 2 }}>
            <span className="num" style={{ fontSize: 11.5, color: "var(--dim)", marginRight: 6 }}>
              {pg * LEADS_PAGE + 1}–{pg * LEADS_PAGE + recent.length} из {fmtInt(all.length)}
            </span>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Более новые" title="Более новые" disabled={pg === 0} onClick={() => setPage(pg - 1)}>
              <Icon name="chevL" size={14} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" aria-label="Более старые" title="Более старые" disabled={pg >= pages - 1} onClick={() => setPage(pg + 1)}>
              <Icon name="chevR" size={14} />
            </button>
          </div>
        )}
      </div>
      {recent.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--dim)" }}>Лидов нет.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {recent.map((l) => (
            <div key={l.id} className="row" style={{ gap: 8 }}>
              <button onClick={() => openLead(l)} className="row" style={{ flex: 1, minWidth: 0, gap: 8, border: "none", background: "none", padding: 0, color: "var(--text)", font: "inherit", textAlign: "left", fontSize: 12.5 }}>
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
              {l.link && <LeadLinkButton link={l.link} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InfoCard({ row }: { row: OpRow }) {
  const { data, full, ix, access } = useCrm();
  const op = ix.opById.get(row.op.id) ?? row.op;
  // стажировка считается с даты приёма по всем месяцам
  const prob = useMemo(() => probation(op, ix, data.settings), [op, ix, data.settings]);
  // обучение сотрудника — по его аккаунту; в срезе data у руководителя только свой аккаунт,
  // а аккаунты операторов своей зоны он видит в full (в Supabase — по правилу accounts_read)
  const acc = full.accounts.find((a) => a.operatorId === op.id && !a.deletedAt) ?? null;
  const learn = acc ? learnSummary(acc.id, acc.role, data.learn) : null;
  // условия оплаты — только тем, кому видны деньги этого человека (наставнику — не видны)
  const canPayView = canSeePay(access, row.op.id);
  return (
    <div className="card card-pad" style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 7 }}>
      <h3 className="card-title" style={{ marginBottom: 4 }}>
        <Icon name="user" size={15} className="title-ic" />Карточка
      </h3>
      <Info k="Приём" v={op.hireDate ? fmtDate(op.hireDate) : "—"} />
      {op.fireDate && <Info k="Увольнение" v={fmtDate(op.fireDate)} />}
      {canPayView && <Info k="Оплата" v={PAY_LABEL[row.terms.payType]} />}
      {canPayView && isSalary(row.terms.payType) && <Info k="Оклад" v={fmtMoney(row.terms.salary)} />}
      {/* по сетке ставка и бонус зависят от лидов за смену — показываем диапазон ступеней, а не «0 ₽/ч» из карточки */}
      {canPayView && isHourlyTiered(row.terms.payType) && row.terms.tiers.length > 0 && <Info k="Ставка" v={`${range(row.terms.tiers.map((t) => t.hourlyRate))} ₽/ч по ступеням`} />}
      {canPayView && !isSalary(row.terms.payType) && !isTiered(row.terms.payType) && <Info k="Ставка" v={`${fmtMoney(row.terms.hourlyRate)}/ч`} />}
      {canPayView && hasBonus(row.terms.payType) && (
        <Info k="Бонус за лид" v={isTiered(row.terms.payType) && row.terms.tiers.length ? `${range(row.terms.tiers.map((t) => t.leadBonus))} ₽ по ступеням` : fmtMoney(row.terms.leadBonus)} />
      )}
      <Info k="Норма" v={fmtHours(row.norm)} />
      <Info k="Telegram" v={<TelegramLink value={op.contact} />} />
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
  );
}

function PayoutsCard({ opId }: { opId: string }) {
  return (
    <div className="card card-pad">
      <div className="card-head" style={{ marginBottom: 8 }}>
        <div>
          <h3 className="card-title"><Icon name="clock" size={15} className="title-ic" />История выплат</h3>
          <p className="card-sub">Авансы и выплаты по всем месяцам</p>
        </div>
      </div>
      <PayoutHistory opId={opId} compact />
    </div>
  );
}

/** «200–260» из значений ступеней (или одно число, если все равны). */
function range(vals: number[]): string {
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  return lo === hi ? fmtInt(lo) : `${fmtInt(lo)}–${fmtInt(hi)}`;
}

/** Telegram оператора: ник — кликабельная иконка и @ник, открывают его Telegram; не ник (старые записи с телефоном) — просто текст. */
function TelegramLink({ value }: { value: string }) {
  const user = telegramUser(value);
  if (!user) return <>{value || "—"}</>;
  return (
    <a className="tg-link" href={`https://t.me/${user}`} target="_blank" rel="noreferrer" title={`Открыть @${user} в Telegram`}>
      <span className="tg-link-ico" aria-hidden>
        <Icon name="telegram" size={13} />
      </span>
      @{user}
    </a>
  );
}

function Info({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
      <span style={{ width: 96, flex: "none", color: "var(--dim)" }}>{k}</span>
      <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>{v}</span>
    </div>
  );
}
