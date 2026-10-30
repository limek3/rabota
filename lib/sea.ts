"use client";

import { supabase, supabaseReady } from "@/lib/supabase";
import { nowMs } from "@/lib/crm/dates";

/**
 * «Морской бой» — партии один на один, ходами. Поле 10×10, флот 4-3-3-2-2-2-1-1-1-1,
 * корабли не касаются даже углами. Попал — ходишь ещё, промах — ход сопернику.
 * Партия: invite (вызов) → setup (расстановка) → play (бой) → done; или declined / cancelled.
 *
 * С Supabase — таблицы sea_games (открытая часть: выстрелы, чей ход, итог) и sea_fleets
 * (расстановка, каждый видит только свою), правила проверяет база — crm_sea_* в
 * supabase/migrations/…_sea_battle.sql. Без Supabase — localStorage этого браузера: в
 * режиме для тестов за соперника играешь, переключив аккаунт.
 */

export const N = 10;
export const FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
export const COLS = ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З", "И", "К"];
export const EMOTES = ["👍", "😎", "😱", "🔥", "😂", "🎯", "💀", "🤝", "🙏", "👋"];
export const MAX_ACTIVE = 5;
export const CLAIM_MS = 24 * 3600_000;

export type Cell = [number, number];
/** [x, y, r]: r 0 — мимо, 1 — попал, 2 — корабль потоплен. */
export type Shot = [number, number, 0 | 1 | 2];
export type Ship = Cell[];
export type Status = "invite" | "setup" | "play" | "done" | "declined" | "cancelled";

export interface SeaGame {
  id: string;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  status: Status;
  aReady: boolean;
  bReady: boolean;
  aShots: Shot[];
  bShots: Shot[];
  turn: string | null;
  winner: string | null;
  endedBy: "win" | "resign" | "timeout" | null;
  emote: string | null;
  emoteBy: string | null;
  emoteAt: string | null;
  createdAt: string;
  updatedAt: string;
  movedAt: string;
}

export interface Player {
  id: string;
  name: string;
  role: "head" | "supervisor" | "operator";
  seen?: string | null;
}

export interface Admiral {
  id: string;
  name: string;
  wins: number;
  games: number;
}

/* ── взгляд одного игрока на партию ── */

export interface View {
  meA: boolean;
  otherId: string;
  otherName: string;
  myReady: boolean;
  otherReady: boolean;
  /** Куда стрелял я (по флоту соперника). */
  myShots: Shot[];
  /** Куда стрелял соперник (по моему флоту). */
  theirShots: Shot[];
  myTurn: boolean;
}

export function viewOf(g: SeaGame, me: string): View {
  const meA = g.aId === me;
  return {
    meA,
    otherId: meA ? g.bId : g.aId,
    otherName: meA ? g.bName : g.aName,
    myReady: meA ? g.aReady : g.bReady,
    otherReady: meA ? g.bReady : g.aReady,
    myShots: meA ? g.aShots : g.bShots,
    theirShots: meA ? g.bShots : g.aShots,
    myTurn: g.status === "play" && g.turn === me,
  };
}

export const ACTIVE: Status[] = ["invite", "setup", "play"];

/** Ждёт ли партия моего действия: мой ход, вызов мне, или пора расставить флот. */
export function needsMe(g: SeaGame, me: string): boolean {
  const v = viewOf(g, me);
  if (g.status === "play") return v.myTurn;
  if (g.status === "invite") return g.bId === me;
  if (g.status === "setup") return !v.myReady;
  return false;
}

/* ── правила ── */

const key = (x: number, y: number) => y * N + x;

/** Клетки корабля: от (x, y) вправо (h) или вниз. */
export function shipCells(x: number, y: number, len: number, horizontal: boolean): Ship {
  return Array.from({ length: len }, (_, i) => (horizontal ? [x + i, y] : [x, y + i]) as Cell);
}

/** Можно ли поставить корабль к уже стоящим: в поле, не пересекается и не касается. */
export function canPlace(ship: Ship, fleet: Ship[]): boolean {
  if (ship.some(([x, y]) => x < 0 || y < 0 || x >= N || y >= N)) return false;
  for (const other of fleet) for (const [ox, oy] of other) for (const [x, y] of ship) if (Math.abs(ox - x) <= 1 && Math.abs(oy - y) <= 1) return false;
  return true;
}

