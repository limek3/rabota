"use client";

import { useMemo, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { AUDIT_LABEL, type AuditEntity } from "@/lib/crm/types";
import { fmtStamp } from "@/lib/crm/dates";
import { Avatar, Empty, Seg } from "@/components/ui/kit";
import { Icon, type IconName } from "@/components/ui/icons";

/**
 * Журнал изменений: кто и когда менял план, ставку, смену или начисление.
 * Нужен ровно для одного разговора — «почему в ведомости другая сумма».
 * Пишется автоматически из действий стора, здесь только чтение и поиск.
 */

const ICON: Record<AuditEntity, IconName> = {
  operator: "user",
  group: "groups",
  lead: "leads",
  shift: "calendar",
  plan: "target",
  payroll: "wallet",
  project: "folder",
  account: "users",
  settings: "settings",
  approve: "check",
  data: "database",
};

const FILTERS: { value: string; label: string; match: AuditEntity[] }[] = [
  { value: "all", label: "Всё", match: [] },
  { value: "pay", label: "Деньги", match: ["payroll", "approve"] },
  { value: "people", label: "Люди", match: ["operator", "group", "account"] },
  { value: "time", label: "График и планы", match: ["shift", "plan"] },
  { value: "sys", label: "Система", match: ["settings", "project", "data", "lead"] },
];

export function AuditLog() {
  const { data } = useCrm();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.value === filter) ?? FILTERS[0];
    const text = q.trim().toLowerCase();
    return data.audit
      .filter((e) => (f.match.length ? f.match.includes(e.entity) : true))
      .filter((e) => !text || e.summary.toLowerCase().includes(text) || e.accountName.toLowerCase().includes(text))
      .slice()
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 300);
  }, [data.audit, filter, q]);

  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="card-title" style={{ fontSize: 15 }}>
            Журнал изменений
          </h2>
          <p className="card-sub">
            Кто и когда менял планы, ставки, смены и начисления. Хранятся последние 3000 записей, они попадают в выгрузку и
            резервные копии
          </p>
        </div>
        <span style={{ fontSize: 12, color: "var(--dim)", whiteSpace: "nowrap" }}>записей: {data.audit.length}</span>
      </div>

      <div className="toolbar">
        <Seg value={filter} onChange={setFilter} options={FILTERS.map((f) => ({ value: f.value, label: f.label }))} />
        <div style={{ position: "relative", width: 240 }}>
          <Icon name="search" size={14} style={{ position: "absolute", left: 10, top: 10, color: "var(--dim)" }} />
          <input className="inp" style={{ paddingLeft: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Что искать" />
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty icon="info" title="Записей нет" text="Журнал наполняется по мере правок: смены, планы, ставки, начисления." />
      ) : (
        <div className="audit">
          {rows.map((e) => (
            <div className="audit-row" key={e.id}>
              <span className="audit-i" title={AUDIT_LABEL[e.entity]}>
                <Icon name={ICON[e.entity] ?? "info"} size={14} />
              </span>
              <span className="audit-t">
                <span className="audit-s">{e.summary}</span>
                <span className="audit-m">
                  {AUDIT_LABEL[e.entity]} · {fmtStamp(e.at)}
                </span>
              </span>
              <span className="audit-who" title={e.accountName}>
                <Avatar name={e.accountName || "—"} id={e.accountId} size={20} />
                <span>{e.accountName || "—"}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
