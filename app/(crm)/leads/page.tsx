"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { filterLeads } from "@/lib/crm/calc";
import { LEAD_STATUSES, LEAD_STATUS_HUE, LEAD_STATUS_LABEL, NO_GROUP, NO_GROUP_LABEL, type DayKey, type Lead, type LeadStatus } from "@/lib/crm/types";
import { fmtDate, fmtStamp, rangeDays } from "@/lib/crm/dates";
import { LEADS, fmtInt, fmtNum, fmtPhone, plural, shortName } from "@/lib/crm/format";
import { Chip, ClipText, Empty, Field, Modal, RegionTag, LeadLinkButton, LeadStatusChip, PageHead, Pager, PeriodPicker, Switch, downloadText, hueVars, periodFor, periodLabel, toCsv, type Period } from "@/components/ui/kit";
import { DateInput, Select, dot, type Opt } from "@/components/ui/select";
import { canReviewLead } from "@/lib/crm/access";
import { Icon } from "@/components/ui/icons";
import { SEGMENT_HUE, SEGMENT_LABEL, regionSegment, type RegionSegment } from "@/lib/crm/regions";
import { buildXlsx, downloadBlob } from "@/lib/xlsx";

/** Размеры страницы журнала; выбор запоминается в этом браузере. */
const SIZES = [25, 50, 75, 100];
const SIZE_KEY = "leadup.leads.pageSize";

function readQuery(): Record<string, string> {
  if (typeof window === "undefined") return {};
  return Object.fromEntries(new URLSearchParams(window.location.search).entries());
}

