"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { PACE_HUE, PACE_LABEL, type OpRow, type Pace, type PaceStatus } from "@/lib/crm/calc";
import { NO_GROUP, NO_GROUP_LABEL, ROLE_LABEL, STATUS_LABEL, type Operator } from "@/lib/crm/types";
import { fmtMonth } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct, fmtSigned, safeDiv } from "@/lib/crm/format";
import { Avatar, Empty, GoneTag, MonthSwitcher, PageHead, Progress, Seg, SortTh, StatusChip, Swatch, Switch, downloadText, foldRow, hueVars, toCsv, useFoldGroups, type FoldPhase, type SortState } from "@/components/ui/kit";
import { Select, dot, type Opt } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";
import { OperatorDrawer } from "@/components/app/OperatorDrawer";

type Emp = "work" | "active" | "pause" | "fired" | "all";
type SortKey = "name" | "plan" | "fact" | "pct" | "dev" | "rr" | "left" | "need" | "today" | "week" | "prev" | "avg" | "hours" | "norm" | "lph";

const val = (r: OpRow, k: SortKey): number | string => {
  switch (k) {
    case "name": return r.op.name;
    case "plan": return r.terms.plan;
    case "fact": return r.pace.fact;
    case "pct": return r.pace.pct;
    case "dev": return r.pace.deviation;
    case "rr": return r.pace.rr;
    case "left": return r.pace.remaining;
    case "need": return r.pace.needPerDay ?? -1;
    case "today": return r.pace.today;
    case "week": return r.pace.thisWeek;
    case "prev": return r.pace.prevWeek;
    case "avg": return r.avgPerWorkday;
    case "hours": return r.hours;
    case "norm": return r.normPct;
    case "lph": return r.lph ?? -1;
  }
};

/** Строка без показателей — оператор не относится к выбранному месяцу. */
function blankRow(op: Operator, base: Pace): OpRow {
  return {
    op,
    groupKey: op.groupId || NO_GROUP,
    terms: { plan: 0, normHours: 0, payType: op.payType, salary: op.salary, hourlyRate: op.hourlyRate, leadBonus: op.leadBonus ?? 0, tiers: [], grade: op.grade, track: op.track, approvePct: 0, growth: null, explicit: false },
    pace: {
      ...base, plan: 0, fact: 0, pct: 0, planToDate: 0, deviation: 0, paceRatio: 0, remaining: 0, rr: 0, rrPct: 0, avgPerDay: 0,
      needPerDay: null, dailyPlan: 0, today: 0, yesterday: 0, thisWeek: 0, prevWeek: 0, weekChange: null, best: null, worst: null, daysMet: 0, daysCounted: 0,
    },
    status: op.status === "fired" ? "fired" : op.status === "pause" ? "paused" : "nodata",
    hours: 0, hoursToday: 0, hoursWeek: 0, norm: 0, normToDate: 0, hoursDelta: 0, normPct: 0, lph: null, daysWorked: 0,
    hasShifts: false, avgPerWorkday: 0, lastLead: null, absentDays: 0, isLeader: false, inWindow: false,
  };
}

const STATUS_FILTERS: PaceStatus[] = ["ahead", "ontrack", "lagging", "critical", "idle", "paused", "noplan"];

