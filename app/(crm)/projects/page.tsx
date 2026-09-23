"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { filterLeads, pivot } from "@/lib/crm/calc";
import { HUES } from "@/lib/crm/defaults";
import { NO_GROUP, NO_GROUP_LABEL, type Project } from "@/lib/crm/types";
import { fmtInt, fmtPct, safeDiv } from "@/lib/crm/format";
import { Chip, Collapse, Empty, PageHead, PeriodPicker, Progress, Seg, Swatch, downloadText, hueFg, periodFor, periodLabel, toCsv, type Period } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";

export default function ProjectsPage() {
  const { data, ix, today } = useCrm();
  const [period, setPeriod] = useState<Period>(() => periodFor("month", today));
  const [by, setBy] = useState<"operator" | "group">("operator");

  const leads = useMemo(() => filterLeads(data.leads, { from: period.from, to: period.to, status: "counted" }), [data.leads, period]);
  const projects = useMemo(() => [...data.projects].sort((a, b) => a.sort - b.sort), [data.projects]);

  const byProject = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) m.set(l.projectId || "__none__", (m.get(l.projectId || "__none__") ?? 0) + 1);
    return m;
  }, [leads]);
  const cols = useMemo(() => {
    const ids = projects.filter((p) => !p.deletedAt || byProject.has(p.id)).map((p) => p.id);
    if (byProject.has("__none__")) ids.push("__none__");
    return ids;
  }, [projects, byProject]);

  const table = useMemo(() => {
    const pv = pivot(leads, (l) => (by === "operator" ? l.operatorId : l.groupId || NO_GROUP));
    return Array.from(pv.entries())
      .map(([key, m]) => ({
        key,
        name: by === "operator" ? ix.opById.get(key)?.name ?? "—" : key === NO_GROUP ? NO_GROUP_LABEL : ix.groupById.get(key)?.name ?? "—",
        m,
        total: Array.from(m.values()).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [leads, by, ix]);

  const exportCsv = () => {
    const head = [by === "operator" ? "Оператор" : "Группа", ...cols.map((c) => ix.projectById.get(c)?.name ?? "Без проекта"), "Всего"];
    const body = table.map((r) => [r.name, ...cols.map((c) => r.m.get(c) ?? 0), r.total]);
    downloadText(`projects_${by}_${period.from}_${period.to}.csv`, toCsv([head, ...body]), "text/csv;charset=utf-8");
  };

  return (
    <div className="stack">
      <PageHead title="Проекты" sub="Справочник направлений, по которым передаются лиды, и количество лидов по ним за любой период" />

      <div className="cols-main" style={{ gridTemplateColumns: "minmax(0, 1.7fr) minmax(300px, 1fr)" }}>
        <div className="stack">
          <div className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <PeriodPicker value={period} onChange={setPeriod} today={today} />
            <div style={{ fontSize: 13 }}>
              <b className="num">{fmtInt(leads.length)}</b> лидов · {periodLabel(period)}
            </div>
            {leads.length === 0 ? (
              <div style={{ fontSize: 13, color: "var(--dim)" }}>За период лидов нет.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {cols.map((c) => {
                  const p = ix.projectById.get(c);
                  const n = byProject.get(c) ?? 0;
                  return (
                    <div key={c} className="row" style={{ gap: 10 }}>
                      <span className="row" style={{ gap: 8, width: 170, minWidth: 0 }}>
                        <Swatch hue={p?.color ?? "gray"} />
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p?.name ?? "Без проекта"}</span>
                      </span>
                      <Progress value={safeDiv(n, leads.length)} hue={p?.color ?? "gray"} style={{ flex: 1 }} />
                      <span className="num" style={{ width: 50, textAlign: "right", fontWeight: 600 }}>{fmtInt(n)}</span>
                      <span className="num" style={{ width: 44, textAlign: "right", color: "var(--dim)", fontSize: 12 }}>{fmtPct(safeDiv(n, leads.length))}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card card-tbl" style={{ overflow: "hidden" }}>
            <div className="card-head" style={{ padding: "14px 18px 0" }}>
              <Seg value={by} onChange={setBy} options={[{ value: "operator", label: "По операторам" }, { value: "group", label: "По группам" }]} />
              <button className="btn btn-sm" onClick={exportCsv} disabled={!table.length}>
                <Icon name="download" size={13} /> CSV
              </button>
            </div>
            {table.length === 0 ? (
              <Empty icon="folder" title="Нет данных за период" />
            ) : (
              <div style={{ overflowX: "auto", maxHeight: 520 }}>
                <table className="tbl tbl-fit">
                  <thead>
                    <tr>
                      <th className="sticky-col">{by === "operator" ? "Оператор" : "Группа"}</th>
                      {cols.map((c) => (
                        <th key={c} className="r">
                          {ix.projectById.get(c)?.name ?? "Без проекта"}
                        </th>
                      ))}
                      <th className="r bl">Всего</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((r) => (
                      <tr key={r.key}>
                        <td className="sticky-col">
                          {by === "operator" ? (
                            <Link href={`/leads?op=${encodeURIComponent(r.key)}&from=${period.from}&to=${period.to}`} style={{ color: "var(--text)", textDecoration: "none" }}>
                              {r.name}
                            </Link>
                          ) : (
                            r.name
                          )}
                        </td>
                        {cols.map((c) => (
                          <td key={c} className="r num">
                            {r.m.get(c) ? fmtInt(r.m.get(c)!) : <span className="muted">·</span>}
                          </td>
                        ))}
                        <td className="r num bl" style={{ fontWeight: 600 }}>{fmtInt(r.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="sticky-col">Итого</td>
                      {cols.map((c) => (
                        <td key={c} className="r num">{fmtInt(byProject.get(c) ?? 0)}</td>
                      ))}
                      <td className="r num bl">{fmtInt(leads.length)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>

        <ProjectDirectory projects={projects} />
      </div>
    </div>
  );
}

function ProjectDirectory({ projects }: { projects: Project[] }) {
  const { data, saveProject, deleteProject, restoreProject, confirm, access } = useCrm();
  const canEdit = access.can.manageProjects;
  const [name, setName] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [showDeleted, setShowDeleted] = useState(false);
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of data.leads) if (l.projectId) m.set(l.projectId, (m.get(l.projectId) ?? 0) + 1);
    return m;
  }, [data.leads]);
  const live = projects.filter((p) => !p.deletedAt);
  const deleted = projects.filter((p) => p.deletedAt);
  const used = new Set(live.map((p) => p.color));

  const add = async () => {
    if (!name.trim()) return;
    const ok = await saveProject({ name, active: true, color: HUES.find((h) => !used.has(h)) ?? "blue" });
    if (ok) setName("");
  };

  // порядок в форме лида: меняем местами и переписываем номера только у тех, чей номер изменился
  const move = async (p: Project, dir: -1 | 1) => {
    const order = [...live];
    const i = order.findIndex((x) => x.id === p.id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    for (let k = 0; k < order.length; k++) if (order[k].sort !== k) await saveProject({ ...order[k], sort: k });
  };

  return (
    <div className="card card-pad" style={{ alignSelf: "start", display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <h3 className="card-title">Справочник проектов</h3>
        <p className="card-sub">Оператор выбирает проект при записи лида.{canEdit ? " Изменения видны сразу." : " Справочник ведёт РОП."}</p>
      </div>
      {canEdit && (
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <input className="inp" value={name} onChange={(e) => setName(e.target.value)} placeholder="Новый проект, например «Авто»" />
        <button className="btn btn-primary" type="submit" disabled={!name.trim()}>
          <Icon name="plus" size={14} /> Добавить
        </button>
      </form>
      )}
      {live.length === 0 && <div style={{ fontSize: 13, color: "var(--dim)" }}>Проектов пока нет.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {live.map((p, i) => (
          <div key={p.id} className="row" style={{ gap: 8, padding: "6px 8px", borderRadius: 8, border: "1px solid var(--ink-06)", opacity: p.active ? 1 : 0.6 }}>
            {canEdit ? (
            <button
              type="button"
              aria-label="Сменить цвет"
              title="Сменить цвет"
              onClick={() => void saveProject({ ...p, color: HUES[(HUES.indexOf(p.color as (typeof HUES)[number]) + 1) % HUES.length] })}
              style={{ width: 14, height: 14, borderRadius: 4, border: "none", padding: 0, flex: "none", background: hueFg(p.color) }}
            />
            ) : (
              <span className="swatch" style={{ background: hueFg(p.color), width: 12, height: 12, borderRadius: 4 }} />
            )}
            {editId === p.id ? (
              <input
                className="inp inp-sm"
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === "Enter") {
                    if (await saveProject({ ...p, name: editName })) setEditId(null);
                  }
                  if (e.key === "Escape") setEditId(null);
                }}
                onBlur={async () => {
                  if (editName.trim() && editName !== p.name) await saveProject({ ...p, name: editName });
                  setEditId(null);
                }}
              />
            ) : (
              <span style={{ flex: 1, minWidth: 0, fontSize: 13 }} onDoubleClick={() => (setEditId(p.id), setEditName(p.name))}>
                {p.name}
                {!p.active && <span className="muted"> · скрыт</span>}
              </span>
            )}
            <span className="num" style={{ fontSize: 12, color: "var(--dim)" }} title="Всего лидов">
              {fmtInt(totals.get(p.id) ?? 0)}
            </span>
            {canEdit && (
            <>
            <button className="btn btn-ghost btn-sm btn-icon" title="Выше" disabled={i === 0} onClick={() => void move(p, -1)}>
              <Icon name="chevL" size={13} style={{ transform: "rotate(90deg)" }} />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" title="Ниже" disabled={i === live.length - 1} onClick={() => void move(p, 1)}>
              <Icon name="chevR" size={13} style={{ transform: "rotate(90deg)" }} />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" title="Переименовать" onClick={() => (setEditId(p.id), setEditName(p.name))}>
              <Icon name="edit" size={13} />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" title={p.active ? "Скрыть из формы лида" : "Показывать в форме лида"} onClick={() => void saveProject({ ...p, active: !p.active })}>
              <Icon name={p.active ? "pause" : "play"} size={13} />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              title="Удалить"
              onClick={async () => {
                if (await confirm({ title: `Удалить проект «${p.name}»?`, text: "Проект пропадёт из формы и списков. Лиды по нему сохранятся и останутся в отчётах.", ok: "Удалить", danger: true }))
                  void deleteProject(p.id);
              }}
            >
              <Icon name="trash" size={13} />
            </button>
            </>
            )}
          </div>
        ))}
      </div>
      {deleted.length > 0 && (
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowDeleted((v) => !v)} style={{ marginLeft: -8 }}>
            <Icon name="chevR" size={13} className={`grp-chev${showDeleted ? " open" : ""}`} /> Удалённые · {deleted.length}
          </button>
          <Collapse open={showDeleted} innerStyle={{ paddingTop: 6 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {deleted.map((p) => (
                <div key={p.id} className="row" style={{ gap: 8, fontSize: 13, color: "var(--dim)" }}>
                  <Chip hue={p.color}>{p.name}</Chip>
                  <span className="num">{fmtInt(totals.get(p.id) ?? 0)} лид.</span>
                  <span className="spacer" />
                  {canEdit && (
                    <button className="btn btn-sm" onClick={() => void restoreProject(p.id)}>
                      Вернуть
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Collapse>
        </div>
      )}
    </div>
  );
}
