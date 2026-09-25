"use client";

import { useEffect, useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { filterLeads } from "@/lib/crm/calc";
import { LEAD_STATUSES, LEAD_STATUS_HUE, LEAD_STATUS_LABEL, NO_GROUP, NO_GROUP_LABEL, type LeadStatus } from "@/lib/crm/types";
import { fmtDate, rangeDays } from "@/lib/crm/dates";
import { LEADS, fmtInt, fmtNum, fmtPhone, plural, shortName } from "@/lib/crm/format";
import { Chip, ClipText, Empty, LeadLinkButton, LeadStatusChip, PageHead, PeriodPicker, downloadText, hueVars, periodFor, periodLabel, toCsv, type Period } from "@/components/ui/kit";
import { Select, dot, type Opt } from "@/components/ui/select";
import { canReviewLead } from "@/lib/crm/access";
import { Icon } from "@/components/ui/icons";

const PAGE = 100;

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
  const [limit, setLimit] = useState(PAGE);

  // переход из карточки оператора / группы / проекта: /leads?op=…&from=…&to=…
  useEffect(() => {
    const qp = readQuery();
    if (qp.op) setOperatorId(qp.op);
    if (qp.group) setGroupId(qp.group);
    if (qp.project) setProjectId(qp.project);
    if ((LEAD_STATUSES as string[]).includes(qp.status)) setStatus(qp.status as LeadStatus);
    if (qp.from && qp.to) setPeriod({ mode: "range", from: qp.from, to: qp.to });
  }, []);

  useEffect(() => setLimit(PAGE), [period, operatorId, groupId, projectId, q, status]);

  // без фильтра по статусу — для счётчиков «в работе / доведён / не доведён»
  const base = useMemo(
    () => filterLeads(data.leads, { from: period.from, to: period.to, operatorId, groupId, projectId, q }).sort((a, b) => b.at.localeCompare(a.at)),
    [data.leads, period, operatorId, groupId, projectId, q],
  );
  const list = useMemo(() => (status ? base.filter((l) => l.status === status) : base), [base, status]);
  const byStatus = useMemo(() => {
    const m: Record<LeadStatus, number> = { work: 0, done: 0, failed: 0 };
    for (const l of base) m[l.status]++;
    return m;
  }, [base]);
  // что этот аккаунт может разом отметить доведёнными
  const reviewable = useMemo(() => list.filter((l) => l.status === "work" && canReviewLead(access, l)), [list, access]);

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
  const filtered = !!(operatorId || groupId || projectId || q || status);

  const exportCsv = () => {
    const rows: (string | number)[][] = [["ID", "Дата", "Время", "Статус", "Причина", "Клиент", "Телефон", "Ссылка", "Проект", "Оператор", "Группа", data.settings.directionLabel || "Направление", "Комментарий", "Источник"]];
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
        l.direction,
        l.comment,
        l.source,
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
          {filtered && (
            <button
              className="btn btn-ghost"
              onClick={() => {
                setOperatorId("");
                setGroupId("");
                setProjectId("");
                setQ("");
                setStatus("");
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
        <div className="tbl-wrap" style={{ maxHeight: "max(300px, calc(100vh / var(--ui-scale, 1) - 330px))" }}>
          <table className="tbl tbl-leads">
            <thead>
              <tr>
                <th className="c">Передан</th>
                <th className="c">Статус</th>
                <th>Клиент</th>
                <th className="c">Телефон</th>
                <th className="c">Проект</th>
                <th>Оператор</th>
                <th className="c">Группа</th>
                {data.settings.directionEnabled && <th>{data.settings.directionLabel || "Направление"}</th>}
                <th>Комментарий</th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, limit).map((l) => {
                const op = ix.opById.get(l.operatorId);
                const g = l.groupId ? ix.groupById.get(l.groupId) : null;
                const p = l.projectId ? ix.projectById.get(l.projectId) : null;
                return (
                  <tr key={l.id} className="clickable" onClick={() => openLead(l)}>
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
                      <ClipText text={l.client} width={120} />
                    </td>
                    <td className="num c">
                      {/* ссылка на лид — слева от номера; слот фиксированной ширины держит номера на одной вертикали */}
                      <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <span style={{ width: 22, flex: "none", display: "inline-flex" }}>
                          <LeadLinkButton link={l.link} variant="icon" />
                        </span>
                        {fmtPhone(l.phone) || <span className="muted">—</span>}
                      </span>
                    </td>
                    <td className="c">{p ? <Chip hue={p.color}>{p.name}</Chip> : <span className="muted">—</span>}</td>
                    <td>
                      <ClipText text={shortName(op?.name ?? "—") + (op?.deletedAt ? " (удалён)" : "")} full={(op?.name ?? "—") + (op?.deletedAt ? " (удалён)" : "")} width={130} />
                    </td>
                    <td className={g ? "c" : "c muted"}>{g ? g.name : NO_GROUP_LABEL}</td>
                    {data.settings.directionEnabled && (
                      <td>
                        <ClipText text={l.direction} width={100} />
                      </td>
                    )}
                    <td className="muted">
                      <ClipText text={l.comment} width={130} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length > limit && (
            <div style={{ padding: 12, textAlign: "center", borderTop: "1px solid var(--ink-06)" }}>
              <button className="btn btn-sm" onClick={() => setLimit((n) => n + PAGE * 3)}>
                Показать ещё · осталось {fmtInt(list.length - limit)}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