export default function OperatorsPage() {
  const { data, ix, month, setMonth, openOperator, access } = useCrm();
  const m = useMonthModel();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [emp, setEmp] = useState<Emp>("work");
  const [pace, setPace] = useState<Set<PaceStatus>>(new Set());
  const [showDeleted, setShowDeleted] = useState(false);
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "fact", dir: -1 });
  const [openId, setOpenId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fold = useFoldGroups(wrapRef);

  // группа строки: супервайзер — в группе, которую ведёт (как в зарплате); остальные — по карточке
  const led = useMemo(() => {
    const out = new Map<string, string>();
    for (const g of data.groups) if (!g.deletedAt && g.supervisorId && !out.has(g.supervisorId)) out.set(g.supervisorId, g.id);
    return out;
  }, [data.groups]);
  const keyOf = useCallback((r: OpRow) => led.get(r.op.id) ?? r.groupKey, [led]);

  // /operators?id=… — открыть карточку сразу
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) setOpenId(id);
  }, []);

  // операторы месяца с показателями + все остальные (принятые позже, уволенные раньше) с пустыми —
  // чтобы любого можно было найти, открыть и поправить
  const rows = useMemo(() => {
    const inModel = new Set(m.ops.map((r) => r.op.id));
    return [...m.ops, ...data.operators.filter((o) => !inModel.has(o.id)).map((o) => blankRow(o, m.team.pace))];
  }, [m.ops, m.team.pace, data.operators]);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const out = rows.filter((r) => {
      if (!showDeleted && r.op.deletedAt) return false;
      if (emp === "work" && r.op.status === "fired") return false;
      if (emp !== "work" && emp !== "all" && r.op.status !== emp) return false;
      if (group && keyOf(r) !== group) return false;
      if (pace.size && !pace.has(r.status)) return false;
      if (t && !r.op.name.toLowerCase().includes(t) && !r.op.contact.toLowerCase().includes(t)) return false;
      return true;
    });
    out.sort((a, b) => {
      const x = val(a, sort.key);
      const y = val(b, sort.key);
      const c = typeof x === "string" ? x.localeCompare(y as string, "ru") : (x as number) - (y as number);
      return c * sort.dir || a.op.name.localeCompare(b.op.name, "ru");
    });
    return out;
  }, [rows, q, group, emp, pace, showDeleted, sort, keyOf]);

  // по группам: у РОПа (и у всех, если в списке несколько групп) — строка-заголовок группы с итогами;
  // внутри группы порядок — по выбранной сортировке
  const sections = useMemo(() => {
    const map = new Map<string, OpRow[]>();
    for (const r of list) {
      const k = keyOf(r);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return Array.from(map.entries())
      .map(([key, rs]) => {
        const g = key === NO_GROUP ? null : ix.groupById.get(key);
        const sum = (f: (r: OpRow) => number) => rs.reduce((a, r) => a + f(r), 0);
        const plan = sum((r) => r.terms.plan);
        const fact = sum((r) => r.pace.fact);
        const hours = sum((r) => r.hours);
        return {
          key,
          name: g?.name ?? NO_GROUP_LABEL,
          color: g?.color ?? "gray",
          supervisor: g ? (g.supervisorId ? ix.opById.get(g.supervisorId)?.name : null) ?? (g.supervisorName || null) : null,
          status: m.groups.find((x) => x.key === key)?.status ?? null,
          rows: rs,
          t: {
            plan, fact, hours,
            planToDate: sum((r) => r.pace.planToDate),
            dev: sum((r) => r.pace.deviation),
            rr: sum((r) => r.pace.rr),
            left: sum((r) => r.pace.remaining),
            today: sum((r) => r.pace.today),
            week: sum((r) => r.pace.thisWeek),
            prev: sum((r) => r.pace.prevWeek),
          },
        };
      })
      .sort((a, b) => Number(a.key === NO_GROUP) - Number(b.key === NO_GROUP) || a.name.localeCompare(b.name, "ru"));
  }, [list, keyOf, ix, m.groups]);
  const grouped = access.viewAll || sections.length > 1;

  const counts = useMemo(() => {
    const c = {} as Record<PaceStatus, number>;
    for (const r of rows) {
      if (r.op.deletedAt && !showDeleted) continue;
      if (emp === "work" && r.op.status === "fired") continue;
      c[r.status] = (c[r.status] ?? 0) + 1;
    }
    return c;
  }, [rows, showDeleted, emp]);

  const totals = useMemo(() => {
    const plan = list.reduce((a, r) => a + r.terms.plan, 0);
    const fact = list.reduce((a, r) => a + r.pace.fact, 0);
    const hours = list.reduce((a, r) => a + r.hours, 0);
    return { plan, fact, hours, today: list.reduce((a, r) => a + r.pace.today, 0), week: list.reduce((a, r) => a + r.pace.thisWeek, 0), prev: list.reduce((a, r) => a + r.pace.prevWeek, 0) };
  }, [list]);

  const openRow = openId ? rows.find((r) => r.op.id === openId) ?? null : null;

  const exportCsv = () => {
    const head = ["ФИО", "Группа", "Роль", "Статус", "Оценка темпа", "План", "Факт", "% плана", "К плану на дату", "Прогноз RR", "Прогноз %", "Осталось", "Нужно в день", "Сегодня", "Неделя", "Пр. неделя", "Ср. в раб. день", "Часы", "Норма", "% нормы", "Лидов/час"];
    const body = list.map((r) => [
      r.op.name,
      r.op.groupId ? ix.groupById.get(r.op.groupId)?.name ?? "" : NO_GROUP_LABEL,
      ROLE_LABEL[r.op.role],
      STATUS_LABEL[r.op.status],
      PACE_LABEL[r.status],
      r.terms.plan,
      r.pace.fact,
      Math.round(r.pace.pct * 1000) / 10,
      Math.round(r.pace.deviation * 10) / 10,
      Math.round(r.pace.rr),
      Math.round(r.pace.rrPct * 1000) / 10,
      r.pace.remaining,
      r.pace.needPerDay == null ? "" : Math.round(r.pace.needPerDay * 10) / 10,
      r.pace.today,
      r.pace.thisWeek,
      r.pace.prevWeek,
      Math.round(r.avgPerWorkday * 10) / 10,
      r.hours,
      r.norm,
      Math.round(r.normPct * 1000) / 10,
      r.lph == null ? "" : Math.round(r.lph * 100) / 100,
    ]);
    downloadText(`operators_${month}.csv`, toCsv([head, ...body]), "text/csv;charset=utf-8");
  };

  const groups = data.groups.filter((g) => !g.deletedAt);

  const renderRow = (r: OpRow, i = 0, phase?: FoldPhase) => {
    const f = foldRow(phase, i);
    const g = r.op.groupId ? ix.groupById.get(r.op.groupId) : null;
    const p = r.pace;
    return (
      <tr key={r.op.id} className={`clickable ${r.op.deletedAt || r.op.status === "fired" ? "dim" : ""} ${f.className}`} style={f.style} onClick={() => setOpenId(r.op.id)}>
        <td className="sticky-col">
          <span className="row" style={{ gap: 9 }}>
            <Avatar name={r.op.name} id={r.op.id} size={26} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 500 }}>
                {r.op.name}
                {r.isLeader && <Icon name="star" size={12} stroke={2} style={{ color: "var(--c-amber-fg)" }} />}
                <GoneTag op={r.op} />
              </span>
              <span style={{ fontSize: 11.5, color: "var(--dim)" }}>
                {g ? g.name : NO_GROUP_LABEL}
                {r.op.role !== "operator" && ` · ${ROLE_LABEL[r.op.role]}`}
                {r.op.deletedAt ? " · удалён" : r.op.status !== "active" ? ` · ${STATUS_LABEL[r.op.status].toLowerCase()}` : ""}
              </span>
            </span>
          </span>
        </td>
        <td>
          <StatusChip status={r.status} />
        </td>
        <td className="r num">
          {fmtInt(r.terms.plan)}
          {r.terms.explicit && <span title="План задан для этого месяца" style={{ color: "var(--brand)" }}>•</span>}
        </td>
        <td className="r num" style={{ fontWeight: 600 }}>{fmtInt(p.fact)}</td>
        <td>
          <div className="row" style={{ gap: 8 }}>
            <Progress value={p.pct} marker={!past && r.terms.plan > 0 ? p.planToDate / r.terms.plan : undefined} hue={PACE_HUE[r.status]} style={{ flex: 1, minWidth: 50 }} />
            <span className="num" style={{ fontSize: 12, width: 38, textAlign: "right" }}>{fmtPct(p.pct)}</span>
          </div>
        </td>
        <td className="r num" style={{ color: p.deviation >= 0 ? "var(--c-green-fg)" : "var(--c-red-fg)" }}>{fmtSigned(p.deviation)}</td>
        <td className="r num">
          {fmtInt(p.rr)} <span className="muted">{fmtPct(p.rrPct)}</span>
        </td>
        <td className="r num">{fmtInt(p.remaining)}</td>
        <td className="r num">{p.needPerDay == null ? "—" : fmtNum(p.needPerDay)}</td>
        <td className="r num bl">{fmtInt(p.today)}</td>
        <td className="r num">{fmtInt(p.thisWeek)}</td>
        <td className="r num muted">{fmtInt(p.prevWeek)}</td>
        <td className="r num">{fmtNum(r.avgPerWorkday)}</td>
        <td className="r num bl">{fmtNum(r.hours)}</td>
        <td className="r num" title={`Норма ${fmtNum(r.norm)} ч; к дате ${fmtNum(r.normToDate)} ч`}>
          <span style={{ color: r.hoursDelta < -0.5 ? "var(--c-red-fg)" : undefined }}>{fmtPct(r.normPct)}</span>
        </td>
        <td className="r num">{r.lph == null ? "—" : fmtNum(r.lph, 2)}</td>
      </tr>
    );
  };

  const past = m.cal.phase === "past";

  return (
    <div className="stack">
      <PageHead
        title="Операторы"
        sub={`${fmtMonth(month)} · темп к личному плану на ${past ? "конец месяца" : "сегодня"}`}
        actions={
          <>
            <MonthSwitcher value={month} onChange={setMonth} />
            <button className="btn" onClick={exportCsv} disabled={!list.length}>
              <Icon name="download" size={14} /> CSV
            </button>
            {access.can.manageOperators && (
              <button className="btn btn-primary" onClick={() => openOperator()}>
                <Icon name="plus" size={14} stroke={2.2} /> Оператор
              </button>
            )}
          </>
        }
      />

      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="toolbar">
          <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 280 }}>
            <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--dim)" }} />
            <input className="inp" style={{ paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ФИО или контакт" />
          </div>
          <Select
            width={180}
            value={group}
            options={[
              { value: "", label: "Все группы" },
              ...groups.map<Opt>((g) => ({ value: g.id, label: g.name, icon: dot(g.color) })),
              { value: NO_GROUP, label: NO_GROUP_LABEL, icon: dot("gray") },
            ]}
            onChange={setGroup}
            ariaLabel="Группа"
          />
          <Seg<Emp>
            value={emp}
            onChange={setEmp}
            options={[
              { value: "work", label: "В штате" },
              { value: "active", label: "Активные" },
              { value: "pause", label: "Пауза" },
              { value: "fired", label: "Уволенные" },
              { value: "all", label: "Все" },
            ]}
          />
          <Switch size="sm" checked={showDeleted} onChange={setShowDeleted} label="удалённые" />
        </div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          {STATUS_FILTERS.filter((s) => counts[s]).map((s) => (
            <button
              key={s}
              className="chip"
              style={hueVars(PACE_HUE[s])}
              aria-pressed={pace.size === 0 ? undefined : pace.has(s)}
              onClick={() =>
                setPace((prev) => {
                  const n = new Set(prev);
                  if (n.has(s)) n.delete(s);
                  else n.add(s);
                  return n;
                })
              }
              title="Показать только этот статус"
            >
              <span className="dot" />
              {PACE_LABEL[s]} · {counts[s]}
            </button>
          ))}
          {pace.size > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setPace(new Set())}>
              Все статусы
            </button>
          )}
          <span style={{ fontSize: 12, color: "var(--dim)", marginLeft: "auto" }}>
            Выше плана ≥ {data.settings.aheadPct}% · по плану ≥ {data.settings.normalPct}% · отстаёт ≥ {data.settings.lagPct}% · не работает — {data.settings.idleDays} раб. дн. без лидов
          </span>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card">
          <Empty
            icon="users"
            title={data.operators.length ? "Никого не найдено" : "Операторов пока нет"}
            text={data.operators.length ? "Смените фильтры или месяц. В списке — те, кто был в штате или работал в выбранном месяце." : "Добавьте операторов — у каждого свой план, норма часов и схема оплаты."}
            action={
              access.can.manageOperators ? (
                <button className="btn btn-primary" onClick={() => openOperator()}>
                  <Icon name="plus" size={14} /> Оператор
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div ref={wrapRef} className="tbl-wrap" style={{ maxHeight: "max(320px, calc(100vh / var(--ui-scale, 1) - 290px))" }}>
          <table className="tbl tbl-fit">
            <thead>
              <tr>
                <SortTh k="name" sort={sort} setSort={setSort} className="sticky-col" style={{ minWidth: 240 }}>
                  Оператор
                </SortTh>
                <th>Оценка</th>
                <SortTh k="plan" sort={sort} setSort={setSort} className="r">План</SortTh>
                <SortTh k="fact" sort={sort} setSort={setSort} className="r">Факт</SortTh>
                <SortTh k="pct" sort={sort} setSort={setSort} style={{ minWidth: 120 }}>Выполнение</SortTh>
                <SortTh k="dev" sort={sort} setSort={setSort} className="r" title="Факт минус план на сегодня">К дате</SortTh>
                <SortTh k="rr" sort={sort} setSort={setSort} className="r" title="Run Rate: прогноз на конец месяца по текущему темпу">Прогноз</SortTh>
                <SortTh k="left" sort={sort} setSort={setSort} className="r">Осталось</SortTh>
                <SortTh k="need" sort={sort} setSort={setSort} className="r" title="Сколько нужно в рабочий день до конца месяца">Нужно/д</SortTh>
                <SortTh k="today" sort={sort} setSort={setSort} className="r bl">Сегодня</SortTh>
                <SortTh k="week" sort={sort} setSort={setSort} className="r">Неделя</SortTh>
                <SortTh k="prev" sort={sort} setSort={setSort} className="r">Пр. нед.</SortTh>
                <SortTh k="avg" sort={sort} setSort={setSort} className="r" title="Среднее лидов в отработанный день">Ср./день</SortTh>
                <SortTh k="hours" sort={sort} setSort={setSort} className="r bl">Часы</SortTh>
                <SortTh k="norm" sort={sort} setSort={setSort} className="r" title="Отработано от месячной нормы">Норма</SortTh>
                <SortTh k="lph" sort={sort} setSort={setSort} className="r" title="Переданные лиды / отработанные часы">Лид/час</SortTh>
              </tr>
            </thead>
            {grouped ? (
              sections.map((sec) => {
                const closed = fold.isClosed(sec.key);
                const phase = fold.phase(sec.key);
                const pct = safeDiv(sec.t.fact, sec.t.plan);
                return (
                  <tbody key={sec.key}>
                    <tr className="grp-head" onClick={() => fold.toggle(sec.key)} title={closed ? "Развернуть группу" : "Свернуть группу"} aria-expanded={!closed}>
                      <td className="sticky-col">
                        <span className="row" style={{ gap: 8 }}>
                          <Icon name="chevR" size={14} className={`grp-chev${closed || phase === "out" ? "" : " open"}`} />
                          <Swatch hue={sec.color} />
                          <span>{sec.name}</span>
                          <span className="grp-head-sub">
                            {sec.rows.length} чел.{sec.supervisor ? ` · СВ ${sec.supervisor}` : ""}
                          </span>
                        </span>
                      </td>
                      <td>{sec.status && <StatusChip status={sec.status} />}</td>
                      <td className="r num">{fmtInt(sec.t.plan)}</td>
                      <td className="r num">{fmtInt(sec.t.fact)}</td>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <Progress value={pct} marker={!past && sec.t.plan > 0 ? sec.t.planToDate / sec.t.plan : undefined} hue={sec.status ? PACE_HUE[sec.status] : undefined} style={{ flex: 1, minWidth: 50 }} />
                          <span className="num" style={{ fontSize: 12, width: 38, textAlign: "right" }}>{fmtPct(pct)}</span>
                        </div>
                      </td>
                      <td className="r num" style={{ color: sec.t.dev >= 0 ? "var(--c-green-fg)" : "var(--c-red-fg)" }}>{fmtSigned(sec.t.dev)}</td>
                      <td className="r num">{fmtInt(sec.t.rr)}</td>
                      <td className="r num">{fmtInt(sec.t.left)}</td>
                      <td />
                      <td className="r num bl">{fmtInt(sec.t.today)}</td>
                      <td className="r num">{fmtInt(sec.t.week)}</td>
                      <td className="r num">{fmtInt(sec.t.prev)}</td>
                      <td />
                      <td className="r num bl">{fmtNum(sec.t.hours)}</td>
                      <td />
                      <td className="r num">{sec.t.hours > 0 ? fmtNum(sec.t.fact / sec.t.hours, 2) : "—"}</td>
                    </tr>
                    {!closed && sec.rows.map((r, i) => renderRow(r, i, phase))}
                  </tbody>
                );
              })
            ) : (
              <tbody>{list.map((r) => renderRow(r))}</tbody>
            )}
            <tfoot>
              <tr>
                <td className="sticky-col">Итого · {list.length}</td>
                <td />
                <td className="r num">{fmtInt(totals.plan)}</td>
                <td className="r num">{fmtInt(totals.fact)}</td>
                <td className="num">{fmtPct(safeDiv(totals.fact, totals.plan))}</td>
                <td colSpan={4} />
                <td className="r num bl">{fmtInt(totals.today)}</td>
                <td className="r num">{fmtInt(totals.week)}</td>
                <td className="r num">{fmtInt(totals.prev)}</td>
                <td />
                <td className="r num bl">{fmtNum(totals.hours)}</td>
                <td />
                <td className="r num">{totals.hours > 0 ? fmtNum(totals.fact / totals.hours, 2) : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {openRow && (
        <OperatorDrawer
          row={openRow}
          onClose={() => {
            setOpenId(null);
            if (window.location.search) window.history.replaceState(null, "", "/operators/");
          }}
        />
      )}
    </div>
  );
}
