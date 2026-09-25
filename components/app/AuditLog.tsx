"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { AUDIT_LABEL, type AuditEntity, type AuditEntry } from "@/lib/crm/types";
import { fmtStamp } from "@/lib/crm/dates";
import { Avatar, Drawer, Empty, Seg } from "@/components/ui/kit";
import { Icon, type IconName } from "@/components/ui/icons";

/**
 * Журнал изменений: кто и когда менял план, ставку, смену или начисление.
 * Нужен ровно для одного разговора — «почему в ведомости другая сумма».
 * Пишется автоматически из действий стора, здесь только чтение и поиск.
 * Клик по записи — панель справа: что было, что стало, и переход к самому объекту.
 */

const ICON: Record<AuditEntity, IconName> = {
  operator: "user",
  candidate: "userPlus",
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
  { value: "people", label: "Люди", match: ["operator", "group", "account", "candidate"] },
  { value: "leads", label: "Лиды", match: ["lead"] },
  { value: "time", label: "График и планы", match: ["shift", "plan"] },
  { value: "sys", label: "Система", match: ["settings", "project", "data"] },
];

/** Куда вести из записи журнала: страница объекта. Лид открываем прямо в его окне. */
const WHERE: Partial<Record<AuditEntity, { href: string; label: string }>> = {
  operator: { href: "/operators", label: "Открыть операторов" },
  group: { href: "/groups", label: "Открыть группы" },
  shift: { href: "/schedule", label: "Открыть график" },
  plan: { href: "/plans", label: "Открыть планы" },
  payroll: { href: "/payroll", label: "Открыть зарплату" },
  approve: { href: "/payroll", label: "Открыть зарплату" },
  candidate: { href: "/hiring", label: "Открыть найм" },
  project: { href: "/projects", label: "Открыть проекты" },
  settings: { href: "/settings?tab=system", label: "Открыть настройки" },
};

export function AuditLog() {
  const { data } = useCrm();
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const f = FILTERS.find((x) => x.value === filter) ?? FILTERS[0];
    const text = q.trim().toLowerCase();
    return data.audit
      .filter((e) => (f.match.length ? f.match.includes(e.entity) : true))
      .filter(
        (e) =>
          !text ||
          e.summary.toLowerCase().includes(text) ||
          e.accountName.toLowerCase().includes(text) ||
          (e.changes ?? []).some((c) => `${c.f} ${c.from} ${c.to}`.toLowerCase().includes(text)),
      )
      .slice()
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, 300);
  }, [data.audit, filter, q]);

  const idx = openId ? rows.findIndex((e) => e.id === openId) : -1;
  const open = idx >= 0 ? rows[idx] : null;

  return (
    <section className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 className="card-title" style={{ fontSize: 15 }}>
            Журнал изменений
          </h2>
          <p className="card-sub">
            Кто и когда менял планы, ставки, смены и начисления. Нажмите на запись — справа будет видно, что было и что стало. Хранятся
            последние 3000 записей, они попадают в выгрузку и резервные копии
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
            <button type="button" className={`audit-row audit-click${e.id === openId ? " is-on" : ""}`} key={e.id} onClick={() => setOpenId(e.id)}>
              <span className="audit-i" title={AUDIT_LABEL[e.entity]}>
                <Icon name={ICON[e.entity] ?? "info"} size={14} />
              </span>
              <span className="audit-t">
                <span className="audit-s">{e.summary}</span>
                <span className="audit-m">
                  {AUDIT_LABEL[e.entity]} · {fmtStamp(e.at)}
                  {e.changes?.length ? <span className="audit-n"> · {changesLabel(e.changes.length)}</span> : null}
                </span>
              </span>
              <span className="audit-who" title={e.accountName}>
                <Avatar name={e.accountName || "—"} id={e.accountId} size={20} />
                <span>{e.accountName || "—"}</span>
              </span>
              <Icon name="chevR" size={14} className="audit-go" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <AuditDrawer
          e={open}
          onClose={() => setOpenId(null)}
          onPrev={idx > 0 ? () => setOpenId(rows[idx - 1].id) : undefined}
          onNext={idx < rows.length - 1 ? () => setOpenId(rows[idx + 1].id) : undefined}
        />
      )}
    </section>
  );
}

