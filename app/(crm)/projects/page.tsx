"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { filterLeads, pivot } from "@/lib/crm/calc";
import { HUES } from "@/lib/crm/defaults";
import { DEFAULT_FORM_CHECKLIST, HANDOFF_LABEL, NO_GROUP, NO_GROUP_LABEL, type Project, type ProjectHandoff } from "@/lib/crm/types";
import { hasLeadChecksColumn, hasProjectCitiesColumn, hasProjectFormColumns, hasProjectPriceColumns } from "@/lib/crm/remote";
import { LEADS, fmtInt, fmtPct, plural, safeDiv, shortName } from "@/lib/crm/format";
import { fmtDate, rangeDays } from "@/lib/crm/dates";
import { Chip, Collapse, Empty, HuePicker, NumInput, PeriodPicker, Progress, Seg, Swatch, hueFg, periodFor, periodLabel, type Period } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { StickyHead } from "@/components/app/StickyHead";
import { HeroBars, HeroBig, HeroSplit, PageHero } from "@/components/app/PageHero";

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

  // хиро: лиды по дням и проектам (не больше 62 дней)
  const heroDays = useMemo(() => rangeDays(period.from, period.to).slice(0, 62), [period]);
  const byDay = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of leads) {
      const k = `${l.at.slice(0, 10)}|${l.projectId || "__none__"}`;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [leads]);
  const table = useMemo(() => {
    const pv = pivot(leads, (l) => (by === "operator" ? l.operatorId : l.groupId || NO_GROUP));
    return Array.from(pv.entries())
      .map(([key, m]) => ({
        key,
        name: by === "operator" ? shortName(ix.opById.get(key)?.name ?? "—") : key === NO_GROUP ? NO_GROUP_LABEL : ix.groupById.get(key)?.name ?? "—",
        m,
        total: Array.from(m.values()).reduce((a, b) => a + b, 0),
      }))
      .sort((a, b) => b.total - a.total);
  }, [leads, by, ix]);


  return (
    <div className="stack">
      <StickyHead title="Проекты" />
      <PageHero
        accent="pink"
        title="Проекты"
        sub="Справочник направлений, по которым передаются лиды, и количество лидов по ним за любой период"
        bar={<PeriodPicker value={period} onChange={setPeriod} today={today} />}
      >
        <HeroBig
          label={`Засчитано · ${periodLabel(period)}`}
          value={fmtInt(leads.length)}
          unit={plural(leads.length, LEADS)}
          facts={[
            <>
              проектов в работе <b className="num">{fmtInt(projects.filter((p) => !p.deletedAt && p.active).length)}</b> из {fmtInt(projects.filter((p) => !p.deletedAt).length)}
            </>,
          ]}
        />
        <HeroSplit
          parts={cols.map((c) => {
            const p = ix.projectById.get(c);
            const n = byProject.get(c) ?? 0;
            return { key: c, label: p?.name ?? "Без проекта", value: n, pct: leads.length ? fmtPct(safeDiv(n, leads.length)) : undefined, note: p ? HANDOFF_LABEL[p.handoff ?? "transfer"].toLowerCase() : "проект не указан", hue: p?.color ?? "gray" };
          })}
        />
        <HeroBars
          from={fmtDate(heroDays[0]).slice(0, 5)}
          to={fmtDate(heroDays[heroDays.length - 1]).slice(0, 5)}
          caption="лиды по дням и проектам"
          cols={heroDays.map((d) => ({
            key: d,
            title: `${fmtDate(d).slice(0, 5)}: ${cols.map((c) => `${ix.projectById.get(c)?.name ?? "без проекта"} ${byDay.get(`${d}|${c}`) ?? 0}`).join(", ")}`,
            parts: cols.map((c) => ({ hue: ix.projectById.get(c)?.color ?? "gray", n: byDay.get(`${d}|${c}`) ?? 0 })),
            today: d === today,
            ghost: d > today,
          }))}
        />
      </PageHero>

      <div className="cols-main" style={{ gridTemplateColumns: "minmax(0, 1.6fr) minmax(360px, 1fr)" }}>
        <div className="stack">
          <div className="card card-tbl" style={{ overflow: "hidden" }}>
            <div className="card-head" style={{ padding: "14px 18px 0" }}>
              <Seg className="seg-fill" value={by} onChange={setBy} options={[{ value: "operator", label: "По операторам" }, { value: "group", label: "По группам" }]} />
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
  // цвет нового проекта: по умолчанию — первый свободный из палитры
  const [newColor, setNewColor] = useState<string | null>(null);
  // у какого проекта сейчас открыт выбор цвета
  const [colorFor, setColorFor] = useState<string | null>(null);
  // у какого проекта открыты условия и способ передачи
  const [termsFor, setTermsFor] = useState<string | null>(null);
  const totals = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of data.leads) if (l.projectId) m.set(l.projectId, (m.get(l.projectId) ?? 0) + 1);
    return m;
  }, [data.leads]);
  const live = projects.filter((p) => !p.deletedAt);
  const deleted = projects.filter((p) => p.deletedAt);
  const used = new Set(live.map((p) => p.color));
  const autoColor = HUES.find((h) => !used.has(h)) ?? "slate";

  const add = async () => {
    if (!name.trim()) return;
    const ok = await saveProject({ name, active: true, color: newColor ?? autoColor });
    if (ok) {
      setName("");
      setNewColor(null);
    }
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
        <h3 className="card-title"><Icon name="folder" size={15} className="title-ic" />Справочник проектов</h3>
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
      {canEdit && (
        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, color: "var(--text-sub)" }}>Цвет</span>
          <HuePicker value={newColor ?? autoColor} onChange={setNewColor} size={22} />
          <Chip hue={newColor ?? autoColor}>{name.trim() || "Проект"}</Chip>
        </div>
      )}
      {live.length === 0 && <div style={{ fontSize: 13, color: "var(--dim)" }}>Проектов пока нет.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {live.map((p, i) => (
          <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 8, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--ink-06)", opacity: p.active ? 1 : 0.6 }}>
          <div className="row" style={{ gap: 8 }}>
            {canEdit ? (
            <button
              type="button"
              aria-label="Выбрать цвет"
              title="Выбрать цвет"
              aria-expanded={colorFor === p.id}
              onClick={() => setColorFor((cur) => (cur === p.id ? null : p.id))}
              style={{ width: 16, height: 16, borderRadius: 4, border: `1px solid var(--c-${p.color}-bd)`, padding: 0, flex: "none", background: hueFg(p.color), cursor: "pointer" }}
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
              // название и под ним число лидов: так название помещается целиком рядом с кнопками
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.3 }} onDoubleClick={() => (setEditId(p.id), setEditName(p.name))}>
                <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.name}>
                  {p.name}
                </span>
                <span className="num" style={{ fontSize: 11.5, color: "var(--dim)" }}>
                  {fmtInt(totals.get(p.id) ?? 0)} лид. всего{p.handoff === "form" && " · форма"}{p.handoff === "mixed" && " · перевод или форма"}{!p.active && " · скрыт"}
                </span>
              </span>
            )}
            {canEdit && (
            <>
            <button className="btn btn-ghost btn-sm btn-icon" title="Выше" disabled={i === 0} onClick={() => void move(p, -1)}>
              <Icon name="chevL" size={13} style={{ transform: "rotate(90deg)" }} />
            </button>
            <button className="btn btn-ghost btn-sm btn-icon" title="Ниже" disabled={i === live.length - 1} onClick={() => void move(p, 1)}>
              <Icon name="chevR" size={13} style={{ transform: "rotate(90deg)" }} />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              title="Передача лида и условия для оператора"
              aria-expanded={termsFor === p.id}
              onClick={() => setTermsFor((cur) => (cur === p.id ? null : p.id))}
            >
              <Icon name="rules" size={13} />
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
          {termsFor === p.id && <ProjectTerms p={p} canEdit={canEdit} onDone={() => setTermsFor(null)} />}
          {colorFor === p.id && (
            <HuePicker
              value={p.color}
              size={22}
              onChange={(h) => {
                setColorFor(null);
                if (h !== p.color) void saveProject({ ...p, color: h });
              }}
            />
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

/**
 * Передача лида и условия проекта. «Форма» — оператор не переводит клиента, а отправляет форму заказчика:
 * в окне лида он видит условия и отмечает чек-лист, без отметок лид не записать.
 */
function ProjectTerms({ p, canEdit, onDone }: { p: Project; canEdit: boolean; onDone: () => void }) {
  const { saveProject, remote, access, data } = useCrm();
  // цена лида и апрув — деньги: видит и меняет только РОП
  const money = access.can.systemSettings;
  const [price, setPrice] = useState<number | null>(p.leadPrice ? p.leadPrice : null);
  const [approve, setApprove] = useState<number | null>(p.approvePct ?? null);
  const [handoff, setHandoff] = useState<ProjectHandoff>(p.handoff ?? "transfer");
  const [brief, setBrief] = useState(p.brief ?? "");
  const [list, setList] = useState((p.checklist?.length ? p.checklist : handoff !== "transfer" ? DEFAULT_FORM_CHECKLIST : []).join("\n"));
  const [cities, setCities] = useState((p.regions ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const items = list.split("\n").map((x) => x.trim()).filter(Boolean);
  const cityList = cities.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
  const notStored = remote && (!hasProjectFormColumns() || !hasProjectCitiesColumn() || !hasLeadChecksColumn() || (money && !hasProjectPriceColumns()));
  const pickHandoff = (v: ProjectHandoff) => {
    setHandoff(v);
    // форма (или «перевод или форма») без чек-листа — подставляем обязательные поля формы
    if (v !== "transfer" && !list.trim()) setList(DEFAULT_FORM_CHECKLIST.join("\n"));
  };
  const save = async () => {
    setBusy(true);
    const ok = await saveProject({
      ...p,
      handoff,
      brief: brief.trim(),
      checklist: items,
      regions: cityList,
      ...(money ? { leadPrice: price ?? 0, approvePct: approve } : {}),
    });
    setBusy(false);
    if (ok) onDone();
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
      <Seg<ProjectHandoff>
        value={handoff}
        onChange={canEdit ? pickHandoff : () => undefined}
        options={(["transfer", "form", "mixed"] as ProjectHandoff[]).map((v) => ({ value: v, label: HANDOFF_LABEL[v] }))}
      />
      {money && (
        <div className="grid2" style={{ gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "var(--text-sub)" }}>
            Цена лида, ₽
            <NumInput value={price} onChange={setPrice} max={10_000_000} placeholder={`как в настройках · ${fmtInt(data.settings.leadRevenue)}`} />
            <span className="field-hint">Пусто — цена «основы» / «регионов» из настроек</span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "var(--text-sub)" }}>
            Апрув по умолчанию, %
            <NumInput value={approve} onChange={setApprove} max={100} step={0.5} placeholder={`общий · ${fmtInt(data.settings.svBonus.defaultApprovePct)}`} />
            <span className="field-hint">Пусто — общий. Апрув за месяц — в «Зарплате»</span>
          </label>
        </div>
      )}
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "var(--text-sub)" }}>
        Условия для оператора — видны в окне лида
        <textarea
          className="inp"
          rows={6}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          readOnly={!canEdit}
          placeholder={"Марки и модели, города, бюджет, кому не звоним.\nНапример: стоимость от 500 тыс до 5 млн, не лизинг, гражданство РФ"}
        />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "var(--text-sub)" }}>
        {handoff === "form"
          ? "Чек-лист формы — по пункту в строке; оператор отмечает каждый перед записью лида"
          : handoff === "mixed"
            ? "Чек-лист формы — по пункту в строке; нужен, только если клиента не перевели на менеджера в звонке"
            : "Чек-лист перед записью лида (необязательно) — по пункту в строке"}
        <textarea className="inp" rows={4} value={list} onChange={(e) => setList(e.target.value)} readOnly={!canEdit} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, color: "var(--text-sub)" }}>
        Города проекта — по городу в строке; в окне лида это список «Город клиента». Пусто — регионы из настроек
        <textarea className="inp" rows={4} value={cities} onChange={(e) => setCities(e.target.value)} readOnly={!canEdit} placeholder={"Москва\nКраснодар\nСамара"} />
      </label>
      {notStored && (
        <span style={{ fontSize: 12, color: "var(--c-red-fg)" }}>
          Не всё сохраняется: выполните в Supabase файлы supabase/migrations/20261017000002_project_form.sql, 20261017000003_project_cities.sql и 20261017000004_project_price.sql
        </span>
      )}
      {canEdit && (
        <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn-sm" onClick={onDone}>
            Отмена
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={busy}>
            Сохранить
          </button>
        </div>
      )}
    </div>
  );
}
