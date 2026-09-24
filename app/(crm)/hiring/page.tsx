"use client";

import { useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import type { Candidate, DataState, Group } from "@/lib/crm/types";
import { CANDIDATE_STAGE_HUE, CANDIDATE_STAGE_LABEL, NO_GROUP, NO_GROUP_LABEL } from "@/lib/crm/types";
import { EARLY_DAYS, daysBetween, fmtTenure, hiresIn, hiringFunnel, isOpenCandidate, leaversIn, staffStat, turnoverByMonth } from "@/lib/crm/hiring";
import { hasCandidatesTable } from "@/lib/crm/remote";
import { addMonths, fmtDate, fmtMonth, fmtMonthShort, monthEnd, monthStart } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct, plural, safeDiv } from "@/lib/crm/format";
import { Chip, Empty, Kpi, MonthSwitcher, PageHead, Progress, Seg, downloadText, toCsv } from "@/components/ui/kit";
import { Select, dot, type Opt } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";
import { CandidateModal } from "@/components/app/CandidateModal";

/**
 * Найм и текучесть.
 *
 *   Воронка    — кандидаты с откликом в периоде: этапы, источники, причины отказов;
 *                принятые за период (с кандидатом или без) и как у них со стажировкой.
 *   Кандидаты  — список: кто в работе, кого приняли, кому отказали. Карточка — CandidateModal.
 *   Текучесть  — кто ушёл, сколько проработал, отток по месяцам, стаж работающих.
 *
 * Супервайзер видит только своих (срез по правам — access.ts). РОП — весь отдел и фильтр
 * «чей найм»: супервайзер (все его группы) или отдельная группа; фильтр режет кандидатов
 * по группе, куда их ведут, а сотрудников — по текущей группе.
 */

type Span = "1" | "3" | "6" | "12";
type Tab = "funnel" | "list" | "churn";
type ListFilter = "open" | "hired" | "closed" | "all";

const PEOPLE: [string, string, string] = ["человек", "человека", "человек"];
const CANDS: [string, string, string] = ["кандидат", "кандидата", "кандидатов"];

