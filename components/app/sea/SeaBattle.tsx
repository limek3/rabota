"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCrm } from "@/lib/crm/store";
import { nowMs } from "@/lib/crm/dates";
import { liveColor } from "@/lib/live";
import { Empty, Modal, PageHead } from "@/components/ui/kit";
import { Icon } from "@/components/ui/icons";
import { StickyHead } from "@/components/app/StickyHead";
import { initials } from "@/components/app/LiveCursors";
import { SeaBoard } from "@/components/app/sea/SeaBoard";
import { SeaSetup } from "@/components/app/sea/SeaSetup";
import {
  ACTIVE,
  CLAIM_MS,
  EMOTES,
  FLEET,
  MAX_ACTIVE,
  afloat,
  cellName,
  haloOf,
  needsMe,
  seaStore,
  sunkShips,
  viewOf,
  type Admiral,
  type Cell,
  type Player,
  type SeaChange,
  type SeaGame,
  type Ship,
} from "@/lib/sea";

/**
 * «Морской бой» (правила — lib/sea.ts). Слева — партии: где мой ход, вызовы мне, ожидание,
 * итоги; «Адмиралы» — рейтинг. Справа — выбранная партия: вызов → расстановка → бой → итог.
 * Ход сделан — можно уходить звонить: соперник ответит, когда освободится, а в меню
 * загорится значок «ваш ход».
 */

const LAST_KEY = "leadup.sea.last";
const ONLINE_MS = 10 * 60_000;

function Ava({ id, name, size = 34, emote }: { id: string; name: string; size?: number; emote?: string | null }) {
  return (
    <span className="sea-ava" style={{ width: size, height: size, background: liveColor(id), fontSize: size * 0.36 }}>
      {initials(name)}
      {emote && (
        <em key={emote} className="sea-bubble">
          {emote}
        </em>
      )}
    </span>
  );
}