/** Флот по правилам — та же проверка, что crm_sea_fleet_ok. */
export function fleetOk(fleet: Ship[]): boolean {
  if (fleet.length !== FLEET.length) return false;
  const sizes = fleet.map((s) => s.length).sort((a, b) => b - a);
  if (sizes.join() !== FLEET.join()) return false;
  for (const s of fleet) {
    const xs = new Set(s.map((c) => c[0]));
    const ys = new Set(s.map((c) => c[1]));
    const line = xs.size === 1 ? s.map((c) => c[1]) : ys.size === 1 ? s.map((c) => c[0]) : null;
    if (!line || new Set(line).size !== s.length || Math.max(...line) - Math.min(...line) + 1 !== s.length) return false;
  }
  for (let i = 0; i < fleet.length; i++) {
    if (!canPlace(fleet[i], [])) return false;
    if (!canPlace(fleet[i], fleet.filter((_, j) => j !== i))) return false;
  }
  return true;
}

/** Случайная расстановка всего флота (или дополнить уже стоящие корабли). */
export function randomFleet(keep: Ship[] = []): Ship[] {
  for (let attempt = 0; attempt < 200; attempt++) {
    const fleet = keep.map((s) => s.slice());
    const need = FLEET.slice();
    for (const s of keep) need.splice(need.indexOf(s.length), 1);
    let ok = true;
    for (const len of need) {
      let placed = false;
      for (let t = 0; t < 300 && !placed; t++) {
        const h = Math.random() < 0.5;
        const x = Math.floor(Math.random() * (h ? N - len + 1 : N));
        const y = Math.floor(Math.random() * (h ? N : N - len + 1));
        const s = shipCells(x, y, len, h);
        if (canPlace(s, fleet)) {
          fleet.push(s);
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return fleet;
  }
  return keep;
}

/** Потопленные корабли по выстрелам (r = 2) — клетки, собранные в корабли. */
export function sunkShips(shots: Shot[]): Ship[] {
  const left = new Set(shots.filter((s) => s[2] === 2).map((s) => key(s[0], s[1])));
  const out: Ship[] = [];
  for (const k of Array.from(left)) {
    if (!left.has(k)) continue;
    const ship: Ship = [];
    const stack = [k];
    left.delete(k);
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % N;
      const y = Math.floor(c / N);
      ship.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const nk = key(nx, ny);
        if (nx >= 0 && ny >= 0 && nx < N && ny < N && left.has(nk)) {
          left.delete(nk);
          stack.push(nk);
        }
      }
    }
    out.push(ship.sort((a, b) => a[0] - b[0] || a[1] - b[1]));
  }
  return out;
}

/** Клетки вокруг потопленных кораблей — там точно пусто. */
export function haloOf(ships: Ship[]): Set<number> {
  const out = new Set<number>();
  for (const s of ships)
    for (const [x, y] of s)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < N && ny < N) out.add(key(nx, ny));
        }
  for (const s of ships) for (const [x, y] of s) out.delete(key(x, y));
  return out;
}

