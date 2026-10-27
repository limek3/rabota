"use client";

import type { ReactNode } from "react";
import { useCrm } from "@/lib/crm/store";
import { PACE_LABEL, type MonthCal, type MonthModel, type Pace, type PaceStatus } from "@/lib/crm/calc";
import { fmtDate, fmtMonth, isoWeekday } from "@/lib/crm/dates";
import { LEADS, fmtInt, fmtMoney, fmtNum, fmtPct, plural } from "@/lib/crm/format";
import type { FundStat, PayRow, Payroll } from "@/lib/crm/payroll";
import type { RopReport } from "@/lib/crm/rop";
import type { Report } from "@/lib/crm/report";
import type { DayKey } from "@/lib/crm/types";
import { HeroAlarm, HeroBars, HeroBig, HeroSplit, HeroStats, heroDelta, type HeroCol, type HeroHue } from "@/components/app/PageHero";

/**
 * Наполнение хиро для страниц месяца (группы, планы, динамика, мои показатели): итог к плану,
 * доли и столбики по дням месяца с чертой дневного плана. Сам каркас — PageHero.
 */

const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const dd = (d: DayKey) => fmtDate(d).slice(0, 5);

/** Столбики по дням месяца: части дня, черта плана в рабочие дни, будущее — бледно. */
export function monthCols(cal: MonthCal, parts: (d: DayKey) => { hue: HeroHue; n: number }[], dayPlan: number, onDay?: (d: DayKey) => void): HeroCol[] {
  return cal.days.map((d) => {
    const ps = parts(d);
    const n = ps.reduce((a, p) => a + p.n, 0);
    const plan = dayPlan > 0 && cal.isWork(d) ? dayPlan : 0;
    return {
      key: d,
      title: `${dd(d)}, ${DOW[isoWeekday(d) - 1]}: ${fmtInt(n)} ${plural(n, LEADS)}${plan ? ` · план дня ${fmtNum(plan)}` : cal.isWork(d) ? "" : " · выходной"}`,
      parts: ps,
      mark: plan || undefined,
      today: d === cal.today,
      ghost: d > cal.today,
      onClick: onDay ? () => onDay(d) : undefined,
    };
  });
}

/** Главное число месяца: факт к плану, прогноз и ещё строка-другая. */
export function PaceBig({ p, plan, label, cal, extra }: { p: Pace; plan: number; label: ReactNode; cal: MonthCal; extra?: ReactNode[] }) {
  const cur = cal.phase === "current";
  return (
    <HeroBig
      label={label}
      value={fmtInt(p.fact)}
      unit={plural(p.fact, LEADS)}
      delta={plan > 0 && cur ? heroDelta(Math.round(p.deviation), (x) => `${fmtInt(x)} к плану на дату`, true, 0.5, `Должно быть к сегодня: ${fmtInt(Math.round(p.planToDate))}`) : null}
      vs={plan > 0 ? `из ${fmtInt(plan)} · ${fmtPct(p.pct)} плана` : "план не задан"}
      facts={[cur && plan > 0 && p.elapsedW > 0 ? <>прогноз <b className="num">{fmtInt(Math.round(p.rr))}</b> · {fmtPct(p.rrPct)} плана</> : null, ...(extra ?? [])]}
    />
  );
}

