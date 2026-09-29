"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCrm } from "@/lib/crm/store";
import { useInsights, useMonthModel } from "@/lib/crm/hooks";
import { LAG_LABEL, type OpInsight } from "@/lib/crm/insights";
import { PACE_HUE, PACE_LABEL, goneLast, isGone, type OpRow, type Pace, type PaceStatus } from "@/lib/crm/calc";
import { NO_GROUP, NO_GROUP_LABEL, ROLE_LABEL, STATUS_LABEL, type Operator } from "@/lib/crm/types";
import { fmtMonth } from "@/lib/crm/dates";
import { ColumnPicker, useColumnDrag, useColumnOrder, useColumnVisibility, type ColumnGroup } from "@/components/ui/ColumnOrder";

/** Столбцы таблицы по умолчанию (после закреплённого «Оператор»). Порядок каждый может поменять у себя. */
const OP_COLS = ["status", "plan", "fact", "pct", "dev", "why", "lph", "real", "rr", "left", "need", "today", "week", "prev", "avg", "hours"] as const;
import { fmtInt, fmtNum, fmtPct, fmtSigned, safeDiv, shortName } from "@/lib/crm/format";
import { Avatar, Conv, Empty, GoneSepRow, LeadN, GoneTag, MonthSwitcher, PageHead, Progress, Seg, SortTh, StatusChip, Swatch, Switch, downloadText, foldRow, hueVars, toCsv, useFoldGroups, useWheelHScroll, type FoldPhase, type SortState } from "@/components/ui/kit";
import { Select, dot, type Opt } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";
import { OperatorDrawer } from "@/components/app/OperatorDrawer";
import { AttentionPanel, RealCell, WhyCell } from "@/components/app/Insights";
import { DayHeatmap } from "@/components/app/DayHeatmap";

type Emp = "work" | "active" | "pause" | "fired" | "all";
type View = "table" | "days";

/**
 * Какие столбцы видны — личная настройка каждого аккаунта (кнопка «Столбцы»). По умолчанию —
 * то, что нужно, чтобы увидеть, кто отстаёт и почему; остальное включается по надобности.
 */
const OP_DEFAULT_SHOWN = ["status", "plan", "fact", "pct", "dev", "why", "lph"];
const OP_COL_GROUPS: ColumnGroup[] = [
  {
    title: "Темп",
    cols: [
      { key: "status", label: "Оценка" },
      { key: "plan", label: "План" },
      { key: "fact", label: "Факт" },
      { key: "pct", label: "Выполнение" },
      { key: "dev", label: "К дате", hint: "факт минус план на сегодня" },
    ],
  },
  {
    title: "Разбор",
    cols: [
      { key: "why", label: "Почему отстаёт", hint: "часы или лиды в час" },
      { key: "lph", label: "Конверсия", hint: "лиды ÷ часы" },
      { key: "real", label: "Реально ли", hint: "нужно в день ÷ делает" },
    ],
  },
  {
    title: "Прогноз",
    cols: [
      { key: "rr", label: "Прогноз" },
      { key: "left", label: "Осталось" },
      { key: "need", label: "Нужно в день" },
    ],
  },
  {
    title: "Работа",
    cols: [
      { key: "today", label: "Сегодня" },
      { key: "week", label: "Неделя" },
      { key: "prev", label: "Прошлая неделя" },
      { key: "avg", label: "Среднее за день" },
      { key: "hours", label: "Часы" },
    ],
  },
];
/** Новый порядок видимых столбцов → полный порядок: скрытые остаются на своих местах. */
function mergeVisible(full: string[], visibleNext: string[]): string[] {
  const vis = new Set(visibleNext);
  let i = 0;
  return full.map((k) => (vis.has(k) ? visibleNext[i++] : k));
}
const isPaused = (r: OpRow) => r.op.status === "pause" && !isGone(r.op);
/** Ключ блока «Супервайзеры» — над всеми группами. */
const SV_KEY = "__sv__";
type SortKey = "name" | "plan" | "fact" | "pct" | "dev" | "why" | "rr" | "left" | "need" | "real" | "today" | "week" | "prev" | "avg" | "hours" | "lph";

