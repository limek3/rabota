"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useCrm } from "@/lib/crm/store";
import { NAV, NAV_GROUPS } from "@/lib/crm/nav";
import { monthModel } from "@/lib/crm/calc";
import { currentMonth, fmtMonth } from "@/lib/crm/dates";
import { fmtInt, fmtPct } from "@/lib/crm/format";
import { Icon, type IconName } from "@/components/ui/icons";
import { Avatar, Progress } from "@/components/ui/kit";
import { AccountMenu } from "./AccountMenu";
import { LearnRail } from "./LearnRail";

/**
 * Мобильная оболочка (телефон, до 760 px): сверху — полоска с планом месяца и аватаром,
 * снизу — меню из четырёх-пяти главных разделов и большая кнопка «Лид» посередине.
 * Остальные разделы, аккаунт и меню обучения — в шторке «Ещё». На компьютере всё это
 * спрятано CSS (app/mobile.css), а боковое меню — наоборот.
 */

/** Месяц коротко — для меню слева и полоски сверху на телефоне. */
export function useMonthStatus() {
  const { data, ix, today, ready, access } = useCrm();
  const m = useMemo(() => (ready ? monthModel(data, ix, currentMonth(), today) : null), [data, ix, today, ready]);
  if (!m) return null;

  const scoped = !access.isHead && access.ownGroups.size > 0;
  const groups = m.groups.filter((g) => (g.plan > 0 || g.pace.fact > 0) && (!scoped || access.ownGroups.has(g.key)));
  // у оператора срез данных — он сам, поэтому «команда» здесь = его личный план
  const t = scoped
    ? groups.reduce((a, g) => ({ fact: a.fact + g.pace.fact, plan: a.plan + g.plan, toDate: a.toDate + g.pace.planToDate, today: a.today + g.pace.today }), { fact: 0, plan: 0, toDate: 0, today: 0 })
    : { fact: m.team.pace.fact, plan: m.team.plan, toDate: m.team.pace.planToDate, today: m.team.pace.today };
  if (t.plan === 0 && t.fact === 0) return null;

  const tone = (fact: number, toDate: number, plan: number) => (plan <= 0 ? undefined : fact >= toDate - 0.5 ? ("ok" as const) : ("behind" as const));
  return {
    ...t,
    pct: t.plan > 0 ? t.fact / t.plan : 0,
    tone: tone(t.fact, t.toDate, t.plan),
    toneOf: tone,
    who: access.isOp && !scoped ? "Мой план" : scoped ? (groups.length === 1 ? groups[0].name : "Мои группы") : "Отдел",
    href: access.routes.has("/dashboard") ? "/dashboard" : "/me",
    // разбивку по группам видит только РОП
    groups: access.isHead && groups.length > 1 ? groups : [],
  };
}

/** Главные разделы в нижнем меню — по роли; что не разрешено аккаунту, пропускаем. */
function useTabs() {
  const { access } = useCrm();
  const order = access.isTrainee
    ? ["/learn", "/cities", "/cars"]
    : access.isOp
      ? ["/me", "/leads", "/schedule", "/stats", "/learn"]
      : ["/dashboard", "/leads", "/operators", "/schedule", "/groups"];
  return order
    .filter((h) => access.routes.has(h))
    .map((h) => NAV.find((n) => n.href === h))
    .filter((n): n is (typeof NAV)[number] => !!n);
}

const SHORT: Record<string, string> = { "/me": "Кабинет", "/stats": "Показатели", "/dashboard": "Сводка", "/cities": "Карта", "/cars": "Авто" };

function isActive(pathname: string, href: string) {
  const p = pathname.replace(/\/$/, "");
  return p === href || p.startsWith(href + "/");
}

export function MobileTop({ onMore }: { onMore: () => void }) {
  const { me } = useCrm();
  const st = useMonthStatus();
  return (
    <header className="m-top">
      <Link href={st?.href ?? "/"} className="m-brand" aria-label="На главную">
        <img src="/brand-logo.png" alt="" width={26} height={26} />
        <b>LEADUP</b>
      </Link>
      {st && (
        <Link href={st.href} className="m-stat" title={`${st.who}: ${fmtInt(st.fact)} из ${fmtInt(st.plan)}`}>
          <span className="m-stat-w">{st.who}</span>
          <b data-tone={st.tone}>{st.plan > 0 ? fmtPct(st.pct) : fmtInt(st.fact)}</b>
          <span className="m-stat-d">сегодня {fmtInt(st.today)}</span>
        </Link>
      )}
      <button type="button" className="m-ava" onClick={onMore} aria-label="Меню и аккаунт">
        <Avatar name={me.name} id={me.id} size={32} />
      </button>
    </header>
  );
}

