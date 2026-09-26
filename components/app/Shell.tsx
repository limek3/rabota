"use client";

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CrmProvider, useCrm } from "@/lib/crm/store";
import { NAV, NAV_GROUPS } from "@/lib/crm/nav";
import { Icon } from "@/components/ui/icons";
import { ConfirmHost, Progress, ToastHost, isTyping } from "@/components/ui/kit";
import { TitleTips } from "@/components/ui/TitleTips";
import { AuthGate } from "./AuthGate";
import { LeadModal } from "./LeadModal";
import { OperatorModal } from "./OperatorModal";
import { GroupModal } from "./GroupModal";
import { CommandPalette } from "./CommandPalette";
import { AccountMenu } from "./AccountMenu";
import { SheetsAutoSync } from "./SheetsSync";
import { homeFor } from "@/lib/crm/access";
import { signOut } from "@/lib/auth";
import { monthModel } from "@/lib/crm/calc";
import { currentMonth, fmtMonth } from "@/lib/crm/dates";
import { fmtInt, fmtPct } from "@/lib/crm/format";

function RailStatus() {
  const { data, ix, today, ready, access } = useCrm();
  const m = useMemo(() => (ready ? monthModel(data, ix, currentMonth(), today) : null), [data, ix, today, ready]);
  if (!m || (m.team.plan === 0 && m.team.pace.fact === 0)) return null;
  // у оператора срез данных — он сам, поэтому «команда» здесь = его личный план
  const p = m.team.pace;
  const href = access.routes.has("/dashboard") ? "/dashboard" : "/me";
  return (
    <Link href={href} className="rail-text" style={{ display: "block", textDecoration: "none", color: "inherit", margin: "0 10px 10px", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--ink-07)", background: "var(--bg-panel)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-sub)", marginBottom: 6 }}>
        <span>{access.isOp ? "Мой план · " : ""}{fmtMonth(currentMonth())}</span>
        <span style={{ fontWeight: 600, color: "var(--text)" }}>{fmtPct(p.pct)}</span>
      </div>
      <Progress value={p.pct} marker={p.plan > 0 ? p.planToDate / p.plan : undefined} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--dim)", marginTop: 6 }}>
        <span>
          {fmtInt(p.fact)} / {fmtInt(p.plan)}
        </span>
        <span>сегодня {fmtInt(p.today)}</span>
      </div>
    </Link>
  );
}

function Rail() {
  const pathname = usePathname() || "";
  const { openLead, data, persistent, setPaletteOpen, access } = useCrm();
  return (
    <aside className="app-rail" style={{ width: 236, flex: "none", display: "flex", flexDirection: "column", background: "var(--bg-sidebar)", minHeight: 0 }}>
      {access.can.createLeads && (
        <div style={{ padding: "14px 10px 6px" }}>
          <button className="btn btn-primary" style={{ width: "100%", height: 34 }} onClick={() => openLead()} title="Передать лид (N)">
            <Icon name="plus" size={15} stroke={2.2} />
            <span className="rail-text">Лид передан</span>
            <span className="kbd rail-text" style={{ marginLeft: "auto" }}>N</span>
          </button>
        </div>
      )}

      <nav style={{ flex: 1, overflowY: "auto", padding: "0 10px 10px", display: "flex", flexDirection: "column" }}>
        {NAV_GROUPS.map((g) => {
          const items = NAV.filter((n) => n.group === g && access.routes.has(n.href));
          if (!items.length) return null;
          return (
          <div key={g} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <div className="rail-group rail-text">{g.toUpperCase()}</div>
            {items.map((n) => {
              const active = pathname === n.href || pathname.startsWith(n.href + "/");
              return (
                <Link key={n.href} href={n.href} className="app-rail-item" aria-current={active ? "page" : undefined} title={n.hint}>
                  <span className="rail-icon" style={{ display: "flex" }}>
                    <Icon name={n.icon} size={16} />
                  </span>
                  <span className="rail-text">{n.label}</span>
                </Link>
              );
            })}
          </div>
          );
        })}
      </nav>

      <RailStatus />

      {!persistent && (
        <div className="rail-text" style={{ margin: "0 10px 8px", padding: "8px 10px", borderRadius: 6, fontSize: 11.5, lineHeight: 1.4, background: "var(--c-red-bg)", color: "var(--c-red-fg)", border: "1px solid var(--c-red-bd)" }}>
          Браузер запретил хранилище — данные живут только до закрытия вкладки. Сделайте выгрузку в Настройках.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 10px 10px", borderTop: "1px solid var(--ink-06)" }}>
        <button className="btn btn-ghost btn-sm" onClick={() => setPaletteOpen(true)} title="Быстрые действия (Ctrl+K)" style={{ width: "100%", justifyContent: "flex-start" }}>
          <Icon name="search" size={14} />
          <span className="rail-text">Действия</span>
          <span className="kbd rail-text" style={{ marginLeft: "auto" }}>Ctrl K</span>
        </button>
        <AccountMenu />
      </div>
    </aside>
  );
}

function Hotkeys() {
  const { openLead, modal, confirmState, setPaletteOpen, paletteOpen, access } = useCrm();
  const canLead = access.can.createLeads;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.code === "KeyK" || e.key === "k" || e.key === "K" || e.key === "л" || e.key === "Л")) {
        e.preventDefault();
        setPaletteOpen(!paletteOpen);
        return;
      }
      if (isTyping(e) || modal || confirmState || paletteOpen || e.ctrlKey || e.metaKey || e.altKey) return;
      // code — физическая клавиша (работает в любой раскладке), key — запасной вариант
      if (canLead && (e.code === "KeyN" || e.key === "n" || e.key === "N" || e.key === "т" || e.key === "Т")) {
        e.preventDefault();
        openLead();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openLead, modal, confirmState, setPaletteOpen, paletteOpen, canLead]);
  return null;
}

