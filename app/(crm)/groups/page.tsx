"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { PACE_HUE, approvePctWhere, leadIncome, monthCal, type GroupRow } from "@/lib/crm/calc";
import { fundStat, payroll } from "@/lib/crm/payroll";
import { NO_GROUP } from "@/lib/crm/types";
import { fmtMonth, monthEnd, monthStart } from "@/lib/crm/dates";
import { fmtInt, fmtNum, fmtPct, fmtSigned, shortName } from "@/lib/crm/format";
import { Avatar, Chip, Collapse, Empty, MonthSwitcher, PageHead, Progress, Seg, StatusChip, Swatch } from "@/components/ui/kit";
import { Select, type Opt } from "@/components/ui/select";
import { Icon } from "@/components/ui/icons";

export default function GroupsPage() {
  const { month, setMonth, openGroup, access } = useCrm();
  const m = useMonthModel();
  const [view, setView] = useState<"cards" | "table">("cards");

  return (
    <div className="stack">
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: 14 }}>
          {m.groups.map((g) => (
            <GroupCard key={g.key} g={g} />
          ))}
        </div>
      ) : (
        <GroupTable groups={m.groups} past={m.cal.phase === "past"} />
      )}
    </div>
  );
}

function GroupCard({ g }: { g: GroupRow }) {
  const { data, ix, month, today, openGroup, openOperator, deleteGroup, moveOperator, confirm, access } = useCrm();
  // ФОТ группы: начисления её операторов против дохода по переданным лидам
  const fund = useMemo(() => {
    if (!access.can.viewPayroll || !g.group) return null;
    const pr = payroll(data, ix, monthCal(month, data.settings, today));
    const rows = pr.rows.filter((r) => r.op.groupId === g.group!.id);
    const gross = rows.reduce((a, r) => a + r.gross, 0);
    const leads = rows.reduce((a, r) => a + r.leads, 0);
    // доход = лиды × цена лида × апрув заказчика по проектам лидов группы
    const ids = new Set(rows.map((r) => r.op.id));
    const approve = approvePctWhere(data, month, (l) => ids.has(l.operatorId));
    return fundStat(gross, leads, leadIncome(data.settings.leadRevenue, approve), data.settings.payrollCapPct);
  }, [access.can.viewPayroll, data, ix, month, today, g.group]);
  const [open, setOpen] = useState(false);
  const p = g.pace;
  const supFull = g.group?.supervisorId ? ix.opById.get(g.group.supervisorId)?.name : g.group?.supervisorName;
  const sup = supFull ? shortName(supFull) : supFull;
  const isNone = g.key === NO_GROUP;
  const canEdit = access.isHead || access.ownGroups.has(g.key);
  const candidates = data.operators.filter((o) => !o.deletedAt && o.status !== "fired" && (o.groupId || NO_GROUP) !== g.key);
  const members = [...g.members].sort((a, b) => b.pace.fact - a.pace.fact);

  return (
    <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, opacity: g.group && !g.group.active ? 0.75 : 1 }}>
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

      <div className="grid3" style={{ gap: 8 }}>
        <Cell label="План к сегодня" value={fmtInt(Math.round(p.planToDate))} />
        <Cell label="Осталось" value={fmtInt(p.remaining)} />
        <Cell label="Нужно в день" value={p.needPerDay == null ? "—" : fmtNum(p.needPerDay)} />
        <Cell label="Сегодня" value={fmtInt(p.today)} />
        <Cell label="Неделя" value={fmtInt(p.thisWeek)} sub={`пр. ${fmtInt(p.prevWeek)}`} />
        <Cell label="Активных" value={fmtInt(g.headcount)} sub={`${fmtNum(g.avgPerOp)} на чел.`} />
        <Cell label="Часы группы" value={fmtNum(g.hours, 0)} />
        <Cell label="Лидов на час" value={g.lph == null ? "—" : fmtNum(g.lph, 2)} />
        <Cell label="RR" value={fmtInt(p.rr)} sub="к концу мес." tone={g.plan > 0 ? (p.rr >= g.plan ? "good" : "bad") : undefined} />
        {access.can.viewPayroll && fund && (
          <Cell
            label="ФОТ к доходу"
            value={fund.revenue ? fmtPct(fund.pct) : "—"}
            sub={`норма ≤ ${data.settings.payrollCapPct}%`}
            tone={fund.revenue ? (fund.ok ? "good" : "bad") : undefined}
          />
        )}
      </div>

      <div>
        <button className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)} style={{ marginLeft: -8 }}>
          <Icon name="chevR" size={13} className={`grp-chev${open ? " open" : ""}`} /> Состав · {members.length}
        </button>
        <Collapse open={open} innerStyle={{ paddingTop: 8 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {members.length === 0 && <div style={{ fontSize: 12.5, color: "var(--dim)" }}>В группе никого нет.</div>}
            {members.map((r) => (
              <div key={r.op.id} className="row" style={{ gap: 8, fontSize: 12.5 }}>
                <Avatar name={r.op.name} id={r.op.id} size={22} />
                <Link href={`/operators?id=${encodeURIComponent(r.op.id)}`} style={{ flex: 1, minWidth: 0, color: "var(--text)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {shortName(r.op.name)}
                </Link>
                <StatusChip status={r.status} />
                <span className="num" style={{ width: 64, textAlign: "right" }}>
                  {fmtInt(r.pace.fact)}/{fmtInt(r.terms.plan)}
                </span>
              </div>
            ))}
            <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {!isNone && g.group && !g.group.deletedAt && access.can.manageOperators && canEdit && (
                <button className="btn btn-sm" onClick={() => openOperator(null, { groupId: g.group!.id })}>
                  <Icon name="plus" size={13} /> Новый оператор
                </button>
              )}
              {!isNone && g.group && !g.group.deletedAt && access.can.manageOperators && canEdit && candidates.length > 0 && (
                <Select
                  size="sm"
                  width={230}
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
                Лиды группы
              </Link>
            </div>
          </div>
        </Collapse>
      </div>
    </div>
  );
}

function Cell({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div style={{ padding: "8px 10px", borderRadius: 8, background: "var(--bg)", border: "1px solid var(--ink-06)", minWidth: 0 }}>
      <div style={{ fontSize: 11, color: "var(--text-sub)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
      <div className="row" style={{ columnGap: 5, rowGap: 0, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 16, fontWeight: 600, flex: "none", color: tone === "good" ? "var(--c-green-fg)" : tone === "bad" ? "var(--c-red-fg)" : undefined }}>{value}</span>
        {/* не влезает рядом с числом — переносится строкой ниже, а не обрезается */}
        {sub && <span style={{ fontSize: 11, color: "var(--dim)", whiteSpace: "nowrap" }}>{sub}</span>}
      </div>
    </div>
  );
}

function GroupTable({ groups, past }: { groups: GroupRow[]; past: boolean }) {
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
            <th style={{ minWidth: 120 }}>Выполнение</th>
            <th className="r">К дате</th>
            <th className="r">Прогноз</th>
            <th className="r">Осталось</th>
            <th className="r">Нужно/д</th>
            <th className="r bl">Сегодня</th>
            <th className="r">Неделя</th>
            <th className="r">Активных</th>
            <th className="r">На чел.</th>
            <th className="r bl">Часы</th>
            <th className="r">Лид/час</th>
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
              <td className="r num" style={{ fontWeight: 600 }}>{fmtInt(g.pace.fact)}</td>
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
              <td className="r num bl">{fmtInt(g.pace.today)}</td>
              <td className="r num">{fmtInt(g.pace.thisWeek)}</td>
              <td className="r num">{g.headcount}</td>
              <td className="r num">{fmtNum(g.avgPerOp)}</td>
              <td className="r num bl">{fmtNum(g.hours, 0)}</td>
              <td className="r num">{g.lph == null ? "—" : fmtNum(g.lph, 2)}</td>
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