/** «Группы»: факт отдела, доли групп (клик — состав группы), лиды по дням с разбивкой по группам. */
export function TeamHero({ m, picked, onPick }: { m: MonthModel; picked: string; onPick: (key: string) => void }) {
  const { ix, data } = useCrm();
  const cal = m.cal;
  const norm = data.settings.convNormPct / 100;
  const lag = m.groups.filter((g) => g.status === "lagging" || g.status === "critical");
  const dayPlan = m.team.plan > 0 ? m.team.plan / cal.W : 0;
  return (
    <>
      <PaceBig
        p={m.team.pace}
        plan={m.team.plan}
        cal={cal}
        label={`Факт за ${fmtMonth(cal.month).toLowerCase()}`}
        extra={[
          <>
            конверсия <b className="num">{m.team.lph == null ? "—" : fmtPct(m.team.lph)}</b>
            {norm > 0 && <> · норма {fmtPct(norm)}</>}
          </>,
        ]}
      />
      <HeroSplit
        parts={m.groups.map((g) => ({
          key: g.key,
          label: g.name,
          value: g.pace.fact,
          pct: g.plan > 0 ? fmtPct(g.pace.pct) : undefined,
          note: g.plan > 0 ? `план ${fmtInt(g.plan)} · ${PACE_LABEL[g.status].toLowerCase()}` : "без плана",
          hue: g.color || "gray",
          on: g.key === picked,
          onClick: () => onPick(g.key),
          title: `${g.name}: ${fmtInt(g.pace.fact)} из ${fmtInt(g.plan)} — нажмите, чтобы показать состав`,
        }))}
        after={
          lag.length ? (
            <HeroAlarm tone="red" title="Группы, которые отстают от плана на дату">
              Отстают: <b>{lag.map((g) => g.name).join(", ")}</b>
            </HeroAlarm>
          ) : (
            <HeroAlarm tone="green">Все группы идут по плану</HeroAlarm>
          )
        }
      />
      <HeroBars
        from={dd(cal.days[0])}
        to={dd(cal.days[cal.days.length - 1])}
        caption="лиды по дням и группам · черта — план дня"
        cols={monthCols(cal, (d) => m.groups.map((g) => ({ hue: g.color || "gray", n: ix.groupDay.get(g.key)?.get(d) ?? 0 })), dayPlan)}
      />
    </>
  );
}

const STATUS_PARTS: { st: PaceStatus; hue: HeroHue; pace: "ok" | "behind" }[] = [
  { st: "ahead", hue: "green", pace: "ok" },
  { st: "ontrack", hue: "blue", pace: "ok" },
  { st: "lagging", hue: "amber", pace: "behind" },
  { st: "critical", hue: "red", pace: "behind" },
];

/** «Планы»: план и факт, кто в плане (клик — фильтр), накопленный факт против плана на дату. */
export function PlanHero({ m, label, pace, onPace }: { m: MonthModel; label: string; pace: string; onPace: (p: "all" | "ok" | "behind") => void }) {
  const { ix } = useCrm();
  const cal = m.cal;
  const p = m.team.pace;
  const plan = m.team.plan;
  let cum = 0;
  const cols: HeroCol[] = cal.days.map((d) => {
    cum += ix.day.get(d) ?? 0;
    const should = plan > 0 ? (plan * cal.wIdx(d)) / cal.W : 0;
    return {
      key: d,
      title: `${dd(d)}: накоплено ${fmtInt(cum)}${should ? ` · должно быть ${fmtInt(Math.round(should))}` : ""}`,
      parts: [{ hue: !should || cum >= should - 0.5 ? "green" : "red", n: cum }],
      mark: should || undefined,
      today: d === cal.today,
      ghost: d > cal.today,
    };
  });
  const crit = m.statusCount.critical ?? 0;
  return (
    <>
      <HeroBig
        label={label}
        value={fmtInt(plan)}
        unit={plural(plan, LEADS)}
        delta={plan > 0 && cal.phase === "current" ? heroDelta(Math.round(p.deviation), (x) => `${fmtInt(x)} к плану на дату`, true, 0.5) : null}
        vs={`факт ${fmtInt(p.fact)} · ${fmtPct(p.pct)} плана`}
        facts={[
          p.needPerDay == null ? "месяц закрыт" : <>нужно <b className="num">{fmtNum(p.needPerDay)}</b> в рабочий день · осталось {p.remainingW} дн.</>,
          <>сейчас <b className="num">{fmtNum(p.avgPerDay)}</b> в рабочий день</>,
        ]}
      />
      <HeroSplit
        cols={4}
        parts={STATUS_PARTS.map((x) => ({
          key: x.st,
          label: PACE_LABEL[x.st],
          value: m.statusCount[x.st] ?? 0,
          note: "операторов",
          hue: x.hue,
          on: pace === x.pace,
          onClick: () => onPace(pace === x.pace ? "all" : x.pace),
          title: x.pace === "ok" ? "Показать тех, кто в плане" : "Показать отстающих",
        }))}
        after={
          crit > 0 ? (
            <HeroAlarm tone="red" on={pace === "behind"} onClick={() => onPace(pace === "behind" ? "all" : "behind")}>
              <b className="num">{fmtInt(crit)}</b> сильно отстают от плана
            </HeroAlarm>
          ) : (
            <HeroAlarm tone="green">Никто сильно не отстаёт</HeroAlarm>
          )
        }
      />
      <HeroBars from={dd(cal.days[0])} to={dd(cal.days[cal.days.length - 1])} caption="накопленный факт · черта — сколько должно быть" cols={cols} />
    </>
  );
}