/** Страница не разрешена аккаунту (или аккаунт сменили) — на его стартовую. */
function RouteGuard() {
  const { ready, access } = useCrm();
  const pathname = usePathname() || "";
  const router = useRouter();
  const route = "/" + (pathname.split("/")[1] || "");
  const prevAcc = useRef(access.account.id);
  useEffect(() => {
    if (!ready) return;
    // первая загрузка (временный __boot__ → реальный аккаунт) — не смена аккаунта
    const switched = prevAcc.current !== "__boot__" && prevAcc.current !== access.account.id;
    prevAcc.current = access.account.id;
    if (switched || !access.routes.has(route)) router.replace(homeFor(access));
  }, [ready, access, route, router]);
  return null;
}

/** Вошёл в Supabase, но почты нет среди аккаунтов CRM. */
function NoAccess({ email }: { email: string }) {
  const router = useRouter();
  const { reload } = useCrm();
  return (
    <div className="empty" style={{ flex: 1, minHeight: "60vh" }}>
      <div className="empty-title">Нет доступа к CRM</div>
      <div className="empty-text" style={{ maxWidth: 460 }}>
        Почта <b>{email}</b> не добавлена в CRM. Попросите руководителя отдела завести вам аккаунт с этой почтой («Настройки → Аккаунты»), затем нажмите «Проверить снова».
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary" onClick={() => void reload()}>
          Проверить снова
        </button>
        <button
          className="btn"
          onClick={async () => {
            await signOut();
            router.replace("/login");
          }}
        >
          Выйти
        </button>
      </div>
    </div>
  );
}

function Body({ children }: { children: ReactNode }) {
  const { ready, loadError, reload, access, noAccess } = useCrm();
  const pathname = usePathname();
  const route = "/" + ((pathname || "").split("/")[1] || "");
  if (loadError) {
    return (
      <div className="empty" style={{ flex: 1 }}>
        <div className="empty-title">Не удалось открыть базу данных</div>
        <div className="empty-text">{loadError}</div>
        <button className="btn" onClick={() => void reload()}>
          Повторить
        </button>
      </div>
    );
  }
  if (ready && noAccess) return <NoAccess email={noAccess} />;
  if (!ready) {
    return (
      <div className="stack" aria-busy aria-label="Загрузка">
        <div style={{ height: 22, width: 220, borderRadius: 5, background: "var(--ink-06)", animation: "vexaSkeleton 1.2s ease-in-out infinite" }} />
        <div className="kpi-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="card" style={{ height: 78, animation: "vexaSkeleton 1.2s ease-in-out infinite" }} />
          ))}
        </div>
        <div className="card" style={{ height: 280, animation: "vexaSkeleton 1.2s ease-in-out infinite" }} />
      </div>
    );
  }
  if (!access.routes.has(route)) return null; // RouteGuard уже уводит на разрешённую страницу
  return (
    <div key={`${pathname}|${access.account.id}`} style={{ minWidth: 0 }}>
      {children}
    </div>
  );
}

function Modals() {
  const { modal } = useCrm();
  if (!modal) return null;
  if (modal.kind === "lead") return <LeadModal key={modal.lead?.id ?? "new"} lead={modal.lead} preset={modal.preset} />;
  if (modal.kind === "operator") return <OperatorModal key={modal.op?.id ?? "new"} op={modal.op} preset={modal.preset} />;
  if (modal.kind === "group") return <GroupModal key={modal.group?.id ?? "new"} group={modal.group} />;
  return null;
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <CrmProvider>
        <div style={{ display: "flex", height: "calc(100vh / var(--ui-scale, 1) - var(--titlebar-h, 0px))", overflow: "hidden", background: "var(--bg-sidebar)" }}>
          <Rail />
          <main
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              background: "var(--bg)",
              border: "1px solid var(--ink-07)",
              borderRadius: 10,
              margin: 8,
              marginLeft: 0,
            }}
          >
            <div id="app-scroll" style={{ flex: 1, overflowY: "auto", position: "relative" }}>
              <div className="app-content" style={{ padding: "24px 30px 48px", maxWidth: 1680, margin: "0 auto" }}>
                <Body>{children}</Body>
              </div>
            </div>
          </main>
        </div>
        <Modals />
        <CommandPalette />
        <ConfirmHost />
        <ToastHost />
        <TitleTips />
        <Hotkeys />
        <RouteGuard />
        <SheetsAutoSync />
      </CrmProvider>
    </AuthGate>
  );
}
