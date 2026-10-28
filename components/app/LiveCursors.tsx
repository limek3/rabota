"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { gradeLevel } from "@/lib/crm/telegram";
import { LIVE_HIDE_EVENT, liveColor, liveHidden, liveOthersOff, markParty, openLive, partySeen, type LiveLink, type LiveMsg } from "@/lib/live";
import { useMonthModel } from "@/lib/crm/hooks";
import type { MonthKey } from "@/lib/crm/types";
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

/** Точка экрана → координаты содержимого страницы; мышь не над содержимым — null. */
function posIn(host: HTMLElement, m: { x: number; y: number; rail: boolean }): { x: number; y: number; w: number } | null {
  if (m.rail) return null;
  const z = uiZoom();
  const r = host.getBoundingClientRect();
  if (m.x < r.left || m.x > r.right || m.y < r.top || m.y > r.bottom) return null;
  return { x: (m.x - r.left) / z, y: (m.y - r.top) / z, w: r.width / z };
}

/** Быстрые смайлики в поле сообщения. */
const EMOJI = ["👍", "🔥", "😂", "❤️", "👀", "🎉", "✅", "🙏", "💪", "😎"];
/** Сообщение только из смайликов — показываем крупно, без пузыря. */
const EMOJI_ONLY = new RegExp("^(?:\\p{Extended_Pictographic}|\\uFE0F|\\u200D|\\s){1,12}$", "u");
const isEmoji = (s: string) => EMOJI_ONLY.test(s) && /\S/.test(s);

/** Мини-чат страницы: последние сообщения — чтобы не пропустить, если отошёл. Только в памяти вкладки. */
const NOTES_MAX = 10;
type Note = { k: string; id: string; name: string; text: string; at: number; mine?: boolean };

