"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { employmentShare, goneLast, isGone, type GroupRow, type OpRow, type PaceStatus } from "@/lib/crm/calc";
import { planId } from "@/lib/crm/ids";
import { fmtMonth, fmtRange, isWorkday, rangeDays, weekEnd, weekStart } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct, fmtSigned, safeDiv, shortName } from "@/lib/crm/format";
import { Avatar, Chip, Empty, GoneSepRow, GoneTag, Kpi, MonthSwitcher, PageHead, Progress, Seg, StatusChip, Swatch, foldRow, useFoldGroups } from "@/components/ui/kit";
import { Select, dot, type Opt } from "@/components/ui/select";
import { canEditPlan } from "@/lib/crm/access";
import { Icon } from "@/components/ui/icons";

type Pace = "all" | "behind" | "ok";
const BEHIND: PaceStatus[] = ["lagging", "critical", "idle"];
const OK: PaceStatus[] = ["ahead", "ontrack"];

/**
 * Поле плана месяца. Показывает действующий план — одно число, без «по умолчанию / в расчёте».
 * Обычным шрифтом — план посчитан сам (из карточки или суммой), жирным с рамкой — задан на этот месяц.
 * Очистить поле или нажать ↺ — вернуть автоматический план.
 */
function PlanInput({ value, explicit, onSave, disabled, auto }: { value: number; explicit: boolean; onSave: (v: number | null) => void; disabled?: boolean; auto: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const t = text.trim().replace(/\s/g, "").replace(",", ".");
    if (t === "") {
      if (explicit) onSave(null);
      else setText(String(value));
      return;
    }
    const v = Math.round(Number(t));
    if (!Number.isFinite(v) || v < 0) {
      setText(String(value));
      return;
    }
    if (v !== value) onSave(v);
  };
  return (
    <span className="row" style={{ gap: 4, justifyContent: "flex-end" }} onClick={(e) => e.stopPropagation()}>
      {explicit && !disabled && (
        <button className="btn btn-ghost btn-sm" style={{ padding: "0 5px" }} title={`Вернуть автоматический план (${auto})`} onClick={() => onSave(null)}>
          <Icon name="restore" size={12} />
        </button>
      )}
      <input
        className="inp inp-sm num"
        style={{ width: 84, textAlign: "right", fontWeight: explicit ? 600 : undefined, borderColor: explicit ? "var(--brand-border)" : undefined }}
        inputMode="numeric"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setText(String(value));
        }}
        title={disabled ? "Менять этот план может РОП" : explicit ? `План задан на этот месяц. Автоматически было бы: ${auto}.` : `Автоматически: ${auto}. Впишите число — план станет именно таким на этот месяц.`}
      />
    </span>
  );
}

/** Распределение плана группы между операторами: сумма личных планов против плана группы. */
function Distribution({ plan, given, compact }: { plan: number; given: number; compact?: boolean }) {
  const d = Math.round(plan - given);
  if (plan <= 0 && given <= 0) return <span className="muted">—</span>;
  if (d === 0)
    return compact ? (
      <span title={`Личные планы распределены полностью: ${fmtInt(given)} из ${fmtInt(plan)}`}>
        <Chip hue="green">✓ {fmtInt(given)} из {fmtInt(plan)}</Chip>
      </span>
    ) : (
      <Chip hue="green">распределено {fmtInt(given)} из {fmtInt(plan)}</Chip>
    );
  if (compact)
    return (
      <span title={`Сумма личных планов ${fmtInt(given)} из плана группы ${fmtInt(plan)} — ${d > 0 ? `не хватает ${fmtInt(d)}` : `лишние ${fmtInt(-d)}`}`}>
        <Chip hue="amber">
          {fmtInt(given)} из {fmtInt(plan)} · {d > 0 ? "−" : "+"}
          {fmtInt(Math.abs(d))}
        </Chip>
      </span>
    );
  return (
    <Chip hue="amber">
      распределено {fmtInt(given)} из {fmtInt(plan)} · {d > 0 ? `не хватает ${fmtInt(d)}` : `лишние ${fmtInt(-d)}`}
    </Chip>
  );
}

