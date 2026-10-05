"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { buildIndex, monthModel, PACE_HUE } from "@/lib/crm/calc";
import { NO_GROUP_LABEL } from "@/lib/crm/types";
import { fmtMonth, monthEnd, monthStart } from "@/lib/crm/dates";
import { fmtInt, fmtPct, safeDiv } from "@/lib/crm/format";
import { Empty, MonthSwitcher, PageHead, Progress, StatusChip } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { OperatorStats } from "@/components/app/OperatorDrawer";
import { StickyHead, planItems } from "@/components/app/StickyHead";

/**
 * «Мои показатели» — как идёт месяц: то, что супервайзер видит в карточке оператора, но на всю
 * страницу и только про себя (план, показатели, графики, смены, выработка, последние лиды),
 * плюс прогресс своей группы, если РОП разрешил. Деньги и «сегодня» — в «Моём кабинете».
 */
export default function StatsPage() {
  const { data, full, access, month, setMonth, me, ix, today, workedTo, remote } = useCrm();
  const m = useMonthModel();
  const opId = access.opId;
  const row = useMemo(() => m.ops.find((r) => r.op.id === opId) ?? null, [m.ops, opId]);
  const O = data.settings.access.operator;

  // прогресс группы — если РОП разрешил операторам его видеть
  const groupProgress = useMemo(() => {
    // в Supabase оператору приходят только его записи — прогресс группы из них не посчитать
    if (!row?.op.groupId || !(O.viewGroupProgress || O.viewTeamProgress) || access.isHead || (remote && access.isOp)) return null;
    const fm = monthModel(full, buildIndex(full, workedTo), month, today);
    const g = fm.groups.find((x) => x.key === row.op.groupId) ?? null;
    return { group: g, team: O.viewTeamProgress ? fm.team : null, myShare: g ? safeDiv(row.pace.fact, g.pace.fact) : 0 };
  }, [row, O.viewGroupProgress, O.viewTeamProgress, access.isHead, access.isOp, remote, full, month, today, workedTo]);

  if (!opId) {
    return (
      <div className="card">
        <Empty icon="user" title="Аккаунт не привязан к карточке оператора" text="Попросите руководителя связать ваш аккаунт с карточкой сотрудника — тогда здесь появятся ваши показатели." />
      </div>
    );
  }

  const group = row?.op.groupId ? ix.groupById.get(row.op.groupId) : null;
  return (
    <div className="stack">
      {row && <StickyHead title="Мои показатели" ctx={fmtMonth(month)} items={planItems(row.pace, row.lph, data.settings.convNormPct / 100)} />}
      <PageHead
        title="Мои показатели"
        sub={`${me.name} · ${group ? group.name : NO_GROUP_LABEL} · ${fmtMonth(month)}`}
        actions={
          <>
            {row && <StatusChip status={row.status} />}
            <Link className="btn btn-ghost" href={`/leads?op=${encodeURIComponent(opId)}&from=${monthStart(month)}&to=${monthEnd(month)}`}>
              <Icon name="leads" size={14} /> Мои лиды за месяц
            </Link>
            {/* без данных за месяц переключателя в главном блоке нет — тогда месяц меняем здесь */}
            {!row && <MonthSwitcher value={month} onChange={setMonth} />}
          </>
        }
      />
      {row ? (
        <>
          <OperatorStats row={row} wide />
          {groupProgress?.group && (
            <section className="card d2-pp">
              <div className="d2-pp-h" style={{ justifyContent: "space-between" }}>
                <h3 className="d2-h">
                  <Icon name="groups" size={15} className="title-ic" />
                  Моя группа · {groupProgress.group.name}
                </h3>
                <StatusChip status={groupProgress.group.status} />
              </div>
              <div className="me-grp">
                <span className="num">{fmtInt(groupProgress.group.pace.fact)}</span>
                <small>из {fmtInt(groupProgress.group.plan)}</small>
                <em>мой вклад {fmtPct(groupProgress.myShare)}</em>
              </div>
              <Progress value={groupProgress.group.pace.pct} marker={groupProgress.group.plan ? groupProgress.group.pace.planToDate / groupProgress.group.plan : undefined} hue={PACE_HUE[groupProgress.group.status]} />
              {groupProgress.team && (
                <div className="me-money-s" style={{ marginTop: 10 }}>
                  Отдел: {fmtInt(groupProgress.team.pace.fact)} из {fmtInt(groupProgress.team.plan)} ({fmtPct(groupProgress.team.pace.pct)})
                </div>
              )}
            </section>
          )}
        </>
      ) : (
        <div className="card">
          <Empty icon="calendar" title="В этом месяце вы не работали" text="Выберите другой месяц." />
        </div>
      )}
    </div>
  );
}
