"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { NAV } from "@/lib/crm/nav";
import { Icon, type IconName } from "@/components/ui/icons";
import { fmtPhone } from "@/lib/crm/format";
import { fmtStamp } from "@/lib/crm/dates";
import { AUTH_ENABLED } from "@/lib/appMode";
import { ACCOUNT_ROLE_LABEL } from "@/lib/crm/types";

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  run: () => void;
}

/** Ctrl+K: переход по разделам, частые действия, поиск оператора и лида по телефону. */
export function CommandPalette() {
  const crm = useCrm();
  const { paletteOpen, setPaletteOpen, data, full, ix, access, me } = crm;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paletteOpen) {
      setQ("");
      setSel(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [paletteOpen]);

  const close = () => setPaletteOpen(false);

  const cmds = useMemo<Cmd[]>(() => {
    const go = (href: string) => () => router.push(href);
    const can = access.can;
    const base: Cmd[] = [
      ...(can.createLeads ? [{ id: "a-lead", label: "Записать переданный лид", hint: "N", icon: "plus" as const, run: () => crm.openLead() }] : []),
      ...(can.manageOperators ? [{ id: "a-op", label: "Добавить оператора", icon: "user" as const, run: () => crm.openOperator() }] : []),
      ...(can.manageGroups ? [{ id: "a-group", label: "Создать группу", icon: "groups" as const, run: () => crm.openGroup() }] : []),
      ...(can.editShifts ? [{ id: "a-shift", label: "Записать смену / часы", icon: "clock" as const, run: go("/schedule") }] : []),
      ...(can.editPayroll ? [{ id: "a-adj", label: "Внести корректировку зарплаты", icon: "wallet" as const, run: go("/payroll") }] : []),
      ...(can.editPlans || can.editTeamPlan ? [{ id: "a-plan", label: "Изменить планы месяца", icon: "target" as const, run: go("/plans") }] : []),
      { id: "a-profile", label: "Мой профиль и настройки", icon: "user", run: go("/settings?tab=profile") },
      ...(can.systemSettings ? [{ id: "a-settings", label: "Изменить настройки системы", icon: "settings" as const, run: go("/settings?tab=system") }] : []),
      ...(can.manageAccounts ? [{ id: "a-acc", label: "Аккаунты и доступ", icon: "users" as const, run: go("/settings?tab=accounts") }] : []),
      { id: "a-reload", label: "Обновить расчёты", hint: "перечитать базу", icon: "refresh", run: () => void crm.reload() },
      ...(can.manageData
        ? [
            {
              id: "a-backup",
              label: "Сделать резервную копию сейчас",
              icon: "database" as const,
              run: () =>
                void crm
                  .backup("Вручную")
                  .then(() => crm.toast("Резервная копия сохранена"))
                  .catch((e) => crm.toast(`Не удалось: ${e instanceof Error ? e.message : e}`, "err")),
            },
          ]
        : []),
      {
        id: "a-theme",
        label: me.prefs.theme === "dark" ? "Светлая тема" : "Тёмная тема",
        icon: me.prefs.theme === "dark" ? "sun" : "moon",
        run: () => void crm.saveMyProfile({ theme: me.prefs.theme === "dark" ? "light" : "dark" }),
      },
      ...(!AUTH_ENABLED
        ? full.accounts
            .filter((a) => !a.deletedAt && a.active && a.id !== me.id)
            .map<Cmd>((a) => ({
              id: "sw" + a.id,
              label: `Войти как ${a.name}`,
              hint: ACCOUNT_ROLE_LABEL[a.role],
              icon: "user",
              run: () => crm.switchAccount(a.id),
            }))
        : []),
      ...NAV.filter((n) => access.routes.has(n.href)).map((n) => ({ id: "n" + n.href, label: n.label, hint: n.hint, icon: n.icon, run: go(n.href) })),
    ];
    return base;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, access, me, full.accounts, crm.openLead, crm.openOperator, crm.openGroup, crm.reload, crm.backup, crm.saveMyProfile, crm.switchAccount, crm.toast]);

  const results = useMemo<Cmd[]>(() => {
    const t = q.trim().toLowerCase();
    if (!t) return cmds.slice(0, 14);
    const out = cmds.filter((c) => c.label.toLowerCase().includes(t) || c.hint?.toLowerCase().includes(t));
    const ops = data.operators
      .filter((o) => !o.deletedAt && o.name.toLowerCase().includes(t))
      .slice(0, 6)
      .map<Cmd>((o) => ({
        id: "op" + o.id,
        label: o.name,
        hint: `оператор · ${o.groupId ? ix.groupById.get(o.groupId)?.name ?? "" : "без группы"}`,
        icon: "user",
        run: () => router.push(`/operators?id=${encodeURIComponent(o.id)}`),
      }));
    const digits = t.replace(/\D+/g, "");
    const leads =
      digits.length >= 4
        ? data.leads
            .filter((l) => l.phone.includes(digits))
            .slice(-5)
            .reverse()
            .map<Cmd>((l) => ({
              id: "ld" + l.id,
              label: `${l.client || "Без имени"} · ${fmtPhone(l.phone)}`,
              hint: `лид · ${fmtStamp(l.at)} · ${ix.opById.get(l.operatorId)?.name ?? ""}`,
              icon: "phone",
              run: () => crm.openLead(l),
            }))
        : [];
    return [...out, ...ops, ...leads];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, cmds, data.operators, data.leads, ix, router, crm.openLead]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!paletteOpen || typeof document === "undefined") return null;

  const run = (c: Cmd | undefined) => {
    if (!c) return;
    close();
    c.run();
  };

  return createPortal(
    <div className="modal-back" style={{ paddingTop: "12vh" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal" role="dialog" aria-modal aria-label="Быстрые действия" style={{ maxWidth: 560 }}>
        <div className="row" style={{ padding: "12px 14px", borderBottom: "1px solid var(--ink-06)", gap: 10 }}>
          <Icon name="search" size={16} style={{ color: "var(--dim)" }} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Действие, раздел, оператор или телефон…"
            style={{ flex: 1, border: "none", outline: "none", background: "transparent", color: "var(--text)", font: "inherit", fontSize: 14 }}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                run(results[sel]);
              }
            }}
          />
          <span className="kbd">Esc</span>
        </div>
        <div ref={listRef} style={{ maxHeight: 380, overflowY: "auto", padding: 6 }}>
          {results.length === 0 && <div style={{ padding: 18, fontSize: 13, color: "var(--dim)", textAlign: "center" }}>Ничего не найдено</div>}
          {results.map((c, i) => (
            <button
              key={c.id}
              data-i={i}
              onMouseEnter={() => setSel(i)}
              onClick={() => run(c)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                border: "none",
                borderRadius: 8,
                background: i === sel ? "var(--brand-tint)" : "transparent",
                color: "var(--text)",
                font: "inherit",
                fontSize: 13,
                textAlign: "left",
              }}
            >
              <Icon name={c.icon} size={15} style={{ color: i === sel ? "var(--brand)" : "var(--dim)" }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
              {c.hint && <span style={{ fontSize: 11.5, color: "var(--dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}