const ago = (iso: string) => {
  const m = Math.round((nowMs() - Date.parse(iso)) / 60_000);
  if (m < 1) return "только что";
  if (m < 60) return `${m} мин назад`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ч назад`;
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
};

export function SeaBattle() {
  const { me, access, full, toast, confirm } = useCrm();
  const myId = access.account.id;
  const mePlayer: Player = { id: myId, name: me.name, role: me.role };

  const [games, setGames] = useState<SeaGame[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [top, setTop] = useState<Admiral[]>([]);
  const [picker, setPicker] = useState(false);

  const selRef = useRef(sel);
  selRef.current = sel;
  const gamesRef = useRef(games);
  gamesRef.current = games;

  const put = useCallback((g: SeaGame) => setGames((prev) => (prev.some((x) => x.id === g.id) ? prev.map((x) => (x.id === g.id ? g : x)) : [g, ...prev])), []);

  const loadTop = useCallback(() => {
    seaStore.top().then(setTop, () => setTop([]));
  }, []);

  useEffect(() => {
    let off = false;
    seaStore.games(myId).then(
      (r) => {
        if (off) return;
        setGames(r);
        setLoading(false);
        // открыть: последнюю выбранную, иначе ту, где ждут меня
        let last: string | null = null;
        try {
          last = localStorage.getItem(LAST_KEY);
        } catch {
          /* нет — выберем сами */
        }
        const pick = r.find((g) => g.id === last && ACTIVE.includes(g.status)) ?? r.find((g) => needsMe(g, myId)) ?? r.find((g) => ACTIVE.includes(g.status));
        if (pick) setSel(pick.id);
      },
      (e) => {
        if (off) return;
        setErr(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
    loadTop();
    const unsub = seaStore.subscribe(myId, (c: SeaChange) => {
      const g = c.g;
      if (g.aId !== myId && g.bId !== myId) return;
      const old = gamesRef.current.find((x) => x.id === g.id);
      // зовём, только если партия ждала соперника, а теперь ждёт меня — и она не открыта
      if (needsMe(g, myId) && (!old || !needsMe(old, myId)) && g.id !== selRef.current) {
        const v = viewOf(g, myId);
        toast(g.status === "invite" ? `${v.otherName} вызывает вас на морской бой` : `Ваш ход в партии с ${v.otherName}`, "ok", { label: "Открыть", run: () => setSel(g.id) });
      }
      put(g);
    });
    return () => {
      off = true;
      unsub();
    };
  }, [myId, toast, loadTop, put]);

  useEffect(() => {
    if (!sel) return;
    try {
      localStorage.setItem(LAST_KEY, sel);
    } catch {
      /* не запомнили — в следующий раз выберем сами */
    }
  }, [sel]);

  const act = useCallback(
    async (fn: () => Promise<SeaGame>, after?: (g: SeaGame) => void) => {
      setBusy(true);
      try {
        const g = await fn();
        put(g);
        after?.(g);
        return g;
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "err");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [put, toast],
  );

  const game = games.find((g) => g.id === sel) ?? null;

  // партия закончилась (у меня или у соперника) — «Адмиралы» пересчитываются
  const finished = games.filter((g) => g.status === "done").length;
  useEffect(() => {
    if (finished) loadTop();
  }, [finished, loadTop]);

  /* ── списки ── */
  const lists = useMemo(() => {
    const mine = games.filter((g) => g.aId === myId || g.bId === myId);
    return {
      turn: mine.filter((g) => needsMe(g, myId)),
      wait: mine.filter((g) => ACTIVE.includes(g.status) && !needsMe(g, myId)),
      done: mine.filter((g) => g.status === "done").slice(0, 8),
    };
  }, [games, myId]);
  const activeCount = lists.turn.length + lists.wait.length;

  const challenge = async (p: Player) => {
    setPicker(false);
    await act(() => seaStore.invite(p, mePlayer), (g) => setSel(g.id));
  };

  return (
    <div className="stack">
      <StickyHead title="Морской бой" />
      <PageHead
        title="Морской бой"
        sub="Один на один, ходами: выстрелил — и можно звонить дальше, соперник ответит, когда освободится"
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setPicker(true)} disabled={activeCount >= MAX_ACTIVE}>
            <Icon name="plus" size={14} /> Вызвать коллегу
          </button>
        }
      />

      <div className="sea-wrap">
        <aside className="sea-side">
          <section className="card sea-list">
            {loading && <div className="sea-list-empty">Загружаем партии…</div>}
            {err && <div className="sea-list-empty sea-err">Не загрузилось: {err}</div>}
            {!loading && !err && !games.length && (
              <div className="sea-list-empty">
                <span>⚓</span>
                Партий пока нет — вызовите коллегу
              </div>
            )}
            {lists.turn.length > 0 && <GameGroup title="Ждут вас" hot games={lists.turn} me={myId} sel={sel} onSel={setSel} />}
            {lists.wait.length > 0 && <GameGroup title="Ждём соперника" games={lists.wait} me={myId} sel={sel} onSel={setSel} />}
            {lists.done.length > 0 && <GameGroup title="Сыграно" games={lists.done} me={myId} sel={sel} onSel={setSel} />}
          </section>

          <section className="card sea-top">
            <h3 className="d2-h">
              <span aria-hidden>🏆</span> Адмиралы
            </h3>
            {top.length ? (
              <ol>
                {top.slice(0, 10).map((a, i) => (
                  <li key={a.id} data-me={a.id === myId ? "" : undefined}>
                    <span className="sea-top-r num">{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
                    <span className="sea-top-n">{a.name}</span>
                    <b className="num">{a.wins}</b>
                    <small className="num">/ {a.games}</small>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="sea-top-empty">Первая победа — и вы здесь</p>
            )}
          </section>
        </aside>

        <section className="card sea-main">
          {game ? (
            <GameView key={game.id} g={game} me={myId} myName={me.name} busy={busy} act={act} confirm={confirm} onRematch={(p) => void challenge(p)} />
          ) : (
            <Hero onStart={() => setPicker(true)} />
          )}
        </section>
      </div>

      {picker && <PlayerPicker me={myId} localPlayers={full.accounts.filter((a) => a.active && !a.deletedAt).map((a) => ({ id: a.id, name: a.name, role: a.role, seen: a.lastSeenAt }))} games={games} onPick={(p) => void challenge(p)} onClose={() => setPicker(false)} />}
    </div>
  );
}

/* ── список партий ── */

function statusLine(g: SeaGame, me: string): { text: string; tone?: "hot" | "win" | "lose" } {
  const v = viewOf(g, me);
  switch (g.status) {
    case "invite":
      return g.bId === me ? { text: "Вызывает вас!", tone: "hot" } : { text: "Ждём ответа" };
    case "setup":
      return v.myReady ? { text: "Соперник расставляет флот" } : { text: "Расставьте флот", tone: "hot" };
    case "play":
      return v.myTurn ? { text: "Ваш ход!", tone: "hot" } : { text: "Ходит соперник" };
    case "done":
      return g.winner === me
        ? { text: g.endedBy === "win" ? "Победа" : g.endedBy === "resign" ? "Победа — соперник сдался" : "Победа — соперник пропал", tone: "win" }
        : { text: g.endedBy === "win" ? "Поражение" : g.endedBy === "resign" ? "Вы сдались" : "Поражение по времени", tone: "lose" };
    case "declined":
      return { text: "Вызов отклонён" };
    default:
      return { text: "Вызов отменён" };
  }
}

function GameGroup({ title, games, me, sel, onSel, hot }: { title: string; games: SeaGame[]; me: string; sel: string | null; onSel: (id: string) => void; hot?: boolean }) {
  return (
    <div className="sea-group" data-hot={hot ? "" : undefined}>
      <div className="sea-group-h">
        {title} <span className="num">{games.length}</span>
      </div>
      {games.map((g) => {
        const v = viewOf(g, me);
        const st = statusLine(g, me);
        return (
          <button key={g.id} type="button" className="sea-row" data-on={g.id === sel ? "" : undefined} onClick={() => onSel(g.id)}>
            <Ava id={v.otherId} name={v.otherName} size={30} />
            <span className="sea-row-t">
              <b>{v.otherName || "Коллега"}</b>
              <small data-tone={st.tone}>
                {st.tone === "hot" && <i className="sea-dot" />}
                {st.text}
              </small>
            </span>
            {g.status === "play" && (
              <span className="sea-row-score num" title="Кораблей на плаву: ваших : соперника">
                {afloat(v.theirShots).length}:{afloat(v.myShots).length}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ── первая страница: пока партия не выбрана ── */

function Hero({ onStart }: { onStart: () => void }) {
  return (
    <div className="sea-hero">
      <div className="sea-hero-art" aria-hidden>
        <div className="sea-hero-sun" />
        <div className="sea-hero-boat">
          <i />
        </div>
        <div className="sea-hero-wave" />
        <div className="sea-hero-wave sea-hero-wave2" />
      </div>
      <h2>Морской бой</h2>
      <p>Вызовите коллегу, расставьте флот и топите корабли по очереди. Партия идёт в своём темпе — сделали ход и вернулись к звонкам.</p>
      <ul>
        <li>
          <b>Флот:</b> линкор, 2 крейсера, 3 эсминца, 4 катера — корабли не касаются даже углами
        </li>
        <li>
          <b>Попал</b> — стреляете ещё, <b>мимо</b> — ход сопернику
        </li>
        <li>
          Соперник молчит больше суток в свой ход — победу можно забрать
        </li>
      </ul>
      <button type="button" className="btn btn-primary" onClick={onStart}>
        <Icon name="plus" size={14} /> Вызвать коллегу
      </button>
    </div>
  );
}

/* ── выбор соперника ── */

function PlayerPicker({
  me,
  localPlayers,
  games,
  onPick,
  onClose,
}: {
  me: string;
  localPlayers: Player[];
  games: SeaGame[];
  onPick: (p: Player) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<Player[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    seaStore.players(me, localPlayers).then(setList, (e) => setErr(e instanceof Error ? e.message : String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);
  const busyWith = new Set(games.filter((g) => ACTIVE.includes(g.status)).map((g) => viewOf(g, me).otherId));
  const shown = (list ?? [])
    .filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => Number(isOnline(b)) - Number(isOnline(a)) || a.name.localeCompare(b.name, "ru"));
  return (
    <Modal title="Кого вызвать на бой?" onClose={onClose} width={460}>
      <div className="sea-pick">
        <div className="sea-pick-search">
          <Icon name="search" size={14} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Имя коллеги" />
        </div>
        {err && <div className="sea-list-empty sea-err">Не загрузилось: {err}</div>}
        {!list && !err && <div className="sea-list-empty">Загружаем…</div>}
        <div className="sea-pick-list">
          {shown.map((p) => (
            <button key={p.id} type="button" className="sea-pick-row" disabled={busyWith.has(p.id)} onClick={() => onPick(p)}>
              <Ava id={p.id} name={p.name} size={32} />
              <span className="sea-row-t">
                <b>{p.name}</b>
                <small>
                  {busyWith.has(p.id) ? "уже играете" : isOnline(p) ? <><i className="sea-dot sea-dot-on" /> в CRM сейчас</> : p.seen ? `был ${ago(p.seen)}` : p.role === "head" ? "РОП" : p.role === "supervisor" ? "Супервайзер" : "Оператор"}
                </small>
              </span>
              {!busyWith.has(p.id) && <span className="sea-pick-go">⚔ Вызвать</span>}
            </button>
          ))}
          {list && !shown.length && <div className="sea-list-empty">Никого не нашли</div>}
        </div>
      </div>
    </Modal>
  );
}

const isOnline = (p: Player) => !!p.seen && nowMs() - Date.parse(p.seen) < ONLINE_MS;

/* ── партия ── */

function GameView({
  g,
  me,
  busy,
  act,
  confirm,
  onRematch,
  myName,
}: {
  g: SeaGame;
  me: string;
  busy: boolean;
  act: (fn: () => Promise<SeaGame>, after?: (g: SeaGame) => void) => Promise<SeaGame | null>;
  confirm: (o: { title: string; text?: string; ok?: string; danger?: boolean }) => Promise<boolean>;
  onRematch: (p: Player) => void;
  myName: string;
}) {
  const v = viewOf(g, me);
  const [fleet, setFleet] = useState<Ship[] | null>(null);
  const [revealed, setRevealed] = useState<Ship[] | null>(null);
  const [pending, setPending] = useState<Cell | null>(null);
  const [aim, setAim] = useState<Cell | null>(null);

  // своя расстановка — когда она есть; флот соперника — после партии
  useEffect(() => {
    if (!v.myReady) return;
    seaStore.fleet(g.id, me).then(setFleet, () => setFleet(null));
  }, [g.id, me, v.myReady]);
  useEffect(() => {
    if (g.status !== "done" || !v.otherReady) return;
    seaStore.reveal(g.id, me).then(setRevealed, () => setRevealed(null));
  }, [g.id, g.status, me, v.otherReady]);

  // эмоции: показываем пузырь у того, кто отправил, пару секунд
  const [bubble, setBubble] = useState<{ by: string; e: string } | null>(null);
  const seenEmote = useRef(g.emoteAt);
  useEffect(() => {
    if (!g.emoteAt || g.emoteAt === seenEmote.current) return;
    seenEmote.current = g.emoteAt;
    if (nowMs() - Date.parse(g.emoteAt) > 15_000) return;
    setBubble({ by: g.emoteBy ?? "", e: g.emote ?? "" });
    const t = setTimeout(() => setBubble(null), 3200);
    return () => clearTimeout(t);
  }, [g.emoteAt, g.emoteBy, g.emote]);

  const fire = async (x: number, y: number) => {
    if (!v.myTurn || busy || pending) return;
    setPending([x, y]);
    await act(() => seaStore.fire(g.id, x, y, me));
    setPending(null);
  };

  const mySunk = useMemo(() => sunkShips(v.myShots), [v.myShots]);
  const myHalo = useMemo(() => haloOf(mySunk), [mySunk]);
  const theirHalo = useMemo(() => haloOf(sunkShips(v.theirShots)), [v.theirShots]);
  const enemyLeft = afloat(v.myShots);
  const myLeft = afloat(v.theirShots);
  const lastMine = v.myShots[v.myShots.length - 1];
  const lastTheirs = v.theirShots[v.theirShots.length - 1];
  const stale = nowMs() - Date.parse(g.movedAt) > CLAIM_MS;
  const canClaim = stale && ((g.status === "play" && !v.myTurn) || (g.status === "setup" && v.myReady && !v.otherReady));
  const won = g.status === "done" && g.winner === me;
  // открытые после партии корабли соперника, которые он так и не потерял
  const ghosts = useMemo(() => {
    if (!revealed) return [];
    const hit = new Set(mySunk.flat().map((c) => `${c[0]},${c[1]}`));
    return revealed.filter((s) => !s.every((c) => hit.has(`${c[0]},${c[1]}`)));
  }, [revealed, mySunk]);

  const header = (
    <div className="sea-vs">
      <div className="sea-vs-p">
        <Ava id={me} name={myName} size={38} emote={bubble?.by === me ? bubble.e : null} />
        <span>
          <b>Вы</b>
          {(g.status === "play" || g.status === "done") && <small className="num">на плаву {myLeft.length} из {FLEET.length}</small>}
        </span>
      </div>
      <div className="sea-vs-x">VS</div>
      <div className="sea-vs-p sea-vs-p2">
        <span>
          <b>{v.otherName || "Коллега"}</b>
          {(g.status === "play" || g.status === "done") && <small className="num">на плаву {enemyLeft.length} из {FLEET.length}</small>}
        </span>
        <Ava id={v.otherId} name={v.otherName} size={38} emote={bubble?.by === v.otherId ? bubble.e : null} />
      </div>
    </div>
  );

  /* вызов */
  if (g.status === "invite" || g.status === "declined" || g.status === "cancelled") {
    return (
      <div className="sea-game">
        {header}
        <div className="sea-invite">
          <div className="sea-invite-ic">⚔️</div>
          {g.status === "invite" && g.bId === me && (
            <>
              <h3>{v.otherName} вызывает вас на морской бой</h3>
              <p>Примете — расставите флот, и начнём. Партия идёт в своём темпе.</p>
              <div className="sea-invite-a">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act(() => seaStore.answer(g.id, true, me))}>
                  Принять бой
                </button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(() => seaStore.answer(g.id, false, me))}>
                  Не сейчас
                </button>
              </div>
            </>
          )}
          {g.status === "invite" && g.aId === me && (
            <>
              <h3>Ждём ответа от {v.otherName}</h3>
              <p>Как только примет вызов — расставляйте флот. Мы покажем, когда пора.</p>
              <div className="sea-invite-a">
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(() => seaStore.leave(g.id, me))}>
                  Отменить вызов
                </button>
              </div>
            </>
          )}
          {g.status !== "invite" && (
            <>
              <h3>{g.status === "declined" ? "Вызов отклонён" : "Вызов отменён"}</h3>
              <p>Можно вызвать снова — или найти другого соперника.</p>
              <div className="sea-invite-a">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onRematch({ id: v.otherId, name: v.otherName, role: "operator" })}>
                  Вызвать ещё раз
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  /* расстановка */
  if (g.status === "setup") {
    return (
      <div className="sea-game">
        {header}
        {!v.myReady ? (
          <>
            <div className="sea-banner" data-tone="hot">
              ⚓ Расставьте флот — {v.otherReady ? `${v.otherName} уже готов!` : `${v.otherName} тоже расставляет`}
            </div>
            <SeaSetup busy={busy} onReady={(f) => void act(() => seaStore.place(g.id, f, me))} />
          </>
        ) : (
          <>
            <div className="sea-banner">⏳ Флот на позициях. Ждём, пока {v.otherName} расставит свой — можно идти звонить</div>
            <div className="sea-boards sea-boards-one">
              <div className="sea-board-wrap">
                <div className="sea-board-h">Мой флот</div>
                <SeaBoard ships={fleet ?? []} label="Мой флот" />
              </div>
            </div>
          </>
        )}
        <GameFoot g={g} me={me} busy={busy} act={act} confirm={confirm} canClaim={canClaim} />
      </div>
    );
  }

  /* бой и итог */
  return (
    <div className="sea-game">
      {header}
      {g.status === "play" && (
        <div className="sea-banner" data-tone={v.myTurn ? "hot" : undefined}>
          {v.myTurn ? (
            <>🎯 Ваш ход — стреляйте по полю соперника{aim ? <span className="sea-aim num"> · {cellName(aim[0], aim[1])}</span> : null}</>
          ) : (
            <>⏳ Ходит {v.otherName} — можно идти звонить, позовём, когда будет ваш ход</>
          )}
        </div>
      )}
      {g.status === "done" && (
        <div className="sea-result" data-won={won ? "" : undefined}>
          {won && (
            <div className="sea-confetti" aria-hidden>
              {Array.from({ length: 28 }, (_, i) => (
                <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 0.12}s`, background: ["#f59e0b", "#3b82f6", "#ef4444", "#10b981", "#a855f7", "#ec4899"][i % 6] }} />
              ))}
            </div>
          )}
          <div className="sea-result-ic">{won ? "🏆" : "🌊"}</div>
          <div className="sea-result-t">
            <b>{won ? "Победа!" : "Поражение"}</b>
            <span>
              {won
                ? g.endedBy === "win"
                  ? `Весь флот соперника на дне. ${v.otherName} повержен!`
                  : g.endedBy === "resign"
                    ? `${v.otherName} сдался`
                    : `${v.otherName} пропал больше чем на сутки`
                : g.endedBy === "win"
                  ? `${v.otherName} потопил ваш флот. Реванш?`
                  : g.endedBy === "resign"
                    ? "Вы сдались"
                    : "Вы не отвечали больше суток"}
            </span>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => onRematch({ id: v.otherId, name: v.otherName, role: "operator" })}>
            ⚔ Реванш
          </button>
        </div>
      )}

      <div className="sea-boards">
        <div className="sea-board-wrap" data-target={v.myTurn ? "" : undefined}>
          <div className="sea-board-h">
            Поле соперника
            <FleetLeft left={enemyLeft} />
          </div>
          <SeaBoard
            shots={v.myShots}
            wrecks={mySunk}
            ghosts={ghosts}
            halo={myHalo}
            aim={v.myTurn && !pending}
            dim={g.status === "play" && !v.myTurn}
            pending={pending}
            last={lastMine ? [lastMine[0], lastMine[1]] : null}
            onCell={v.myTurn ? (x, y) => void fire(x, y) : undefined}
            onHover={setAim}
            label="Поле соперника"
          />
        </div>
        <div className="sea-board-wrap sea-board-mine">
          <div className="sea-board-h">
            Мой флот
            <FleetLeft left={myLeft} />
          </div>
          <SeaBoard ships={fleet ?? []} shots={v.theirShots} halo={theirHalo} last={lastTheirs ? [lastTheirs[0], lastTheirs[1]] : null} size="sm" label="Мой флот" />
        </div>
      </div>

      <div className="sea-emotes">
        {EMOTES.map((e) => (
          <button key={e} type="button" onClick={() => void act(() => seaStore.emote(g.id, e, me))} title="Отправить сопернику">
            {e}
          </button>
        ))}
      </div>
      <GameFoot g={g} me={me} busy={busy} act={act} confirm={confirm} canClaim={canClaim} />
    </div>
  );
}

