"use client";

import { useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { ADJ_LABEL, type Adjustment } from "@/lib/crm/types";
import { canTouchOp } from "@/lib/crm/access";
import { fmtDate, fmtMonth } from "@/lib/crm/dates";
import { PAYOUTS, fmtInt, fmtMoney, plural, shortName } from "@/lib/crm/format";
import { Avatar, Chip, Empty, Pager } from "@/components/ui/kit";

/** Что считается выплатой: деньги, уже отданные сотруднику (аванс и выплата). */
export const isPayout = (a: Adjustment) => a.type === "advance" || a.type === "payout";

/** Выплаты, которые видит этот аккаунт: новые сверху (по дате выплаты, затем по времени записи). */
export function usePayouts(opId?: string): Adjustment[] {
  const { data, access } = useCrm();
  return useMemo(
    () =>
      data.adjustments
        .filter((a) => isPayout(a) && (opId ? a.operatorId === opId : canTouchOp(access, a.operatorId)))
        .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [data.adjustments, access, opId],
  );
}

/**
 * История выплат. В карточке сотрудника — его выплаты по всем месяцам (compact: последние,
 * без колонки «Сотрудник»); на странице зарплаты — все выплаты зоны с поиском и страницами.
 */
export function PayoutHistory({ opId, list, compact, pageSize = 25 }: { opId?: string; list?: Adjustment[]; compact?: boolean; pageSize?: number }) {
  const { ix } = useCrm();
  const all = usePayouts(opId);
  const rows = list ?? all;
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(pageSize);
  const [showAll, setShowAll] = useState(false);
  const total = useMemo(() => rows.reduce((s, a) => s + a.amount, 0), [rows]);

  if (!rows.length)
    return compact ? (
      <div style={{ fontSize: 13, color: "var(--dim)" }}>Выплат пока не было.</div>
    ) : (
      <div className="card">
        <Empty icon="wallet" title="Выплат нет" text="Выплаты появятся здесь, как только их отметят в ведомости — кнопкой «Выплатить» или записью «Аванс» / «Выплата»." />
      </div>
    );

  if (compact) {
    const shown = showAll ? rows : rows.slice(0, 6);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <table className="tbl" style={{ background: "transparent" }}>
          <tbody>
            {shown.map((a) => (
              <tr key={a.id}>
                <td className="num muted" style={{ width: 86 }}>{fmtDate(a.date)}</td>
                <td>
                  <Chip hue={a.type === "advance" ? "amber" : "green"}>{ADJ_LABEL[a.type]}</Chip>
                </td>
                <td className="muted" style={{ whiteSpace: "normal" }}>
                  за {fmtMonth(a.month).toLowerCase()}
                  {a.comment ? ` · ${a.comment}` : ""}
                </td>
                <td className="r num" style={{ fontWeight: 600 }}>{fmtMoney(a.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ fontSize: 12.5, color: "var(--text-sub)" }}>
          <span>
            Всего выплачено: <b className="num" style={{ color: "var(--text)" }}>{fmtMoney(total)}</b> · {fmtInt(rows.length)} {plural(rows.length, PAYOUTS)}
          </span>
          <span className="spacer" />
          {rows.length > 6 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Свернуть" : `Показать все · ${fmtInt(rows.length)}`}
            </button>
          )}
        </div>
      </div>
    );
  }

  const pages = Math.max(1, Math.ceil(rows.length / size));
  const cur = Math.min(page, pages);
  return (
    <>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th className="c">Дата</th>
              <th>Сотрудник</th>
              <th>Тип</th>
              <th>За ведомость</th>
              <th>Комментарий</th>
              <th className="r">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice((cur - 1) * size, cur * size).map((a) => {
              const op = ix.opById.get(a.operatorId);
              return (
                <tr key={a.id}>
                  <td className="num c">{fmtDate(a.date)}</td>
                  <td>
                    <span className="row" style={{ gap: 8 }}>
                      <Avatar name={op?.name ?? "?"} id={a.operatorId} size={22} />
                      {shortName(op?.name ?? "—")}
                    </span>
                  </td>
                  <td>
                    <Chip hue={a.type === "advance" ? "amber" : "green"}>{ADJ_LABEL[a.type]}</Chip>
                  </td>
                  <td className="muted">{fmtMonth(a.month)}</td>
                  <td className="muted" style={{ whiteSpace: "normal" }}>{a.comment || "—"}</td>
                  <td className="r num" style={{ fontWeight: 600 }}>{fmtMoney(a.amount)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Итого · {fmtInt(rows.length)} {plural(rows.length, PAYOUTS)}</td>
              <td className="r num">{fmtMoney(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {rows.length > 25 && (
        <Pager
          page={cur}
          size={size}
          total={rows.length}
          onPage={setPage}
          onSize={(v) => {
            setSize(v);
            setPage(1);
          }}
        />
      )}
    </>
  );
}
