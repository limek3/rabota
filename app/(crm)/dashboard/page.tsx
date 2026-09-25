"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { dailyRows, PACE_HUE, type PaceStatus } from "@/lib/crm/calc";
import { addDays, fmtDay, fmtDayShort, fmtMonth, fmtRange, fmtWeekday, weekStart } from "@/lib/crm/dates";
import { DAYS, fmtInt, fmtNum, fmtPct, fmtSigned, fmtSignedPct, LEADS, OPS, plural, safeDiv, shortName } from "@/lib/crm/format";
import { Avatar, Chip, Conv, Empty, Kpi, LeadN, MonthSwitcher, PageHead, Progress, StatusChip, Swatch } from "@/components/ui/kit";
import { CumulativeChart, DailyBars, Legend } from "@/components/ui/charts";
import { Icon } from "@/components/ui/icons";
import { MorningCard } from "@/components/app/MorningCard";

function Onboarding() {
  const { openOperator, openGroup } = useCrm();
  return (
    <div className="card card-pad" style={{ padding: 28 }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>База пустая — начнём</div>
      <p style={{ margin: "0 0 18px", fontSize: 13.5, color: "var(--text-sub)", lineHeight: 1.6, maxWidth: 720 }}>
        Здесь учитывается только конечный результат работы оператора — лид, успешно переданный менеджеру из Скорозвона. Заведите справочники, и
        показатели команды, групп и операторов начнут считаться автоматически.
      </p>
      <div className="grid3">
        {[
          { n: 1, t: "Проекты", d: "Авто, Недвижимость и другие направления, по которым передаются лиды.", a: <Link className="btn btn-sm" href="/projects">Открыть проекты</Link> },
          { n: 2, t: "Группы", d: "Команды со своим руководителем и планом. Можно работать и без групп.", a: <button className="btn btn-sm" onClick={() => openGroup()}>Создать группу</button> },
          { n: 3, t: "Операторы", d: "Личный план, норма часов и схема оплаты — по умолчанию из настроек.", a: <button className="btn btn-sm" onClick={() => openOperator()}>Добавить оператора</button> },
        ].map((s) => (
          <div key={s.n} className="card" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8, background: "var(--bg)" }}>
            <span style={{ width: 24, height: 24, borderRadius: 5, background: "var(--brand-tint)", color: "var(--brand)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>{s.n}</span>
            <div style={{ fontWeight: 600 }}>{s.t}</div>
            <div style={{ fontSize: 12.5, color: "var(--text-sub)", lineHeight: 1.5, flex: 1 }}>{s.d}</div>
            <div>{s.a}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const BUCKETS: PaceStatus[] = ["ahead", "ontrack", "lagging", "critical", "idle"];

export default function DashboardPage() {
  const { data, ix, month, setMonth, today, access } = useCrm();
  const router = useRouter();
  const m = useMonthModel();
  const t = m.team;
  const p = t.pace;
  const cal = m.cal;
  const rows = useMemo(() => dailyRows(cal, t.plan, ix.day, ix.hoursDay), [cal, t.plan, ix]);

  const empty = data.operators.filter((o) => !o.deletedAt).length === 0 && data.leads.length === 0;
  const past = cal.phase === "past";
  const future = cal.phase === "future";

  const top = useMemo(
    () =>
      m.ops
        .filter((r) => r.pace.fact > 0)
        .sort((a, b) => b.pace.fact - a.pace.fact || (b.lph ?? 0) - (a.lph ?? 0))
        .slice(0, 6),
    [m.ops],
  );

  const attendance = safeDiv(t.opDays, p.elapsedW);

  const sub = future
    ? `${fmtMonth(month)} ещё не начался · ${cal.W} ${plural(cal.W, ["рабочий день", "рабочих дня", "рабочих дней"])}`
    : past
      ? `${fmtMonth(month)} · месяц закрыт · ${cal.W} ${plural(cal.W, ["рабочий день", "рабочих дня", "рабочих дней"])}`
      : `${fmtMonth(month)} · на ${fmtDay(today)}, ${fmtWeekday(today)} · прошло ${p.elapsedW} из ${cal.W} рабочих дней`;

  return (
    <div className="stack">
      <PageHead title={access.isHead ? "Сводка" : `Сводка · ${access.scopeLabel}`} sub={sub} actions={<MonthSwitcher value={month} onChange={setMonth} />} />

      {empty ? (
        <Onboarding />
      ) : (
        <>
          {/* ── главное: план / факт / прогноз ─────────────────────── */}
          <div className="card hero-grid">
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: "var(--text-sub)", marginBottom: 4 }}>Передано лидов{past ? " за месяц" : ""}</div>
              <div className="row" style={{ alignItems: "baseline", gap: 10 }}>
                <span style={{ fontSize: 52, fontWeight: 600, letterSpacing: "-.03em", lineHeight: 1 }}>{fmtInt(p.fact)}</span>
                <span style={{ fontSize: 15, color: "var(--text-sub)" }}>из {fmtInt(t.plan)}</span>
              </div>
              <Progress value={p.pct} marker={!past && t.plan > 0 ? p.planToDate / t.plan : undefined} height={8} style={{ margin: "14px 0 10px" }} />
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                <Chip hue={PACE_HUE[t.status]} dot>
                  {fmtPct(p.pct)} плана
                </Chip>
                {!past && !future && t.plan > 0 && (
                  <Chip hue={p.rrPct >= 1 ? "green" : p.rrPct >= data.settings.lagPct / 100 ? "amber" : "red"} dot title="Run Rate: сколько будет к концу месяца, если темп сохранится">
                    RR {fmtPct(p.rrPct)} плана
                  </Chip>
                )}
                {!future && t.plan > 0 && <StatusChip status={t.status} />}
                {t.plan === 0 && (
                  <Link href="/plans" className="chip" style={{ textDecoration: "none" }}>
                    План не задан →
                  </Link>
                )}
              </div>
              {t.planSource === "sum" && t.plan > 0 && <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 8 }}>План команды = сумма планов групп и операторов</div>}
            </div>
            <div className="grid3" style={{ gap: 10 }}>
              <HeroStat
                label={past ? "Выполнение плана" : "К плану на сегодня"}
                value={t.plan > 0 ? fmtPct(past ? p.pct : p.paceRatio) : "—"}
                sub={t.plan > 0 ? (past ? "факт / план месяца" : "факт / план на сегодня") : "план не задан"}
                tone={t.plan > 0 ? ((past ? p.pct : p.paceRatio) >= data.settings.normalPct / 100 ? "good" : (past ? p.pct : p.paceRatio) >= data.settings.lagPct / 100 ? "warn" : "bad") : undefined}
              />
              <HeroStat label={past ? "Не хватило до плана" : "Осталось до плана"} value={fmtInt(p.remaining)} sub={p.remaining === 0 && t.plan > 0 ? "План выполнен" : `${plural(p.remaining, LEADS)}`} />
              <HeroStat
                label="Нужно в рабочий день"
                value={p.needPerDay == null ? "—" : fmtNum(p.needPerDay)}
                sub={p.needPerDay == null ? (past ? "месяц закрыт" : "рабочих дней не осталось") : `осталось ${p.remainingW} ${plural(p.remainingW, DAYS)} · сейчас ${fmtNum(p.avgPerDay)}`}
                tone={p.needPerDay != null && p.elapsedW > 0 ? (p.needPerDay <= p.avgPerDay ? "good" : "bad") : undefined}
              />
              <HeroStat label={past ? "План месяца" : "Должно быть к сегодня"} value={fmtNum(past ? t.plan : p.planToDate, 0)} sub={`дневной план ${fmtNum(p.dailyPlan)}`} />
              <HeroStat label="Отклонение от плана" value={fmtSigned(p.deviation)} sub={past ? "к итоговому плану" : "к плану на сегодня"} tone={p.deviation >= 0 ? "good" : "bad"} />
              <HeroStat
                label="RR"
                value={fmtInt(p.rr)}
                sub="к концу месяца при текущем темпе"
                tone={t.plan > 0 ? (p.rrPct >= 1 ? "good" : p.rrPct >= data.settings.lagPct / 100 ? "warn" : "bad") : undefined}
              />
            </div>
          </div>

          {/* ── оперативно ─────────────────────────────────────────── */}
          {/* 6 плиток: в ряд, а когда не влезают — 3 + 3, без одинокой плитки на второй строке */}
          <div className="kpi-grid" data-n={!past && !future ? 6 : 4}>
            {!past && !future && (
              <>
                <Kpi label="Передано сегодня" value={fmtInt(p.today)} sub={!cal.isWork(today) ? "сегодня выходной" : p.dailyPlan > 0 ? `дневной план ${fmtNum(p.dailyPlan)}` : undefined} />
                <Kpi label="Вчера" value={fmtInt(p.yesterday)} sub={`${fmtDay(addDays(today, -1))}, ${fmtWeekday(addDays(today, -1))}`} />
              </>
            )}
            <Kpi
              label={past ? `Неделя ${fmtRange(weekStart(cal.ref), cal.ref)}` : "Текущая неделя"}
              value={fmtInt(p.thisWeek)}
              delta={p.weekChange != null ? { text: fmtSignedPct(p.weekChange), good: p.weekChange >= 0 } : undefined}
              sub="темп к прошлой неделе"
              title="Изменение среднего числа лидов в рабочий день относительно предыдущей недели"
            />
            <Kpi label="Прошлая неделя" value={fmtInt(p.prevWeek)} sub={fmtRange(addDays(weekStart(cal.ref), -7), addDays(weekStart(cal.ref), -1))} />
            <Kpi label="Конверсия" title="Лиды ÷ отработанные часы" value={<Conv value={t.lph} />} sub={`${fmtNum(t.hours, 0)} ч отработано за месяц`} onClick={() => router.push("/schedule")} />
            <Kpi label="В штате" title="Активных операторов" value={fmtInt(t.headcount)} sub={`в среднем ${fmtNum(attendance)} на смене`} onClick={() => router.push("/operators")} />
          </div>

          <div className="cols-main">
            {/* ── графики ─────────────────────────────────────────── */}
            <div className="stack">
              <div className="card card-pad">
                <div className="card-head">
                  <div>
                    <h3 className="card-title">Накопительный итог</h3>
                    <p className="card-sub">Факт против плана по рабочим дням{!past && !future ? " и прогноз по текущему темпу" : ""}</p>
                  </div>
                  <Legend
                    items={[
                      { color: "var(--brand)", label: "Факт" },
                      { color: "var(--text-sub3)", label: "План", dashed: true },
                      ...(!past && !future ? [{ color: "var(--brand)", label: "Прогноз (RR)", dashed: true }] : []),
                    ]}
                  />
                </div>
                <CumulativeChart rows={rows} rr={p.rr} showForecast={!past && !future && p.elapsedW > 0} />
              </div>
              <div className="card card-pad">
                <div className="card-head">
                  <div>
                    <h3 className="card-title">Лиды по дням</h3>
                    <p className="card-sub">Пунктир — дневной план ({fmtNum(p.dailyPlan)})</p>
                  </div>
                  <Legend
                    items={[
                      { color: "var(--brand)", label: "План дня выполнен", bar: true },
                      { color: "color-mix(in srgb, var(--brand-soft) 55%, transparent)", label: "Ниже плана", bar: true },
                    ]}
                  />
                </div>
                <DailyBars rows={rows} dailyPlan={p.dailyPlan} />
              </div>
              <div className="card card-tbl" style={{ overflow: "hidden" }}>
              <div className="card-head" style={{ padding: "16px 18px 0" }}>
              <div>
              <h3 className="card-title">Группы</h3>
              <p className="card-sub">Факт по группе оператора на момент передачи лида</p>
              </div>
              <Link href="/groups" className="btn btn-sm btn-ghost">
              Подробно <Icon name="chevR" size={13} />
              </Link>
              </div>
              {m.groups.length === 0 ? (
              <Empty icon="groups" title="Групп нет" text="Можно работать и без групп — тогда все считаются вместе." />
              ) : (
              <div style={{ overflowX: "auto" }}>
              <table className="tbl tbl-fit">
              <thead>
              <tr>
              <th>Группа</th>
              <th className="r">План</th>
              <th className="r">Факт</th>
              <th style={{ minWidth: 110 }}>Выполнение</th>
              <th className="r" title="Run Rate — прогноз на конец месяца">Прогноз</th>
              <th className="r">Нужно/день</th>
              <th className="r">Людей</th>
              <th className="r" title="Конверсия: лиды ÷ отработанные часы">Конв.</th>
              </tr>
              </thead>
              <tbody>
              {m.groups.map((g) => (
              <tr key={g.key} className="clickable" onClick={() => router.push("/groups")}>
              <td>
              <span className="row" style={{ gap: 8 }}>
              <Swatch hue={g.color} />
              {g.name}
              </span>
              </td>
              <td className="r num">{fmtInt(g.plan)}</td>
              <td className="r num" style={{ fontWeight: 600 }}>
              <LeadN n={g.pace.fact} />
              </td>
              <td>
              <div className="row" style={{ gap: 8 }}>
              <Progress value={g.pace.pct} marker={!past && g.plan > 0 ? g.pace.planToDate / g.plan : undefined} style={{ flex: 1, minWidth: 50 }} />
              <span className="num" style={{ fontSize: 12, width: 38, textAlign: "right" }}>
              {fmtPct(g.pace.pct)}
              </span>
              </div>
              </td>
              <td className="r num">
              {fmtInt(g.pace.rr)} <span className="muted">· {fmtPct(g.pace.rrPct)}</span>
              </td>
              <td className="r num">{g.pace.needPerDay == null ? "—" : fmtNum(g.pace.needPerDay)}</td>
              <td className="r num">{g.headcount}</td>
              <td className="r num"><Conv value={g.lph} /></td>
              </tr>
              ))}
              </tbody>
              </table>
              </div>
              )}
              </div>
            <div className="card card-pad">
              <div className="card-head">
                <div>
                  <h3 className="card-title">Лучший результат</h3>
                  <p className="card-sub">По числу переданных лидов за месяц</p>
                </div>
              </div>
                {top.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--dim)" }}>Пока нет переданных лидов.</div>
                ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {top.map((r, i) => (
                <Link key={r.op.id} href={`/operators?id=${encodeURIComponent(r.op.id)}`} className="row" style={{ gap: 10, textDecoration: "none", color: "var(--text)" }}>
                <span className="num" style={{ width: 16, fontSize: 12, color: "var(--dim)" }}>
                {i + 1}
                </span>
                <Avatar name={r.op.name} id={r.op.id} size={26} />
                <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{shortName(r.op.name)}</span>
                <span style={{ fontSize: 11.5, color: "var(--dim)" }}>
                {r.lph != null ? `конв. ${fmtPct(r.lph)} · ` : ""}
                {fmtPct(r.pace.pct)} плана
                </span>
                </span>
                <span className="num" style={{ fontWeight: 600, fontSize: 15 }}>
                {fmtInt(r.pace.fact)}
                </span>
                </Link>
                ))}
                </div>
                )}
              </div>
            </div>


            {/* ── люди и темп ─────────────────────────────────────── */}
            <div className="stack">
              <div className="card card-pad">
                <div className="card-head">
                  <div>
                    <h3 className="card-title">Кто как идёт</h3>
                    <p className="card-sub">Факт к личному плану на {past ? "конец месяца" : "сегодня"}</p>
                  </div>
                  <Link href="/operators" className="btn btn-sm btn-ghost">
                    Все <Icon name="chevR" size={13} />
                  </Link>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {BUCKETS.map((b) => {
                    const people = m.ops.filter((r) => r.status === b && !r.op.deletedAt);
                    if (!people.length) return null;
                    return (
                      <div key={b}>
                        <div className="row" style={{ marginBottom: 6 }}>
                          <StatusChip status={b} />
                          <span style={{ fontSize: 12, color: "var(--dim)" }}>
                            {people.length} {plural(people.length, OPS)}
                          </span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {people
                            .sort((a, z) => z.pace.paceRatio - a.pace.paceRatio)
                            .map((r) => (
                              <Link
                                key={r.op.id}
                                href={`/operators?id=${encodeURIComponent(r.op.id)}`}
                                className="row"
                                style={{ gap: 6, padding: "3px 8px 3px 3px", borderRadius: 6, border: "1px solid var(--ink-08)", textDecoration: "none", color: "var(--text)", fontSize: 12 }}
                                title={`${r.op.name}: ${fmtInt(r.pace.fact)} из ${fmtInt(r.terms.plan)}, к плану на дату ${fmtPct(r.pace.paceRatio)}`}
                              >
                                <Avatar name={r.op.name} id={r.op.id} size={20} />
                                {shortName(r.op.name)}
                                <span className="num" style={{ color: "var(--dim)" }}>
                                  {fmtPct(r.pace.paceRatio)}
                                </span>
                              </Link>
                            ))}
                        </div>
                      </div>
                    );
                  })}
                  {m.ops.length === 0 && <div style={{ fontSize: 13, color: "var(--dim)" }}>В этом месяце нет операторов.</div>}
                  {(m.statusCount.paused > 0 || m.statusCount.noplan > 0) && (
                    <div style={{ fontSize: 12, color: "var(--dim)" }}>
                      {m.statusCount.paused > 0 && `На паузе: ${m.statusCount.paused}. `}
                      {m.statusCount.noplan > 0 && `Без плана: ${m.statusCount.noplan}.`}
                    </div>
                  )}
                </div>
              </div>

              <MorningCard m={m} />

              <div className="card card-pad">
                <h3 className="card-title" style={{ marginBottom: 10 }}>Темп</h3>
                <div className="grid2" style={{ gap: 12 }}>
                  <MiniStat label="Лучший день" value={p.best ? `${fmtInt(p.best.count)}` : "—"} sub={p.best ? fmtDayShort(p.best.day) : undefined} />
                  <MiniStat label="Худший рабочий день" value={p.worst ? `${fmtInt(p.worst.count)}` : "—"} sub={p.worst ? fmtDayShort(p.worst.day) : undefined} />
                  <MiniStat label="Дней с выполненным темпом" value={p.daysCounted ? `${p.daysMet} из ${p.daysCounted}` : "—"} sub={`дневной план ${fmtNum(p.dailyPlan)}`} />
                  <MiniStat label="Темп к прошлой неделе" value={p.weekChange == null ? "—" : fmtSignedPct(p.weekChange)} sub="лидов в рабочий день" tone={p.weekChange == null ? undefined : p.weekChange >= 0 ? "good" : "bad"} />
                </div>
              </div>

              {!past && !future && (
                <div className="card card-pad">
                  <h3 className="card-title" style={{ marginBottom: 8 }}>Хватает ли людей</h3>
                  {t.neededOps != null && t.perOpDay > 0 ? (
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-sub)" }}>
                      Оператор в среднем передаёт <b style={{ color: "var(--text)" }}>{fmtNum(t.perOpDay)}</b> {plural(Math.round(t.perOpDay), LEADS)} за смену. Чтобы
                      выполнить план, нужно <b style={{ color: "var(--text)" }}>≈ {Math.ceil(t.neededOps)}</b> {plural(Math.ceil(t.neededOps), OPS)} на смене каждый
                      рабочий день, сейчас выходит в среднем <b style={{ color: "var(--text)" }}>{fmtNum(attendance)}</b>.
                      <div style={{ marginTop: 8 }}>
                        {Math.ceil(t.neededOps) > attendance + 0.5 ? (
                          <Chip hue="red" dot>
                            Не хватает ≈ {Math.ceil(t.neededOps - attendance)} {plural(Math.ceil(t.neededOps - attendance), OPS)} в смену
                          </Chip>
                        ) : (
                          <Chip hue="green" dot>
                            Состава хватает
                          </Chip>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: "var(--dim)" }}>Нужны лиды и смены за прошедшие дни, чтобы оценить выработку.</div>
                  )}
                </div>
              )}
            </div>
            </div>

        </>
      )}
    </div>
  );
}

function HeroStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "var(--c-green-fg)" : tone === "bad" ? "var(--c-red-fg)" : tone === "warn" ? "var(--c-amber-fg)" : "var(--text)";
  return (
    <div style={{ padding: "10px 12px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--ink-06)", minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-sub)", lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, color, marginTop: 2, letterSpacing: "-.01em" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--dim)", marginTop: 1, lineHeight: 1.3 }}>{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11.5, color: "var(--text-sub)" }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 600, marginTop: 2, color: tone === "good" ? "var(--c-green-fg)" : tone === "bad" ? "var(--c-red-fg)" : "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: "var(--dim)" }}>{sub}</div>}
    </div>
  );
}