type Party = { key: string; kind: "g4" | "plan"; name?: string; n?: number; plan?: number; mine?: boolean };
const PARTY_MS = 5200;
const hhmm = (t: number) => new Date(t).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

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
  // план отдела на сегодня — видит только тот, кому виден весь отдел (РОП); он и объявляет праздник
  const mm = useMonthModel(today.slice(0, 7) as MonthKey);
  const tp = mm.team.pace;
  const planMet = access.viewAll && mm.cal.phase === "current" && mm.cal.isWork(today) && tp.dailyPlan > 0 && tp.today >= tp.dailyPlan;
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const follow = useRef(false);
  const [, tick] = useState(0);
  const link = useRef<LiveLink | null>(null);
  const sid = useRef(sidOf());
  const pos = useRef<{ x: number; y: number; w: number } | null>(null);
  // где мышь на экране (последнее движение); над меню слева — rail
  const mouse = useRef<{ x: number; y: number; rail: boolean } | null>(null);
  const ready = me.id !== "__boot__";

  // чужие курсоры выключены в настройках — не принимаем и не рисуем их
  const [othersOff, setOthersOff] = useState(false);
  const othersOffRef = useRef(false);

  // мини-чат: сообщения по страницам и когда список последний раз смотрели (непрочитанные — на плашке)
  const [notes, setNotes] = useState<Record<string, Note[]>>({});
  const [readAt, setReadAt] = useState<Record<string, number>>({});
  const peersRef = useRef(peers);
  peersRef.current = peers;
  const addNote = (pg: string, n: Note) => setNotes((h) => ({ ...h, [pg]: [...(h[pg] ?? []), n].slice(-NOTES_MAX) }));

  // праздник: один раз за день на каждый повод (в этом браузере)
  const [party, setParty] = useState<Party | null>(null);
  const celebrate = (p: Party) => {
    if (partySeen(p.key)) return;
    markParty(p.key, today);
    setParty(p);
  };
  const celebrateRef = useRef(celebrate);
  celebrateRef.current = celebrate;
  useEffect(() => {
    if (!party) return;
    const t = window.setTimeout(() => setParty(null), PARTY_MS);
    return () => window.clearTimeout(t);
  }, [party]);
  const announce = (p: Omit<Party, "mine">) => {
    if (partySeen(p.key)) return;
    celebrate({ ...p, mine: p.kind === "g4" });
    link.current?.send({ t: "party", sid: sid.current, ...p });
  };
  // свой Грейд IV — когда дорос до него за сессию (при открытии уже IV — не празднуем задним числом)
  const prevGrade = useRef<number | undefined>(undefined);
  useEffect(() => {
    const prev = prevGrade.current;
    prevGrade.current = myGrade;
    if (prev != null && prev < 4 && myGrade === 4) announce({ key: `g4:${me.id}:${today}`, kind: "g4", name: me.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myGrade]);
  // план отдела на день — так же, только в момент выполнения
  const prevPlan = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const prev = prevPlan.current;
    prevPlan.current = planMet;
    if (prev === false && planMet) announce({ key: `plan:${today}`, kind: "plan", n: tp.today, plan: Math.round(tp.dailyPlan) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planMet]);

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
      // праздник показываем всем, даже если чужие курсоры выключены
      if (m.t === "party") return celebrateRef.current({ key: m.key, kind: m.kind, name: m.name, n: m.n, plan: m.plan });
      if (othersOffRef.current) return;
      if (m.t === "msg") {
        const p = peersRef.current[m.sid];
        if (p) addNote(m.path, { k: `${m.sid}:${Date.now()}`, id: p.id, name: p.name, text: m.text.slice(0, MSG_MAX), at: Date.now() });
      }
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
    const measure = () => {
      frame = 0;
      if (!mouse.current) return;
      pos.current = posIn(host, mouse.current);
      const inside = !!pos.current;
      if (follow.current && pos.current) setCur({ x: pos.current.x, y: pos.current.y });
      if (!inside && !wasIn) return;
      wasIn = inside;
      const wait = SEND_MS - (Date.now() - last);
      if (wait <= 0) send();
      else if (!timer) timer = window.setTimeout(send, wait);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      mouse.current = { x: e.clientX, y: e.clientY, rail: e.target instanceof Element && !!e.target.closest(".app-rail") };
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    const leave = () => {
      mouse.current = null;
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

  // Enter — написать сообщение у своего курсора (не в поле ввода и не в открытом окне)
  useEffect(() => {
    if (!ready || !host) return;
    // ходят по кнопкам с клавиатуры (Tab, стрелки) — Enter нажимает кнопку; мышью — Enter наш.
    // Раньше смотрели «по этой ли кнопке щёлкнули»: после закрытия окна фокус сам возвращается
    // на кнопку, которая его открыла, — и Enter молча уходил ей.
    let kbNav = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab" || e.key.startsWith("Arrow")) kbNav = true;
      if (e.key !== "Enter" || e.repeat || e.defaultPrevented || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || hidden || typing) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, select, [contenteditable=true]")) return;
      if (kbNav && t?.closest(CONTROLS)) return;
      // открытое окно или меню — только видимое: спрятанные списки в разметке не мешают
      if (Array.from(document.querySelectorAll(".modal, [role=dialog], [role=menu], [role=listbox]")).some((el) => el.getClientRects().length > 0)) return;
      // где мышь — считаем прямо сейчас: после перехода на другую страницу прежней позиции уже нет
      const p = mouse.current ? posIn(host, mouse.current) : null;
      if (!p) return;
      pos.current = p;
      e.preventDefault();
      setCur({ x: p.x, y: p.y });
      setTyping(true);
    };
    const onDown = () => {
      kbNav = false;
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [hidden, ready, typing, host]);

  const sendMsg = (text: string) => {
    const v = text.trim().slice(0, MSG_MAX);
    if (v && link.current) {
      link.current.send({ t: "msg", sid: sid.current, path, text: v });
      setMine({ text: v, at: Date.now() });
      addNote(path, { k: `me:${Date.now()}`, id: me.id, name: me.name, text: v, at: Date.now(), mine: true });
    }
    setTyping(false);
  };

  // открыли список — сообщения этой страницы прочитаны
  useEffect(() => {
    if (open) setReadAt((r) => ({ ...r, [path]: Date.now() }));
  }, [open, path, notes]);

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
  const pageNotes = notes[path] ?? [];
  // непрочитанные — чужие сообщения после последнего открытия списка
  const unread = open ? 0 : pageNotes.filter((n) => !n.mine && n.at > (readAt[path] ?? 0)).length;
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
                {talking && <span className={`lv-msg${isEmoji(p.msg ?? "") ? " emo" : ""}`}>{p.msg}</span>}
              </div>
            );
          })}
          {talkingMe && !typing && cur && (
            <div className={`lv-cur me${me.role === "head" ? " r-head" : ""}`} style={{ ["--lv" as string]: "var(--brand)", transform: `translate3d(${cur.x}px, ${cur.y}px, 0)` }}>
              <span key={mine.at} className={`lv-msg${isEmoji(mine.text) ? " emo" : ""}`}>
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
              ref={inputRef}
              autoFocus
              maxLength={MSG_MAX}
              placeholder="Сообщение всем на странице…"
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMsg(e.currentTarget.value);
                if (e.key === "Escape") setTyping(false);
              }}
              onBlur={() => setTyping(false)}
            />
            {/* смайлик: поле пустое — сразу отправляем его; есть текст — вставляем в текст.
                mousedown без фокуса — иначе поле теряет фокус и закрывается */}
            <div className="lv-emo" onMouseDown={(e) => e.preventDefault()}>
              {EMOJI.map((em) => (
                <button
                  key={em}
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    const inp = inputRef.current;
                    if (!inp || !inp.value.trim()) return sendMsg(em);
                    const at = inp.selectionStart ?? inp.value.length;
                    inp.setRangeText(em, at, inp.selectionEnd ?? at, "end");
                    inp.focus();
                  }}
                >
                  {em}
                </button>
              ))}
            </div>
            <span>Enter — отправить · Esc — отмена · смайлик без текста — сразу</span>
          </div>,
          host,
        )}
      {(people.length > 0 || pageNotes.length > 0) &&
        createPortal(
          <div ref={hereRef} className={`lv-here${open ? " open" : ""}`}>
            <div className="lv-here-list" aria-hidden={!open}>
              <div className="lv-here-in">
                {pageNotes.length > 0 && (
                  <>
                    <div className="lv-here-h">Сообщения на странице</div>
                    <div className="lv-notes" ref={(el) => {
                        if (el) el.scrollTop = el.scrollHeight;
                      }}>
                      {pageNotes.map((n) => (
                        <div key={n.k} className={`lv-note${n.mine ? " mine" : ""}`}>
                          <i style={{ background: n.mine ? "var(--brand)" : liveColor(n.id) }} />
                          <div>
                            <b>
                              {n.mine ? "Вы" : shortName(n.name) || "Коллега"}
                              <time>{hhmm(n.at)}</time>
                            </b>
                            <p className={isEmoji(n.text) ? "emo" : undefined}>{n.text}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {people.length > 0 && <div className="lv-here-h">Сейчас на этой странице</div>}
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
                {people.length === 0 ? "Сообщения" : people.length === 1 ? shortName(people[0].name) : `${people.length} на странице`}
                {!hidden && <em> · Enter — написать</em>}
              </span>
              {unread > 0 && <span className="lv-unread">{unread}</span>}
              <svg className="lv-here-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                <path d="M2 6.5 5 3.5 8 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>,
          document.documentElement,
        )}
      {party && createPortal(<Confetti key={party.key} party={party} />, document.documentElement)}
    </>
  );
}

/** Конфетти на весь экран и подпись: кто взял Грейд IV или что отдел выполнил план дня. */
const CONFETTI = ["#ffc83d", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#3b82f6", "#06b6d4", "#10b981"];
function Confetti({ party }: { party: Party }) {
  const bits = useMemo(
    () =>
      Array.from({ length: 90 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.7,
        dur: 2.4 + Math.random() * 1.6,
        drift: (Math.random() - 0.5) * 160,
        spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 720),
        w: 6 + Math.random() * 6,
        round: i % 4 === 0,
        color: CONFETTI[i % CONFETTI.length],
      })),
    [],
  );
  const g4 = party.kind === "g4";
  return (
    <div className="lv-party" aria-live="polite">
      {bits.map((b, i) => (
        <i
          key={i}
          style={{
            left: `${b.left}%`,
            width: b.w,
            height: b.round ? b.w : b.w * 0.45,
            borderRadius: b.round ? "50%" : 2,
            background: b.color,
            animationDelay: `${b.delay}s`,
            animationDuration: `${b.dur}s`,
            ["--dx" as string]: `${b.drift}px`,
            ["--rot" as string]: `${b.spin}deg`,
          }}
        />
      ))}
      <div className={`lv-party-cap ${party.kind}`}>
        <span className="lv-party-ico">{g4 ? "👑" : "🎉"}</span>
        <div>
          <b>{g4 ? (party.mine ? "Вы взяли Грейд IV!" : `${shortName(party.name ?? "") || "Коллега"} — Грейд IV!`) : "Отдел выполнил план дня!"}</b>
          <span>{g4 ? "11 доведённых за день — так держать" : party.n != null && party.plan ? `${party.n} лидов при плане ${party.plan} — и день ещё не кончился` : "Спасибо всем, кто на смене"}</span>
        </div>
      </div>
    </div>
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