function changesLabel(n: number): string {
  const a = n % 100;
  const b = n % 10;
  const w = a > 10 && a < 20 ? "изменений" : b === 1 ? "изменение" : b >= 2 && b <= 4 ? "изменения" : "изменений";
  return `${n} ${w}`;
}

/** Панель справа: кто, когда, что было → что стало, и куда перейти. */
function AuditDrawer({ e, onClose, onPrev, onNext }: { e: AuditEntry; onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const { data, openLead } = useCrm();
  const router = useRouter();
  const lead = e.entity === "lead" && !e.entityId.includes(",") ? data.leads.find((l) => l.id === e.entityId) : undefined;
  const where = WHERE[e.entity];
  const changes = e.changes ?? [];
  const created = changes.length > 0 && changes.every((c) => c.from === "—");
  const removed = changes.length > 0 && changes.every((c) => c.to === "—");

  return (
    <Drawer onClose={onClose} width={560}>
      <div className="row" style={{ gap: 12, padding: "18px 20px 14px", borderBottom: "1px solid var(--ink-06)" }}>
        <span className="audit-i" style={{ width: 36, height: 36 }}>
          <Icon name={ICON[e.entity] ?? "info"} size={17} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: "var(--dim)" }}>
            {AUDIT_LABEL[e.entity]} · {fmtStamp(e.at)}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.35 }}>{e.summary}</div>
        </div>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onNext} disabled={!onNext} title="Более ранняя запись" aria-label="Более ранняя запись">
          <Icon name="chevD" size={15} />
        </button>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onPrev} disabled={!onPrev} title="Более поздняя запись" aria-label="Более поздняя запись">
          <Icon name="chevD" size={15} style={{ transform: "rotate(180deg)" }} />
        </button>
        <button className="btn btn-ghost btn-sm btn-icon" onClick={onClose} aria-label="Закрыть">
          <Icon name="close" size={16} />
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px 24px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="row" style={{ gap: 10 }}>
          <Avatar name={e.accountName || "—"} id={e.accountId} size={30} />
          <div>
            <div style={{ fontWeight: 600 }}>{e.accountName || "—"}</div>
            <div style={{ fontSize: 12, color: "var(--dim)" }}>{created ? "создал(а)" : removed ? "удалил(а)" : "изменил(а)"} · {fmtStamp(e.at)} МСК</div>
          </div>
        </div>

        {changes.length > 0 ? (
          <div className="card" style={{ overflow: "hidden" }}>
            <table className="tbl audit-diff">
              <thead>
                <tr>
                  <th>Поле</th>
                  {!created && <th>Было</th>}
                  {!removed && <th>Стало</th>}
                </tr>
              </thead>
              <tbody>
                {changes.map((c, i) => (
                  <tr key={i}>
                    <td className="audit-f">{c.f}</td>
                    {!created && (
                      <td>
                        <span className={c.from === "—" ? "audit-empty" : "audit-from"}>{c.from}</span>
                      </td>
                    )}
                    {!removed && (
                      <td>
                        <span className={c.to === "—" ? "audit-empty" : "audit-to"}>{c.to}</span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="note-line">
            <Icon name="info" size={15} />
            <span>
              Подробностей «было → стало» у этой записи нет: она сделана до того, как журнал начал их сохранять, или действие массовое (импорт,
              восстановление). Что произошло — в заголовке выше.
            </span>
          </div>
        )}

        {(lead || where) && (
          <div className="row" style={{ gap: 8 }}>
            {lead ? (
              <button
                className="btn"
                onClick={() => {
                  onClose();
                  openLead(lead);
                }}
              >
                <Icon name="leads" size={14} /> Открыть лид
              </button>
            ) : where ? (
              <button
                className="btn"
                onClick={() => {
                  onClose();
                  router.push(where.href);
                }}
              >
                <Icon name="arrowR" size={14} /> {where.label}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </Drawer>
  );
}