export default function HiringPage() {
  const { data, ix, month, setMonth, today, remote, openOperator, access } = useCrm();
  const [span, setSpan] = useState<Span>("3");
  const [tab, setTab] = useState<Tab>("funnel");
  const [filter, setFilter] = useState<ListFilter>("open");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Candidate | "new" | null>(null);
  const [who, setWho] = useState("");

  const liveGroups = useMemo(() => data.groups.filter((g) => !g.deletedAt), [data.groups]);
  const svName = (g: Group) => (g.supervisorId ? ix.opById.get(g.supervisorId)?.name ?? "" : g.supervisorName.trim());
  // «чей найм»: супервайзеры (все их группы) и отдельные группы — РОПу и тем, кто видит весь отдел
  const whoOpts = useMemo(() => {
    const bySv = new Map<string, { label: string; groups: string[] }>();
    for (const g of liveGroups) {
      const name = svName(g);
      if (!name) continue;
      const key = g.supervisorId ? `sv:${g.supervisorId}` : `svn:${name}`;
      const cur = bySv.get(key) ?? { label: name, groups: [] };
      cur.groups.push(g.id);
      bySv.set(key, cur);
    }
    const opts: (Opt & { groups: string[] })[] = [{ value: "", label: "Весь отдел", groups: [] }];
    for (const [value, v] of Array.from(bySv).sort((a, b) => a[1].label.localeCompare(b[1].label, "ru")))
      opts.push({ value, label: v.label, hint: v.groups.map((id) => ix.groupById.get(id)?.name ?? "").join(", "), group: "Супервайзеры", groups: v.groups });
    for (const g of liveGroups) opts.push({ value: `g:${g.id}`, label: g.name, icon: dot(g.color), group: "Группы", groups: [g.id] });
    opts.push({ value: `g:${NO_GROUP}`, label: NO_GROUP_LABEL, icon: dot("gray"), group: "Группы", groups: [NO_GROUP] });
    return opts;
  }, [liveGroups, ix]);
  const showWho = access.viewAll && liveGroups.length > 0;
  const view: DataState = useMemo(() => {
    const keep = whoOpts.find((o) => o.value === who)?.groups;
    if (!who || !keep) return data;
    const set = new Set(keep);
    const inScope = (groupId: string | null) => set.has(groupId || NO_GROUP);
    return { ...data, candidates: data.candidates.filter((c) => inScope(c.groupId)), operators: data.operators.filter((o) => inScope(o.groupId)) };
  }, [data, who, whoOpts]);

  const from = monthStart(addMonths(month, -(Number(span) - 1)));
  const to = monthEnd(month) < today ? monthEnd(month) : today;
  const periodLabel = span === "1" ? fmtMonth(month) : `${fmtMonthShort(addMonths(month, -(Number(span) - 1)))} – ${fmtMonthShort(month)}`;

  const funnel = useMemo(() => hiringFunnel(view, ix, from, to, today), [view, ix, from, to, today]);
  const hires = useMemo(() => hiresIn(view, ix, from, to, today), [view, ix, from, to, today]);
  const leavers = useMemo(() => leaversIn(view, ix, from, to, today), [view, ix, from, to, today]);
  const staff = useMemo(() => staffStat(view, ix, today), [view, ix, today]);
  const months = useMemo(() => Array.from({ length: 12 }, (_, i) => addMonths(month, i - 11)), [month]);
  const churn = useMemo(() => turnoverByMonth(view, ix, months, today), [view, ix, months, today]);
  // свежие сверху; пустые месяцы до появления первых сотрудников не показываем
  const churnRows = useMemo(() => {
    const first = churn.findIndex((r) => r.start || r.hired || r.fired || r.end);
    return (first < 0 ? [] : churn.slice(first)).reverse();
  }, [churn]);

  const groupName = (id: string | null) => (id ? ix.groupById.get(id)?.name ?? NO_GROUP_LABEL : NO_GROUP_LABEL);
  /** Группа и её супервайзер — РОПу видно, чей это кандидат. */
  const groupWithSv = (id: string | null) => {
    const g = id ? ix.groupById.get(id) : null;
    if (!g) return "—";
    const sv = svName(g);
    return sv ? `${g.name} · ${sv}` : g.name;
  };
  const live = useMemo(() => view.candidates.filter((c) => !c.deletedAt), [view.candidates]);
  const openCount = live.filter(isOpenCandidate).length;
  const missing = remote && !hasCandidatesTable();

  // отток за выбранный период — по месяцам периода
  const periodChurn = churn.filter((r) => r.month >= from.slice(0, 7) && r.month <= month);
  const churnFired = periodChurn.reduce((a, r) => a + r.fired, 0);
  const churnAvg = periodChurn.length ? periodChurn.reduce((a, r) => a + (r.start + r.end) / 2, 0) / periodChurn.length : 0;
  const passedHires = hires.filter((h) => h.passed === true);
  const probHires = hires.filter((h) => h.passed !== null);
  const earlyLeft = hires.filter((h) => h.early).length;
  const avgToPass = passedHires.length ? passedHires.reduce((a, h) => a + (h.daysToPass ?? 0), 0) / passedHires.length : null;

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return live
      .filter((c) => {
        if (filter === "open") return isOpenCandidate(c);
        // остальные фильтры — за выбранный период
        if (c.appliedAt < from || c.appliedAt > to) return false;
        if (filter === "hired") return c.stage === "hired";
        if (filter === "closed") return c.stage === "rejected" || c.stage === "declined";
        return true;
      })
      .filter((c) => !needle || `${c.name} ${c.contact} ${c.source} ${c.comment}`.toLowerCase().includes(needle))
      .sort((a, b) => lastMove(b).localeCompare(lastMove(a)) || a.name.localeCompare(b.name, "ru"));
  }, [live, filter, q, from, to]);

  const exportCsv = () => {
    const head = ["ФИО", "Контакт", "Источник", "Группа · супервайзер", "Этап", "Отклик", "Собеседование", "Обучение", "Итог", "Причина", "Комментарий"];
    const body = list.map((c) => [c.name, c.contact, c.source, c.groupId ? groupWithSv(c.groupId) : "", CANDIDATE_STAGE_LABEL[c.stage], c.appliedAt, c.interviewAt, c.trainingAt, c.closedAt, c.reason, c.comment]);
    downloadText(`kandidaty_${from}_${to}.csv`, toCsv([head, ...body]), "text/csv;charset=utf-8");
  };

  return (
    <div className="stack">
      <PageHead
        title="Найм"
        sub={`${periodLabel} · в работе ${fmtInt(openCount)} ${plural(openCount, CANDS)} · в штате ${fmtInt(staff.staff.length)} ${plural(staff.staff.length, PEOPLE)}`}
        actions={
          <>
            <MonthSwitcher value={month} onChange={setMonth} />
            <button className="btn btn-primary" onClick={() => setOpen("new")} disabled={missing || !access.can.manageHiring}>
              <Icon name="plus" size={14} /> Кандидат
            </button>
          </>
        }
      />

      {missing && (
        <div className="card card-pad note-line warn" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <Icon name="alert" size={16} />
          <div>
            <b>В Supabase ещё нет таблицы кандидатов.</b> Откройте Supabase → SQL Editor, вставьте файл <code>supabase/migrations/20260924000001_candidates.sql</code> целиком и нажмите Run —
            повторный запуск безопасен, данные не трогаются. Текучесть и стажировка ниже уже считаются по карточкам операторов.
          </div>
        </div>
      )}

      <div className="toolbar">
        <Seg<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: "funnel", label: "Воронка" },
            { value: "list", label: `Кандидаты${openCount ? ` · ${openCount}` : ""}` },
            { value: "churn", label: "Текучесть" },
          ]}
        />
        {showWho && (
          <Select
            width={240}
            value={who}
            options={whoOpts}
            onChange={setWho}
            ariaLabel="Чей найм"
            minPopWidth={300}
          />
        )}
        <Seg<Span>
          value={span}
          onChange={setSpan}
          options={[
            { value: "1", label: "Месяц" },
            { value: "3", label: "3 мес." },
            { value: "6", label: "6 мес." },
            { value: "12", label: "Год" },
          ]}
        />
      </div>

      {tab === "funnel" && (
        <>
          <div className="kpi-grid" data-n="6">
            <Kpi label="Отклики" value={fmtInt(funnel.steps[0].count)} sub={`в работе ${fmtInt(funnel.open)}`} />
            <Kpi label="Приняты" value={fmtInt(funnel.steps[3].count)} sub={funnel.steps[0].count ? `${fmtPct(funnel.steps[3].ofFirst)} от откликов` : "откликов нет"} />
            <Kpi
              label="Срок найма"
              value={funnel.avgDaysToHire == null ? "—" : `${fmtNum(funnel.avgDaysToHire, 0)} дн.`}
              sub="от отклика до приёма"
            />
            <Kpi label="Принято всего" value={fmtInt(hires.length)} sub="и без воронки" title="Все, кого приняли за период, — и из кандидатов, и заведённые сразу карточкой" />
            <Kpi
              label="Стажировка"
              value={probHires.length ? fmtPct(safeDiv(passedHires.length, probHires.length)) : "—"}
              sub={probHires.length ? `закрыли ${fmtInt(passedHires.length)} из ${fmtInt(probHires.length)}${avgToPass != null ? ` · за ${fmtNum(avgToPass, 0)} дн.` : ""}` : "стажировка выключена"}
              tone={probHires.length ? (safeDiv(passedHires.length, probHires.length) >= 0.5 ? "good" : "warn") : undefined}
            />
            <Kpi
              label={`Ушли за ${EARLY_DAYS} дней`}
              value={fmtInt(earlyLeft)}
              sub={hires.length ? `${fmtPct(safeDiv(earlyLeft, hires.length))} принятых` : "—"}
              tone={earlyLeft ? "bad" : undefined}
            />
          </div>

          <div className="cols-main">
            <div className="card card-pad">
              <div className="card-head">
                <div>
                  <h3 className="card-title">Воронка найма</h3>
                  <p className="card-sub">Кандидаты с откликом за {periodLabel.toLowerCase()} — сколько дошло до каждого этапа</p>
                </div>
              </div>
              {funnel.steps[0].count === 0 ? (
                <Empty
                  icon="userPlus"
                  title="Кандидатов за период нет"
                  text="Заводите каждого откликнувшегося — тогда будет видно, на каком этапе теряются люди и какой источник даёт тех, кто остаётся."
                  action={
                    !missing && access.can.manageHiring ? (
                      <button className="btn btn-primary" onClick={() => setOpen("new")}>
                        <Icon name="plus" size={14} /> Кандидат
                      </button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <div className="funnel">
                    {funnel.steps.map((st) => (
                      <div key={st.key} className="funnel-row">
                        <div className="funnel-label">
                          {st.label}
                          {st.ofPrev != null && <span>переход {fmtPct(st.ofPrev)}</span>}
                        </div>
                        <div className="funnel-track">
                          <div className={st.ofFirst < 0.12 ? "funnel-fill low" : "funnel-fill"} style={{ width: `${Math.max(2, Math.round(st.ofFirst * 100))}%` }}>
                            {fmtInt(st.count)}
                          </div>
                        </div>
                        <div className="funnel-meta">
                          <b>{fmtPct(st.ofFirst)}</b> от откликов
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 14 }}>
                    <Chip hue="green" dot>
                      Работают: {fmtInt(funnel.working)}
                      {funnel.onProbation ? ` (на стажировке ${fmtInt(funnel.onProbation)})` : ""}
                    </Chip>
                    <Chip hue={funnel.fired ? "red" : "gray"} dot>
                      Ушли: {fmtInt(funnel.fired)}
                      {funnel.firedBeforeProbation ? ` (не закрыв стажировку ${fmtInt(funnel.firedBeforeProbation)})` : ""}
                    </Chip>
                    <Chip hue="gray">Отказали мы: {fmtInt(funnel.rejected)}</Chip>
                    <Chip hue="amber">Отказались сами: {fmtInt(funnel.declined)}</Chip>
                    <Chip hue="blue">В работе: {fmtInt(funnel.open)}</Chip>
                  </div>
                </>
              )}
            </div>

            <div className="stack">
              <div className="card card-pad">
                <h3 className="card-title" style={{ marginBottom: 8 }}>
                  Источники
                </h3>
                {funnel.sources.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--dim)" }}>Нет данных за период.</div>
                ) : (
                  <table className="tbl tbl-fit" style={{ background: "transparent" }}>
                    <thead>
                      <tr>
                        <th>Источник</th>
                        <th className="r">Кандидатов</th>
                        <th className="r">Принято</th>
                        <th className="r">Конверсия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {funnel.sources.map((s) => (
                        <tr key={s.source}>
                          <td>{s.source}</td>
                          <td className="r num">{fmtInt(s.candidates)}</td>
                          <td className="r num" style={{ fontWeight: 600 }}>{fmtInt(s.hired)}</td>
                          <td className="r num">{fmtPct(s.pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              <div className="card card-pad">
                <h3 className="card-title" style={{ marginBottom: 8 }}>
                  Причины отказов
                </h3>
                {funnel.reasons.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--dim)" }}>Отказов за период нет.</div>
                ) : (
                  <div className="dist">
                    {funnel.reasons.slice(0, 8).map((r) => (
                      <div key={r.reason} className="dist-row" style={{ gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr) 32px" }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason}>
                          {r.reason}
                        </span>
                        <div className="dist-bar">
                          <span style={{ width: `${Math.round(safeDiv(r.count, funnel.reasons[0].count) * 100)}%` }} />
                        </div>
                        <b className="num" style={{ textAlign: "right" }}>
                          {fmtInt(r.count)}
                        </b>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card card-tbl" style={{ overflow: "hidden" }}>
            <div className="card-head" style={{ padding: "14px 18px 0" }}>
              <div>
                <h3 className="card-title">Принятые за период</h3>
                <p className="card-sub">Все, у кого дата приёма в периоде, — и из воронки, и заведённые сразу карточкой</p>
              </div>
            </div>
            {hires.length === 0 ? (
              <Empty icon="users" title="За период никого не приняли" />
            ) : (
              <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Сотрудник</th>
                      <th>Группа</th>
                      <th>Принят</th>
                      <th>Стажировка</th>
                      <th>Сейчас</th>
                      <th className="r">Стаж</th>
                      <th>Источник</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hires.map((h) => {
                      const o = h.stint.op;
                      return (
                        <tr key={o.id} className="clickable" onClick={() => openOperator(o)}>
                          <td style={{ fontWeight: 500 }}>{o.name}</td>
                          <td className="muted">{groupName(o.groupId)}</td>
                          <td className="num">{fmtDate(h.stint.hire)}</td>
                          <td style={{ minWidth: 170 }}>
                            {h.passed === null ? (
                              <span className="muted">не нужна</span>
                            ) : h.passed ? (
                              <Chip hue="green" dot>
                                закрыта{h.daysToPass != null ? ` за ${fmtInt(h.daysToPass)} дн.` : ""}
                              </Chip>
                            ) : h.stint.fire && h.stint.fire <= today ? (
                              <Chip hue="red" dot>
                                не закрыл · {fmtPct(h.prob.pct)}
                              </Chip>
                            ) : (
                              <div className="row" style={{ gap: 8 }}>
                                <Progress value={h.prob.pct} height={6} style={{ flex: 1, minWidth: 60 }} />
                                <span className="num muted" style={{ fontSize: 12 }}>
                                  {fmtPct(h.prob.pct)}
                                </span>
                              </div>
                            )}
                          </td>
                          <td>
                            {h.stint.fire && h.stint.fire <= today ? (
                              <Chip hue={h.early ? "red" : "gray"}>ушёл {fmtDate(h.stint.fire)}</Chip>
                            ) : (
                              <Chip hue="green">работает</Chip>
                            )}
                          </td>
                          <td className="r num">{fmtTenure(h.tenure)}</td>
                          <td className="muted">{h.candidate?.source || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "list" && (
        <div className="card card-tbl" style={{ overflow: "hidden" }}>
          <div className="toolbar" style={{ padding: "14px 18px 12px" }}>
            <Seg<ListFilter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: "open", label: `В работе · ${openCount}` },
                { value: "hired", label: "Приняты" },
                { value: "closed", label: "Отказы" },
                { value: "all", label: "Все за период" },
              ]}
            />
            <div style={{ position: "relative", flex: "1 1 200px", maxWidth: 300 }}>
              <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--dim)" }} />
              <input className="inp" style={{ paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ФИО, контакт, источник" />
            </div>
            <span className="spacer" />
            <button className="btn btn-sm" onClick={exportCsv} disabled={!list.length}>
              <Icon name="download" size={13} /> CSV
            </button>
          </div>
          {list.length === 0 ? (
            <Empty
              icon="userPlus"
              title={filter === "open" ? "Кандидатов в работе нет" : "Никого не нашлось"}
              text={filter === "open" ? "Новый отклик — кнопка «Кандидат» сверху." : filter === "all" ? undefined : "Фильтры «Приняты», «Отказы» и «Все» — за выбранный период."}
            />
          ) : (
            <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Кандидат</th>
                    <th>Этап</th>
                    <th>Источник</th>
                    <th>Группа · СВ</th>
                    <th>Отклик</th>
                    <th>Последний шаг</th>
                    <th>Комментарий</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => setOpen(c)}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{c.name}</div>
                        {c.contact && <div style={{ fontSize: 12, color: "var(--dim)" }}>{c.contact}</div>}
                      </td>
                      <td>
                        <Chip hue={CANDIDATE_STAGE_HUE[c.stage]} dot title={c.reason || undefined}>
                          {CANDIDATE_STAGE_LABEL[c.stage]}
                        </Chip>
                      </td>
                      <td className="muted">{c.source || "—"}</td>
                      <td className="muted">{groupWithSv(c.groupId)}</td>
                      <td className="num">{fmtDate(c.appliedAt)}</td>
                      <td className="num muted">
                        {fmtDate(lastMove(c))}
                        {isOpenCandidate(c) && <span> · {fmtInt(Math.max(0, daysBetween(lastMove(c), today)))} дн. назад</span>}
                      </td>
                      <td className="muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {c.reason ? `${c.reason}${c.comment ? ` · ${c.comment}` : ""}` : c.comment}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "churn" && (
        <>
          <div className="kpi-grid" data-n="6">
            <Kpi label="В штате сейчас" value={fmtInt(staff.staff.length)} sub={`средний стаж ${fmtTenure(staff.avgTenure)}`} />
            <Kpi label="Ушли за период" value={fmtInt(leavers.length)} sub={leavers.length ? `в среднем проработали ${fmtTenure(leavers.reduce((a, l) => a + l.days, 0) / leavers.length)}` : periodLabel} tone={leavers.length ? "warn" : undefined} />
            <Kpi
              label="Текучесть"
              value={churnAvg > 0 ? fmtPct(churnFired / churnAvg / Math.max(1, periodChurn.length), 1) : "—"}
              sub="в месяц, в среднем"
              title="Средний месячный отток за период: ушли ÷ средняя численность"
            />
            <Kpi label={`Ушли до ${EARLY_DAYS} дней`} value={fmtInt(periodChurn.reduce((a, r) => a + r.early, 0))} sub="за период" />
            <Kpi
              label="Остались 30+ дней"
              value={staff.retention30.pct == null ? "—" : fmtPct(staff.retention30.pct)}
              sub={`${fmtInt(staff.retention30.kept)} из ${fmtInt(staff.retention30.base)} принятых`}
              tone={staff.retention30.pct == null ? undefined : staff.retention30.pct >= 0.7 ? "good" : "warn"}
            />
            <Kpi
              label="Остались 90+ дней"
              value={staff.retention90.pct == null ? "—" : fmtPct(staff.retention90.pct)}
              sub={`${fmtInt(staff.retention90.kept)} из ${fmtInt(staff.retention90.base)} принятых`}
            />
          </div>

          <div className="card card-tbl" style={{ overflow: "hidden" }}>
            <div className="card-head" style={{ padding: "14px 18px 0" }}>
              <div>
                <h3 className="card-title">По месяцам</h3>
                <p className="card-sub">Последние 12 месяцев · текучесть = ушли ÷ средняя численность за месяц</p>
              </div>
            </div>
            <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }}>
              <table className="tbl tbl-fit">
                <thead>
                  <tr>
                    <th>Месяц</th>
                    <th className="r">На начало</th>
                    <th className="r">Принято</th>
                    <th className="r">Ушло</th>
                    <th className="r">На конец</th>
                    <th className="r">Текучесть</th>
                    <th className="r" title={`Проработали меньше ${EARLY_DAYS} дней`}>
                      Ушли &lt; {EARLY_DAYS} дн.
                    </th>
                    <th className="r">Стаж ушедших</th>
                  </tr>
                </thead>
                <tbody>
                  {churnRows.map((r) => (
                    <tr key={r.month} style={r.month >= from.slice(0, 7) ? undefined : { opacity: 0.6 }}>
                      <td>
                        {fmtMonth(r.month)}
                        {r.current && <span className="muted"> · по сегодня</span>}
                      </td>
                      <td className="r num">{fmtInt(r.start)}</td>
                      <td className="r num" style={{ color: r.hired ? "var(--c-green-fg)" : undefined }}>{r.hired ? `+${fmtInt(r.hired)}` : "—"}</td>
                      <td className="r num" style={{ color: r.fired ? "var(--c-red-fg)" : undefined }}>{r.fired ? `−${fmtInt(r.fired)}` : "—"}</td>
                      <td className="r num" style={{ fontWeight: 600 }}>{fmtInt(r.end)}</td>
                      <td className="r num">{r.rate == null ? "—" : fmtPct(r.rate, 1)}</td>
                      <td className="r num">{r.early || "—"}</td>
                      <td className="r num">{fmtTenure(r.avgTenureFired)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="cols-main">
            <div className="card card-tbl" style={{ overflow: "hidden" }}>
              <div className="card-head" style={{ padding: "14px 18px 0" }}>
                <div>
                  <h3 className="card-title">Кто ушёл</h3>
                  <p className="card-sub">{periodLabel} · по дате увольнения</p>
                </div>
              </div>
              {leavers.length === 0 ? (
                <Empty icon="users" title="За период никто не ушёл" />
              ) : (
                <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }}>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Сотрудник</th>
                        <th>Принят</th>
                        <th>Ушёл</th>
                        <th className="r">Проработал</th>
                        <th>Стажировка</th>
                        <th>Комментарий в карточке</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leavers.map((l) => (
                        <tr key={l.op.id} className="clickable" onClick={() => openOperator(l.op)}>
                          <td>
                            <div style={{ fontWeight: 500 }}>{l.op.name}</div>
                            <div style={{ fontSize: 12, color: "var(--dim)" }}>{groupName(l.op.groupId)}</div>
                          </td>
                          <td className="num">{fmtDate(l.hire)}</td>
                          <td className="num">{fmtDate(l.fire!)}</td>
                          <td className="r num" style={{ color: l.days < EARLY_DAYS ? "var(--c-red-fg)" : undefined }}>
                            {fmtTenure(l.days)}
                          </td>
                          <td>{l.passed === null ? <span className="muted">—</span> : l.passed ? <Chip hue="green">закрыл</Chip> : <Chip hue="red">не закрыл</Chip>}</td>
                          <td className="muted" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }}>
                            {l.op.comment || ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="card card-pad">
              <h3 className="card-title">Стаж работающих</h3>
              <p className="card-sub" style={{ marginBottom: 12 }}>
                {fmtInt(staff.staff.length)} {plural(staff.staff.length, PEOPLE)} в штате
              </p>
              {staff.staff.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--dim)" }}>Нет работающих сотрудников с датой приёма.</div>
              ) : (
                <div className="dist">
                  {staff.buckets.map((b) => (
                    <div key={b.label} className="dist-row">
                      <span>{b.label}</span>
                      <div className="dist-bar">
                        <span style={{ width: `${Math.round(safeDiv(b.count, Math.max(...staff.buckets.map((x) => x.count))) * 100)}%` }} />
                      </div>
                      <b className="num" style={{ textAlign: "right" }}>
                        {fmtInt(b.count)}
                      </b>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

        </>
      )}

      {open && <CandidateModal key={open === "new" ? "new" : open.id} cand={open === "new" ? null : open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Последнее движение кандидата: итог, обучение, собеседование или отклик. */
function lastMove(c: Candidate): string {
  return [c.closedAt, c.trainingAt, c.interviewAt, c.appliedAt].filter(Boolean).sort().pop() ?? c.appliedAt;
}