export default function LeadsPage() {
  const { data, ix, today, openLead, setLeadStatus, confirm, toast, access } = useCrm();
  const [period, setPeriod] = useState<Period>(() => periodFor("month", today));
  const [operatorId, setOperatorId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<LeadStatus | "">("");
  // регион: "" — все, "seg:main" / "seg:regional" — сегмент, иначе — конкретный город
  const [region, setRegion] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [phonesOpen, setPhonesOpen] = useState(false);
  // только лиды с номером, который ещё не выгружали в Excel
  const [notExported, setNotExported] = useState(false);
  const canExport = access.isHead || access.isSup;
  const wrapRef = useRef<HTMLDivElement>(null);

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
  const goPage = (p: number) => {
    setPage(p);
    wrapRef.current?.scrollTo({ top: 0 });
  };

  // переход из карточки оператора / группы / проекта: /leads?op=…&from=…&to=…
  useEffect(() => {
    const qp = readQuery();
    if (qp.op) setOperatorId(qp.op);
    if (qp.group) setGroupId(qp.group);
    if (qp.project) setProjectId(qp.project);
    if ((LEAD_STATUSES as string[]).includes(qp.status)) setStatus(qp.status as LeadStatus);
    if (qp.from && qp.to) setPeriod({ mode: "range", from: qp.from, to: qp.to });
  }, []);

  // новый фильтр или размер страницы — снова с первой страницы
  useEffect(() => setPage(1), [period, operatorId, groupId, projectId, q, status, region, size, notExported]);

  // без фильтра по статусу — для счётчиков «в работе / доведён / не доведён»
  const s = data.settings;
  // все фильтры страницы, кроме статуса, за любые даты — и для списка, и для выгрузки номеров
  const pick = useCallback(
    (from: DayKey, to: DayKey) => {
      const all = filterLeads(data.leads, { from, to, operatorId, groupId, projectId, q });
      // лид без региона — основа (так же считает доход)
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
  const byStatusList = useMemo(() => (status ? base.filter((l) => l.status === status) : base), [base, status]);
  const notExportedCount = useMemo(() => byStatusList.filter((l) => l.phone && !data.leadExports[l.id]).length, [byStatusList, data.leadExports]);
  const list = useMemo(
    () => (notExported ? byStatusList.filter((l) => l.phone && !data.leadExports[l.id]) : byStatusList),
    [byStatusList, notExported, data.leadExports],
  );
  // лид могли удалить или сменить статус — не остаёмся на пустой странице
  const pageCount = Math.max(1, Math.ceil(list.length / size));
  const cur = Math.min(page, pageCount);
  const byStatus = useMemo(() => {
    const m: Record<LeadStatus, number> = { work: 0, done: 0, failed: 0 };
    for (const l of base) m[l.status]++;
    return m;
  }, [base]);
  // что этот аккаунт может разом отметить доведёнными
  const reviewable = useMemo(() => list.filter((l) => l.status === "work" && canReviewLead(access, l)), [list, access]);

  const bySegment = useMemo(() => {
    const m: Record<RegionSegment, number> = { main: 0, regional: 0 };
    for (const l of list) m[regionSegment(l.region, s) ?? "main"]++;
    return m;
  }, [list, s]);
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

  const byProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of list) m.set(l.projectId || "__none__", (m.get(l.projectId || "__none__") ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [list]);

  const days = rangeDays(period.from, period.to > today ? (period.from > today ? period.from : today) : period.to).length;

  const operators = useMemo(() => [...data.operators].sort((a, b) => Number(!!a.deletedAt) - Number(!!b.deletedAt) || a.name.localeCompare(b.name, "ru")), [data.operators]);
  const groups = data.groups;

  // Список операторов в фильтре: работающие — по группам; уволенные и удалённые — отдельно
  // и только те, у кого есть лиды за выбранный период (история их не теряется, но и не мешает).
  const opOptions = useMemo<Opt[]>(() => {
    const cnt = new Map<string, number>();
    for (const l of data.leads) {
      const d = l.at.slice(0, 10);
      if (d >= period.from && d <= period.to) cnt.set(l.operatorId, (cnt.get(l.operatorId) ?? 0) + 1);
    }
    const groupName = (o: (typeof operators)[number]) => (o.groupId ? ix.groupById.get(o.groupId)?.name ?? NO_GROUP_LABEL : NO_GROUP_LABEL);
    const leadsHint = (id: string) => (cnt.get(id) ? `${fmtInt(cnt.get(id)!)} ${plural(cnt.get(id)!, LEADS)}` : "");
    const working = operators
      .filter((o) => !o.deletedAt && o.status !== "fired")
      .sort((a, b) => Number(!a.groupId) - Number(!b.groupId) || groupName(a).localeCompare(groupName(b), "ru") || a.name.localeCompare(b.name, "ru"));
    const former = operators.filter((o) => o.deletedAt || o.status === "fired");
    const shown = former.filter((o) => cnt.get(o.id) || o.id === operatorId);
    const hidden = former.length - shown.length;
    const FORMER = "Уволенные и удалённые";
    return [
      { value: "", label: "Все операторы" },
      ...working.map<Opt>((o) => ({ value: o.id, label: shortName(o.name), group: groupName(o), hint: leadsHint(o.id) })),
      ...shown.map<Opt>((o) => ({
        value: o.id,
        label: o.name,
        group: FORMER,
        hint: [o.deletedAt ? "удалён" : "уволен", leadsHint(o.id)].filter(Boolean).join(" · "),
      })),
      ...(hidden > 0 ? [{ value: "__former_hidden__", label: `Ещё ${hidden} — без лидов за период`, group: FORMER, disabled: true }] : []),
    ];
  }, [operators, data.leads, period.from, period.to, operatorId, ix]);
  const projects = useMemo(() => [...data.projects].sort((a, b) => a.sort - b.sort), [data.projects]);
  const filtered = !!(operatorId || groupId || projectId || q || status || region || notExported);

  const exportCsv = () => {
    const rows: (string | number)[][] = [["ID", "Дата", "Время", "Статус", "Причина", "Клиент", "Телефон", "Ссылка", "Проект", "Оператор", "Группа", "Комментарий", "Источник", "Регион", "Основа / регионы"]];
    for (const l of list) {
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

  return (
    <div className="stack">
      <PageHead
        title="Лиды"
        sub="Журнал лидов, переданных менеджеру. Новый лид — «в работе», супервайзер отмечает «доведён» или «не доведён». Источник — Скорозвон."
        actions={
          <>
            <button className="btn" onClick={exportCsv} disabled={!list.length}>
              <Icon name="download" size={14} /> CSV
            </button>
            {canExport && (
              <button className="btn" onClick={() => setPhonesOpen(true)} disabled={!data.leads.length} title="Имя и телефон в Excel, с отметкой, что уже выгружали">
                <Icon name="download" size={14} /> Номера
              </button>
            )}
            {access.can.createLeads && (
              <button className="btn btn-primary" onClick={() => openLead()}>
                <Icon name="plus" size={14} stroke={2.2} /> Лид передан
              </button>
            )}
          </>
        }
      />

      <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <PeriodPicker value={period} onChange={setPeriod} today={today} />
        <div className="toolbar">
          <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
            <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--dim)" }} />
            <input className="inp" style={{ paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Телефон, клиент, комментарий" />
          </div>
          <Select
            width={210}
            value={operatorId}
            options={opOptions}
            onChange={setOperatorId}
            ariaLabel="Оператор"
            minPopWidth={280}
          />
          <Select
            width={170}
            value={groupId}
            options={[
              { value: "", label: "Все группы" },
              ...groups.map<Opt>((g) => ({ value: g.id, label: g.name + (g.deletedAt ? " (удалена)" : ""), icon: dot(g.color) })),
              { value: NO_GROUP, label: NO_GROUP_LABEL, icon: dot("gray") },
            ]}
            onChange={setGroupId}
            ariaLabel="Группа"
          />
          <Select
            width={170}
            value={projectId}
            options={[
              { value: "", label: "Все проекты" },
              ...projects.map<Opt>((p) => ({ value: p.id, label: p.name + (p.deletedAt ? " (удалён)" : ""), icon: dot(p.color) })),
              { value: "__none__", label: "Без проекта", icon: dot("gray") },
            ]}
            onChange={setProjectId}
            ariaLabel="Проект"
          />
          <Select width={170} value={region} options={regionOptions} onChange={setRegion} ariaLabel="Регион" minPopWidth={260} />
          {filtered && (
            <button
              className="btn btn-ghost"
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
        </div>
        <div className="row" style={{ gap: 8, flexWrap: "wrap", fontSize: 13 }}>
          <span>
            <b className="num">{fmtInt(list.length)}</b> {plural(list.length, LEADS)} · {periodLabel(period)}
            {days > 1 && list.length > 0 && <span style={{ color: "var(--dim)" }}> · {fmtNum(list.length / days)} в день</span>}
          </span>
          {LEAD_STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              className="chip"
              style={hueVars(LEAD_STATUS_HUE[st])}
              aria-pressed={status ? status === st : undefined}
              onClick={() => setStatus((cur) => (cur === st ? "" : st))}
              title={status === st ? "Показать все статусы" : `Только «${LEAD_STATUS_LABEL[st]}»`}
            >
              <span className="dot" />
              {LEAD_STATUS_LABEL[st]} · {fmtInt(byStatus[st])}
            </button>
          ))}
          {canExport && (
            <button
              type="button"
              className="chip"
              style={hueVars("blue")}
              aria-pressed={notExported || undefined}
              onClick={() => setNotExported((v) => !v)}
              title={notExported ? "Показать все лиды" : "Только лиды с номером, который ещё не выгружали в Excel"}
            >
              Не выгружены · {fmtInt(notExportedCount)}
            </button>
          )}
          {status === "work" && reviewable.length > 0 && (
            <button
              className="btn btn-sm"
              onClick={async () => {
                const ok = await confirm({
                  title: `Отметить доведёнными: ${fmtInt(reviewable.length)}?`,
                  text: "Все лиды «в работе» из списка (в вашей зоне) станут «доведён». Не доведённые сначала отметьте по одному — с причиной.",
                  ok: "Отметить",
                });
                if (!ok) return;
                const n = await setLeadStatus(
                  reviewable.map((l) => l.id),
                  "done",
                );
                if (n) toast(`Доведено: ${fmtInt(n)}`);
              }}
            >
              <Icon name="check" size={13} /> Все в списке — доведён
            </button>
          )}
          {list.length > 0 && <span style={{ width: 1, height: 16, background: "var(--ink-08)" }} />}
          {(["main", "regional"] as RegionSegment[]).map((seg) => (
            <button
              key={seg}
              type="button"
              className="chip"
              style={hueVars(SEGMENT_HUE[seg])}
              aria-pressed={region.startsWith("seg:") ? region === `seg:${seg}` : undefined}
              onClick={() => setRegion((cur) => (cur === `seg:${seg}` ? "" : `seg:${seg}`))}
              title={seg === "main" ? `Основа: ${s.regions.main.join(", ")} и лиды без региона` : `Регионы: ${s.regions.regional.join(", ")}`}
            >
              {SEGMENT_LABEL[seg]} · {fmtInt(bySegment[seg])}
            </button>
          ))}
          {byProject.length > 0 && <span style={{ width: 1, height: 16, background: "var(--ink-08)" }} />}
          {byProject.map(([pid, n]) => {
            const p = ix.projectById.get(pid);
            return (
              <Chip key={pid} hue={p?.color ?? "gray"} dot>
                {p?.name ?? "Без проекта"} · {n}
              </Chip>
            );
          })}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card">
          <Empty
            icon="leads"
            title={data.leads.length ? "Под фильтр ничего не попало" : "Лидов пока нет"}
            text={data.leads.length ? "Поменяйте период или сбросьте фильтры." : "Запишите первый переданный лид — кнопка «Лид передан» или клавиша N."}
            action={
              !data.leads.length && access.can.createLeads && (
                <button className="btn btn-primary" onClick={() => openLead()}>
                  <Icon name="plus" size={14} /> Лид передан
                </button>
              )
            }
          />
        </div>
      ) : (
        <>
        <div ref={wrapRef} className="tbl-wrap" style={{ maxHeight: "max(300px, calc(100vh / var(--ui-scale, 1) - 380px))" }}>
          <table className="tbl tbl-leads">
            <thead>
              <tr>
                <th className="c">Передан</th>
                <th className="c">Статус</th>
                <th>Клиент</th>
                <th className="c">Телефон</th>
                <th className="c">Проект</th>
                <th>Регион</th>
                <th>Оператор</th>
                <th className="c">Группа</th>
                <th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {list.slice((cur - 1) * size, cur * size).map((l) => {
                const op = ix.opById.get(l.operatorId);
                const g = l.groupId ? ix.groupById.get(l.groupId) : null;
                const p = l.projectId ? ix.projectById.get(l.projectId) : null;
                return (
                  <tr key={l.id} className={l.status === "failed" ? "clickable row-stripe" : "clickable"} onClick={() => openLead(l)}>
                    <td className="num c" title={`${fmtDate(l.at.slice(0, 10))} ${l.at.slice(11, 16)} МСК`}>
                      {l.at.slice(0, 4) === today.slice(0, 4) ? fmtDate(l.at.slice(0, 10)).slice(0, 5) : fmtDate(l.at.slice(0, 10))} <span className="muted">{l.at.slice(11, 16)}</span>
                    </td>
                    <td className="c">
                      <LeadStatusChip lead={l} />
                      {l.status === "failed" && l.statusReason && (
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                          <ClipText text={l.statusReason} width={104} />
                        </div>
                      )}
                    </td>
                    <td>
                      <ClipText text={l.client} width={160} />
                    </td>
                    <td className="num c">
                      {/* ссылка на лид — слева от номера; слот фиксированной ширины держит номера на одной вертикали */}
                      <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <span style={{ width: 22, flex: "none", display: "inline-flex" }}>
                          <LeadLinkButton link={l.link} variant="icon" />
                        </span>
                        {fmtPhone(l.phone) || <span className="muted">—</span>}
                        {data.leadExports[l.id] && (
                          <span className="lead-exported" title={`Номер выгружен ${fmtStamp(data.leadExports[l.id])}`}>
                            <Icon name="check" size={14} stroke={2.4} />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="c">{p ? <Chip hue={p.color}>{p.name}</Chip> : <span className="muted">—</span>}</td>
                    <td>
                      <RegionTag region={l.region} />
                    </td>
                    <td>
                      <ClipText text={shortName(op?.name ?? "—") + (op?.deletedAt ? " (удалён)" : "")} full={(op?.name ?? "—") + (op?.deletedAt ? " (удалён)" : "")} width={130} />
                    </td>
                    <td className={g ? "c" : "c muted"}>{g ? g.name : NO_GROUP_LABEL}</td>
                    <td className="muted">
                      <ClipText text={l.comment} width={280} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pager page={cur} size={size} total={list.length} sizes={SIZES} onPage={goPage} onSize={changeSize} />
        </>
      )}
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

/** «номер / номера / номеров» */
const NUMBERS: [string, string, string] = ["номер", "номера", "номеров"];

/** Номер для файла: +7XXXXXXXXXX — так его понимают и Excel, и звонилки. */
const filePhone = (p: string) => {
  const d = (p || "").replace(/\D+/g, "");
  return d.length === 11 && d.startsWith("7") ? `+${d}` : (p || "").trim();
};

/**
 * Выгрузка номеров в Excel: две колонки — имя и телефон, за выбранные даты.
 * Выгруженные лиды получают отметку (галочка у номера в журнале), поэтому
 * по умолчанию в файл идут только те, что ещё не выгружали.
 */
function PhonesExport({
  from: from0,
  to: to0,
  pick,
  filtered,
  onClose,
}: {
  from: DayKey;
  to: DayKey;
  pick: (from: DayKey, to: DayKey) => Lead[];
  filtered: boolean;
  onClose: () => void;
}) {
  const { data, today, markLeadsExported, toast } = useCrm();
  const [from, setFrom] = useState<DayKey>(from0);
  const [to, setTo] = useState<DayKey>(to0 < from0 ? from0 : to0);
  const [onlyNew, setOnlyNew] = useState(true);
  const [busy, setBusy] = useState(false);

  const withPhone = useMemo(() => (from <= to ? pick(from, to) : []).filter((l) => filePhone(l.phone)), [pick, from, to]);
  const done = useMemo(() => withPhone.filter((l) => data.leadExports[l.id]).length, [withPhone, data.leadExports]);
  const out = useMemo(() => {
    const src = (onlyNew ? withPhone.filter((l) => !data.leadExports[l.id]) : withPhone).slice().sort((a, b) => a.at.localeCompare(b.at));
    // один номер — одна строка, даже если лид по нему передавали дважды
    const seen = new Set<string>();
    const rows: string[][] = [];
    for (const l of src) {
      const ph = filePhone(l.phone);
      if (seen.has(ph)) continue;
      seen.add(ph);
      rows.push([l.client.trim(), ph]);
    }
    return { leads: src, rows };
  }, [withPhone, onlyNew, data.leadExports]);

  const download = async () => {
    setBusy(true);
    const span = from === to ? fmtDate(from) : `${fmtDate(from)}–${fmtDate(to)}`;
    downloadBlob(`Номера ${span}.xlsx`, buildXlsx([["Имя", "Телефон"], ...out.rows], { sheet: "Номера", widths: [34, 18] }));
    const ok = await markLeadsExported(
      out.leads.map((l) => l.id),
      { from, to, count: out.rows.length },
    );
    setBusy(false);
    if (!ok) return;
    toast(`Выгружено номеров: ${fmtInt(out.rows.length)}`);
    onClose();
  };

  return (
    <Modal
      title="Выгрузка номеров"
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Отмена
          </button>
          <button className="btn btn-primary" onClick={() => void download()} disabled={busy || !out.rows.length}>
            <Icon name="download" size={14} /> Скачать Excel{out.rows.length ? ` (${fmtInt(out.rows.length)})` : ""}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13, color: "var(--text-sub)", lineHeight: 1.5 }}>
        Файл Excel: две колонки — имя и телефон. Выгруженные номера отмечаются галочкой в журнале лидов.
        {filtered && " Учитываются фильтры страницы."}
      </div>
      <div className="grid2">
        <Field label="С">
          <DateInput value={from} onChange={(d) => d && setFrom(d)} max={today} ariaLabel="С" />
        </Field>
        <Field label="По">
          <DateInput value={to} onChange={(d) => d && setTo(d)} min={from} max={today} ariaLabel="По" />
        </Field>
      </div>
      <Switch checked={onlyNew} onChange={setOnlyNew} label="Только ещё не выгруженные" />
      <div className="note-line" style={{ fontSize: 13 }}>
        С номером: <b className="num">{fmtInt(withPhone.length)}</b> · уже выгружали:{" "}
        <b className="num">
          {fmtInt(done)} <Icon name="check" size={12} stroke={2.4} style={{ color: "var(--c-green-fg)", verticalAlign: -1 }} />
        </b>{" "}
        · в файл: <b className="num">{fmtInt(out.rows.length)}</b>
        {out.leads.length > out.rows.length && <span className="muted"> (повторы номеров убраны)</span>}
      </div>
      {data.leadExportLog.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-sub)" }}>Последние выгрузки</span>
          <div className="exp-log">
            {data.leadExportLog.slice(0, 8).map((e) => (
              <div key={e.at + e.by} className="exp-log-row">
                <span className="num">{fmtStamp(e.at)}</span>
                <span className="exp-log-by">{e.by}</span>
                <b className="num">
                  {fmtInt(e.count)} {plural(e.count, NUMBERS)}
                </b>
                <span className="muted num">{e.from === e.to ? fmtDate(e.from) : `${fmtDate(e.from).slice(0, 5)}–${fmtDate(e.to).slice(0, 5)}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
