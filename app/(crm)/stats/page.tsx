"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useCrm } from "@/lib/crm/store";
import { useMonthModel } from "@/lib/crm/hooks";
import { NO_GROUP_LABEL } from "@/lib/crm/types";
import { fmtMonth, monthEnd, monthStart } from "@/lib/crm/dates";
import { Empty, MonthSwitcher, PageHead, StatusChip } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { OperatorStats } from "@/components/app/OperatorDrawer";

/**
 * «Мои показатели» — то, что супервайзер видит в карточке оператора, но на всю страницу
 * и только про себя: план и факт, прогноз, темп, часы, выработка, последние лиды.
 */
export default function StatsPage() {
  const { access, month, setMonth, me, ix } = useCrm();
  const m = useMonthModel();
  const opId = access.opId;
  const row = useMemo(() => m.ops.find((r) => r.op.id === opId) ?? null, [m.ops, opId]);

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
      <PageHead
        title="Мои показатели"
        sub={`${me.name} · ${group ? group.name : NO_GROUP_LABEL} · ${fmtMonth(month)}`}
        actions={
          <>
            {row && <StatusChip status={row.status} />}
            <Link className="btn btn-ghost" href={`/leads?op=${encodeURIComponent(opId)}&from=${monthStart(month)}&to=${monthEnd(month)}`}>
              <Icon name="leads" size={14} /> Мои лиды за месяц
            </Link>
            <MonthSwitcher value={month} onChange={setMonth} />
          </>
        }
      />
      {row ? (
        <OperatorStats row={row} wide />
      ) : (
        <div className="card">
          <Empty icon="calendar" title="В этом месяце вы не работали" text="Выберите другой месяц." />
        </div>
      )}
    </div>
  );
}