/** Сколько кораблей каждого размера ещё на плаву у соперника. */
export function afloat(shots: Shot[]): number[] {
  const left = FLEET.slice();
  for (const s of sunkShips(shots)) {
    const i = left.indexOf(s.length);
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

/** Выстрел по флоту: результат и новый список выстрелов — как crm_sea_fire. */
export function resolveShot(shots: Shot[], fleet: Ship[], x: number, y: number): { shots: Shot[]; hit: boolean; sunk: boolean; won: boolean } {
  const ship = fleet.find((s) => s.some((c) => c[0] === x && c[1] === y));
  let next: Shot[] = [...shots, [x, y, ship ? 1 : 0]];
  let sunk = false;
  if (ship) {
    const hits = new Set(next.filter((s) => s[2] > 0).map((s) => key(s[0], s[1])));
    sunk = ship.every((c) => hits.has(key(c[0], c[1])));
    if (sunk) {
      const cells = new Set(ship.map((c) => key(c[0], c[1])));
      next = next.map((s) => (cells.has(key(s[0], s[1])) ? [s[0], s[1], 2] : s));
    }
  }
  const won = next.filter((s) => s[2] > 0).length >= FLEET.reduce((a, b) => a + b, 0);
  return { shots: next, hit: !!ship, sunk, won };
}

export const cellName = (x: number, y: number) => `${COLS[x]}${y + 1}`;

/* ── хранилище ── */

export type SeaChange = { type: "put"; g: SeaGame };

export interface SeaStore {
  games: (me: string) => Promise<SeaGame[]>;
  fleet: (gameId: string, me: string) => Promise<Ship[] | null>;
  reveal: (gameId: string, me: string) => Promise<Ship[] | null>;
  players: (me: string, local: Player[]) => Promise<Player[]>;
  top: () => Promise<Admiral[]>;
  invite: (to: Player, me: Player) => Promise<SeaGame>;
  answer: (id: string, accept: boolean, me: string) => Promise<SeaGame>;
  leave: (id: string, me: string) => Promise<SeaGame>;
  claim: (id: string, me: string) => Promise<SeaGame>;
  place: (id: string, fleet: Ship[], me: string) => Promise<SeaGame>;
  fire: (id: string, x: number, y: number, me: string) => Promise<SeaGame>;
  emote: (id: string, emote: string, me: string) => Promise<SeaGame>;
  subscribe: (me: string, on: (c: SeaChange) => void) => () => void;
}

function fromRow(r: Record<string, unknown>): SeaGame {
  return {
    id: String(r.id),
    aId: String(r.a_id),
    bId: String(r.b_id),
    aName: String(r.a_name ?? ""),
    bName: String(r.b_name ?? ""),
    status: r.status as Status,
    aReady: !!r.a_ready,
    bReady: !!r.b_ready,
    aShots: (r.a_shots as Shot[]) ?? [],
    bShots: (r.b_shots as Shot[]) ?? [],
    turn: (r.turn as string | null) ?? null,
    winner: (r.winner as string | null) ?? null,
    endedBy: (r.ended_by as SeaGame["endedBy"]) ?? null,
    emote: (r.emote as string | null) ?? null,
    emoteBy: (r.emote_by as string | null) ?? null,
    emoteAt: (r.emote_at as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    movedAt: String(r.moved_at),
  };
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const remoteStore: SeaStore = {
  async games() {
    // незаконченные — все, законченные — последние 30
    const [act, fin] = await Promise.all([
      supabase().from("sea_games").select("*").in("status", ACTIVE).order("updated_at", { ascending: false }),
      supabase().from("sea_games").select("*").not("status", "in", `(${ACTIVE.join(",")})`).order("updated_at", { ascending: false }).limit(30),
    ]);
    if (act.error) throw new Error(act.error.message);
    if (fin.error) throw new Error(fin.error.message);
    return [...(act.data ?? []), ...(fin.data ?? [])].map(fromRow);
  },
  async fleet(gameId) {
    const { data, error } = await supabase().from("sea_fleets").select("cells").eq("game_id", Number(gameId)).maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.cells as Ship[] | undefined) ?? null;
  },
  async reveal(gameId) {
    return (await rpc<Ship[] | null>("crm_sea_reveal", { p_id: Number(gameId) })) ?? null;
  },
  async players() {
    const rows = await rpc<{ id: string; name: string; role: Player["role"]; seen: string | null }[]>("crm_sea_players", {});
    return (rows ?? []).map((r) => ({ id: r.id, name: r.name, role: r.role, seen: r.seen }));
  },
  async top() {
    return ((await rpc<Admiral[]>("crm_sea_top", {})) ?? []).map((r) => ({ ...r, wins: Number(r.wins), games: Number(r.games) }));
  },
  invite: async (to) => fromRow(await rpc("crm_sea_invite", { p_to: to.id })),
  answer: async (id, accept) => fromRow(await rpc("crm_sea_answer", { p_id: Number(id), p_accept: accept })),
  leave: async (id) => fromRow(await rpc("crm_sea_leave", { p_id: Number(id) })),
  claim: async (id) => fromRow(await rpc("crm_sea_claim", { p_id: Number(id) })),
  place: async (id, fleet) => fromRow(await rpc("crm_sea_place", { p_id: Number(id), p_cells: fleet })),
  fire: async (id, x, y) => fromRow(await rpc("crm_sea_fire", { p_id: Number(id), p_x: x, p_y: y })),
  emote: async (id, emote) => fromRow(await rpc("crm_sea_emote", { p_id: Number(id), p_emote: emote })),
  subscribe(me, on) {
    // имя канала — своё у каждой подписки: значок в меню и страница слушают одно и то же,
    // а с одинаковым именем Supabase отдаёт уже подписанный канал, и вторая подписка падает
    const ch = supabase().channel(`sea-${me}-${Math.random().toString(36).slice(2, 8)}`);
    ch.on("postgres_changes", { event: "*", schema: "public", table: "sea_games" }, (p) => {
      if (p.eventType !== "DELETE") on({ type: "put", g: fromRow(p.new as Record<string, unknown>) });
    });
    ch.subscribe();
    return () => void supabase().removeChannel(ch);
  },
};

/* без Supabase: партии и расстановки — в localStorage, вкладки синхронизирует BroadcastChannel */
const LS_GAMES = "leadup.sea.games";
const LS_FLEETS = "leadup.sea.fleets";
const BC = "leadup-sea";

function lsGet<T>(k: string, d: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(k) || "null");
    return (v ?? d) as T;
  } catch {
    return d;
  }
}
function lsSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    throw new Error("Не получилось сохранить партию в этом браузере");
  }
}
const nowIso = () => new Date(nowMs()).toISOString();