export function MobileTabs({ onMore, moreOpen }: { onMore: () => void; moreOpen: boolean }) {
  const pathname = usePathname() || "";
  const { access, openLead } = useCrm();
  const all = useTabs();
  const fab = access.can.createLeads;
  // с кнопкой «Лид» посередине — по два раздела слева и справа («Ещё» — второй справа)
  const tabs = all.slice(0, fab ? 3 : 4);
  const left = fab ? tabs.slice(0, 2) : tabs;
  const right = fab ? tabs.slice(2) : [];
  const shownActive = tabs.some((t) => isActive(pathname, t.href));

  const tab = (n: (typeof NAV)[number]) => {
    const on = isActive(pathname, n.href) && !moreOpen;
    return (
      <Link key={n.href} href={n.href} className="m-tab" aria-current={on ? "page" : undefined}>
        <Icon name={n.icon} size={21} stroke={on ? 2.1 : 1.75} />
        <span>{SHORT[n.href] ?? n.label}</span>
      </Link>
    );
  };

  return (
    <nav className="m-tabs" aria-label="Разделы">
      {left.map(tab)}
      {fab && (
        <button type="button" className="m-fab" onClick={() => openLead()} aria-label="Лид передан">
          <span className="m-fab-i">
            <Icon name="plus" size={24} stroke={2.4} />
          </span>
          <span>Лид</span>
        </button>
      )}
      {right.map(tab)}
      <button type="button" className="m-tab" onClick={onMore} aria-expanded={moreOpen} aria-current={moreOpen || !shownActive ? "page" : undefined}>
        <Icon name="grid" size={21} stroke={moreOpen || !shownActive ? 2.1 : 1.75} />
        <span>Ещё</span>
      </button>
    </nav>
  );
}

/** Шторка «Ещё»: месяц, все разделы плиткой, меню обучения, аккаунт. */
export function MobileMore({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname() || "";
  const { access } = useCrm();
  const st = useMonthStatus();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // перешли куда-то — шторка закрывается
  useEffect(() => {
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".acc-pop") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!mounted || !open) return null;

  const learnMode = access.isTrainee || isActive(pathname, "/learn");

  return createPortal(
    <div className="m-sheet-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="m-sheet m-more" role="dialog" aria-modal aria-label="Меню">
        <div className="m-grab" aria-hidden />
        <div className="m-more-acc">
          <AccountMenu />
          <button type="button" className="m-x" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" size={18} />
          </button>
        </div>

        {st && (
          <Link href={st.href} className="m-more-month">
            <div className="m-more-month-t">
              <span>
                {st.who} · <i>{fmtMonth(currentMonth())}</i>
              </span>
              <b data-tone={st.tone}>{st.plan > 0 ? fmtPct(st.pct) : "—"}</b>
            </div>
            <Progress value={st.pct} marker={st.plan > 0 ? st.toDate / st.plan : undefined} hue={st.tone === "behind" ? "red" : st.tone === "ok" ? "green" : undefined} />
            <div className="m-more-month-s">
              <span>
                <b>{fmtInt(st.fact)}</b> из {fmtInt(st.plan)}
              </span>
              <span>
                сегодня <b>{fmtInt(st.today)}</b>
              </span>
            </div>
            {st.groups.length > 0 && (
              <div className="m-more-groups">
                {st.groups.map((g) => {
                  const tn = st.toneOf(g.pace.fact, g.pace.planToDate, g.plan);
                  return (
                    <span key={g.key} data-tone={tn}>
                      <i style={{ background: `var(--c-${g.color}-fg)` }} />
                      {g.name} <b>{g.plan > 0 ? fmtPct(g.pace.fact / g.plan) : "—"}</b>
                    </span>
                  );
                })}
              </div>
            )}
          </Link>
        )}

        {learnMode && (
          <div className="m-more-learn">
            <LearnRail off={false} back={!access.isTrainee} pin={null} />
          </div>
        )}

        {!access.isTrainee &&
          NAV_GROUPS.map((g) => {
            const items = NAV.filter((n) => n.group === g && access.routes.has(n.href));
            if (!items.length) return null;
            return (
              <section key={g} className="m-more-sec">
                <div className="m-more-h">{g}</div>
                <div className="m-more-grid">
                  {items.map((n) => (
                    <Link key={n.href} href={n.href} className="m-more-it" aria-current={isActive(pathname, n.href) ? "page" : undefined}>
                      <span className="ic">
                        <Icon name={n.icon as IconName} size={19} />
                      </span>
                      <span className="t">{n.label}</span>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
      </div>
    </div>,
    document.body,
  );
}