const val = (r: OpRow, k: SortKey, ins: Map<string, OpInsight>): number | string => {
  const x = ins.get(r.op.id);
  switch (k) {
    case "name": return r.op.name;
    case "plan": return r.terms.plan;
    case "fact": return r.pace.fact;
    case "pct": return r.pace.pct;
    case "dev": return r.pace.deviation;
    // причина: сортируем по размеру отставания, без причины — в конце
    case "why": return x?.reason ? x.reason.hoursImpact + x.reason.lphImpact : 1e9;
    case "real": return x?.realism == null ? -1 : x.realism === Infinity ? 1e9 : x.realism;
    case "rr": return r.pace.rr;
    case "left": return r.pace.remaining;
    case "need": return r.pace.needPerDay ?? -1;
    case "today": return r.pace.today;
    case "week": return r.pace.thisWeek;
    case "prev": return r.pace.prevWeek;
    case "avg": return r.avgPerWorkday;
    case "hours": return r.hours;
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
    hours: 0, hoursToday: 0, hoursWeek: 0, norm: 0, normToDate: 0, hoursDelta: 0, normPct: 0, lph: null, factClosed: 0, daysWorked: 0,
    hasShifts: false, avgPerWorkday: 0, lastLead: null, absentDays: 0, isLeader: false, inWindow: false,
  };
}

const STATUS_FILTERS: PaceStatus[] = ["ahead", "ontrack", "lagging", "critical", "idle", "paused", "noplan"];

