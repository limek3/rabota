"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { filterLeads } from "@/lib/crm/calc";
import { canReviewLead } from "@/lib/crm/access";
import { addDays, addMonths, fmtDate, fmtMonth, fmtStamp, isoWeekday, monthOf, monthStart, rangeDays } from "@/lib/crm/dates";
import { LEADS, fmtInt, fmtNum, fmtPct, fmtPhone, plural, shortName } from "@/lib/crm/format";
import { LEAD_STATUSES, LEAD_STATUS_HUE, LEAD_STATUS_LABEL, NO_GROUP, NO_GROUP_LABEL, type DayKey, type Lead, type LeadStatus } from "@/lib/crm/types";
import { ClipText, Pager, RegionTag, downloadText, periodFor, toCsv, type Period, type PeriodMode } from "@/components/ui/kit";
import { DateInput, Select, dot, type Opt } from "@/components/ui/select";
import { useColumnDrag, useColumnOrder, useColumnVisibility } from "@/components/ui/ColumnOrder";
import { Icon, type IconName } from "@/components/ui/icons";
import { SEGMENT_LABEL, regionSegment, type RegionSegment } from "@/lib/crm/regions";
import { PhonesExport } from "@/components/app/LeadsClassic";
import { Popover } from "@/components/app/OperatorsV2";
import { LeadPanel } from "@/components/app/LeadModal";

/**
 * «Лиды» v2: карточки статусов, лиды по дням, что требует внимания, журнал и карточка лида
 * справа (закреплена; пока лид не выбран — заглушка). Прежняя версия — LeadsClassic,
 * переключатель — в app/(crm)/leads/page.tsx.
 */

const COLS = ["at", "client", "project", "status", "operator", "region", "comment"] as const;
type Col = (typeof COLS)[number];
const COL_TITLE: Record<Col, string> = { at: "Время", client: "Клиент", project: "Проект", status: "Статус", operator: "Оператор", region: "Регион", comment: "Комментарий" };
const SHOWN_DEFAULT: Col[] = ["at", "client", "project", "status", "operator", "region"];
type SortKey = "at" | "client" | "status" | "operator" | "region";
const COL_SORT: Partial<Record<Col, SortKey>> = { at: "at", client: "client", status: "status", operator: "operator", region: "region" };

const SIZES = [25, 50, 75, 100];
const SIZE_KEY = "leadup.leads.pageSize";
const ST_ICON: Record<LeadStatus, IconName> = { done: "check", failed: "close", work: "clock" };
const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function mergeVisible(full: string[], visibleNext: string[]): string[] {
  const vis = new Set(visibleNext);
  let i = 0;
  return full.map((k) => (vis.has(k) ? visibleNext[i++] : k));
}

function readQuery(): Record<string, string> {
  if (typeof window === "undefined") return {};
  return Object.fromEntries(new URLSearchParams(window.location.search).entries());
}