/** Темп одного среза (команда, группа, оператор): итог к плану, темп и лучшие дни, дни — зелёные, если план дня взят. */
export function PaceHero({ cal, p, plan, label, counts, extra }: { cal: MonthCal; p: Pace; plan: number; label: ReactNode; counts: Map<DayKey, number> | undefined; extra?: ReactNode[] }) {
  const dayPlan = p.dailyPlan;
  const hueOf = (d: DayKey, n: number): HeroHue => {
    if (d === cal.today) return "purple";
    if (!(dayPlan > 0) || !cal.isWork(d)) return "gray";
    return n >= dayPlan - 0.001 ? "green" : "red";
  };
  return (
    <>
      <PaceBig p={p} plan={plan} cal={cal} label={label} extra={extra} />
      <HeroStats
        items={[
          {
            label: "Темп",
            value: fmtNum(p.avgPerDay),
            note:
              p.weekChange == null ? (
                "лидов в рабочий день"
              ) : (
                <span data-tone={p.weekChange >= 0 ? "up" : "down"}>
                  {p.weekChange >= 0 ? "▲" : "▼"} {fmtPct(Math.abs(p.weekChange))} к прошлой неделе
                </span>
              ),
            title: "Средний темп: лидов в рабочий день",
          },
          { label: "Нужно в день", value: p.needPerDay == null ? "—" : fmtNum(p.needPerDay), note: p.needPerDay == null ? "месяц закрыт" : `осталось ${p.remainingW} раб. дн.` },
          { label: "Сегодня", value: fmtInt(p.today), note: `вчера ${fmtInt(p.yesterday)} · неделя ${fmtInt(p.thisWeek)}` },
          { label: "Дни с планом", value: p.daysCounted ? `${p.daysMet} из ${p.daysCounted}` : "—", note: p.best ? `лучший ${dd(p.best.day)} — ${fmtInt(p.best.count)}` : "дней ещё нет" },
        ]}
      />
      <HeroBars
        from={dd(cal.days[0])}
        to={dd(cal.days[cal.days.length - 1])}
        caption="зелёный — план дня взят · черта — план"
        cols={monthCols(cal, (d) => {
          const n = counts?.get(d) ?? 0;
          return [{ hue: hueOf(d, n), n }];
        }, dayPlan)}
      />
    </>
  );
}