function save(g: SeaGame): SeaGame {
  const all = lsGet<SeaGame[]>(LS_GAMES, []);
  lsSet(LS_GAMES, all.some((x) => x.id === g.id) ? all.map((x) => (x.id === g.id ? g : x)) : [...all, g]);
  try {
    const bc = new BroadcastChannel(BC);
    bc.postMessage({ type: "put", g } satisfies SeaChange);
    bc.close();
  } catch {
    /* соседние вкладки увидят после перезагрузки */
  }
  return g;
}

function mine(id: string, me: string): SeaGame {
  const g = lsGet<SeaGame[]>(LS_GAMES, []).find((x) => x.id === id);
  if (!g || (g.aId !== me && g.bId !== me)) throw new Error("Партия не найдена");
  return g;
}

const fleetKey = (id: string, acc: string) => `${id}|${acc}`;

const localStore: SeaStore = {
  async games(me) {
    return lsGet<SeaGame[]>(LS_GAMES, [])
      .filter((g) => g.aId === me || g.bId === me)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async fleet(id, me) {
    return lsGet<Record<string, Ship[]>>(LS_FLEETS, {})[fleetKey(id, me)] ?? null;
  },
  async reveal(id, me) {
    const g = mine(id, me);
    if (g.status !== "done") throw new Error("Флот соперника откроется после партии");
    return lsGet<Record<string, Ship[]>>(LS_FLEETS, {})[fleetKey(id, viewOf(g, me).otherId)] ?? null;
  },
  async players(me, local) {
    return local.filter((p) => p.id !== me);
  },
  async top() {
    const fin = lsGet<SeaGame[]>(LS_GAMES, []).filter((g) => g.status === "done" && g.winner);
    const m = new Map<string, Admiral>();
    for (const g of fin)
      for (const [id, name] of [[g.aId, g.aName], [g.bId, g.bName]]) {
        const a = m.get(id) ?? { id, name, wins: 0, games: 0 };
        a.games++;
        if (g.winner === id) a.wins++;
        m.set(id, a);
      }
    return Array.from(m.values()).sort((a, b) => b.wins - a.wins || a.games - b.games);
  },
  async invite(to, me) {
    const all = lsGet<SeaGame[]>(LS_GAMES, []);
    const act = all.filter((g) => ACTIVE.includes(g.status));
    if (act.some((g) => (g.aId === me.id && g.bId === to.id) || (g.aId === to.id && g.bId === me.id))) throw new Error("С этим соперником уже идёт партия");
    if (act.filter((g) => g.aId === me.id || g.bId === me.id).length >= MAX_ACTIVE) throw new Error(`У вас уже ${MAX_ACTIVE} незаконченных партий — доиграйте одну`);
    const t = nowIso();
    return save({
      id: String(Math.max(0, ...all.map((g) => Number(g.id) || 0)) + 1),
      aId: me.id,
      bId: to.id,
      aName: me.name,
      bName: to.name,
      status: "invite",
      aReady: false,
      bReady: false,
      aShots: [],
      bShots: [],
      turn: null,
      winner: null,
      endedBy: null,
      emote: null,
      emoteBy: null,
      emoteAt: null,
      createdAt: t,
      updatedAt: t,
      movedAt: t,
    });
  },
  async answer(id, accept, me) {
    const g = mine(id, me);
    if (g.status !== "invite" || g.bId !== me) throw new Error("Вызов уже неактуален");
    return save({ ...g, status: accept ? "setup" : "declined", updatedAt: nowIso(), movedAt: nowIso() });
  },
  async leave(id, me) {
    const g = mine(id, me);
    if (g.status === "invite") return save({ ...g, status: g.aId === me ? "cancelled" : "declined", updatedAt: nowIso() });
    if (g.status === "setup" || g.status === "play") return save({ ...g, status: "done", winner: viewOf(g, me).otherId, endedBy: "resign", turn: null, updatedAt: nowIso() });
    throw new Error("Партия уже закончилась");
  },
  async claim(id, me) {
    const g = mine(id, me);
    const v = viewOf(g, me);
    const stale = nowMs() - Date.parse(g.movedAt) > CLAIM_MS;
    if (!stale || !((g.status === "play" && g.turn !== me) || (g.status === "setup" && v.myReady && !v.otherReady)))
      throw new Error("Забрать победу можно, если соперник молчит больше суток");
    return save({ ...g, status: "done", winner: me, endedBy: "timeout", turn: null, updatedAt: nowIso() });
  },
  async place(id, fleet, me) {
    const g = mine(id, me);
    if (g.status !== "setup") throw new Error("Расставлять флот уже поздно");
    const fleets = lsGet<Record<string, Ship[]>>(LS_FLEETS, {});
    if (fleets[fleetKey(id, me)]) throw new Error("Флот уже расставлен");
    if (!fleetOk(fleet)) throw new Error("Флот расставлен не по правилам");
    lsSet(LS_FLEETS, { ...fleets, [fleetKey(id, me)]: fleet });
    const next = { ...g, aReady: g.aReady || g.aId === me, bReady: g.bReady || g.bId === me, updatedAt: nowIso(), movedAt: nowIso() };
    if (next.aReady && next.bReady) Object.assign(next, { status: "play", turn: Math.random() < 0.5 ? g.aId : g.bId });
    return save(next);
  },
  async fire(id, x, y, me) {
    const g = mine(id, me);
    if (g.status !== "play") throw new Error("Партия не идёт");
    if (g.turn !== me) throw new Error("Сейчас ход соперника");
    if (x < 0 || y < 0 || x >= N || y >= N) throw new Error("Мимо поля");
    const v = viewOf(g, me);
    if (v.myShots.some((s) => s[0] === x && s[1] === y)) throw new Error("Сюда уже стреляли");
    const fleet = lsGet<Record<string, Ship[]>>(LS_FLEETS, {})[fleetKey(id, v.otherId)] ?? [];
    const r = resolveShot(v.myShots, fleet, x, y);
    return save({
      ...g,
      [v.meA ? "aShots" : "bShots"]: r.shots,
      status: r.won ? "done" : g.status,
      winner: r.won ? me : g.winner,
      endedBy: r.won ? "win" : g.endedBy,
      turn: r.won ? null : r.hit ? me : v.otherId,
      updatedAt: nowIso(),
      movedAt: nowIso(),
    });
  },
  async emote(id, emote, me) {
    const g = mine(id, me);
    if (!EMOTES.includes(emote)) throw new Error("Нет такой эмоции");
    return save({ ...g, emote, emoteBy: me, emoteAt: nowIso(), updatedAt: nowIso() });
  },
  subscribe(_me, on) {
    if (typeof BroadcastChannel === "undefined") return () => {};
    const bc = new BroadcastChannel(BC);
    bc.onmessage = (e) => on(e.data as SeaChange);
    return () => bc.close();
  },
};

export const seaStore: SeaStore = supabaseReady ? remoteStore : localStore;
