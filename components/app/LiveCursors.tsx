"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { useCrm } from "@/lib/crm/store";
import { LIVE_HIDE_EVENT, liveColor, liveHidden, openLive, type LiveLink, type LiveMsg } from "@/lib/live";
import { shortName } from "@/lib/crm/format";
import { uiZoom } from "@/components/ui/select";

/**
 * Живые курсоры коллег на той же странице (lib/live.ts — канал).
 *  • Курсор коллеги — маленькая точка его цвета с подписью имени: мельче своей «живой» точки
 *    и без кольца, чтобы не путаться.
 *  • «/» — написать короткое сообщение: оно всплывает у вашего курсора у всех на странице.
 *  • Внизу справа — кто сейчас на этой странице.
 *  • «Скрывать мой курсор» — в меню аккаунта: тогда вас не видно, а вы видите остальных.
 * Координаты — в пикселях содержимого страницы (.app-content): x — доля ширины, y — от верха,
 * поэтому курсор стоит над тем же местом у людей с разной шириной окна и прокруткой.
 */
const SEND_MS = 60; // не чаще ~16 раз в секунду
const HELLO_MS = 5000;
const STALE_MS = 15000; // нет «я здесь» дольше — человек ушёл
const IDLE_MS = 9000; // мышь не двигалась — курсор гаснет
const MSG_MS = 6000;
const MSG_MAX = 140;

type Peer = { sid: string; id: string; name: string; path: string; seen: number; x?: number; y?: number; moved?: number; msg?: string; msgAt?: number };

const sidOf = () => Math.random().toString(36).slice(2, 10);

export function LiveCursors() {
  const { me } = useCrm();
  // «/leads/» и «/leads» — одна страница (сборка со слешем на конце)
  const path = (usePathname() || "/").replace(/(.)\/$/, "$1");
  const [peers, setPeers] = useState<Record<string, Peer>>({});
  const [hidden, setHidden] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [typing, setTyping] = useState<{ x: number; y: number } | null>(null);
  const [mine, setMine] = useState<{ text: string; x: number; y: number; at: number } | null>(null);
  const [, tick] = useState(0);
  const link = useRef<LiveLink | null>(null);
  const sid = useRef(sidOf());
  const pos = useRef<{ x: number; y: number; w: number } | null>(null);
  const ready = me.id !== "__boot__";

  useEffect(() => {
    setHidden(liveHidden());
    const on = () => setHidden(liveHidden());
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
      setPeers((prev) => {
        const p = prev[m.sid];
        const now = Date.now();
        if (m.t === "hello") {
          if (m.id === me.id) return prev;
          return { ...prev, [m.sid]: { ...(p ?? { sid: m.sid }), id: m.id, name: m.name, path: m.path, seen: now, ...(p && p.path !== m.path ? { x: undefined, y: undefined } : null) } };
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
    const hello = () => l.send({ t: "hello", sid: sid.current, id: me.id, name: me.name, path });
    hello();
    const iv = window.setInterval(hello, HELLO_MS);
    const bye = () => l.send({ t: "bye", sid: sid.current });
    window.addEventListener("pagehide", bye);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener("pagehide", bye);
    };
  }, [hidden, path, me.id, me.name, ready]);

  // своя мышь → координаты содержимого страницы; не чаще SEND_MS
  useEffect(() => {
    if (!host || !ready) return;
    let last = 0;
    let timer = 0;
    let wasIn = false;
    const send = () => {
      timer = 0;
      last = Date.now();
      const p = pos.current;
      if (hidden || !link.current) return;
      if (p) link.current.send({ t: "cur", sid: sid.current, path, x: p.x / p.w, y: p.y });
      else link.current.send({ t: "out", sid: sid.current });
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const z = uiZoom();
      const r = host.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom && !(e.target instanceof Element && e.target.closest(".app-rail"));
      pos.current = inside ? { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z, w: r.width / z } : null;
      if (!inside && !wasIn) return;
      wasIn = inside;
      const wait = SEND_MS - (Date.now() - last);
      if (wait <= 0) send();
      else if (!timer) timer = window.setTimeout(send, wait);
    };
    const leave = () => {
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
      window.removeEventListener("pointermove", move);
      document.documentElement.removeEventListener("mouseleave", leave);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [host, hidden, path, ready]);

  // «/» — написать сообщение у своего курсора
  useEffect(() => {
    if (!ready) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || hidden) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, select, [contenteditable=true], .modal, [role=dialog]")) return;
      const p = pos.current;
      if (!p) return;
      e.preventDefault();
      setTyping({ x: p.x, y: p.y });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hidden, ready]);

  const sendMsg = (text: string) => {
    const v = text.trim().slice(0, MSG_MAX);
    if (v && typing && link.current) {
      link.current.send({ t: "msg", sid: sid.current, path, text: v });
      setMine({ text: v, x: typing.x, y: typing.y, at: Date.now() });
    }
    setTyping(null);
  };

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
  const people = Array.from(new Map(here.map((p) => [p.id, p])).values());
  const w = host.clientWidth;

  return (
    <>
      {createPortal(
        <div className="lv-layer" aria-hidden>
          {here.map((p) => {
            const live = p.x != null && p.y != null && now - (p.moved ?? 0) < IDLE_MS;
            const talking = p.msg && now - (p.msgAt ?? 0) < MSG_MS;
            if (!live && !talking) return null;
            if (p.x == null || p.y == null) return null;
            return (
              <div key={p.sid} className={`lv-cur${live ? "" : " idle"}`} style={{ ["--lv" as string]: liveColor(p.id), transform: `translate3d(${p.x * w}px, ${p.y}px, 0)` }}>
                <i className="lv-dot" />
                <span className="lv-name">{shortName(p.name) || "Коллега"}</span>
                {talking && <span className="lv-msg">{p.msg}</span>}
              </div>
            );
          })}
          {mine && now - mine.at < MSG_MS && (
            <div className="lv-cur me" style={{ ["--lv" as string]: "var(--brand)", transform: `translate3d(${mine.x}px, ${mine.y}px, 0)` }}>
              <span className="lv-msg">{mine.text}</span>
            </div>
          )}
        </div>,
        host,
      )}
      {typing &&
        createPortal(
          <div className="lv-type" style={{ transform: `translate3d(${typing.x}px, ${typing.y}px, 0)` }}>
            <input
              autoFocus
              maxLength={MSG_MAX}
              placeholder="Сообщение всем на странице…"
              onKeyDown={(e) => {
                if (e.key === "Enter") sendMsg(e.currentTarget.value);
                if (e.key === "Escape") setTyping(null);
              }}
              onBlur={() => setTyping(null)}
            />
            <span>Enter — отправить · Esc — отмена</span>
          </div>,
          host,
        )}
      {people.length > 0 &&
        createPortal(
          <div className="lv-here" title="Сейчас на этой странице">
            <span className="lv-here-ava">
              {people.slice(0, 5).map((p) => (
                <i key={p.id} style={{ background: liveColor(p.id) }}>
                  {initials(p.name)}
                </i>
              ))}
            </span>
            <span className="lv-here-t">
              {people.length === 1 ? shortName(people[0].name) : `${people.length} на странице`}
              {!hidden && <em> · «/» — написать</em>}
            </span>
          </div>,
          document.documentElement,
        )}
    </>
  );
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}