/** «Зарплата»: к выплате, из чего сложилось (выплачено / остаток / удержано), ФОТ к доходу и кто сколько получает. */
export function PayHero({
  t,
  rows,
  fund,
  capPct,
  label,
  onRow,
}: {
  t: Payroll["total"];
  rows: PayRow[] | null;
  fund: FundStat | null;
  capPct: number;
  label: string;
  onRow: (opId: string) => void;
}) {
  const paid = Math.max(0, t.paid);
  const rest = Math.max(0, t.toPay);
  const held = Math.max(0, t.gross - t.net);
  const waiting = rows ? rows.filter((r) => r.toPay > 0.005).length : 0;
  const top = rows ? [...rows].filter((r) => r.gross > 0).sort((a, b) => b.gross - a.gross).slice(0, 28) : [];
  return (
    <>
      <HeroBig
        label={label}
        value={fmtMoney(t.net)}
        vs={`начислено ${fmtMoney(t.gross)}`}
        facts={[
          <>
            лидов <b className="num">{fmtInt(t.leads)}</b> · часов <b className="num">{fmtNum(t.hours, 0)}</b>
          </>,
          t.leads > 0 ? (
            <>
              лид обходится в <b className="num">{fmtMoney(t.gross / t.leads)}</b>
            </>
          ) : null,
        ]}
      />
      <HeroSplit
        parts={[
          { key: "paid", label: "Выплачено", value: paid, shown: fmtMoney(paid), pct: t.gross ? fmtPct(paid / t.gross) : undefined, note: "уже на руках", hue: "green" },
          { key: "rest", label: "Остаток", value: rest, shown: fmtMoney(rest), pct: t.gross ? fmtPct(rest / t.gross) : undefined, note: waiting ? `${fmtInt(waiting)} чел. ждут` : "никто не ждёт", hue: "amber" },
          { key: "held", label: "Удержано", value: held, shown: fmtMoney(held), pct: t.gross ? fmtPct(held / t.gross) : undefined, note: "налог и вычеты", hue: "gray" },
        ]}
        after={
          fund && fund.revenue > 0 ? (
            fund.ok ? (
              <HeroAlarm tone="green" title={`Фонд ${fmtMoney(fund.fund)} против дохода ${fmtMoney(fund.revenue)}`}>
                ФОТ <b className="num">{fmtPct(fund.pct)}</b> дохода — в нормативе {capPct}%
              </HeroAlarm>
            ) : (
              <HeroAlarm tone="red" title={`Фонд ${fmtMoney(fund.fund)} против дохода ${fmtMoney(fund.revenue)}`}>
                ФОТ <b className="num">{fmtPct(fund.pct)}</b> дохода — выше норматива {capPct}% на {fmtMoney(fund.over)}
              </HeroAlarm>
            )
          ) : rest > 0.005 ? (
            <HeroAlarm tone="amber">
              Остаток к выплате <b className="num">{fmtMoney(rest)}</b>
            </HeroAlarm>
          ) : undefined
        }
      />
      {top.length > 0 && (
        <HeroBars
          caption="кто сколько получает · нажмите — открыть"
          legend={[
            { hue: "green", label: "выплачено" },
            { hue: "amber", label: "остаток" },
          ]}
          cols={top.map((r) => ({
            key: r.op.id,
            title: `${r.op.name}: начислено ${fmtMoney(r.gross)}, к выплате ${fmtMoney(r.net)}, выплачено ${fmtMoney(r.paid)}, остаток ${fmtMoney(r.toPay)}`,
            parts: [
              { hue: "green", n: Math.max(0, r.paid) },
              { hue: "amber", n: Math.max(0, r.toPay) },
              { hue: "gray", n: Math.max(0, r.gross - r.net) },
            ],
            onClick: () => onRow(r.op.id),
          }))}
        />
      )}
    </>
  );
}

/** Лиды по дням одним цветом: обычный объём без разбивки по статусам; выбранный отрезок — ярко, остальные приглушены. */
export function dayCols(days: DayKey[], count: (d: DayKey) => number, today: DayKey, inRange: (d: DayKey) => boolean, onDay?: (d: DayKey) => void, mark?: (d: DayKey) => number): HeroCol[] {
  return days.map((d) => {
    const n = count(d);
    const m = mark?.(d) ?? 0;
    return {
      key: d,
      title: `${dd(d)}, ${DOW[isoWeekday(d) - 1]}: ${fmtInt(n)} ${plural(n, LEADS)}${m ? ` · план ${fmtNum(m)}` : ""}`,
      parts: [{ hue: "brand", n }],
      mark: m || undefined,
      on: inRange(d),
      today: d === today,
      ghost: d > today,
      onClick: onDay ? () => onDay(d) : undefined,
    };
  });
}

/** Деньги коротко, как в картинке отчёта: «21 т.р.», «1,25 млн», «850 ₽». */
function kMoney(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "−" : "";
  if (a >= 1_000_000) return `${s}${fmtNum(a / 1_000_000, 2)} млн`;
  if (a >= 1000) return `${s}${fmtInt(Math.round(a / 1000))} т.р.`;
  return `${s}${fmtInt(Math.round(a))} ₽`;
}

/** Подсказка-строка «за что отчёт»: «За день · 27.10» / «За неделю · 20.10 – 26.10». */
function rangeLabel(kind: string, from: DayKey, to: DayKey): string {
  const k = kind === "day" ? "За день" : kind === "week" ? "За неделю" : "За месяц";
  return `${k} · ${from === to ? fmtDate(from) : `${dd(from)} – ${dd(to)}`}`;
}