export default function OperatorsPage() {
  const { data, ix, month, setMonth, openOperator, access, today } = useCrm();
  const m = useMonthModel();
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [emp, setEmp] = useState<Emp>("work");
  const [pace, setPace] = useState<Set<PaceStatus>>(new Set());
  const [showDeleted, setShowDeleted] = useState(false);
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "fact", dir: -1 });
  const [openId, setOpenId] = useState<string | null>(null);
  const [view, setView] = useState<View>("table");
  // операторы на паузе — свёрнуты в одну строку внизу: в текущей работе они только удлиняют список
  const [pausedOpen, setPausedOpen] = useState(false);
  const ins = useInsights(m);
  const wrapRef = useRef<HTMLDivElement>(null);
  // свой порядок столбцов у каждого аккаунта; перетаскивание за заголовок
  const colOrder = useColumnOrder("operators", OP_COLS);
  const vis = useColumnVisibility("operators", OP_COLS, OP_DEFAULT_SHOWN);
  const shown = useMemo(() => colOrder.order.filter((k) => vis.shown.has(k)), [colOrder.order, vis.shown]);
  const colDrag = useColumnDrag({ wrapRef, order: shown, onChange: (next) => colOrder.save(mergeVisible(colOrder.order, next)) });
  const fold = useFoldGroups(wrapRef);

  // группа строки: супервайзер — в группе, которую ведёт (как в зарплате); остальные — по карточке
  const led = useMemo(() => {
    const out = new Map<string, string>();
    for (const g of data.groups) if (!g.deletedAt && g.supervisorId && !out.has(g.supervisorId)) out.set(g.supervisorId, g.id);
    return out;
  }, [data.groups]);
  const keyOf = useCallback((r: OpRow) => led.get(r.op.id) ?? r.groupKey, [led]);
  // супервайзеры — отдельным блоком над группами: по роли в карточке или потому что ведут группу
  const isSvRow = useCallback((r: OpRow) => r.op.role === "supervisor" || led.has(r.op.id), [led]);

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
      const x = val(a, sort.key, ins.byOp);
      const y = val(b, sort.key, ins.byOp);
      const c = typeof x === "string" ? x.localeCompare(y as string, "ru") : (x as number) - (y as number);
      // уволенные — всегда в конце, при любой сортировке
      // уволенные — всегда в конце, на паузе — перед ними
      return goneLast(a.op, b.op) || Number(isPaused(a)) - Number(isPaused(b)) || c * sort.dir || a.op.name.localeCompare(b.op.name, "ru");
    });
    return out;
  }, [rows, q, group, emp, pace, showDeleted, sort, keyOf, ins]);

  // по группам: у РОПа (и у всех, если в списке несколько групп) — строка-заголовок группы с итогами;
  // внутри группы порядок — по выбранной сортировке
  const sections = useMemo(() => {
    const map = new Map<string, OpRow[]>();
    for (const r of list) {
      const k = isSvRow(r) ? SV_KEY : keyOf(r);
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return Array.from(map.entries())
      .map(([key, rs]) => {
        const g = key === NO_GROUP || key === SV_KEY ? null : ix.groupById.get(key);
        const sum = (f: (r: OpRow) => number) => rs.reduce((a, r) => a + f(r), 0);
        const plan = sum((r) => r.terms.plan);
        const fact = sum((r) => r.pace.fact);
        const hours = sum((r) => r.hours);
        return {
          key,
          sv: key === SV_KEY,
          name: key === SV_KEY ? "Супервайзеры" : g?.name ?? NO_GROUP_LABEL,
          color: key === SV_KEY ? "purple" : g?.color ?? "gray",
          supervisor: g ? shortName((g.supervisorId ? ix.opById.get(g.supervisorId)?.name : null) ?? g.supervisorName) || null : null,
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
      // «Супервайзеры» — первым блоком, «Без группы» — последним
      .sort((a, b) => Number(b.sv) - Number(a.sv) || Number(a.key === NO_GROUP) - Number(b.key === NO_GROUP) || a.name.localeCompare(b.name, "ru"));
  }, [list, keyOf, isSvRow, ix, m.groups]);
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
    const head = ["ФИО", "Группа", "Роль", "Статус", "Оценка темпа", "План", "Факт", "% плана", "К плану на дату", "Прогноз RR", "Прогноз %", "Осталось", "Нужно в день", "Сегодня", "Неделя", "Пр. неделя", "Ср. в раб. день", "Часы", "Конверсия, %", "Почему отстаёт", "Тренд 5 смен, %", "Нужно/делает, раз"];
    const body = list.map((r) => {
      const x = ins.byOp.get(r.op.id);
      return [
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
      r.lph == null ? "" : Math.round(r.lph * 100),
      x?.reason ? LAG_LABEL[x.reason.kind] : "",
      x?.tempo.change == null ? "" : Math.round(x.tempo.change * 100),
      x?.realism == null || x.realism === Infinity ? "" : Math.round(x.realism * 10) / 10,
    ];
    });
    downloadText(`operators_${month}.csv`, toCsv([head, ...body]), "text/csv;charset=utf-8");
  };

  const groups = data.groups.filter((g) => !g.deletedAt);

  // перед первым уволенным в списке — разделитель «Уволены · N»
  // пауза сворачивается, только когда в списке есть и работающие: во вкладке «Пауза» свернуть было бы нечего показать
  const foldPaused = emp === "work" || emp === "all";
  const withGoneSep = (rs: OpRow[], render: (r: OpRow, i: number) => ReactNode) => {
    const paused = rs.filter(isPaused).length;
    return rs.map((r, i) => {
      const firstPaused = isPaused(r) && (i === 0 || !isPaused(rs[i - 1]));
      return (
        <Fragment key={r.op.id}>
          {foldPaused && firstPaused && (
            <tr className="pause-sep" onClick={() => setPausedOpen((v) => !v)} aria-expanded={pausedOpen}>
              <td className="sticky-col">
                <span className="row" style={{ gap: 6 }}>
                  <Icon name="chevR" size={12} className={`grp-chev${pausedOpen ? " open" : ""}`} />
                  На паузе · {paused}
                </span>
              </td>
              <td colSpan={shown.length} />
            </tr>
          )}
          {isGone(r.op) && (i === 0 || !isGone(rs[i - 1].op)) && <GoneSepRow count={rs.filter((x) => isGone(x.op)).length} colSpan={shown.length + 1} />}
          {!(foldPaused && !pausedOpen && isPaused(r)) && render(r, i)}
        </Fragment>
      );
    });
  };

  // ── столбцы: ячейка строки, строки группы и итога по ключу; выводятся в порядке colOrder.order ──
  const rowCell = (k: string, r: OpRow, p: OpRow["pace"]): ReactNode => {
    switch (k) {
      case "status":
        return (
          <td key={k} data-col={k}>
            <StatusChip status={r.status} />
          </td>
        );
      case "plan":
        return (
          <td key={k} data-col={k} className="r num">
            {fmtInt(r.terms.plan)}
            {r.terms.explicit && <span title="План задан для этого месяца" style={{ color: "var(--brand)" }}>•</span>}
          </td>
        );
      case "fact":
        return <td key={k} data-col={k} className="r num"><LeadN n={p.fact} /></td>;
      case "pct":
        return (
          <td key={k} data-col={k}>
            <div className="row" style={{ gap: 8 }}>
              <Progress value={p.pct} marker={!past && r.terms.plan > 0 ? p.planToDate / r.terms.plan : undefined} hue={PACE_HUE[r.status]} style={{ flex: 1, minWidth: 50 }} />
              <span className="num" style={{ fontSize: 12, width: 38, textAlign: "right" }}>{fmtPct(p.pct)}</span>
            </div>
          </td>
        );
      case "dev":
        return <td key={k} data-col={k} className="r num" style={{ color: p.deviation >= 0 ? "var(--c-green-fg)" : "var(--c-red-fg)" }}>{fmtSigned(p.deviation)}</td>;
      case "why":
        return <td key={k} data-col={k}><WhyCell reason={ins.byOp.get(r.op.id)?.reason} /></td>;
      case "rr":
        return (
          <td key={k} data-col={k} className="r num">
            {fmtInt(p.rr)} <span className="muted">{fmtPct(p.rrPct)}</span>
          </td>
        );
      case "left":
        return <td key={k} data-col={k} className="r num">{fmtInt(p.remaining)}</td>;
      case "need":
        return <td key={k} data-col={k} className="r num">{p.needPerDay == null ? "—" : fmtNum(p.needPerDay)}</td>;
      case "real":
        return <td key={k} data-col={k} className="r"><RealCell real={ins.byOp.get(r.op.id)?.realism} row={r} /></td>;
      case "today":
        return <td key={k} data-col={k} className="r num">{fmtInt(p.today)}</td>;
      case "week":
        return <td key={k} data-col={k} className="r num">{fmtInt(p.thisWeek)}</td>;
      case "prev":
        return <td key={k} data-col={k} className="r num muted">{fmtInt(p.prevWeek)}</td>;
      case "avg":
        return <td key={k} data-col={k} className="r num">{fmtNum(r.avgPerWorkday)}</td>;
      case "hours":
        return <td key={k} data-col={k} className="r num">{fmtNum(r.hours)}</td>;
      case "lph":
        return <td key={k} data-col={k} className="r num"><Conv value={r.lph} /></td>;
    }
    return null;
  };

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
                {shortName(r.op.name)}
                {r.isLeader && <Icon name="star" size={12} stroke={2} style={{ color: "var(--c-amber-fg)" }} />}
                <GoneTag op={r.op} />
              </span>
              <span style={{ fontSize: 11.5, color: "var(--dim)" }}>
                {/* в блоке «Супервайзеры» — какую группу ведёт */}
                {led.has(r.op.id) ? `ведёт ${ix.groupById.get(led.get(r.op.id)!)?.name ?? ""}` : g ? g.name : NO_GROUP_LABEL}
                {r.op.role !== "operator" && !led.has(r.op.id) && ` · ${ROLE_LABEL[r.op.role]}`}
                {r.op.deletedAt ? " · удалён" : r.op.status !== "active" ? ` · ${STATUS_LABEL[r.op.status].toLowerCase()}` : ""}
              </span>
            </span>
          </span>
        </td>
        {shown.map((k) => rowCell(k, r, p))}
      </tr>
    );
  };

  const past = m.cal.phase === "past";
  const hp = colDrag.headProps;
  const groupCell = (k: string, sec: (typeof sections)[number], pct: number): ReactNode => {
    switch (k) {
      case "status":
        return <td key={k} data-col={k}>{sec.status && <StatusChip status={sec.status} />}</td>;
      case "plan":
        return <td key={k} data-col={k} className="r num">{fmtInt(sec.t.plan)}</td>;
      case "fact":
        return <td key={k} data-col={k} className="r num"><LeadN n={sec.t.fact} /></td>;
      case "pct":
        return (
          <td key={k} data-col={k}>
            <div className="row" style={{ gap: 8 }}>
              <Progress value={pct} marker={!past && sec.t.plan > 0 ? sec.t.planToDate / sec.t.plan : undefined} hue={sec.status ? PACE_HUE[sec.status] : undefined} style={{ flex: 1, minWidth: 50 }} />
              <span className="num" style={{ fontSize: 12, width: 38, textAlign: "right" }}>{fmtPct(pct)}</span>
            </div>
          </td>
        );
      case "dev":
        return <td key={k} data-col={k} className="r num" style={{ color: sec.t.dev >= 0 ? "var(--c-green-fg)" : "var(--c-red-fg)" }}>{fmtSigned(sec.t.dev)}</td>;
      case "rr":
        return <td key={k} data-col={k} className="r num">{fmtInt(sec.t.rr)}</td>;
      case "left":
        return <td key={k} data-col={k} className="r num">{fmtInt(sec.t.left)}</td>;
      case "today":
        return <td key={k} data-col={k} className="r num">{fmtInt(sec.t.today)}</td>;
      case "week":
        return <td key={k} data-col={k} className="r num">{fmtInt(sec.t.week)}</td>;
      case "prev":
        return <td key={k} data-col={k} className="r num">{fmtInt(sec.t.prev)}</td>;
      case "hours":
        return <td key={k} data-col={k} className="r num">{fmtNum(sec.t.hours)}</td>;
      case "lph":
        return <td key={k} data-col={k} className="r num"><Conv leads={sec.t.fact} hours={sec.t.hours} /></td>;
    }
    return <td key={k} data-col={k} />;
  };
  const totalCell = (k: string): ReactNode => {
    switch (k) {
      case "plan":
        return <td key={k} data-col={k} className="r num">{fmtInt(totals.plan)}</td>;
      case "fact":
        return <td key={k} data-col={k} className="r num"><LeadN n={totals.fact} /></td>;
      case "pct":
        return <td key={k} data-col={k} className="c num">{fmtPct(safeDiv(totals.fact, totals.plan))}</td>;
      case "today":
        return <td key={k} data-col={k} className="r num">{fmtInt(totals.today)}</td>;
      case "week":
        return <td key={k} data-col={k} className="r num">{fmtInt(totals.week)}</td>;
      case "prev":
        return <td key={k} data-col={k} className="r num">{fmtInt(totals.prev)}</td>;
      case "hours":
        return <td key={k} data-col={k} className="r num">{fmtNum(totals.hours)}</td>;
      case "lph":
        return <td key={k} data-col={k} className="r num"><Conv leads={totals.fact} hours={totals.hours} /></td>;
    }
    return <td key={k} data-col={k} />;
  };
  const headCell = (k: string): ReactNode => {
    switch (k) {
      case "status":
        return <th key={k} {...hp(k)}>Оценка</th>;
      case "plan":
        return <SortTh key={k} k="plan" sort={sort} setSort={setSort} className="r" drag={hp(k)}>План</SortTh>;
      case "fact":
        return <SortTh key={k} k="fact" sort={sort} setSort={setSort} className="r" drag={hp(k)}>Факт</SortTh>;
      case "pct":
        return <SortTh key={k} k="pct" sort={sort} setSort={setSort} className="c" style={{ minWidth: 120 }} drag={hp(k)}>Выполнение</SortTh>;
      case "dev":
        return <SortTh key={k} k="dev" sort={sort} setSort={setSort} className="r" title="Факт минус план на сегодня" drag={hp(k)}>К дате</SortTh>;
      case "why":
        return (
          <SortTh key={k} k="why" sort={sort} setSort={setSort} title="Почему отстаёт: часы и лиды в час против медианы команды. Цифры — сколько лидов отставания к дате из-за часов и из-за л/ч" drag={hp(k)}>
            Почему отстаёт
          </SortTh>
        );
      case "real":
        return <SortTh key={k} k="real" sort={sort} setSort={setSort} className="r" title="Реально ли закрыть план: во сколько раз «нужно в день» больше его среднего за смену. ×1,5 и больше — без изменений не закрыть" drag={hp(k)}>Реально ли</SortTh>;
      case "rr":
        return <SortTh key={k} k="rr" sort={sort} setSort={setSort} className="r" title="Run Rate: прогноз на конец месяца по текущему темпу" drag={hp(k)}>Прогноз</SortTh>;
      case "left":
        return <SortTh key={k} k="left" sort={sort} setSort={setSort} className="r" drag={hp(k)}>Осталось</SortTh>;
      case "need":
        return <SortTh key={k} k="need" sort={sort} setSort={setSort} className="r" title="Сколько нужно в рабочий день до конца месяца" drag={hp(k)}>Нужно/д</SortTh>;
      case "today":
        return <SortTh key={k} k="today" sort={sort} setSort={setSort} className="r" drag={hp(k)}>Сегодня</SortTh>;
      case "week":
        return <SortTh key={k} k="week" sort={sort} setSort={setSort} className="r" drag={hp(k)}>Неделя</SortTh>;
      case "prev":
        return <SortTh key={k} k="prev" sort={sort} setSort={setSort} className="r" drag={hp(k)}>Пр. нед.</SortTh>;
      case "avg":
        return <SortTh key={k} k="avg" sort={sort} setSort={setSort} className="r" title="Среднее лидов в отработанный день" drag={hp(k)}>Ср./день</SortTh>;
      case "hours":
        return <SortTh key={k} k="hours" sort={sort} setSort={setSort} className="r" drag={hp(k)}>Часы</SortTh>;
      case "lph":
        return <SortTh key={k} k="lph" sort={sort} setSort={setSort} className="r" title="Конверсия: переданные лиды ÷ отработанные часы" drag={hp(k)}>Конв.</SortTh>;
    }
    return null;
  };
  // колесо мыши листает широкую таблицу вбок (если она влезла по высоте или курсор на шапке)
  useWheelHScroll(wrapRef, { auto: true, watch: list.length > 0 });

  return (
    <div className="stack">
      <PageHead
        title="Операторы"
        sub={`${fmtMonth(month)} · темп к личному плану на ${past ? "конец месяца" : "сегодня"}`}
        actions={
          <>
            <MonthSwitcher value={month} onChange={setMonth} />
            <Seg<View> value={view} onChange={setView} options={[{ value: "table", label: "Таблица" }, { value: "days", label: "По дням" }]} />
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
          {view === "table" && (
            <div style={{ marginLeft: "auto" }}>
              <ColumnPicker
                groups={OP_COL_GROUPS}
                shown={vis.shown}
                onToggle={vis.toggle}
                custom={vis.custom || colOrder.custom}
                onReset={() => {
                  vis.reset();
                  colOrder.reset();
                }}
              />
            </div>
          )}
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

      {m.cal.phase === "current" && list.length > 0 && <AttentionPanel rows={list} byOp={ins.byOp} med={ins.med} onOpen={setOpenId} />}

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
      ) : view === "days" ? (
        <DayHeatmap
          sections={grouped ? sections : [{ key: "all", name: "", color: "gray", supervisor: null, rows: list }]}
          grouped={grouped}
          cal={m.cal}
          onOpen={setOpenId}
          paused={foldPaused ? { open: pausedOpen, toggle: () => setPausedOpen((v) => !v) } : null}
        />
      ) : (
        <div ref={wrapRef} className="tbl-wrap" style={{ maxHeight: "max(320px, calc(100vh / var(--ui-scale, 1) - 290px))" }}>
          <table className="tbl tbl-fit">
            <thead>
              <tr>
                <SortTh k="name" sort={sort} setSort={setSort} className="sticky-col" style={{ minWidth: 240 }}>
                  Оператор
                </SortTh>
                {shown.map((k) => headCell(k))}
              </tr>
            </thead>
            {grouped ? (
              sections.map((sec) => {
                const closed = fold.isClosed(sec.key);
                const phase = fold.phase(sec.key);
                const pct = safeDiv(sec.t.fact, sec.t.plan);
                return (
                  <tbody key={sec.key} data-fold={sec.key}>
                    <tr className="grp-head" onClick={() => fold.toggle(sec.key)} title={closed ? "Развернуть группу" : "Свернуть группу"} aria-expanded={!closed}>
                      <td className="sticky-col">
                        <span className="row" style={{ gap: 8 }}>
                          <Icon name="chevR" size={14} className={`grp-chev${closed || phase === "out" ? "" : " open"}`} />
                          {sec.sv ? <Icon name="star" size={13} stroke={2} className="sv-star" /> : <Swatch hue={sec.color} />}
                          <span>{sec.name}</span>
                          <span className="grp-head-sub">
                            {sec.rows.length} чел.{sec.supervisor ? ` · СВ ${sec.supervisor}` : ""}
                          </span>
                        </span>
                      </td>
                      {shown.map((k) => groupCell(k, sec, pct))}
                    </tr>
                    {!closed && withGoneSep(sec.rows, (r, i) => renderRow(r, i, phase))}
                  </tbody>
                );
              })
            ) : (
              <tbody>{withGoneSep(list, (r) => renderRow(r))}</tbody>
            )}
            <tfoot>
              <tr>
                <td className="sticky-col">Итого · {list.length}</td>
                {shown.map((k) => totalCell(k))}
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