export function LeadsV2() {
  const { data, ix, today, openLead, setLeadStatus, confirm, toast, access } = useCrm();
  const s = data.settings;
  const [period, setPeriod] = useState<Period>(() => periodFor("month", today));
  const [operatorId, setOperatorId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [region, setRegion] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<LeadStatus | "">("");
  const [notExported, setNotExported] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [phonesOpen, setPhonesOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selId, setSelId] = useState<string | null>(null);
  // «Не доведён…» из меню строки — панель открывается сразу с причиной
  const [failFor, setFailFor] = useState<string | null>(null);
  const select = (id: string | null, fail = false) => {
    setSelId(id);
    setFailFor(fail ? id : null);
  };
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "at", dir: -1 });
  const canExport = access.isHead || access.isSup;

  const vis = useColumnVisibility("leads2", COLS, SHOWN_DEFAULT);
  const colOrder = useColumnOrder("leads2", COLS);
  const shown = useMemo(() => colOrder.order.filter((k) => vis.shown.has(k)) as Col[], [colOrder.order, vis.shown]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const colDrag = useColumnDrag({ wrapRef, order: shown, onChange: (next) => colOrder.save(mergeVisible(colOrder.order, next)) });

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(SIZE_KEY));
      if (SIZES.includes(v)) setSize(v);
    } catch {
      /* хранилище недоступно — остаёмся на 25 */
    }
  }, []);
  const changeSize = (v: number) => {
    setSize(v);
    try {
      localStorage.setItem(SIZE_KEY, String(v));
    } catch {
      /* не запомнили — не страшно */
    }
  };

  // переход из карточки оператора / группы / проекта: /leads?op=…&from=…&to=…
  useEffect(() => {
    const qp = readQuery();
    if (qp.op) setOperatorId(qp.op);
    if (qp.group) setGroupId(qp.group);
    if (qp.project) setProjectId(qp.project);
    if ((LEAD_STATUSES as string[]).includes(qp.status)) setStatus(qp.status as LeadStatus);
    if (qp.from && qp.to) setPeriod({ mode: "range", from: qp.from, to: qp.to });
    if (qp.id) setSelId(qp.id);
  }, []);
  useEffect(() => setPage(1), [period, operatorId, groupId, projectId, q, status, region, size, notExported, sort]);

  /* ── выборка ────────────────────────────────────────────────────── */
  const pick = useCallback(
    (from: DayKey, to: DayKey) => {
      const all = filterLeads(data.leads, { from, to, operatorId, groupId, projectId, q });
      const segOf = (r?: string): RegionSegment => regionSegment(r, s) ?? "main";
      const byRegion = !region
        ? all
        : region.startsWith("seg:")
          ? all.filter((l) => segOf(l.region) === region.slice(4))
          : all.filter((l) => (l.region ?? "") === region);
      return byRegion.sort((a, b) => b.at.localeCompare(a.at));
    },
    [data.leads, operatorId, groupId, projectId, q, region, s],
  );
  const base = useMemo(() => pick(period.from, period.to), [pick, period]);
  const byStatus = useMemo(() => {
    const m: Record<LeadStatus, number> = { work: 0, done: 0, failed: 0 };
    for (const l of base) m[l.status]++;
    return m;
  }, [base]);
  const opName = useCallback((id: string) => ix.opById.get(id)?.name ?? "", [ix]);
  const list = useMemo(() => {
    let out = status ? base.filter((l) => l.status === status) : base;
    if (notExported) out = out.filter((l) => l.phone && !data.leadExports[l.id]);
    const v = (l: Lead): string =>
      sort.key === "at" ? l.at : sort.key === "client" ? l.client.toLowerCase() : sort.key === "status" ? l.status : sort.key === "operator" ? opName(l.operatorId) : l.region ?? "";
    return [...out].sort((a, b) => v(a).localeCompare(v(b), "ru") * sort.dir || b.at.localeCompare(a.at));
  }, [base, status, notExported, data.leadExports, sort, opName]);
  const notExportedCount = useMemo(() => base.filter((l) => l.phone && !data.leadExports[l.id]).length, [base, data.leadExports]);

  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const cur = Math.min(page, pageCount);
  const pageRows = list.slice((cur - 1) * size, cur * size);
  const sel = selId ? data.leads.find((l) => l.id === selId) ?? null : null;

  /* ── лиды по дням ───────────────────────────────────────────────── */
  const lastDay = period.to > today ? today : period.to;
  const dayList = useMemo(() => rangeDays(period.from, period.to).slice(0, 62), [period]);
  const perDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of list) m.set(l.at.slice(0, 10), (m.get(l.at.slice(0, 10)) ?? 0) + 1);
    return m;
  }, [list]);
  const daysDone = period.from > today ? 0 : rangeDays(period.from, lastDay).length;

  /* ── что требует внимания ───────────────────────────────────────── */
  const stale = useMemo(() => base.filter((l) => l.status === "work" && l.at.slice(0, 10) < today && canReviewLead(access, l)), [base, today, access]);

  /* ── фильтры ────────────────────────────────────────────────────── */
  const operators = useMemo(() => [...data.operators].sort((a, b) => Number(!!a.deletedAt) - Number(!!b.deletedAt) || a.name.localeCompare(b.name, "ru")), [data.operators]);
  const opOptions = useMemo<Opt[]>(() => {
    const cnt = new Map<string, number>();
    for (const l of data.leads) {
      const d = l.at.slice(0, 10);
      if (d >= period.from && d <= period.to) cnt.set(l.operatorId, (cnt.get(l.operatorId) ?? 0) + 1);
    }
    const groupName = (o: (typeof operators)[number]) => (o.groupId ? ix.groupById.get(o.groupId)?.name ?? NO_GROUP_LABEL : NO_GROUP_LABEL);
    const hint = (id: string) => (cnt.get(id) ? `${fmtInt(cnt.get(id)!)} ${plural(cnt.get(id)!, LEADS)}` : "");
    const working = operators.filter((o) => !o.deletedAt && o.status !== "fired");
    const former = operators.filter((o) => (o.deletedAt || o.status === "fired") && (cnt.get(o.id) || o.id === operatorId));
    return [
      { value: "", label: "Все операторы" },
      ...working
        .sort((a, b) => groupName(a).localeCompare(groupName(b), "ru") || a.name.localeCompare(b.name, "ru"))
        .map<Opt>((o) => ({ value: o.id, label: shortName(o.name), group: groupName(o), hint: hint(o.id) })),
      ...former.map<Opt>((o) => ({ value: o.id, label: o.name, group: "Уволенные и удалённые", hint: hint(o.id) })),
    ];
  }, [operators, data.leads, period, operatorId, ix]);
  const projects = useMemo(() => [...data.projects].sort((a, b) => a.sort - b.sort), [data.projects]);
  const regionOptions = useMemo<Opt[]>(
    () => [
      { value: "", label: "Все регионы" },
      { value: "seg:main", label: "Вся основа", group: "Сегмент", hint: s.regions.main.join(", ") },
      { value: "seg:regional", label: "Все регионы", group: "Сегмент", hint: s.regions.regional.join(", ") },
      ...s.regions.main.map<Opt>((r) => ({ value: r, label: r, group: "Основа" })),
      ...s.regions.regional.map<Opt>((r) => ({ value: r, label: r, group: "Регионы" })),
    ],
    [s.regions],
  );
  const filtered = !!(operatorId || groupId || projectId || q || status || region || notExported);

  /* ── период ─────────────────────────────────────────────────────── */
  const shift = (dir: 1 | -1) => {
    if (period.mode === "day") setPeriod(periodFor("day", addDays(period.from, dir)));
    else if (period.mode === "week") setPeriod(periodFor("week", addDays(period.from, 7 * dir)));
    else if (period.mode === "month") setPeriod(periodFor("month", monthStart(addMonths(monthOf(period.from), dir))));
  };
  const setMode = (m: PeriodMode) => {
    if (m === "range") return setPeriod({ mode: "range", from: period.from, to: period.to });
    const anchor = period.from <= today && today <= period.to ? today : period.from;
    setPeriod(periodFor(m, anchor));
  };
  const pLabel =
    period.mode === "month"
      ? fmtMonth(monthOf(period.from))
      : period.mode === "day"
        ? `${period.from === today ? "Сегодня, " : `${DOW[isoWeekday(period.from) - 1]}, `}${fmtDate(period.from).slice(0, 5)}`
        : `${fmtDate(period.from).slice(0, 5)} – ${fmtDate(period.to).slice(0, 5)}`;

  /* ── действия ───────────────────────────────────────────────────── */
  const exportCsv = () => {
    const src = checked.size ? list.filter((l) => checked.has(l.id)) : list;
    const rows: (string | number)[][] = [["ID", "Дата", "Время", "Статус", "Причина", "Клиент", "Телефон", "Ссылка", "Проект", "Оператор", "Группа", "Комментарий", "Источник", "Регион", "Основа / регионы"]];
    for (const l of src) {
      rows.push([
        l.id,
        fmtDate(l.at.slice(0, 10)),
        l.at.slice(11, 16),
        LEAD_STATUS_LABEL[l.status],
        l.status === "failed" ? l.statusReason : "",
        l.client,
        fmtPhone(l.phone),
        l.link,
        l.projectId ? ix.projectById.get(l.projectId)?.name ?? "" : "",
        ix.opById.get(l.operatorId)?.name ?? "",
        l.groupId ? ix.groupById.get(l.groupId)?.name ?? "" : NO_GROUP_LABEL,
        l.comment,
        l.source,
        l.region ?? "",
        SEGMENT_LABEL[regionSegment(l.region, s) ?? "main"],
      ]);
    }
    downloadText(`leads_${period.from}_${period.to}.csv`, toCsv(rows), "text/csv;charset=utf-8");
  };
  const checkedRows = list.filter((l) => checked.has(l.id));
  const reviewChecked = checkedRows.filter((l) => l.status !== "done" && canReviewLead(access, l));
  const markDone = async (ids: string[]) => {
    const ok = await confirm({
      title: `Отметить доведёнными: ${fmtInt(ids.length)}?`,
      text: "Отмеченные лиды станут «доведён». Не доведённые отмечайте по одному — с причиной.",
      ok: "Отметить",
    });
    if (!ok) return;
    const n = await setLeadStatus(ids, "done");
    if (n) toast(`Доведено: ${fmtInt(n)}`);
  };
  const toggleSort = (k: SortKey) => setSort((p) => (p.key === k ? { key: k, dir: p.dir === 1 ? -1 : 1 } : { key: k, dir: k === "at" ? -1 : 1 }));
  const allChecked = pageRows.length > 0 && pageRows.every((l) => checked.has(l.id));
  const someChecked = pageRows.some((l) => checked.has(l.id));

  const total = base.length;

  /* ── сравнение с прошлым периодом: столько же прошедших дней ───────── */
  const prev = useMemo(() => {
    if (period.from > today) return null;
    const span = rangeDays(period.from, period.to > today ? today : period.to).length;
    const pFrom =
      period.mode === "month"
        ? monthStart(addMonths(monthOf(period.from), -1))
        : period.mode === "week"
          ? addDays(period.from, -7)
          : addDays(period.from, -rangeDays(period.from, period.to).length);
    const p = pick(pFrom, addDays(pFrom, span - 1));
    const m: Record<LeadStatus, number> = { work: 0, done: 0, failed: 0 };
    for (const l of p) m[l.status]++;
    return { total: p.length, ...m };
  }, [pick, period, today]);
  const vsLabel = period.mode === "day" ? "ко вчера" : period.mode === "week" ? "к прошлой неделе" : period.mode === "month" ? "к прошлому месяцу" : "к прошлому периоду";
  const opsWithLeads = useMemo(() => new Set(base.map((l) => l.operatorId)).size, [base]);
  const share = (n: number, of: number) => (of > 0 ? n / of : 0);
  const ppDelta = (st: LeadStatus, goodUp: boolean) => {
    if (!prev || !prev.total || !total) return null;
    const d = share(byStatus[st], total) - share(prev[st], prev.total);
    if (Math.abs(d) < 0.0005) return null;
    return { text: `${d > 0 ? "+" : "−"}${fmtNum(Math.abs(d) * 100)} п.п.`, up: d > 0, good: goodUp ? d > 0 : d < 0 };
  };
  const totalDelta = prev && prev.total > 0 ? total / prev.total - 1 : null;

  const cell = (c: Col, l: Lead) => {
    const op = ix.opById.get(l.operatorId);
    const g = l.groupId ? ix.groupById.get(l.groupId) : null;
    const p = l.projectId ? ix.projectById.get(l.projectId) : null;
    switch (c) {
      case "at":
        return (
          <td key={c} data-col={c} title={`${fmtDate(l.at.slice(0, 10))} ${l.at.slice(11, 16)} МСК`}>
            <b style={{ fontWeight: 600 }}>{l.at.slice(0, 4) === today.slice(0, 4) ? fmtDate(l.at.slice(0, 10)).slice(0, 5) : fmtDate(l.at.slice(0, 10))}</b>{" "}
            <span className="o2-muted">{l.at.slice(11, 16)}</span>
          </td>
        );
      case "client":
        return (
          <td key={c} data-col={c}>
            <div className="l2-two">
              <span>
                <ClipText text={l.client || "Без имени"} width={170} />
              </span>
              <span className="o2-muted">
                {fmtPhone(l.phone) || "—"}
                {data.leadExports[l.id] && (
                  <span className="lead-exported" title={`Номер выгружен ${fmtStamp(data.leadExports[l.id])}`} style={{ marginLeft: 5, verticalAlign: -2 }}>
                    <Icon name="check" size={12} stroke={2.4} />
                  </span>
                )}
              </span>
            </div>
          </td>
        );
      case "project":
        return <td key={c} data-col={c}>{p ? <span className="l2-tag">{p.name}</span> : <span className="o2-muted">—</span>}</td>;
      case "status":
        return (
          <td key={c} data-col={c}>
            <LeadPill st={l.status} />
            {l.status === "failed" && l.statusReason && (
              <div className="o2-muted" style={{ fontSize: 11, marginTop: 3 }}>
                <ClipText text={l.statusReason} width={120} />
              </div>
            )}
          </td>
        );
      case "operator":
        return (
          <td key={c} data-col={c}>
            <div className="l2-two">
              <span>{op ? shortName(op.name) + (op.deletedAt ? " (удалён)" : "") : "—"}</span>
              <span className="o2-muted">{g ? g.name : NO_GROUP_LABEL}</span>
            </div>
          </td>
        );
      case "region":
        return (
          <td key={c} data-col={c}>
            <RegionTag region={l.region} />
          </td>
        );
      case "comment":
        return (
          <td key={c} data-col={c} className="o2-muted">
            <ClipText text={l.comment} width={240} />
          </td>
        );
    }
  };

  return (
    <div className="stack" style={{ gap: 0 }}>
      {/* ── заголовок ─────────────────────────────────────────────── */}
      <div className="o2-head">
        <div>
          <h1 className="o2-title">Лиды</h1>
          <div className="o2-sub">Журнал лидов, переданных менеджеру. Источник — Скорозвон.</div>
        </div>
        <div className="o2-tools">
          {period.mode !== "range" ? (
            <div className="o2-date">
              <button className="o2-ib" onClick={() => shift(-1)} aria-label="Назад">
                <Icon name="chevL" size={15} />
              </button>
              <span className="lbl" style={{ minWidth: 130, justifyContent: "center", fontWeight: 600 }}>
                {pLabel}
              </span>
              <button className="o2-ib" onClick={() => shift(1)} aria-label="Вперёд">
                <Icon name="chevR" size={15} />
              </button>
            </div>
          ) : (
            <div className="o2-date">
              <DateInput width={138} value={period.from} onChange={(d) => d && setPeriod({ ...period, from: d, to: d > period.to ? d : period.to })} ariaLabel="С" />
              <span style={{ color: "var(--dim)" }}>—</span>
              <DateInput width={138} value={period.to} onChange={(d) => d && setPeriod({ ...period, to: d, from: d < period.from ? d : period.from })} ariaLabel="По" />
            </div>
          )}
          <div className="o2-seg l2-seg" role="group">
            {(["day", "week", "month", "range"] as PeriodMode[]).map((k) => (
              <button key={k} className={period.mode === k ? "on" : ""} onClick={() => setMode(k)}>
                {k === "day" ? "День" : k === "week" ? "Неделя" : k === "month" ? "Месяц" : "Период"}
              </button>
            ))}
          </div>
          <button className="o2-btn" onClick={exportCsv} disabled={!list.length} title={checked.size ? `Выгрузить отмеченные: ${checked.size}` : "Выгрузить список"}>
            <Icon name="download" size={14} />
            CSV{checked.size ? ` · ${checked.size}` : ""}
          </button>
          {canExport && (
            <button className="o2-btn" onClick={() => setPhonesOpen(true)} disabled={!data.leads.length} title="Имя и телефон в Excel, с отметкой, что уже выгружали">
              <Icon name="download" size={14} />
              Номера
            </button>
          )}
          {access.can.createLeads && (
            <button className="o2-btn pri" onClick={() => openLead()}>
              <Icon name="plus" size={14} stroke={2.2} />
              Лид передан
            </button>
          )}
        </div>
      </div>

      <div className="o2-body has-side l2-body">
        <div className="o2-main">
          {/* ── показатели (как на «Операторах»): нажатие — фильтр по статусу ── */}
          <div className="card o2-kpis l2-kpis">
            <LKpi
              icon="leads"
              label="Всего лидов"
              value={fmtInt(total)}
              onClick={() => setStatus("")}
              delta={totalDelta == null ? null : { text: `${totalDelta >= 0 ? "+" : "−"}${fmtPct(Math.abs(totalDelta))}`, up: totalDelta >= 0, good: totalDelta >= 0 }}
              sub={prev ? vsLabel : "период не начался"}
              title={prev ? `За тот же отрезок прошлого периода: ${fmtInt(prev.total)}` : undefined}
            />
            <LKpi icon="check" hue="green" label="Доведён" value={fmtInt(byStatus.done)} pct={total ? fmtPct(share(byStatus.done, total)) : undefined} delta={ppDelta("done", true)} sub="доля к прошлому" title="Подтвердил менеджер. Изменение — доли доведённых, в п.п." on={status === "done"} onClick={() => setStatus(status === "done" ? "" : "done")} />
            <LKpi icon="close" hue="red" label="Не доведён" value={fmtInt(byStatus.failed)} pct={total ? fmtPct(share(byStatus.failed, total)) : undefined} delta={ppDelta("failed", false)} sub="доля к прошлому" title="Сорвались — ушли из факта и оплаты. Изменение — доли, в п.п." on={status === "failed"} onClick={() => setStatus(status === "failed" ? "" : "failed")} />
            <LKpi icon="clock" hue="amber" label="В работе" value={fmtInt(byStatus.work)} pct={total ? fmtPct(share(byStatus.work, total)) : undefined} line="ждут решения" sub="от всех лидов" title="Менеджер ещё не подтвердил и не отклонил" on={status === "work"} onClick={() => setStatus(status === "work" ? "" : "work")} />
            <LKpi icon="users" label="Операторов" value={fmtInt(opsWithLeads)} line={opsWithLeads ? `${fmtNum(total / opsWithLeads)} на чел.` : undefined} sub="передавали лиды" title="Сколько операторов передали хотя бы один лид, и сколько в среднем на одного" />
            <div className={`o2-kpi crit${stale.length ? "" : " calm"}`} onClick={() => stale.length && setStatus(status === "work" ? "" : "work")} title="«В работе» дольше суток — отметьте доведён или нет">
              <span className="ic">
                <Icon name="alert" size={18} />
              </span>
              <div className="o2-kpi-b">
                <div className="l">Ждут проверки</div>
                <div className="v">{fmtInt(stale.length)}</div>
                <div className="d">{stale.length ? "дольше суток" : "никого"}</div>
                <div className="s">{stale.length > 0 ? <>показать <Icon name="arrowR" size={12} /></> : "всё проверено"}</div>
              </div>
            </div>
          </div>

          {/* ── лиды по дням + внимание ────────────────────────── */}
          <div className="l2-row">
            <div className="card l2-days">
              <div className="l2-days-t">
                <Icon name="chart" size={13} className="mi" />
                Лиды по дням
              </div>
              <div className="l2-bars">
                {dayList.map((d) => {
                  const n = perDay.get(d) ?? 0;
                  const max = Math.max(1, ...Array.from(perDay.values()));
                  const fut = d > today;
                  return (
                    <span
                      key={d}
                      title={`${fmtDate(d).slice(0, 5)}, ${DOW[isoWeekday(d) - 1]}: ${n} ${plural(n, LEADS)}`}
                      className={d === today ? "td" : fut ? "fut" : undefined}
                      style={{ height: `${fut ? 8 : Math.max(8, (n / max) * 100)}%` }}
                    />
                  );
                })}
              </div>
              <div className="l2-avg">
                <b>{daysDone ? fmtNum(list.length / daysDone) : "—"}</b>
                <span>в среднем в день</span>
              </div>
            </div>
            {stale.length > 0 ? (
              <div className="card l2-att" data-hue="red">
                <Icon name="alert" size={20} />
                <div>
                  <b>
                    {fmtInt(stale.length)} {plural(stale.length, LEADS)} {stale.length === 1 ? "ждёт" : "ждут"} проверки
                  </b>
                  <span>«В работе» дольше суток — отметьте доведён или нет</span>
                </div>
                <button className="o2-btn" onClick={() => setStatus("work")}>
                  Показать
                </button>
              </div>
            ) : byStatus.failed > 0 ? (
              <div className="card l2-att" data-hue="amber">
                <Icon name="alert" size={20} />
                <div>
                  <b>
                    {fmtInt(byStatus.failed)} не {byStatus.failed === 1 ? "доведён" : "доведено"} за период
                  </b>
                  <span>Посмотрите причины — что мешает довести</span>
                </div>
                <button className="o2-btn" onClick={() => setStatus("failed")}>
                  Показать
                </button>
              </div>
            ) : (
              <div className="card l2-att" data-hue="green">
                <Icon name="check" size={20} />
                <div>
                  <b>Все лиды проверены</b>
                  <span>Нет лидов, которые ждут решения</span>
                </div>
              </div>
            )}
          </div>

          {/* ── фильтры ──────────────────────────────────────────── */}
          <div className="card o2-filters">
            <label className="o2-search">
              <Icon name="search" size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по клиенту, номеру или комментарию…" />
            </label>
            <Select width={170} value={operatorId} options={opOptions} onChange={setOperatorId} ariaLabel="Оператор" minPopWidth={280} />
            <Select
              width={140}
              value={groupId}
              onChange={setGroupId}
              ariaLabel="Группа"
              options={[
                { value: "", label: "Все группы" },
                ...data.groups.map<Opt>((g) => ({ value: g.id, label: g.name + (g.deletedAt ? " (удалена)" : ""), icon: dot(g.color) })),
                { value: NO_GROUP, label: NO_GROUP_LABEL, icon: dot("gray") },
              ]}
            />
            <Select
              width={140}
              value={projectId}
              onChange={setProjectId}
              ariaLabel="Проект"
              options={[
                { value: "", label: "Все проекты" },
                ...projects.map<Opt>((p) => ({ value: p.id, label: p.name + (p.deletedAt ? " (удалён)" : ""), icon: dot(p.color) })),
                { value: "__none__", label: "Без проекта", icon: dot("gray") },
              ]}
            />
            <Select width={140} value={region} options={regionOptions} onChange={setRegion} ariaLabel="Регион" minPopWidth={260} />
            {canExport && (
              <button className={`o2-btn${notExported ? " pri" : ""}`} style={{ fontWeight: 500 }} onClick={() => setNotExported((v) => !v)} title="Только лиды с номером, который ещё не выгружали в Excel">
                Не выгружены · {fmtInt(notExportedCount)}
              </button>
            )}
            {filtered && (
              <button
                className="o2-btn"
                style={{ fontWeight: 500, border: 0, background: "none", color: "var(--text-sub)" }}
                onClick={() => {
                  setOperatorId("");
                  setGroupId("");
                  setProjectId("");
                  setQ("");
                  setStatus("");
                  setRegion("");
                  setNotExported(false);
                }}
              >
                Сбросить
              </button>
            )}
            <span className="o2-found">Найдено: {fmtInt(list.length)}</span>
            <Popover
              align="right"
              button={(open, toggle, ref) => (
                <button ref={ref} className="o2-ib" onClick={toggle} aria-expanded={open} title="Столбцы">
                  <Icon name="dashboard" size={15} />
                </button>
              )}
            >
              <div className="tt">Столбцы</div>
              {COLS.map((k) => (
                <label key={k}>
                  <input type="checkbox" checked={vis.shown.has(k)} onChange={() => vis.toggle(k)} />
                  {COL_TITLE[k]}
                </label>
              ))}
              <div className="sep" />
              <div className="tt">Порядок — перетащите заголовок столбца</div>
              {vis.custom && (
                <button className="it" onClick={vis.reset}>
                  <Icon name="check" size={13} /> По умолчанию
                </button>
              )}
              {colOrder.custom && (
                <button className="it" onClick={colOrder.reset}>
                  <Icon name="refresh" size={13} /> Вернуть порядок столбцов
                </button>
              )}
            </Popover>
          </div>

          {/* ── журнал ───────────────────────────────────────────── */}
          <div className="card o2-card">
            {list.length === 0 ? (
              <div style={{ padding: 28, textAlign: "center", color: "var(--dim)", fontSize: 13 }}>
                {data.leads.length ? "Под фильтр ничего не попало — поменяйте период или сбросьте фильтры." : "Лидов пока нет — запишите первый: «Лид передан» или клавиша N."}
              </div>
            ) : (
              <>
                <div className="o2-scroll" ref={wrapRef}>
                  <table className="o2-tbl l2-tbl">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>
                          <input
                            type="checkbox"
                            className="o2-cb"
                            checked={allChecked}
                            ref={(el) => {
                              if (el) el.indeterminate = !allChecked && someChecked;
                            }}
                            onChange={() =>
                              setChecked((p) => {
                                const n = new Set(p);
                                for (const l of pageRows) {
                                  if (allChecked) n.delete(l.id);
                                  else n.add(l.id);
                                }
                                return n;
                              })
                            }
                            aria-label="Отметить страницу"
                          />
                        </th>
                        {shown.map((c) => {
                          const hp = colDrag.headProps(c);
                          const k = COL_SORT[c];
                          return (
                            <th key={c} {...hp} className={`${hp.className}${k ? " s" : ""}`} onClick={k ? () => toggleSort(k) : undefined} title="Перетащите, чтобы переставить столбец">
                              {COL_TITLE[c]}
                              {k && <span className="ar">{sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : "↕"}</span>}
                            </th>
                          );
                        })}
                        <th style={{ width: 40 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {pageRows.map((l) => (
                        <tr key={l.id} className={`${sel?.id === l.id ? "sel" : ""}${l.status === "failed" ? " l2-failed" : ""}`} onClick={() => select(sel?.id === l.id ? null : l.id)}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="o2-cb"
                              checked={checked.has(l.id)}
                              onChange={() =>
                                setChecked((p) => {
                                  const n = new Set(p);
                                  if (n.has(l.id)) n.delete(l.id);
                                  else n.add(l.id);
                                  return n;
                                })
                              }
                              aria-label={`Отметить лид ${l.client}`}
                            />
                          </td>
                          {shown.map((c) => cell(c, l))}
                          <td onClick={(e) => e.stopPropagation()}>
                            <Popover
                              align="right"
                              button={(open, toggle, ref) => (
                                <button ref={ref} className="o2-kebab" onClick={toggle} aria-expanded={open} aria-label="Действия">
                                  <Icon name="list" size={15} />
                                </button>
                              )}
                            >
                              {(close) => (
                                <>
                                  <button className="it" onClick={() => { close(); select(l.id); }}>
                                    <Icon name="edit" size={14} /> Открыть лид
                                  </button>
                                  {l.link && (
                                    <a className="it l2-a" href={l.link} target="_blank" rel="noreferrer" onClick={close}>
                                      <Icon name="external" size={14} /> Открыть в Скорозвоне
                                    </a>
                                  )}
                                  {canReviewLead(access, l) && l.status !== "done" && (
                                    <button className="it" onClick={() => { close(); void setLeadStatus([l.id], "done"); }}>
                                      <Icon name="check" size={14} /> Доведён
                                    </button>
                                  )}
                                  {canReviewLead(access, l) && l.status !== "failed" && (
                                    <button className="it" onClick={() => { close(); select(l.id, true); }}>
                                      <Icon name="close" size={14} /> Не доведён…
                                    </button>
                                  )}
                                </>
                              )}
                            </Popover>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="l2-foot">
                  <span className="o2-muted">
                    Выбрано <span className="l2-cnt">{fmtInt(checked.size)} из {fmtInt(list.length)}</span>
                  </span>
                  {reviewChecked.length > 0 && (
                    <button className="o2-btn" onClick={() => void markDone(reviewChecked.map((l) => l.id))}>
                      <Icon name="check" size={13} /> Доведён · {reviewChecked.length}
                    </button>
                  )}
                  {checked.size > 0 && (
                    <button className="o2-btn" style={{ border: 0, background: "none", fontWeight: 500, color: "var(--text-sub)" }} onClick={() => setChecked(new Set())}>
                      Снять выбор
                    </button>
                  )}
                  <span style={{ flex: 1 }} />
                  <Pager page={cur} size={size} total={list.length} sizes={SIZES} onPage={(p) => { setPage(p); wrapRef.current?.scrollTo({ top: 0 }); }} onSize={changeSize} />
                </div>
              </>
            )}
          </div>
        </div>

        {sel ? <LeadPanel key={sel.id + (failFor === sel.id ? ":fail" : "")} lead={sel} failIntent={failFor === sel.id} onClose={() => select(null)} /> : <SideEmpty />}
      </div>

      {phonesOpen && (
        <PhonesExport
          from={period.from}
          to={period.to > today ? today : period.to}
          pick={(from, to) => (status ? pick(from, to).filter((l) => l.status === status) : pick(from, to))}
          filtered={filtered}
          onClose={() => setPhonesOpen(false)}
        />
      )}
    </div>
  );
}

/* ── мелкие части ───────────────────────────────────────────────────── */

function LKpi({
  icon,
  label,
  value,
  pct,
  delta,
  line,
  sub,
  hue,
  on,
  onClick,
  title,
}: {
  icon: IconName;
  label: string;
  value: string;
  /** Доля от всех — мелко рядом с числом. */
  pct?: string;
  delta?: { text: string; up: boolean; good: boolean } | null;
  line?: string;
  sub: string;
  hue?: string;
  on?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <div className={`o2-kpi${onClick ? " click" : ""}${on ? " on" : ""}`} data-hue={hue} onClick={onClick} title={title}>
      <span className="ic">
        <Icon name={icon} size={18} />
      </span>
      <div className="o2-kpi-b">
        <div className="l">{label}</div>
        <div className="v">
          {value}
          {pct && <span className="pc">{pct}</span>}
        </div>
        {delta ? (
          <div className={`d ${delta.good ? "o2-up" : "o2-down"}`}>
            {delta.up ? "▲" : "▼"} {delta.text}
          </div>
        ) : (
          <div className="d" style={{ color: "var(--text)" }}>
            {line ?? <span className="o2-muted">—</span>}
          </div>
        )}
        <div className="s">{sub}</div>
      </div>
    </div>
  );
}

function LeadPill({ st }: { st: LeadStatus }) {
  return (
    <span className="o2-st" data-hue={LEAD_STATUS_HUE[st]}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
      {LEAD_STATUS_LABEL[st]}
    </span>
  );
}

function SideEmpty() {
  return (
    <aside className="card o2-side o2-side-empty">
      <div className="o2-empty">
        <span className="ic">
          <Icon name="leads" size={22} />
        </span>
        <b>Выберите лид</b>
        <span>Нажмите на строку в журнале — здесь можно поставить статус, проверить лид в Скорозвоне и поправить данные.</span>
      </div>
      {["Статус и действия", "Клиент", "Оператор, проект и регион", "Комментарий"].map((t) => (
        <div key={t} className="o2-box o2-ghost">
          <b>{t}</b>
          <i style={{ width: "72%" }} />
          <i style={{ width: "48%" }} />
        </div>
      ))}
    </aside>
  );
}
