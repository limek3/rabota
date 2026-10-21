"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { useInsights, useMonthModel } from "@/lib/crm/hooks";
import { groupSpread, type OpInsight } from "@/lib/crm/insights";
import { SpreadBar } from "@/components/app/Insights";
import { PACE_HUE, goneLast, incomePerLead, isGone, monthCal, type GroupRow } from "@/lib/crm/calc";
import { fundStat, payroll } from "@/lib/crm/payroll";
import { NO_GROUP } from "@/lib/crm/types";
import { fmtMonth, monthEnd, monthStart } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct, fmtSigned, shortName } from "@/lib/crm/format";
import { Avatar, Chip, Conv, Empty, LeadN, MonthSwitcher, PageHead, Progress, Seg, StatusChip, Swatch } from "@/components/ui/kit";
import { Select, type Opt } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";
import { StickyHead, planItems } from "@/components/app/StickyHead";

export default function GroupsPage() {
  const { data, month, setMonth, openGroup, access } = useCrm();
  const m = useMonthModel();
  const { byOp } = useInsights(m);
  const [view, setView] = useState<"cards" | "table">("cards");
  // чей состав показан под карточками: своя группа у СВ, иначе первая
  const [pick, setPick] = useState<string>("");
  const picked = m.groups.some((g) => g.key === pick) ? pick : m.groups.find((g) => access.ownGroups.has(g.key))?.key ?? m.groups[0]?.key ?? "";
  const pickedRow = m.groups.find((g) => g.key === picked) ?? null;
  const pickGroup = (key: string, scroll = false) => {
    setPick(key);
    if (scroll) requestAnimationFrame(() => document.getElementById("grp-members")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div className="stack">
      <StickyHead title="Группы" ctx={fmtMonth(month)} items={planItems(m.team.pace, m.team.lph, data.settings.convNormPct / 100)} />
      <PageHead
        title="Группы"
        sub={`${fmtMonth(month)} · факт считается по группе оператора на момент передачи лида`}
        actions={
          <>
            <MonthSwitcher value={month} onChange={setMonth} />
            <Seg value={view} onChange={setView} options={[{ value: "cards", label: "Карточки" }, { value: "table", label: "Таблица" }]} />
            {access.can.manageGroups && (
              <button className="btn btn-primary" onClick={() => openGroup()}>
                <Icon name="plus" size={14} stroke={2.2} /> Группа
              </button>
            )}
          </>
        }
      />
      {m.groups.length === 0 ? (
        <div className="card">
          <Empty
            icon="groups"
            title="Групп пока нет"
            text="Группа объединяет операторов под одним руководителем со своим планом. Без групп система тоже работает — все считаются вместе."
            action={
              access.can.manageGroups ? (
                <button className="btn btn-primary" onClick={() => openGroup()}>
                  <Icon name="plus" size={14} /> Создать группу
                </button>
              ) : undefined
            }
          />
        </div>
      ) : view === "cards" ? (
        <>
          {/* карточки — своей высоты: соседняя не тянется за раскрытой */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(380px, 100%), 1fr))", gap: 14, alignItems: "start" }}>
            {m.groups.map((g) => (
              <GroupCard key={g.key} g={g} byOp={byOp} picked={g.key === picked} onPick={() => pickGroup(g.key, true)} />
            ))}
          </div>
          {pickedRow && <GroupMembers groups={m.groups} g={pickedRow} onPick={(k) => pickGroup(k)} />}
        </>
      ) : (
        <GroupTable groups={m.groups} past={m.cal.phase === "past"} byOp={byOp} />
      )}
    </div>
  );
}