/** То же для карточки группы: строкой текста, переносится, не вылезает за край. */
function DistLine({ plan, given }: { plan: number; given: number }) {
  const d = Math.round(plan - given);
  if (plan <= 0 && given <= 0) return null;
  const tail = d === 0 ? "распределено полностью" : d > 0 ? `не хватает ${fmtInt(d)}` : `лишние ${fmtInt(-d)}`;
  return (
    <span className="row" style={{ gap: 6, fontSize: 12, lineHeight: 1.35, alignItems: "flex-start", color: d === 0 ? "var(--c-green-fg)" : "var(--c-amber-fg)" }}>
      <Icon name={d === 0 ? "check" : "alert"} size={13} style={{ flex: "none", marginTop: 1 }} />
      <span>
        Личные планы: {fmtInt(given)} из {fmtInt(plan)} — {tail}
      </span>
    </span>
  );
}

interface Section {
  g: GroupRow;
  /** Операторы на линии — без супервайзеров: у СВ нет личного плана по лидам. */
  line: OpRow[];
  rows: OpRow[];
  given: number;
}

export default function PlansPage() {
  const { data, ix, month, setMonth, savePlan, today, access, confirm, toast } = useCrm();
  const m = useMonthModel();
  const s = data.settings;
  const cal = m.cal;
  const head = access.isHead;
  const [q, setQ] = useState("");
  const [grp, setGrp] = useState("");
  const [pace, setPace] = useState<Pace>("all");
  const wrapRef = useRef<HTMLDivElement>(null);
  const fold = useFoldGroups(wrapRef);

  // план на неделю и к дате — пропорционально рабочим дням
  const refDay = cal.phase === "current" ? today : cal.days[0];
  const ws = weekStart(refDay);
  const we = weekEnd(refDay);
  const weekW = rangeDays(ws, we).filter((d) => d.slice(0, 7) === month && isWorkday(d, s)).length;
  const share = (plan: number) => ({ day: plan / cal.W, week: (plan * weekW) / cal.W });

  const userRec = (id: string) => {
    const r = ix.planById.get(id);
    return r && !r.auto ? r : undefined;
  };
  const svName = (g: GroupRow) => {
    const id = g.group?.supervisorId;
    return id ? shortName(ix.opById.get(id)?.name ?? "") : "";
  };

  const sections = useMemo<Section[]>(() => {
    const needle = q.trim().toLowerCase();
    return m.groups.map((g) => {
      const all = m.ops
        .filter((r) => r.groupKey === g.key && !ix.svIds.has(r.op.id) && (!r.op.deletedAt || r.pace.fact > 0))
        .sort((a, b) => goneLast(a.op, b.op) || a.op.name.localeCompare(b.op.name, "ru"));
      const line = all.filter((r) => !r.op.deletedAt);
      const rows = all.filter(
        (r) =>
          (!needle || r.op.name.toLowerCase().includes(needle)) &&
          (pace === "all" || (pace === "behind" ? BEHIND : OK).includes(r.status)),
      );
      return { g, line, rows, given: line.reduce((a, r) => a + r.terms.plan, 0) };
    });
  }, [m, ix, q, pace]);

  const shown = sections.filter((sec) => (!grp || sec.g.key === grp) && (sec.rows.length > 0 || (!q.trim() && pace === "all")));
  const tot = shown.reduce(
    (a, sec) => ({ plan: a.plan + sec.g.plan, toDate: a.toDate + sec.g.pace.planToDate, fact: a.fact + sec.g.pace.fact, given: a.given + sec.given }),
    { plan: 0, toDate: 0, fact: 0, given: 0 },
  );
  const groupOpts: Opt[] = [{ value: "", label: head ? "Все группы" : "Все мои группы" }, ...m.groups.map<Opt>((g) => ({ value: g.key, label: g.name, icon: dot(g.color) }))];

  /** План группы — поровну на операторов с учётом рабочих дней в штате (принятый 15-го получит меньше). */
  const distribute = async (sec: Section) => {
    const who = sec.line.filter((r) => r.op.status !== "fired" && employmentShare(r.op, cal) > 0 && canEditPlan(access, "operator", r.op.id));
    if (!who.length || sec.g.plan <= 0) return;
    const w = who.map((r) => employmentShare(r.op, cal));
    const W = w.reduce((a, x) => a + x, 0);
    const raw = w.map((x) => (sec.g.plan * x) / W);
    const out = raw.map(Math.floor);
    let rest = sec.g.plan - out.reduce((a, x) => a + x, 0);
    raw.map((x, i) => [x - Math.floor(x), i] as const)
      .sort((a, b) => b[0] - a[0])
      .forEach(([, i]) => {
        if (rest > 0) {
          out[i]++;
          rest--;
        }
      });
    const ok = await confirm({
      title: `Распределить ${fmtInt(sec.g.plan)} лидов?`,
      text: `План группы «${sec.g.name}» на ${fmtMonth(month).toLowerCase()} разделится между ${who.length} операторами поровну с учётом рабочих дней в штате. Личные планы этого месяца перезапишутся.`,
      ok: "Распределить",
    });
    if (!ok) return;
    for (let i = 0; i < who.length; i++) if (out[i] !== who[i].terms.plan) await savePlan(month, "operator", who[i].op.id, out[i]);
    toast(`План группы «${sec.g.name}» распределён`);
  };

  const team = m.team;
  const many = m.groups.length > 1;
  return (
    <div className="stack">
      <PageHead
        title="Планы"
        sub={
          head
            ? `${fmtMonth(month)} · план отдела — сумма планов групп, план группы делится между операторами`
            : `${fmtMonth(month)} · планы ${many ? "ваших групп" : "вашей группы"} и операторов`
        }
        actions={<MonthSwitcher value={month} onChange={setMonth} />}
      />

      <div className="kpi-grid" data-n={cal.phase === "current" ? 6 : 4}>
        <Kpi label={head ? "План отдела" : many ? "План ваших групп" : "План группы"} icon="target" value={fmtInt(team.plan)} sub={many ? `сумма ${m.groups.length} групп` : `${cal.W} раб. дней`} />
        <Kpi label="Факт" value={fmtInt(team.pace.fact)} sub={`${fmtPct(team.pace.pct)} плана`} />
        {cal.phase === "current" && (
          <Kpi
            label="К сегодня"
            icon="calendar"
            value={fmtNum(team.pace.planToDate)}
            delta={{ text: fmtSigned(Math.round(team.pace.deviation)), good: team.pace.deviation >= 0 }}
            sub="факт против плана на дату"
          />
        )}
        <Kpi label="В рабочий день" icon="clock" value={fmtNum(share(team.plan).day)} sub={`на неделю ${fmtRange(ws, we)}: ${fmtNum(share(team.plan).week)}`} />
        {cal.phase === "current" && <Kpi label="Прогноз" icon="trend" value={fmtInt(team.pace.rr)} sub={`${fmtPct(team.pace.rrPct)} плана по текущему темпу`} />}
        <Kpi
          label="Нужно в день"
          icon="bolt"
          value={team.pace.needPerDay == null ? "—" : fmtNum(team.pace.needPerDay)}
          sub={team.pace.needPerDay == null ? "месяц закрыт" : `${team.pace.remainingW} раб. дн. осталось`}
        />
      </div>

      {m.groups.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: many ? "repeat(auto-fill, minmax(300px, 1fr))" : "minmax(0, 380px)", gap: 12 }}>
          {sections.map((sec) => {
            const g = sec.g;
            const on = grp === g.key;
            return (
              <button
                key={g.key}
                type="button"
                className="card card-pad"
                onClick={() => many && setGrp(on ? "" : g.key)}
                title={!many ? undefined : on ? "Показать все группы" : "Показать только эту группу"}
                style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: 10, minWidth: 0, cursor: many ? "pointer" : "default", font: "inherit", color: "inherit", borderColor: on ? "var(--text)" : undefined }}
              >
                <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span className="row" style={{ gap: 8, minWidth: 0 }}>
                    <Swatch hue={g.color} />
                    <b style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 14 }}>{g.name}</b>
                    <span className="num" style={{ fontWeight: 600 }}>{fmtPct(g.pace.pct)}</span>
                  </span>
                  <span className="muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {sec.line.length} чел.{svName(g) ? ` · СВ ${svName(g)}` : ""}
                  </span>
                </span>
                <span className="row" style={{ gap: 6, alignItems: "baseline" }}>
                  <span className="num" style={{ fontSize: 22, fontWeight: 650 }}>{fmtInt(g.pace.fact)}</span>
                  <span className="muted">из {fmtInt(g.plan)} лидов</span>
                </span>
                <Progress value={safeDiv(g.pace.fact, g.plan)} marker={cal.phase === "current" ? safeDiv(g.pace.planToDate, g.plan) : undefined} hue={g.color} />
                <DistLine plan={g.plan} given={sec.given} />
              </button>
            );
          })}
        </div>
      )}

      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="toolbar">
          <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 280 }}>
            <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--dim)" }} />
            <input className="inp" style={{ paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Оператор" />
          </div>
          {many && <Select width={200} value={grp} options={groupOpts} onChange={setGrp} ariaLabel="Группа" />}
          <Seg<Pace>
            value={pace}
            onChange={setPace}
            options={[
              { value: "all", label: "Все" },
              { value: "behind", label: "Отстают" },
              { value: "ok", label: "В плане" },
            ]}
          />
          <span style={{ fontSize: 12, color: "var(--dim)", marginLeft: "auto" }}>
            Число в рамке — план задан вручную; ↺ — вернуть автоматический
          </span>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card">
          <Empty icon="target" title="Никого не найдено" text="Смените фильтры или месяц." />
        </div>
      ) : (
        <div ref={wrapRef} className="tbl-wrap" style={{ maxHeight: "max(320px, calc(100vh / var(--ui-scale, 1) - 290px))" }}>
          <table className="tbl tbl-fit">
            <thead>
              <tr>
                <th className="sticky-col" style={{ minWidth: 260 }}>Группа / оператор</th>
                <th className="r" title="Действующий план на месяц">План месяца</th>
                <th className="r">В день</th>
                <th className="r">На неделю</th>
                <th className="r" title="Сколько должно быть к сегодня по рабочим дням">К сегодня</th>
                <th className="r bl">Факт</th>
                <th style={{ minWidth: 150 }}>Выполнение</th>
                <th>Статус</th>
              </tr>
            </thead>
            {shown.map((sec) => {
              const g = sec.g;
              const closed = fold.isClosed(g.key);
              const phase = fold.phase(g.key);
              const gRec = g.group ? userRec(planId(month, "group", g.group.id)) : undefined;
              const gAuto = g.group && g.group.monthlyPlan > 0 ? g.group.monthlyPlan : sec.given;
              const gEdit = !!g.group && !g.group.deletedAt && canEditPlan(access, "group", g.group.id);
              return (
                <tbody key={g.key} data-fold={g.key}>
                  <tr className="grp-head" onClick={() => fold.toggle(g.key)} title={closed ? "Развернуть группу" : "Свернуть группу"} aria-expanded={!closed}>
                    <td className="sticky-col">
                      <span className="row" style={{ gap: 8 }}>
                        <Icon name="chevR" size={14} className={`grp-chev${closed || phase === "out" ? "" : " open"}`} />
                        <Swatch hue={g.color} />
                        <span>{g.name}</span>
                        <span className="grp-head-sub">
                          {sec.line.length} чел.{svName(g) ? ` · СВ ${svName(g)}` : ""}
                        </span>
                      </span>
                    </td>
                    <td className="r">
                      {g.group && !g.group.deletedAt ? (
                        <PlanInput value={g.plan} explicit={!!gRec} auto={`${fmtInt(gAuto)}${g.group.monthlyPlan > 0 ? " из карточки группы" : " — сумма личных планов"}`} disabled={!gEdit} onSave={(v) => void savePlan(month, "group", g.group!.id, v)} />
                      ) : (
                        <span className="num" title="Без группы: сумма личных планов">{fmtInt(g.plan)}</span>
                      )}
                    </td>
                    <td className="r num">{fmtNum(share(g.plan).day)}</td>
                    <td className="r num">{fmtNum(share(g.plan).week)}</td>
                    <td className="r num">{fmtNum(g.pace.planToDate)}</td>
                    <td className="r num bl">{fmtInt(g.pace.fact)}</td>
                    <td>
                      <span className="row" style={{ gap: 8 }}>
                        <Progress value={safeDiv(g.pace.fact, g.plan)} hue={g.color} style={{ flex: 1, minWidth: 70 }} />
                        <span className="num" style={{ minWidth: 44, textAlign: "right" }}>{fmtPct(g.pace.pct)}</span>
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <span className="row" style={{ gap: 6 }}>
                        <Distribution plan={g.plan} given={sec.given} compact />
                        {g.group && Math.round(g.plan - sec.given) !== 0 && sec.line.some((r) => canEditPlan(access, "operator", r.op.id)) && (
                          <button className="btn btn-ghost btn-sm" title="Разделить план группы между операторами с учётом рабочих дней в штате" onClick={() => void distribute(sec)}>
                            Распределить
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                  {!closed &&
                    sec.rows.map((r, i) => {
                      const f = foldRow(phase, i);
                      const rec = userRec(planId(month, "operator", r.op.id));
                      const sh = employmentShare(r.op, cal);
                      const base = r.op.monthlyPlan ?? s.defaultOperatorPlan;
                      const auto = Math.round(base * sh);
                      const days = Math.round(sh * cal.W);
                      return (
                        <Fragment key={r.op.id}>
                          {isGone(r.op) && (i === 0 || !isGone(sec.rows[i - 1].op)) && <GoneSepRow count={sec.rows.filter((x) => isGone(x.op)).length} colSpan={8} indent={28} />}
                          <tr className={`${f.className}${r.op.status !== "active" ? " dim" : ""}`} style={f.style}>
                            <td className="sticky-col" style={{ paddingLeft: 28 }}>
                              <span className="row" style={{ gap: 8 }}>
                                <Avatar name={r.op.name} id={r.op.id} size={22} />
                                <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
                                  <span className="row" style={{ gap: 6 }}>
                                    {shortName(r.op.name)}
                                    <GoneTag op={r.op} />
                                  </span>
                                  {!rec && sh > 0 && sh < 1 && (
                                    <span className="muted" style={{ fontSize: 11 }} title={`Принят или уволен посреди месяца: план ${fmtInt(base)} уменьшен по рабочим дням в штате`}>
                                      в штате {days} из {cal.W} раб. дн. → {fmtInt(base)} × {days}/{cal.W}
                                    </span>
                                  )}
                                </span>
                              </span>
                            </td>
                            <td className="r">
                              <PlanInput
                                value={r.terms.plan}
                                explicit={!!rec}
                                auto={`${fmtInt(auto)}${r.op.monthlyPlan != null ? " из карточки" : " по умолчанию"}${sh < 1 ? " с учётом дней в штате" : ""}`}
                                disabled={!canEditPlan(access, "operator", r.op.id)}
                                onSave={(v) => void savePlan(month, "operator", r.op.id, v)}
                              />
                            </td>
                            <td className="r num">{fmtNum(share(r.terms.plan).day)}</td>
                            <td className="r num">{fmtNum(share(r.terms.plan).week)}</td>
                            <td className="r num">{fmtNum(r.pace.planToDate)}</td>
                            <td className="r num bl">{fmtInt(r.pace.fact)}</td>
                            <td>
                              <span className="row" style={{ gap: 8 }}>
                                <Progress value={safeDiv(r.pace.fact, r.terms.plan)} marker={cal.phase === "current" ? safeDiv(r.pace.planToDate, r.terms.plan) : undefined} style={{ flex: 1, minWidth: 70 }} />
                                <span className="num" style={{ minWidth: 44, textAlign: "right" }}>{fmtPct(r.pace.pct)}</span>
                              </span>
                            </td>
                            <td>
                              <StatusChip status={r.status} />
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
                <td className="sticky-col">Итого · {shown.length === sections.length ? (head ? "отдел" : "все группы") : `${shown.length} из ${sections.length} групп`}</td>
                <td className="r num">{fmtInt(tot.plan)}</td>
                <td className="r num">{fmtNum(share(tot.plan).day)}</td>
                <td className="r num">{fmtNum(share(tot.plan).week)}</td>
                <td className="r num">{fmtNum(tot.toDate)}</td>
                <td className="r num bl">{fmtInt(tot.fact)}</td>
                <td className="num">{fmtPct(safeDiv(tot.fact, tot.plan))}</td>
                <td>
                  <Distribution plan={tot.plan} given={tot.given} compact />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
