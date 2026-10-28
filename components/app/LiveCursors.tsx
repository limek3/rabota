"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { gradeLevel } from "@/lib/crm/telegram";
import { LIVE_HIDE_EVENT, liveColor, liveHidden, liveOthersOff, openLive, type LiveLink, type LiveMsg } from "@/lib/live";
import { plural, shortName } from "@/lib/crm/format";
import { uiZoom } from "@/components/ui/select";

/**
 * Живые курсоры коллег на той же странице (lib/live.ts — канал).
 *  • Курсор коллеги — маленькая точка его цвета с подписью имени: мельче своей «живой» точки
 *    и без кольца, чтобы не путаться.
 *  • Enter — написать короткое сообщение прямо у курсора: поле и потом само сообщение плывут
 *    за вашим курсором, у коллег — за вашей точкой.
 *  • Внизу справа — кто сейчас на этой странице; по нажатию список плавно раскрывается вверх.
 *  • «Скрывать мой курсор» — в меню аккаунта: тогда вас не видно, а вы видите остальных.
 *  • «Курсоры коллег» — в настройках профиля: можно не показывать чужие курсоры (вас при этом видно).
 *  • Грейд дня IV (11+ доведённых сегодня, как тег Vexi) — корона с бликом на подписи курсора.
 * Координаты — в пикселях содержимого страницы (.app-content): x — доля ширины, y — от верха,
 * поэтому курсор стоит над тем же местом у людей с разной шириной окна и прокруткой.
 */
const SEND_MS = 60; // не чаще ~16 раз в секунду
const HELLO_MS = 5000;
const STALE_MS = 15000; // нет «я здесь» дольше — человек ушёл
const IDLE_MS = 9000; // мышь не двигалась — курсор гаснет
const MSG_MS = 6000;
const MSG_MAX = 140;
const CONTROLS = "button, a, summary, [role=button], [role=menuitem], [role=option], [tabindex]:not([tabindex='-1'])";

type Peer = {
  sid: string;
  id: string;
  name: string;
  path: string;
  seen: number;
  grade?: number;
  role?: "head" | "supervisor" | "operator";
  gids?: string[];
  team?: string;
  /** Когда РОП пришёл на страницу — от его точки один раз расходится волна. */
  arrive?: number;
  x?: number;
  y?: number;
  moved?: number;
  msg?: string;
  msgAt?: number;
};

/**
 * Отличие на подписи курсора: РОП — тёмная с золотом и звездой, СВ — щит и его группа,
 * операторы — по грейду дня: II серебро, III бронза с искрой, IV золото с короной.
 */
type Rank = { cls: string; chip: string; icon: "star" | "shield" | "spark" | "crown" | null };
function rankOf(p: Peer): Rank | null {
  if (p.role === "head") return { cls: "r-head", chip: "РОП", icon: "star" };
  if (p.role === "supervisor") return { cls: "r-sv", chip: p.team ? `СВ · ${p.team}` : "СВ", icon: "shield" };
  if (p.grade === 4) return { cls: "g4", chip: "Грейд IV", icon: "crown" };
  if (p.grade === 3) return { cls: "g3", chip: "Грейд III", icon: "spark" };
  if (p.grade === 2) return { cls: "g2", chip: "Грейд II", icon: null };
  return null;
}
const rankWeight = (p: Peer) => (p.role === "head" ? 9 : p.role === "supervisor" ? 8 : p.grade ?? 0);
/** РОПу — сообщения заметнее и висят дольше. */
const msgTtl = (p: Peer) => (p.role === "head" ? MSG_MS * 2 : MSG_MS);

const sidOf = () => Math.random().toString(36).slice(2, 10);