function GroupCard({ g, byOp, picked, onPick }: { g: GroupRow; byOp: Map<string, OpInsight>; picked: boolean; onPick: () => void }) {
  const { data, ix, month, today, openGroup, deleteGroup, confirm, access } = useCrm();
  // ФОТ группы: начисления её операторов против дохода по переданным лидам
  const fund = useMemo(() => {
    // наставник видит группу, но не её деньги
    if (!access.can.viewPayroll || access.isMentor || !g.group) return null;
    const pr = payroll(data, ix, monthCal(month, data.settings, today));
    const rows = pr.rows.filter((r) => r.op.groupId === g.group!.id);
    const gross = rows.reduce((a, r) => a + r.gross, 0);
    const leads = rows.reduce((a, r) => a + r.leads, 0);
    // доход = лиды × цена лида × апрув: основа — по проектам, регионы — по своим цене и апруву
    const ids = new Set(rows.map((r) => r.op.id));
    return fundStat(gross, leads, incomePerLead(data, month, (l) => ids.has(l.operatorId)), data.settings.payrollCapPct);
  }, [access.can.viewPayroll, access.isMentor, data, ix, month, today, g.group]);
  const p = g.pace;
  const supFull = g.group?.supervisorId ? ix.opById.get(g.group.supervisorId)?.name : g.group?.supervisorName;
  const sup = supFull ? shortName(supFull) : supFull;
  const isNone = g.key === NO_GROUP;
  const gone = g.members.filter((r) => isGone(r.op)).length;
  const active = g.members.length - gone;
  const sp = useMemo(() => groupSpread(g.members, byOp), [g.members, byOp]);

  return (
    <div
      className={`card grp-card${picked ? " picked" : ""}`}
      style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, opacity: g.group && !g.group.active ? 0.75 : 1, ["--grp-hue" as string]: `var(--c-${g.color}-fg)` }}
    >
      <div className="row" style={{ alignItems: "flex-start" }}>
        <Swatch hue={g.color} size={12} />
        <div style={{ flex: 1, minWidth: 0, marginTop: -3 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{g.name}</div>
          <div style={{ fontSize: 12, color: "var(--dim)", marginTop: 2 }}>
            {isNone ? "Системная категория для сотрудников без группы" : sup ? `Руководитель: ${sup}` : "Руководитель не указан"}
            {g.group && !g.group.active && " · неактивна"}
          </div>
        </div>
        {g.group && !g.group.deletedAt && access.can.manageGroups && (
          <div className="row" style={{ gap: 2 }}>
            <button className="btn btn-ghost btn-sm btn-icon" title="Изменить" onClick={() => openGroup(g.group)}>
              <Icon name="edit" size={14} />
            </button>
            <button
              className="btn btn-ghost btn-sm btn-icon"
              title="Удалить группу"
              onClick={async () => {
                const n = data.operators.filter((o) => o.groupId === g.group!.id && !o.deletedAt).length;
                if (
                  await confirm({
                    title: `Удалить группу «${g.group!.name}»?`,
                    text: `${n ? `${n} сотр. перейдут в «Без группы» — сами сотрудники не удаляются. ` : ""}Лиды и смены сохранят историю этой группы. Перед удалением сохранится резервная копия.`,
                    ok: "Удалить",
                    danger: true,
                  })
                )
                  void deleteGroup(g.group!.id);
              }}
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.02em" }}>{fmtInt(p.fact)}</span>
          <span style={{ color: "var(--text-sub)", fontSize: 13 }}>
            из {fmtInt(g.plan)}
            {!g.planExplicit && g.group?.monthlyPlan === 0 && <span style={{ color: "var(--dim)" }}> (сумма планов)</span>}
          </span>
          <span className="spacer" />
          <StatusChip status={g.status} />
        </div>
        <Progress value={p.pct} marker={g.plan > 0 && p.needPerDay != null ? p.planToDate / g.plan : undefined} hue={PACE_HUE[g.status]} height={7} style={{ marginTop: 10 }} />
        <div className="row" style={{ justifyContent: "space-between", fontSize: 12, color: "var(--dim)", marginTop: 6 }}>
          <span>{fmtPct(p.pct)} плана</span>
          <span style={{ color: p.deviation >= 0 ? "var(--c-green-fg)" : "var(--c-red-fg)" }}>{fmtSigned(p.deviation)} к плану на дату</span>
        </div>
      </div>

      {/* разброс: группа может держаться на одном сильном, пока остальные отстают */}
      {sp.people.length > 1 && (
        <div className="ins-gspread">
          <div className="row" style={{ justifyContent: "space-between", fontSize: 12, color: "var(--text-sub)" }}>
            <span>Темп каждого в группе</span>
            {sp.lo != null && sp.hi != null && (
              <span className="num" style={{ color: "var(--dim)" }}>
                {fmtPct(sp.lo)} – {fmtPct(sp.hi)}
              </span>
            )}
          </div>
          <SpreadBar sp={sp} />
          <div className="row" style={{ gap: 12, flexWrap: "wrap", fontSize: 12, color: "var(--dim)" }}>
            {sp.topShare > 0 && (
              <span>
                {sp.topName} даёт <b className="num" style={{ color: sp.topShare >= 0.4 ? "var(--c-amber-fg)" : "var(--text)" }}>{fmtPct(sp.topShare)}</b> лидов группы
              </span>
            )}
            {sp.attention > 0 && (
              <Link href="/operators" style={{ color: "var(--c-red-fg)", textDecoration: "none" }}>
                требуют внимания: <b className="num">{sp.attention}</b>
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="grid3" style={{ gap: 8 }}>
        <Cell label="План к сегодня" value={fmtInt(Math.round(p.planToDate))} />
        <Cell label="Осталось" value={fmtInt(p.remaining)} />
        <Cell label="Нужно в день" value={p.needPerDay == null ? "—" : fmtNum(p.needPerDay)} />
        <Cell label="Сегодня" value={fmtInt(p.today)} />
        <Cell label="Неделя" value={fmtInt(p.thisWeek)} sub={`пр. ${fmtInt(p.prevWeek)}`} />
        <Cell label="Активных" value={fmtInt(g.headcount)} sub={`${fmtNum(g.avgPerOp)} на чел.`} />
        <Cell label="Часы группы" value={fmtNum(g.hours, 0)} />
        <Cell label="Конверсия" value={<Conv value={g.lph} />} />
        <Cell label="RR" value={fmtInt(p.rr)} sub="к концу мес." tone={g.plan > 0 ? (p.rr >= g.plan ? "good" : "bad") : undefined} />
        {access.can.viewPayroll && fund && (
          <Cell
            wide
            label="ФОТ к доходу"
            value={fund.revenue ? fmtPct(fund.pct) : "—"}
            sub={`норма ≤ ${data.settings.payrollCapPct}%`}
            tone={fund.revenue ? (fund.ok ? "good" : "bad") : undefined}
          />
        )}
      </div>

      {/* состав — отдельным блоком под карточками, а не списком внутри карточки */}
      <div className="grp-foot">
        <button type="button" className={`btn btn-sm${picked ? " btn-primary" : ""}`} onClick={onPick} aria-pressed={picked}>
          <Icon name="users" size={13} /> Состав · {fmtInt(active)}
          {gone > 0 && <span style={{ opacity: 0.7 }}> + {fmtInt(gone)} увол.</span>}
        </button>
        <Link className="btn btn-sm btn-ghost" href={`/leads?group=${encodeURIComponent(g.key)}&from=${monthStart(month)}&to=${monthEnd(month)}`}>
          Лиды группы <Icon name="arrowR" size={12} />
        </Link>
      </div>
    </div>
  );
}

function SpreadCells({ g, byOp }: { g: GroupRow; byOp: Map<string, OpInsight> }) {
  const sp = groupSpread(g.members, byOp);
  return (
    <>
      <td className="r num bl">{sp.lo != null && sp.hi != null ? `${fmtPct(sp.lo)}–${fmtPct(sp.hi)}` : "—"}</td>
      <td className="r num" style={{ color: sp.topShare >= 0.4 ? "var(--c-amber-fg)" : undefined }} title={sp.topName}>
        {sp.topShare > 0 ? fmtPct(sp.topShare) : "—"}
      </td>
      <td className="r num" style={{ color: sp.attention ? "var(--c-red-fg)" : "var(--dim)" }}>{sp.attention || "—"}</td>
    </>
  );
}

function Cell({ label, value, sub, tone, wide }: { label: string; value: ReactNode; sub?: string; tone?: "good" | "bad"; wide?: boolean }) {
  return (
    // wide — плитка на всю строку (последняя одиночная плитка не висит хвостом)
    <div style={{ padding: "8px 10px", borderRadius: 6, background: "var(--bg)", border: "1px solid var(--ink-06)", minWidth: 0, gridColumn: wide ? "1 / -1" : undefined }}>
      <div style={{ fontSize: 11, color: "var(--text-sub)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div className="row" style={{ columnGap: 5, rowGap: 0, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 16, fontWeight: 600, flex: "none", color: tone === "good" ? "var(--c-green-fg)" : tone === "bad" ? "var(--c-red-fg)" : undefined }}>{value}</span>
        {/* не влезает рядом с числом — переносится строкой ниже, а не обрезается */}
        {sub && <span style={{ fontSize: 11, color: "var(--dim)", whiteSpace: "nowrap" }}>{sub}</span>}
      </div>
    </div>
  );
}

function GroupTable({ groups, past, byOp }: { groups: GroupRow[]; past: boolean; byOp: Map<string, OpInsight> }) {
  const { openGroup, access } = useCrm();
  return (
    <div className="tbl-wrap">
      <table className="tbl tbl-fit">
        <thead>
          <tr>
            <th className="sticky-col">Группа</th>
            <th>Оценка</th>
            <th className="r">План</th>
            <th className="r">Факт</th>
            <th className="c" style={{ minWidth: 120 }}>Выполнение</th>
            <th className="r">К дате</th>
            <th className="r">Прогноз</th>
            <th className="r">Осталось</th>
            <th className="r">Нужно/д</th>
            <th className="r bl" title="Темп к дате: самый низкий и самый высокий в группе">Разброс</th>
            <th className="r" title="Доля лидов группы у лучшего оператора">Лучший даёт</th>
            <th className="r" title="Операторы с сигналами «Требует внимания»">Внимание</th>
            <th className="r bl">Сегодня</th>
            <th className="r">Неделя</th>
            <th className="r">Активных</th>
            <th className="r">На чел.</th>
            <th className="r bl">Часы</th>
            <th className="r" title="Конверсия: лиды ÷ отработанные часы">Конв.</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.key} className={g.group && access.can.manageGroups ? "clickable" : ""} onClick={() => access.can.manageGroups && g.group && !g.group.deletedAt && openGroup(g.group)}>
              <td className="sticky-col">
                <span className="row" style={{ gap: 8 }}>
                  <Swatch hue={g.color} />
                  {g.name}
                </span>
              </td>
              <td>
                <StatusChip status={g.status} />
              </td>
              <td className="r num">{fmtInt(g.plan)}</td>
              <td className="r num"><LeadN n={g.pace.fact} /></td>
              <td>
                <div className="row" style={{ gap: 8 }}>
                  <Progress value={g.pace.pct} marker={!past && g.plan > 0 ? g.pace.planToDate / g.plan : undefined} hue={PACE_HUE[g.status]} style={{ flex: 1, minWidth: 50 }} />
                  <span className="num" style={{ fontSize: 12, width: 38, textAlign: "right" }}>{fmtPct(g.pace.pct)}</span>
                </div>
              </td>
              <td className="r num" style={{ color: g.pace.deviation >= 0 ? "var(--c-green-fg)" : "var(--c-red-fg)" }}>{fmtSigned(g.pace.deviation)}</td>
              <td className="r num">
                {fmtInt(g.pace.rr)} <span className="muted">{fmtPct(g.pace.rrPct)}</span>
              </td>
              <td className="r num">{fmtInt(g.pace.remaining)}</td>
              <td className="r num">{g.pace.needPerDay == null ? "—" : fmtNum(g.pace.needPerDay)}</td>
              <SpreadCells g={g} byOp={byOp} />
              <td className="r num bl">{fmtInt(g.pace.today)}</td>
              <td className="r num">{fmtInt(g.pace.thisWeek)}</td>
              <td className="r num">{g.headcount}</td>
              <td className="r num">{fmtNum(g.avgPerOp)}</td>
              <td className="r num bl">{fmtNum(g.hours, 0)}</td>
              <td className="r num"><Conv value={g.lph} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ padding: "10px 14px", fontSize: 12, color: "var(--dim)", borderTop: "1px solid var(--ink-06)" }}>
        <Chip hue="gray">Без группы</Chip> — системная категория: сюда попадают сотрудники после удаления их группы.
      </div>
    </div>
  );
}

/**
 * Состав выбранной группы — под карточками, одной таблицей: кто работает, сколько сделал против плана,
 * часы и конверсия. Группа выбирается переключателем сверху или кнопкой «Состав» в карточке.
 * Уволенные — свёрнуты строкой внизу, чтобы список не растягивался на полстраницы.
 */
function GroupMembers({ groups, g, onPick }: { groups: GroupRow[]; g: GroupRow; onPick: (key: string) => void }) {
  const { data, ix, month, openOperator, moveOperator, access } = useCrm();
  const router = useRouter();
  const [showGone, setShowGone] = useState(false);
  const isNone = g.key === NO_GROUP;
  const canEdit = access.isHead || access.ownGroups.has(g.key);
  const sorted = [...g.members].sort((a, b) => goneLast(a.op, b.op) || b.pace.fact - a.pace.fact);
  const live = sorted.filter((r) => !isGone(r.op));
  const gone = sorted.filter((r) => isGone(r.op));
  const candidates = data.operators.filter((o) => !o.deletedAt && o.status !== "fired" && (o.groupId || NO_GROUP) !== g.key);
  const manage = !isNone && !!g.group && !g.group.deletedAt && access.can.manageOperators && canEdit;

  const row = (r: GroupRow["members"][number]) => {
    const plan = r.terms.plan;
    const pct = plan > 0 ? r.pace.fact / plan : 0;
    return (
      <tr key={r.op.id} className={`clickable${isGone(r.op) ? " dim" : ""}`} onClick={() => router.push(`/operators?id=${encodeURIComponent(r.op.id)}`)}>
        <td>
          <span className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <Avatar name={r.op.name} id={r.op.id} size={24} />
            <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>{shortName(r.op.name)}</span>
          </span>
        </td>
        <td>
          <StatusChip status={r.status} />
        </td>
        <td className="r num">
          <b>{fmtInt(r.pace.fact)}</b>
          <span className="muted"> / {fmtInt(plan)}</span>
        </td>
        <td>
          <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
            <Progress value={pct} hue={PACE_HUE[r.status]} style={{ flex: 1, minWidth: 60 }} />
            <span className="num muted" style={{ fontSize: 12, width: 40, textAlign: "right" }}>{plan > 0 ? fmtPct(pct) : "—"}</span>
          </div>
        </td>
        <td className="r num">{fmtNum(r.hours, 0)}</td>
        <td className="r num">{r.lph == null ? <span className="muted">—</span> : <Conv value={r.lph} />}</td>
        <td className="r num">{fmtInt(r.pace.today)}</td>
      </tr>
    );
  };

  return (
    <div className="card grp-members" id="grp-members">
      <div className="grp-members-head">
        <div className="grp-members-title">
          <Icon name="users" size={15} /> Состав группы
        </div>
        {/* группы — переключателем: одна таблица, а не список в каждой карточке */}
        <div className="grp-tabs" role="tablist" aria-label="Группа">
          {groups.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={x.key === g.key} className={x.key === g.key ? "on" : ""} onClick={() => onPick(x.key)}>
              <Swatch hue={x.color} size={9} />
              {x.name}
              <span className="num">{fmtInt(x.members.filter((r) => !isGone(r.op)).length)}</span>
            </button>
          ))}
        </div>
        <div className="grp-members-tools">
          {manage && (
            <button className="btn btn-sm" onClick={() => openOperator(null, { groupId: g.group!.id })}>
              <Icon name="plus" size={13} /> Новый оператор
            </button>
          )}
          {manage && candidates.length > 0 && (
            <Select
              size="sm"
              width={210}
              value=""
              resetOnPick
              placeholder="Перевести сюда…"
              options={candidates.map<Opt>((o) => ({ value: o.id, label: shortName(o.name), hint: o.groupId ? ix.groupById.get(o.groupId)?.name ?? "" : "без группы" }))}
              onChange={(v) => v && void moveOperator(v, g.group!.id)}
              ariaLabel="Перевести в группу"
              minPopWidth={280}
            />
          )}
          <Link className="btn btn-sm btn-ghost" href={`/leads?group=${encodeURIComponent(g.key)}&from=${monthStart(month)}&to=${monthEnd(month)}`}>
            Лиды группы <Icon name="arrowR" size={12} />
          </Link>
        </div>
      </div>

      {g.members.length === 0 ? (
        <div style={{ padding: "18px 16px", fontSize: 13, color: "var(--dim)" }}>В группе никого нет.</div>
      ) : (
        <div className="tbl-wrap" style={{ border: 0, borderRadius: 0 }}>
          <table className="tbl grp-tbl">
            <thead>
              <tr>
                <th>Сотрудник</th>
                <th>Темп</th>
                <th className="r">Факт / план</th>
                <th style={{ minWidth: 160 }}>Выполнение</th>
                <th className="r">Часы</th>
                <th className="r" title="Лиды ÷ отработанные часы">Конв.</th>
                <th className="r">Сегодня</th>
              </tr>
            </thead>
            <tbody>
              {live.map(row)}
              {gone.length > 0 && (
                <tr className="grp-gone-toggle" onClick={() => setShowGone((v) => !v)}>
                  <td colSpan={7}>
                    <Icon name="chevR" size={12} className={`grp-chev${showGone ? " open" : ""}`} /> Уволенные · {fmtInt(gone.length)}
                    <span className="muted"> — {showGone ? "скрыть" : "показать"}</span>
                  </td>
                </tr>
              )}
              {showGone && gone.map(row)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