/** Сколько кораблей соперника на плаву: силуэты по размерам, потопленные — зачёркнуты. */
function FleetLeft({ left }: { left: number[] }) {
  const all = FLEET.slice();
  const alive = left.slice();
  return (
    <span className="sea-fleet" title={`На плаву ${left.length} из ${FLEET.length}`}>
      {all.map((len, i) => {
        const j = alive.indexOf(len);
        const ok = j >= 0;
        if (ok) alive.splice(j, 1);
        return (
          <i key={i} data-len={len} data-sunk={ok ? undefined : ""}>
            {Array.from({ length: len }, (_, n) => (
              <b key={n} />
            ))}
          </i>
        );
      })}
    </span>
  );
}

function GameFoot({
  g,
  me,
  busy,
  act,
  confirm,
  canClaim,
}: {
  g: SeaGame;
  me: string;
  busy: boolean;
  act: (fn: () => Promise<SeaGame>) => Promise<SeaGame | null>;
  confirm: (o: { title: string; text?: string; ok?: string; danger?: boolean }) => Promise<boolean>;
  canClaim: boolean;
}) {
  if (g.status !== "setup" && g.status !== "play") return null;
  return (
    <div className="sea-foot">
      <small>Последний ход {ago(g.movedAt)}</small>
      {canClaim && (
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void act(() => seaStore.claim(g.id, me))}>
          🏁 Забрать победу
        </button>
      )}
      <button
        type="button"
        className="btn btn-ghost sea-resign"
        disabled={busy}
        onClick={async () => {
          if (await confirm({ title: "Сдаться?", text: "Победа достанется сопернику, партия закончится.", ok: "Сдаться", danger: true })) await act(() => seaStore.leave(g.id, me));
        }}
      >
        🏳 Сдаться
      </button>
    </div>
  );
}