export function LiveCursors() {
  const { me, data, access, today } = useCrm();
  // свой грейд дня — по своим доведённым лидам за сегодня; без карточки оператора (РОП) грейда нет
  const myGrade = useMemo(() => {
    if (!access.opId) return undefined;
    let done = 0;
    for (const l of data.leads) if (l.operatorId === access.opId && l.status === "done" && l.at.slice(0, 10) === today) done++;
    return gradeLevel(done);
  }, [data.leads, access.opId, today]);
  // СВ рассылает свои группы: их операторы видят его курсор крупнее
  const gidsKey = me.role === "supervisor" ? Array.from(access.ownGroups).sort().join(",") : "";
  const myTeam = useMemo(() => {
    if (!gidsKey) return { gids: undefined, team: undefined };
    const gids = gidsKey.split(",");
    const names = data.groups.filter((g) => gids.includes(g.id)).map((g) => g.name);
    return { gids, team: names.length === 1 ? names[0] : names.length > 1 ? `${names.length} ${plural(names.length, ["группа", "группы", "групп"])}` : undefined };
  }, [gidsKey, data.groups]);
  const myGroup = access.opId ? data.operators.find((o) => o.id === access.opId)?.groupId ?? null : null;
  // «/leads/» и «/leads» — одна страница (сборка со слешем на конце)
  const path = (usePathname() || "/").replace(/(.)\/$/, "$1");
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [hidden, setHidden] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [typing, setTyping] = useState(false);
  const [mine, setMine] = useState<{ text: string; at: number } | null>(null);
  // где мой курсор — только пока за ним плывёт поле или сообщение (иначе не перерисовываемся на каждое движение)
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const hereRef = useRef<HTMLDivElement | null>(null);
  const follow = useRef(false);
  const [, tick] = useState(0);
  const link = useRef<LiveLink | null>(null);
  const sid = useRef(sidOf());
  const pos = useRef<{ x: number; y: number; w: number } | null>(null);
  const ready = me.id !== "__boot__";

  // чужие курсоры выключены в настройках — не принимаем и не рисуем их
  const [othersOff, setOthersOff] = useState(false);
  const othersOffRef = useRef(false);

  useEffect(() => {
    const on = () => {
      setHidden(liveHidden());
      const off = liveOthersOff();
      othersOffRef.current = off;
      setOthersOff(off);
      if (off) {
        setPeers({});
        setOpen(false);
      }
    };
    on();
    window.addEventListener(LIVE_HIDE_EVENT, on);
    return () => window.removeEventListener(LIVE_HIDE_EVENT, on);
  }, []);

  // контейнер содержимого страницы — туда рисуем чужие курсоры (прокручиваются вместе со страницей)
  useEffect(() => {
    setHost(document.querySelector<HTMLElement>(".app-content"));
  }, [path]);

  // канал: принимаем всех, кроме себя (своё другое окно тоже не показываем)
  useEffect(() => {
    if (!ready) return;
    const l = openLive((m: LiveMsg) => {
      if (othersOffRef.current) return;
      setPeers((prev) => {
        const p = prev[m.sid];
        const now = Date.now();
        if (m.t === "hello") {
          if (m.id === me.id) return prev;
          const moved = !p || p.path !== m.path;
          return {
            ...prev,
            [m.sid]: {
              ...(p ?? { sid: m.sid }),
              id: m.id,
              name: m.name,
              path: m.path,
              grade: m.grade,
              role: m.role,
              gids: m.gids,
              team: m.team,
              seen: now,
              ...(m.role === "head" && moved ? { arrive: now } : null),
              ...(p && p.path !== m.path ? { x: undefined, y: undefined } : null),
            },
          };
        }
        if (!p) return prev;
        if (m.t === "cur") return { ...prev, [m.sid]: { ...p, path: m.path, x: m.x, y: m.y, moved: now, seen: now } };
        if (m.t === "out") return { ...prev, [m.sid]: { ...p, x: undefined, y: undefined } };
        if (m.t === "msg") return { ...prev, [m.sid]: { ...p, msg: m.text.slice(0, MSG_MAX), msgAt: now, seen: now } };
        if (m.t === "bye") {
          const next = { ...prev };
          delete next[m.sid];
          return next;
        }
        return prev;
      });
    });
    link.current = l;
    return () => {
      l.send({ t: "bye", sid: sid.current });
      l.close();
      link.current = null;
    };
  }, [ready, me.id]);

  // «я здесь»: сразу, при смене страницы и раз в несколько секунд; скрыт — прощаемся
  useEffect(() => {
    const l = link.current;
    if (!l || !ready) return;
    if (hidden) {
      l.send({ t: "bye", sid: sid.current });
      return;
    }
    const hello = () => l.send({ t: "hello", sid: sid.current, id: me.id, name: me.name, path, grade: myGrade, role: me.role, gids: myTeam.gids, team: myTeam.team });
    hello();
    const iv = window.setInterval(hello, HELLO_MS);
    const bye = () => l.send({ t: "bye", sid: sid.current });
    window.addEventListener("pagehide", bye);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("pagehide", bye);
    };
  }, [hidden, path, me.id, me.name, me.role, myGrade, myTeam, ready]);

  // своя мышь → координаты содержимого страницы; не чаще SEND_MS
  useEffect(() => {
    if (!host || !ready) return;
    let last = 0;
    let timer = 0;
    let wasIn = false;
    let frame = 0;
    const send = () => {
      timer = 0;
      last = Date.now();
      const p = pos.current;
      if (hidden || !link.current) return;
      if (p) link.current.send({ t: "cur", sid: sid.current, path, x: p.x / p.w, y: p.y });
      else link.current.send({ t: "out", sid: sid.current });
    };
    // мышь шлёт сотни событий в секунду — размеры страницы читаем не чаще раза за кадр:
    // чтение на каждое событие заставляло браузер пересчитывать большие таблицы снова и снова
    let raw: { x: number; y: number; rail: boolean } | null = null;
    const measure = () => {
      frame = 0;
      const m = raw;
      if (!m) return;
      const z = uiZoom();
      const r = host.getBoundingClientRect();
      const inside = !m.rail && m.x >= r.left && m.x <= r.right && m.y >= r.top && m.y <= r.bottom;
      pos.current = inside ? { x: (m.x - r.left) / z, y: (m.y - r.top) / z, w: r.width / z } : null;
      if (follow.current && pos.current) setCur({ x: pos.current.x, y: pos.current.y });
      if (!inside && !wasIn) return;
      wasIn = inside;
      const wait = SEND_MS - (Date.now() - last);
      if (wait <= 0) send();
      else if (!timer) timer = window.setTimeout(send, wait);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      raw = { x: e.clientX, y: e.clientY, rail: e.target instanceof Element && !!e.target.closest(".app-rail") };
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const leave = () => {
      raw = null;
      pos.current = null;
      wasIn = false;
      send();
    };
    const vis = () => document.visibilityState === "hidden" && leave();
    window.addEventListener("pointermove", move, { passive: true });
    document.documentElement.addEventListener("mouseleave", leave);
    document.addEventListener("visibilitychange", vis);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [host, hidden, path, ready]);

  // Enter — написать сообщение у своего курсора (не в поле, не на кнопке, не в открытом окне)
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.repeat || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || hidden || typing) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, select, [contenteditable=true]")) return;
      // кнопка в фокусе после щелчка мышью — Enter не её; пришли на неё Tab'ом — её
      const ctl = t?.closest(CONTROLS);
      if (ctl && ctl !== clicked) return;
      if (document.querySelector(".modal, [role=dialog], [role=menu], [role=listbox]")) return;
      const p = pos.current;
      if (!p) return;
      e.preventDefault();
      setCur({ x: p.x, y: p.y });
      setTyping(true);
    };
    let clicked: Element | null = null;
    const onDown = (e: PointerEvent) => {
      clicked = e.target instanceof Element ? e.target.closest(CONTROLS) : null;
    };
    const onTab = (e: KeyboardEvent) => {
      if (e.key === "Tab") clicked = null;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onTab, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onTab, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [hidden, ready, typing]);

  const sendMsg = (text: string) => {
    const v = text.trim().slice(0, MSG_MAX);
    if (v && link.current) {
      link.current.send({ t: "msg", sid: sid.current, path, text: v });
      setMine({ text: v, at: Date.now() });
    }
    setTyping(false);
  };

  // список «кто на странице»: закрываем щелчком мимо и Esc
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Node && hereRef.current?.contains(e.target))) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  // часы: гасим неподвижные курсоры, убираем ушедших и старые сообщения
  useEffect(() => {
    const iv = window.setInterval(() => {
      const now = Date.now();
      setPeers((prev) => {
        let changed = false;
        const next: Record<string, Peer> = {};
        for (const [k, p] of Object.entries(prev)) {
          if (now - p.seen > STALE_MS) {
            changed = true;
            continue;
          }
          next[k] = p;
        }
        return changed ? next : prev;
      });
      tick((n) => n + 1);
    }, 1000);
    return () => window.clearInterval(iv);
  }, []);

  if (!ready || !host) return null;
  const now = Date.now();
  const here = Object.values(peers).filter((p) => p.path === path);
  // кто на странице — по аккаунтам (у человека может быть две вкладки)
  const people = Array.from(new Map(here.map((p) => [p.id, p])).values()).sort((a, b) => rankWeight(b) - rankWeight(a));
  const w = host.clientWidth;
  const talkingMe = !!mine && now - mine.at < (me.role === "head" ? MSG_MS * 2 : MSG_MS);
  follow.current = typing || talkingMe;
  const show = (p: Peer) => host.querySelector(`[data-sid="${p.sid}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });

  return (
    <>
      {createPortal(
        <div className="lv-layer" aria-hidden>
          {here.map((p) => {
            const live = p.x != null && p.y != null && now - (p.moved ?? 0) < IDLE_MS;
            const talking = p.msg && now - (p.msgAt ?? 0) < msgTtl(p);
            if (!live && !talking) return null;
            if (p.x == null || p.y == null) return null;
            const r = rankOf(p);
            // СВ моей группы — курсор крупнее
            const near = p.role === "supervisor" && !!myGroup && !!p.gids?.includes(myGroup);
            return (
              <div
                key={p.sid}
                data-sid={p.sid}
                className={`lv-cur${live ? "" : " idle"}${r ? ` ${r.cls}` : ""}${near ? " near" : ""}`}
                style={{ ["--lv" as string]: liveColor(p.id), transform: `translate3d(${p.x * w}px, ${p.y}px, 0)` }}
              >
                {p.arrive && now - p.arrive < 3000 && <i key={p.arrive} className="lv-wave" />}
                <i className="lv-dot" />
                <span className="lv-name">
                  {r?.icon && <RankIcon name={r.icon} />}
                  {shortName(p.name) || "Коллега"}
                  {p.role === "supervisor" && p.team && <em>· {p.team}</em>}
                </span>
                {talking && <span className="lv-msg">{p.msg}</span>}
              </div>
            );
          })}
          {talkingMe && !typing && cur && (
            <div className={`lv-cur me${me.role === "head" ? " r-head" : ""}`} style={{ ["--lv" as string]: "var(--brand)", transform: `translate3d(${cur.x}px, ${cur.y}px, 0)` }}>
              <span key={mine.at} className="lv-msg">
                {mine.text}
              </span>
            </div>
          )}
        </div>,
        host,
      )}
      {typing &&
        cur &&
        createPortal(
          <div className="lv-type" style={{ transform: `translate3d(${cur.x}px, ${cur.y}px, 0)` }}>
            <input
              autoFocus
              maxLength={MSG_MAX}
              placeholder="Сообщение всем на странице…"
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMsg(e.currentTarget.value);
                if (e.key === "Escape") setTyping(false);
              }}
              onBlur={() => setTyping(false)}
            />
            <span>Enter — отправить · Esc — отмена</span>
          </div>,
          host,
        )}
      {people.length > 0 &&
        createPortal(
          <div ref={hereRef} className={`lv-here${open ? " open" : ""}`}>
            <div className="lv-here-list" aria-hidden={!open}>
              <div className="lv-here-in">
                <div className="lv-here-h">Сейчас на этой странице</div>
                {people.map((p) => {
                  const active = p.x != null && now - (p.moved ?? 0) < IDLE_MS;
                  const r = rankOf(p);
                  return (
                    <button key={p.id} type="button" tabIndex={open ? 0 : -1} className="lv-here-row" disabled={!active} onClick={() => show(p)}>
                      <i style={{ background: liveColor(p.id) }}>{initials(p.name)}</i>
                      <span>
                        <b>
                          {p.name || "Коллега"}
                          {r && (
                            <span className={`lv-rank ${r.cls}`}>
                              {r.icon && <RankIcon name={r.icon} />}
                              {r.chip}
                            </span>
                          )}
                        </b>
                        <small>{active ? "водит курсором — показать" : "смотрит страницу"}</small>
                      </span>
                      <em className={active ? "on" : ""} />
                    </button>
                  );
                })}
                <div className="lv-here-f">{hidden ? "Ваш курсор скрыт — включить можно в меню аккаунта" : "Enter у курсора — написать всем на странице"}</div>
              </div>
            </div>
            <button type="button" className="lv-here-bar" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              <span className="lv-here-ava">
                {people.slice(0, 5).map((p) => (
                  <i key={p.id} style={{ background: liveColor(p.id) }}>
                    {initials(p.name)}
                  </i>
                ))}
              </span>
              <span className="lv-here-t">
                {people.length === 1 ? shortName(people[0].name) : `${people.length} на странице`}
                {!hidden && <em> · Enter — написать</em>}
              </span>
              <svg className="lv-here-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path d="M2 6.5 5 3.5 8 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>,
          document.documentElement,
        )}
    </>
  );
}

/** Значок на подписи: звезда РОПа, щит СВ, искра грейда III, корона грейда IV — у каждого своя анимация (theme.css). */
function RankIcon({ name }: { name: NonNullable<Rank["icon"]> }) {
  return (
    <svg className={`lv-ico lv-ico-${name}`} width="11" height="11" viewBox="0 0 24 24" aria-hidden>
      {name === "crown" && (
        <>
          <path d="M3 8.5 7.5 12 12 5l4.5 7L21 8.5 19 18H5z" fill="currentColor" />
          <path d="M5 20.5h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </>
      )}
      {name === "star" && <path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor" />}
      {name === "shield" && <path d="M12 2.5 20 5.5v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10v-6z" fill="currentColor" />}
      {name === "spark" && <path d="M12 2c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7zM19 15.5c.3 1.9 1 2.6 2.9 2.9-1.9.3-2.6 1-2.9 2.9-.3-1.9-1-2.6-2.9-2.9 1.9-.3 2.6-1 2.9-2.9z" fill="currentColor" />}
    </svg>
  );
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}
