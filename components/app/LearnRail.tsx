"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { homeFor } from "@/lib/crm/access";
import { ACAD_NAV, acadActive, acadProgress, simChaptersDone } from "@/lib/academy/course";
import { Icon } from "@/components/ui/icons";
import { Progress } from "@/components/ui/kit";

/** Последняя страница CRM вне обучения — туда ведёт «Вернуться в меню». */
export const LAST_MAIN_KEY = "leadup.lastMain";

/**
 * Меню обучения в боковой колонке CRM. Показывается вместо основного меню,
 * пока открыт раздел «Обучение» (у стажёра — всегда, и без кнопки возврата).
 * Пункты ведут на /learn#/раздел — страницу рисует lib/academy/engine.js;
 * прогресс и счётчики — из записей learn аккаунта.
 */
export function LearnRail({ off, back, pin }: { off: boolean; back: boolean; pin: ReactNode }) {
  const router = useRouter();
  // адреса CRM со слешем на конце (/learn/) — сравниваем без него
  const pathname = (usePathname() || "").replace(/\/$/, "");
  const { data, me, access } = useCrm();
  const [hash, setHash] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    const onChange = () => setTick((t) => t + 1);
    onHash();
    window.addEventListener("hashchange", onHash);
    window.addEventListener("academy:change", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("academy:change", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  // переход внутри Next (router.push на /learn#/…) событие hashchange не всегда даёт
  useEffect(() => setHash(window.location.hash), [pathname]);

  const prog = useMemo(
    () => acadProgress(data.learn, me.id, simChaptersDone()),
    // tick — тренажёр пишет свои главы в браузер и сообщает об этом событием
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.learn, me.id, tick],
  );
  const notes = useMemo(() => data.learn.filter((l) => l.accountId === me.id && l.note && l.note.trim()).length, [data.learn, me.id]);

  const onLearn = pathname === "/learn";
  const active = pathname.startsWith("/learn/sv") ? "__sv" : pathname.startsWith("/learn/team") ? "__team" : onLearn ? acadActive(hash) : "";
  // руководителю (и наставнику — по своей группе) видно, как учатся стажёры
  const lead = !access.isOp || access.isMentor;

  const open = (r: string) => {
    if (onLearn) window.location.hash = `#/${r}`;
    else router.push(`/learn#/${r}`);
  };
  const go = (r: string) => (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    open(r);
  };
  const cont = () => open(prog.next ? `item/${prog.next.id}` : "course");
  const search = () => {
    if (onLearn) window.dispatchEvent(new Event("academy:search"));
    else {
      router.push("/learn#/home");
      setTimeout(() => window.dispatchEvent(new Event("academy:search")), 450);
    }
  };
  const leave = () => {
    let to = "";
    try {
      to = window.sessionStorage.getItem(LAST_MAIN_KEY) || "";
    } catch {
      /* нет хранилища — на стартовую */
    }
    router.push(to && access.routes.has("/" + (to.split("/")[1] || "")) ? to : homeFor(access));
  };

  /* плашка активного пункта — как в основном меню */
  const navRef = useRef<HTMLElement>(null);
  const [glide, setGlide] = useState<{ top: number; h: number } | null>(null);
  const [anim, setAnim] = useState(false);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const place = () => {
      const el = nav.querySelector<HTMLElement>('.app-rail-item[aria-current="page"]');
      setGlide((p) => (el ? (p && p.top === el.offsetTop && p.h === el.offsetHeight ? p : { top: el.offsetTop, h: el.offsetHeight }) : null));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(nav);
    return () => ro.disconnect();
  }, [active, off, notes, prog.done]);
  useEffect(() => {
    if (!glide || anim) return;
    const id = requestAnimationFrame(() => setAnim(true));
    return () => cancelAnimationFrame(id);
  }, [glide, anim]);

  const item = (r: string, t: string, i: Parameters<typeof Icon>[0]["name"], hint: string, count?: string) => (
    <a key={r} className="app-rail-item" href={`/learn#/${r}`} onClick={go(r)} aria-current={active === r ? "page" : undefined} title={hint}>
      <span className="rail-icon" style={{ display: "flex" }}>
        <Icon name={i} size={16} />
      </span>
      <span className="rail-text lbl">{t}</span>
      {count ? <span className="rail-count rail-text">{count}</span> : null}
    </a>
  );

  return (
    <div className="rail-pane learn" data-off={off ? "" : undefined} aria-hidden={off || undefined}>
      <div className="rail-leadrow">
        <div className="rail-learn-top">
        {back ? (
          <button type="button" className="rail-back" onClick={leave} title="Вернуться в основное меню CRM">
            <span className="rail-icon">
              <Icon name="arrowL" size={15} />
            </span>
            <span className="rail-text">Вернуться в меню</span>
          </button>
        ) : (
          <div className="rail-learn-title">
            <span className="ic">
              <Icon name="cap" size={15} />
            </span>
            <span className="rail-text">Обучение</span>
          </div>
        )}
        {pin}
        </div>
        <button className="btn btn-primary rail-lead" style={{ width: "100%", height: 34 }} onClick={cont} title="Следующий шаг обучения">
          <Icon name="play" size={14} stroke={2.2} />
          <span className="rail-text">Продолжить обучение</span>
        </button>
        <button type="button" className="rail-search" onClick={search} title="Поиск по обучению (Ctrl+K)">
          <Icon name="search" size={14} />
          <span className="rail-text">Поиск</span>
          <span className="kbd rail-text">Ctrl K</span>
        </button>
      </div>

      <nav ref={navRef} style={{ position: "relative", flex: 1, overflowY: "auto", padding: "0 10px 10px", display: "flex", flexDirection: "column" }}>
        <span
          className="rail-glider"
          aria-hidden
          data-anim={anim ? "" : undefined}
          style={glide ? { transform: `translateY(${glide.top}px)`, height: glide.h } : { opacity: 0 }}
        />
        {ACAD_NAV.map((g) => (
          <div key={g.g} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <div className="rail-group">
              <span className="rail-text">{g.g.toUpperCase()}</span>
            </div>
            {g.items.map((n) => item(n.r, n.t, n.i, n.hint, n.count?.(prog, notes)))}
          </div>
        ))}
        {lead && (
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <div className="rail-group">
              <span className="rail-text">ДЛЯ РУКОВОДИТЕЛЯ</span>
            </div>
            <Link className="app-rail-item" href="/learn/team" aria-current={active === "__team" ? "page" : undefined} title="Где сейчас каждый стажёр: этап, тесты, попытки, активность">
              <span className="rail-icon" style={{ display: "flex" }}>
                <Icon name="chart" size={16} />
              </span>
              <span className="rail-text lbl">Обучение команды</span>
            </Link>
            {!access.isOp && <Link className="app-rail-item" href="/learn/sv" aria-current={active === "__sv" ? "page" : undefined} title="Найм, группа, деньги и базы — прежняя академия">
              <span className="rail-icon" style={{ display: "flex" }}>
                <Icon name="users" size={16} />
              </span>
              <span className="rail-text lbl">Академия супервайзера</span>
            </Link>}
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <div className="rail-group">
            <span className="rail-text">СПРАВКА</span>
          </div>
          {item("help", "Как пользоваться", "info", "С чего начать и как устроено обучение")}
        </div>
      </nav>

      <div className="rail-fold">
        <div>
          <a
            href="/learn#/progress"
            onClick={go("progress")}
            className="rail-text"
            style={{ display: "block", width: 216, textDecoration: "none", color: "inherit", margin: "0 10px 10px", padding: "10px 12px", borderRadius: 8, border: "1px solid var(--ink-07)", background: "var(--bg-panel)" }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--text-sub)", marginBottom: 6 }}>
              <span>Курс «Авто»</span>
              <span style={{ fontWeight: 600, color: "var(--text)" }}>{Math.round(prog.pct * 100)}%</span>
            </div>
            <Progress value={prog.pct} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: "var(--dim)", marginTop: 6 }}>
              <span>
                {prog.done} / {prog.total} материалов
              </span>
              <span>{prog.done === prog.total ? "курс пройден" : `осталось ${prog.total - prog.done}`}</span>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
}
