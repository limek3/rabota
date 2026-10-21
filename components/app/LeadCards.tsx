"use client";

import { useCrm } from "@/lib/crm/store";
import { fmtDate } from "@/lib/crm/dates";
import { fmtPhone, shortName } from "@/lib/crm/format";
import { LEAD_STATUS_HUE, LEAD_STATUS_LABEL, type Lead } from "@/lib/crm/types";
import { Icon } from "@/components/ui/icons";

/**
 * Лиды карточками — на телефоне вместо таблицы («Лиды», «Мой кабинет»). Карточка целиком —
 * кнопка: нажал — открылась карточка лида шторкой снизу (запись, данные, статус).
 * Сверху клиент и статус, ниже телефон и город, внизу время, оператор и проект.
 */
export function LeadCards({ leads, onOpen, showOp = true, showDate = true }: { leads: Lead[]; onOpen: (l: Lead) => void; showOp?: boolean; showDate?: boolean }) {
  const { ix, today } = useCrm();
  return (
    <div className="lcards">
      {leads.map((l) => {
        const op = ix.opById.get(l.operatorId);
        const p = l.projectId ? ix.projectById.get(l.projectId) : null;
        const day = l.at.slice(0, 10);
        const when = !showDate || day === today ? l.at.slice(11, 16) : `${fmtDate(day).slice(0, 5)}, ${l.at.slice(11, 16)}`;
        return (
          <button key={l.id} type="button" className="lcard" data-st={l.status} onClick={() => onOpen(l)}>
            <span className="lcard-top">
              <b>{l.client || "Без имени"}</b>
              <span className="o2-st" data-hue={LEAD_STATUS_HUE[l.status]}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor" }} />
                {LEAD_STATUS_LABEL[l.status]}
              </span>
            </span>
            <span className="lcard-mid num">
              {fmtPhone(l.phone) || "номер не указан"}
              {l.region && <span> · {l.region}</span>}
            </span>
            {l.status === "failed" && l.statusReason && <span className="lcard-why">{l.statusReason}</span>}
            <span className="lcard-bot">
              <span className="num">
                <Icon name="clock" size={12} /> {when}
              </span>
              {showOp && op && <span>{shortName(op.name)}</span>}
              {p && (
                <span className="lcard-pr">
                  <i style={{ background: `var(--c-${p.color}-fg)` }} />
                  {p.name}
                </span>
              )}
              <Icon name="chevR" size={14} className="lcard-go" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