/** «Отчёты» · отчёт РОП: прибыль, выручка и расходы по статьям, чего не хватает в параметрах, лиды по дням. */
export function RopReportHero({ r, cols, onParams }: { r: RopReport; cols: HeroCol[]; onParams: () => void }) {
  const m = r.money;
  const days = cols.map((c) => c.key);
  return (
    <>
      <HeroBig
        label={`Прибыль · ${rangeLabel(r.kind, r.from, r.to).toLowerCase()}`}
        value={fmtMoney(m.profit)}
        tone={m.profit < 0 ? "red" : undefined}
        vs={`выручка ${fmtMoney(m.revenue)} · расходы ${fmtMoney(m.total)}`}
        facts={[
          m.pct != null ? (
            <>
              расходы — <b className="num">{fmtPct(m.pct)}</b> выручки
            </>
          ) : (
            "выручки за период нет"
          ),
          <>
            лидов <b className="num">{fmtInt(r.leads.total)}</b> · недвижимость {fmtInt(r.leads.re)} · авто {fmtInt(r.leads.auto)}
          </>,
        ]}
      />
      <HeroSplit
        cols={4}
        parts={[
          { key: "ops", label: "Операторы", value: m.operators, shown: kMoney(m.operators), pct: m.total ? fmtPct(m.operators / m.total) : undefined, note: "часы и бонусы", hue: "purple" },
          { key: "sv", label: "Супервайзеры", value: m.supervisors, shown: kMoney(m.supervisors), pct: m.total ? fmtPct(m.supervisors / m.total) : undefined, note: "оклад и бонус", hue: "indigo" },
          { key: "tel", label: "Связь", value: m.telecom, shown: m.telecom ? kMoney(m.telecom) : "—", note: m.telecom ? "примерно" : "не задано", hue: "teal" },
          { key: "oh", label: "Общие", value: m.overhead, shown: m.overhead ? kMoney(m.overhead) : "—", note: m.overhead ? "аренда, софт" : "не задано", hue: "slate" },
        ]}
        after={
          r.missing.length > 0 ? (
            <HeroAlarm tone="amber" onClick={onParams} title={`Не задано: ${r.missing.join("; ")}`}>
              Цифры неполные: не задано <b className="num">{fmtInt(r.missing.length)}</b> — параметры
            </HeroAlarm>
          ) : (
            <HeroAlarm tone="green">Все расходы заданы — цифры полные</HeroAlarm>
          )
        }
      />
      <HeroBars from={dd(days[0])} to={dd(days[days.length - 1])} caption="лиды по дням · ярко — дни отчёта" cols={cols} />
    </>
  );
}

/** «Отчёты» · по операторам: лиды к плану, доли групп, кто требует внимания, лиды по дням с чертой плана. */
export function OpsReportHero({ r, cols }: { r: Report; cols: HeroCol[] }) {
  const t = r.total;
  const days = cols.map((c) => c.key);
  const att = r.attention.lagging.length + r.attention.noLeads.length;
  return (
    <>
      <HeroBig
        label={`${rangeLabel(r.kind, r.from, r.to)}${r.scope ? ` · ${r.scope}` : ""}`}
        value={fmtInt(t.leads)}
        unit={plural(t.leads, LEADS)}
        vs={t.plan > 0 ? `план ${fmtInt(Math.round(t.plan))} · ${t.pct == null ? "—" : fmtPct(t.pct)} плана` : "план не задан"}
        facts={[
          <>
            конверсия <b className="num">{t.conv == null ? "—" : fmtPct(t.conv)}</b> · часов <b className="num">{fmtNum(t.hours, 0)}</b>
          </>,
          <>
            на линии <b className="num">{fmtInt(t.people)}</b> {plural(t.people, ["оператор", "оператора", "операторов"])}
            {r.bestDay && (
              <>
                {" "}
                · лучший день {dd(r.bestDay.day)} — {fmtInt(r.bestDay.leads)}
              </>
            )}
          </>,
        ]}
      />
      <HeroSplit
        parts={r.groups.map((g) => ({
          key: g.key,
          label: g.name,
          value: g.leads,
          pct: g.pct == null ? undefined : fmtPct(g.pct),
          note: g.plan > 0 ? `план ${fmtInt(Math.round(g.plan))}` : "без плана",
          hue: g.color || "gray",
        }))}
        after={
          att > 0 ? (
            <HeroAlarm tone="red" title={[...r.attention.lagging.map((x) => x.name), ...r.attention.noLeads].join(", ")}>
              Требуют внимания: <b className="num">{fmtInt(att)}</b> — отстают или без лидов
            </HeroAlarm>
          ) : (
            <HeroAlarm tone="green">Все в плане</HeroAlarm>
          )
        }
      />
      <HeroBars from={dd(days[0])} to={dd(days[days.length - 1])} caption="ярко — дни отчёта · черта — план" cols={cols} />
    </>
  );
}
