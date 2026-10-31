"use client";

import { useSyncExternalStore } from "react";
import { supabase, supabaseReady } from "@/lib/supabase";
import { appStamp, nowMs } from "@/lib/crm/dates";
import type { DayKey, Lead } from "@/lib/crm/types";
import { TEAM_RATE, type Painter } from "@/lib/pixels";

/**
 * «Лавка» — украшения профиля, как в магазине Discord: рамки аватара, стиль имени и след
 * за курсором. Всё, что надето, видят коллеги: рамку — у аватарки по всей CRM, имя — на
 * подписи курсора, в «Сейчас на этой странице» и в чате холста, след — за курсором.
 *
 * Ещё значок рядом с именем (там же, где стиль имени) и фон профиля — шапка карточки профиля
 * и подложка строки в «Сейчас на этой странице».
 *
 * Валюта — искры ✦. Баланс не хранится, а считается, как краска холста:
 *   • 10 искр за каждый свой одобренный лид (в «доведён» с SHOP_FROM);
 *   • +20 за каждый день с Грейдом III (8–10 доведённых за день), +50 — с Грейдом IV (11+);
 *   • СВ — 10 искр за каждые 5 одобренных лидов своих групп, РОП — за каждые 10 по отделу;
 *   • минус всё, что купил (и себе, и в подарок).
 * Каждый день одна вещь — со скидкой 30% («Скидка дня»), сезонная коллекция продаётся
 * только в свои даты. Легендарные вещи открывает лучший грейд дня за месяц (как цвета холста).
 *
 * Где хранится:
 *   • с Supabase — таблица shop_items и функции crm_shop_* (supabase/migrations/…_shop.sql):
 *     цену, баланс и грейд проверяет база, обновления — Realtime;
 *   • без Supabase — localStorage этого браузера, вкладки синхронизирует BroadcastChannel.
 * Каталог и правила здесь и в миграции должны совпадать — порядок CATALOG тоже (скидка дня).
 */

export type Slot = "frame" | "name" | "trail" | "badge" | "banner";
export type Rarity = "common" | "rare" | "epic" | "legend";

export interface Item {
  id: string;
  slot: Slot;
  name: string;
  price: number;
  rarity: Rarity;
  /** Нужен лучший грейд дня за месяц (у РОПа и СВ открыто всё). */
  grade?: 3 | 4;
  /** Сезонная вещь: продаётся только в даты SEASON. */
  season?: boolean;
  hint: string;
  /** Стиль имени: градиент букв и плашки курсора. */
  paint?: string;
  /** Значок вещи в списке и на плашке. */
  glyph: string;
}

export const SHOP_FROM: DayKey = "2026-10-01";
export const SPARKS_PER_LEAD = 10;
export const G3_BONUS = 20;
export const G4_BONUS = 50;
export const DEAL_OFF = 30;
/** День отсчёта для «Скидки дня»: номер дня от него → вещь по кругу. */
const DEAL_EPOCH = Date.UTC(2026, 0, 1);

export const SEASON = { name: "Хэллоуин", from: "2026-10-24", until: "2026-11-08" } as const;

export const SLOTS: { slot: Slot; label: string; one: string }[] = [
  { slot: "frame", label: "Рамки", one: "Рамка аватара" },
  { slot: "name", label: "Имена", one: "Стиль имени" },
  { slot: "trail", label: "Следы", one: "След курсора" },
  { slot: "badge", label: "Значки", one: "Значок" },
  { slot: "banner", label: "Фоны", one: "Фон профиля" },
];

export const RARITY: Record<Rarity, { label: string; hue: string }> = {
  common: { label: "Обычная", hue: "gray" },
  rare: { label: "Редкая", hue: "blue" },
  epic: { label: "Эпическая", hue: "purple" },
  legend: { label: "Легендарная", hue: "amber" },
};

/** Порядок важен: тот же список — в crm_shop_catalog. */
export const CATALOG: Item[] = [
  { id: "f_neon", slot: "frame", name: "Неон", price: 300, rarity: "common", glyph: "◯", hint: "Голубое кольцо, которое дышит светом" },
  { id: "f_ice", slot: "frame", name: "Иней", price: 400, rarity: "common", glyph: "❄", hint: "Морозная кромка с искорками" },
  { id: "f_fire", slot: "frame", name: "Пламя", price: 900, rarity: "rare", glyph: "🔥", hint: "Живой огонь вокруг аватарки" },
  { id: "f_cat", slot: "frame", name: "Кошачьи ушки", price: 800, rarity: "rare", glyph: "🐱", hint: "Ушки, которые иногда дёргаются" },
  { id: "f_pixel", slot: "frame", name: "Пиксели", price: 900, rarity: "rare", glyph: "▦", hint: "Рамка из пикселей — для художников холста" },
  { id: "f_rainbow", slot: "frame", name: "Радуга", price: 1800, rarity: "epic", glyph: "🌈", hint: "Переливается по кругу всеми цветами" },
  { id: "f_orbit", slot: "frame", name: "Орбита", price: 2000, rarity: "epic", glyph: "🪐", hint: "Вокруг аватарки летают два спутника" },
  { id: "f_halo", slot: "frame", name: "Нимб", price: 2200, rarity: "epic", glyph: "😇", hint: "Светящийся нимб над головой" },
  { id: "f_crown", slot: "frame", name: "Корона", price: 6000, rarity: "legend", grade: 4, glyph: "👑", hint: "Золотая корона с бликом. Только для тех, кто брал Грейд IV" },
  { id: "f_pumpkin", slot: "frame", name: "Тыква", price: 700, rarity: "rare", season: true, glyph: "🎃", hint: "Оранжевое кольцо и тыква-фонарь" },
  { id: "f_web", slot: "frame", name: "Паутина", price: 800, rarity: "rare", season: true, glyph: "🕸", hint: "Паутина в углу и паучок на ниточке" },

  { id: "n_sunset", slot: "name", name: "Закат", price: 300, rarity: "common", glyph: "Aa", paint: "linear-gradient(100deg, #ff7a59, #ff3d77 55%, #b14dff)", hint: "Тёплый градиент от оранжевого к сиреневому" },
  { id: "n_ocean", slot: "name", name: "Океан", price: 300, rarity: "common", glyph: "Aa", paint: "linear-gradient(100deg, #00c6ff, #2f6bff 60%, #6a3cff)", hint: "Глубокий сине-голубой" },
  { id: "n_mint", slot: "name", name: "Мята", price: 300, rarity: "common", glyph: "Aa", paint: "linear-gradient(100deg, #10c9a0, #1fb6ff)", hint: "Свежий бирюзовый" },
  { id: "n_toxic", slot: "name", name: "Кислота", price: 700, rarity: "rare", glyph: "Aa", paint: "linear-gradient(100deg, #b6ff00, #22e36b 50%, #b6ff00)", hint: "Ядовито-зелёный с переливом" },
  { id: "n_glitch", slot: "name", name: "Глитч", price: 1500, rarity: "epic", glyph: "Aa", paint: "linear-gradient(100deg, #00f0ff, #ff00c8 50%, #00f0ff)", hint: "Имя иногда «сбоит», как старый монитор" },
  { id: "n_rainbow", slot: "name", name: "Радуга", price: 1800, rarity: "epic", glyph: "Aa", paint: "linear-gradient(90deg, #ff4d4d, #ffb84d, #f5f53d, #4dff88, #4dc3ff, #9b6bff, #ff4d4d)", hint: "Бегущая радуга по буквам" },
  { id: "n_gold", slot: "name", name: "Золото", price: 4500, rarity: "legend", grade: 3, glyph: "Aa", paint: "linear-gradient(100deg, #a8741a, #ffd86b 30%, #fff6c8 45%, #e8b923 60%, #a8741a)", hint: "Золотые буквы с бликом. С Грейда III" },
  { id: "n_ghost", slot: "name", name: "Призрак", price: 700, rarity: "rare", season: true, glyph: "Aa", paint: "linear-gradient(100deg, #b9c6ff, #f2f4ff 50%, #b9c6ff)", hint: "Бледное имя, которое то тает, то проявляется" },

  { id: "t_bubbles", slot: "trail", name: "Пузыри", price: 500, rarity: "common", glyph: "🫧", hint: "Мыльные пузыри всплывают за курсором" },
  { id: "t_hearts", slot: "trail", name: "Сердечки", price: 1000, rarity: "rare", glyph: "💖", hint: "Сердечки разлетаются от курсора" },
  { id: "t_snow", slot: "trail", name: "Снег", price: 1000, rarity: "rare", glyph: "❄️", hint: "Снежинки медленно падают" },
  { id: "t_pixels", slot: "trail", name: "Пиксели", price: 1100, rarity: "rare", glyph: "🟪", hint: "Разноцветные пиксели с холста" },
  { id: "t_stars", slot: "trail", name: "Звёздная пыль", price: 2000, rarity: "epic", glyph: "✨", hint: "Мерцающая звёздная пыль" },
  { id: "t_money", slot: "trail", name: "Деньги", price: 2400, rarity: "epic", glyph: "💸", hint: "Купюры и монетки сыплются за курсором" },
  { id: "t_fireworks", slot: "trail", name: "Фейерверк", price: 7000, rarity: "legend", grade: 4, glyph: "🎆", hint: "Салют на каждой остановке курсора. Только с Грейдом IV" },
  { id: "t_bats", slot: "trail", name: "Летучие мыши", price: 1500, rarity: "epic", season: true, glyph: "🦇", hint: "Стайка летучих мышей вылетает из-под курсора" },

  { id: "b_headset", slot: "badge", name: "Гарнитура", price: 300, rarity: "common", glyph: "🎧", hint: "Значок звонаря рядом с именем" },
  { id: "b_coffee", slot: "badge", name: "Кофе", price: 300, rarity: "common", glyph: "☕", hint: "Для тех, кто на третьей кружке к обеду" },
  { id: "b_clover", slot: "badge", name: "Клевер", price: 400, rarity: "common", glyph: "🍀", hint: "На удачу — чтобы клиенты брали трубку" },
  { id: "b_fire", slot: "badge", name: "Огонь", price: 700, rarity: "rare", glyph: "🔥", hint: "Когда сегодня всё горит (в хорошем смысле)" },
  { id: "b_rocket", slot: "badge", name: "Ракета", price: 900, rarity: "rare", glyph: "🚀", hint: "Взлёт по плану" },
  { id: "b_alien", slot: "badge", name: "Пришелец", price: 900, rarity: "rare", glyph: "👾", hint: "Пиксельный гость с холста" },
  { id: "b_unicorn", slot: "badge", name: "Единорог", price: 1800, rarity: "epic", glyph: "🦄", hint: "Редкий зверь — как лид с первого звонка" },
  { id: "b_diamond", slot: "badge", name: "Бриллиант", price: 2400, rarity: "epic", glyph: "💎", hint: "Переливается рядом с именем" },
  { id: "b_trophy", slot: "badge", name: "Кубок", price: 5000, rarity: "legend", grade: 4, glyph: "🏆", hint: "Кубок чемпиона. Только с Грейдом IV" },
  { id: "b_ghost", slot: "badge", name: "Привидение", price: 600, rarity: "rare", season: true, glyph: "👻", hint: "Бу! Покачивается рядом с именем" },

  { id: "bn_sunset", slot: "banner", name: "Закат", price: 500, rarity: "common", glyph: "🌅", hint: "Тёплый градиент на шапке профиля и в списке «на странице»" },
  { id: "bn_ocean", slot: "banner", name: "Глубина", price: 500, rarity: "common", glyph: "🌊", hint: "Морская синева с бликами" },
  { id: "bn_sakura", slot: "banner", name: "Сакура", price: 1200, rarity: "rare", glyph: "🌸", hint: "Розовая весна, лепестки летят по шапке" },
  { id: "bn_aurora", slot: "banner", name: "Северное сияние", price: 1800, rarity: "epic", glyph: "🌌", hint: "Переливы сияния, которые не стоят на месте" },
  { id: "bn_space", slot: "banner", name: "Космос", price: 2000, rarity: "epic", glyph: "🪐", hint: "Звёзды мерцают, планета плывёт" },
  { id: "bn_matrix", slot: "banner", name: "Матрица", price: 2200, rarity: "epic", glyph: "💚", hint: "Зелёный цифровой дождь" },
  { id: "bn_gold", slot: "banner", name: "Золотой зал", price: 5000, rarity: "legend", grade: 3, glyph: "🏛", hint: "Золото с бегущим бликом. С Грейда III" },
  { id: "bn_night", slot: "banner", name: "Ночь Хэллоуина", price: 900, rarity: "rare", season: true, glyph: "🌕", hint: "Луна, тыквы и летучие мыши" },
];

export const ITEMS = new Map(CATALOG.map((i) => [i.id, i]));

/* ── цены ── */

export function seasonOn(today: DayKey): boolean {
  return today >= SEASON.from && today < SEASON.until;
}

/** Вещь «Скидки дня»: по кругу среди обычных, редких и эпических не сезонных — так же в crm_shop_deal. */
export function dealOf(today: DayKey): string {
  const pool = CATALOG.filter((i) => i.rarity !== "legend" && !i.season);
  const [y, m, d] = today.split("-").map(Number);
  const n = Math.round((Date.UTC(y, m - 1, d) - DEAL_EPOCH) / 86_400_000);
  return pool[((n % pool.length) + pool.length) % pool.length].id;
}

/** Цена сегодня; null — не продаётся (сезон прошёл). */
export function priceOf(item: Item, today: DayKey): number | null {
  if (item.season && !seasonOn(today)) return null;
  // целочисленно — так же округляет база
  return dealOf(today) === item.id ? Math.round((item.price * (100 - DEAL_OFF)) / 100 / 10) * 10 : item.price;
}

/* ── искры ── */

export interface Sparks {
  /** Свои одобренные лиды с начала Лавки. */
  own: number;
  /** Дни с Грейдом III (8–10 доведённых) и с Грейдом IV (11+). */
  g3: number;
  g4: number;
  /** Одобренные лиды команды (СВ — свои группы, РОП — отдел). */
  team: number;
  rate: number;
  total: number;
}

const approvedDay = (l: Lead) => (l.statusAt ? appStamp(l.statusAt) : l.at).slice(0, 10);

/** Сколько искр заработано всего. Те же правила — в crm_shop_earned. */
export function sparksEarned(leads: Lead[], who: Painter): Sparks {
  const rate = who.role === "operator" ? 0 : TEAM_RATE[who.role];
  let own = 0;
  let team = 0;
  const byDay = new Map<string, number>();
  for (const l of leads) {
    if (l.status !== "done") continue;
    const approved = approvedDay(l) >= SHOP_FROM;
    if (who.opId && l.operatorId === who.opId) {
      if (approved) own++;
      const d = l.at.slice(0, 10);
      if (d >= SHOP_FROM) byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    if (approved && (who.role === "head" || (who.role === "supervisor" && l.groupId && who.groups.has(l.groupId)))) team++;
  }
  let g3 = 0;
  let g4 = 0;
  for (const n of byDay.values()) {
    if (n >= 11) g4++;
    else if (n >= 8) g3++;
  }
  const total = own * SPARKS_PER_LEAD + g3 * G3_BONUS + g4 * G4_BONUS + (rate ? Math.floor(team / rate) * SPARKS_PER_LEAD : 0);
  return { own, g3, g4, team, rate, total };
}

/** Потрачено: всё, что купил этот аккаунт — себе и в подарок. */
export function sparksSpent(rows: ShopRow[], accountId: string): number {
  let n = 0;
  for (const r of rows) if (r.buyerId === accountId) n += r.price;
  return n;
}

/** Почему нельзя купить (null — можно). Та же проверка — в crm_shop_buy. */
export function buyBlock(item: Item, o: { today: DayKey; grade: number; left: number; owned: boolean; gift: boolean }): string | null {
  const price = priceOf(item, o.today);
  if (price == null) return `${SEASON.name} закончился — эта вещь больше не продаётся`;
  if (o.owned) return o.gift ? "У коллеги это уже есть" : "Уже есть";
  if (item.grade && o.gift) return "Легендарные вещи не дарят — их открывает грейд";
  if (item.grade && item.grade > o.grade) return `Откроется на Грейде ${item.grade === 4 ? "IV" : "III"}`;
  if (o.left < price) return `Не хватает ${price - o.left} ✦`;
  return null;
}

/* ── покупки ── */

export interface ShopRow {
  id: string;
  item: string;
  slot: Slot;
  /** Чьё: аккаунт владельца. */
  ownerId: string;
  /** Кто заплатил (в подарок — не владелец). */
  buyerId: string;
  buyerName: string;
  price: number;
  equipped: boolean;
  at: string;
}

export type Look = Partial<Record<Slot, string>>;

export interface ShopCtx {
  accountId: string;
  name: string;
  today: DayKey;
  earned: number;
  grade: number;
}

export interface ShopStore {
  load: () => Promise<ShopRow[]>;
  buy: (item: string, to: string | null, ctx: ShopCtx) => Promise<ShopRow>;
  equip: (slot: Slot, item: string | null, ctx: ShopCtx) => Promise<void>;
  subscribe: (on: (r: ShopRow) => void) => () => void;
}

function fromRow(r: Record<string, unknown>): ShopRow {
  return {
    id: String(r.id),
    item: String(r.item),
    slot: String(r.slot) as Slot,
    ownerId: String(r.account_id),
    buyerId: String(r.buyer_id),
    buyerName: String(r.buyer_name ?? ""),
    price: Number(r.price) || 0,
    equipped: r.equipped === true,
    at: String(r.created_at),
  };
}

const remoteStore: ShopStore = {
  async load() {
    const out: ShopRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase().from("shop_items").select("*").order("id").range(from, from + 999);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []).map(fromRow));
      if (!data || data.length < 1000) return out;
    }
  },
  async buy(item, to) {
    const { data, error } = await supabase().rpc("crm_shop_buy", { p_item: item, p_to: to });
    if (error) throw new Error(error.message);
    return fromRow(data as Record<string, unknown>);
  },
  async equip(slot, item) {
    const { error } = await supabase().rpc("crm_shop_equip", { p_slot: slot, p_item: item });
    if (error) throw new Error(error.message);
  },
  subscribe(on) {
    // своё имя у каждой подписки: старая может ещё закрываться, когда открывается новая
    const ch = supabase().channel(`shop-${Math.random().toString(36).slice(2, 8)}`);
    ch.on("postgres_changes", { event: "*", schema: "public", table: "shop_items" }, (p) => {
      if (p.eventType !== "DELETE") on(fromRow(p.new as Record<string, unknown>));
    });
    ch.subscribe();
    return () => void supabase().removeChannel(ch);
  },
};

/* без Supabase: всё в localStorage, изменения — соседним вкладкам */
const LS_KEY = "leadup.shop";
const BC_NAME = "leadup-shop";

function lsRead(): ShopRow[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
    return Array.isArray(v) ? (v as ShopRow[]) : [];
  } catch {
    return [];
  }
}

function lsWrite(rows: ShopRow[], changed: ShopRow[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(rows));
  } catch {
    throw new Error("Не получилось сохранить покупку в этом браузере");
  }
  try {
    const bc = new BroadcastChannel(BC_NAME);
    for (const r of changed) bc.postMessage(r);
    bc.close();
  } catch {
    /* соседние вкладки увидят после перезагрузки */
  }
}

const localStore: ShopStore = {
  async load() {
    return lsRead();
  },
  async buy(id, to, ctx) {
    const item = ITEMS.get(id);
    if (!item) throw new Error("Такой вещи нет");
    const all = lsRead();
    const owner = to || ctx.accountId;
    const why = buyBlock(item, {
      today: ctx.today,
      grade: ctx.grade,
      left: ctx.earned - sparksSpent(all, ctx.accountId),
      owned: all.some((r) => r.ownerId === owner && r.item === id),
      gift: owner !== ctx.accountId,
    });
    if (why) throw new Error(why);
    const r: ShopRow = {
      id: String(Math.max(0, ...all.map((x) => Number(x.id) || 0)) + 1),
      item: id,
      slot: item.slot,
      ownerId: owner,
      buyerId: ctx.accountId,
      buyerName: ctx.name,
      price: priceOf(item, ctx.today)!,
      equipped: false,
      at: new Date(nowMs()).toISOString(),
    };
    lsWrite([...all, r], [r]);
    return r;
  },
  async equip(slot, id, ctx) {
    const all = lsRead();
    if (id && !all.some((r) => r.ownerId === ctx.accountId && r.item === id && r.slot === slot)) throw new Error("Сначала купите эту вещь");
    const changed: ShopRow[] = [];
    const next = all.map((r) => {
      if (r.ownerId !== ctx.accountId || r.slot !== slot) return r;
      const on = r.item === id;
      if (r.equipped === on) return r;
      const x = { ...r, equipped: on };
      changed.push(x);
      return x;
    });
    if (changed.length) lsWrite(next, changed);
  },
  subscribe(on) {
    if (typeof BroadcastChannel === "undefined") return () => {};
    const bc = new BroadcastChannel(BC_NAME);
    bc.onmessage = (e) => on(e.data as ShopRow);
    return () => bc.close();
  },
};

export const shopStore: ShopStore = supabaseReady ? remoteStore : localStore;

/* ── общее состояние: покупки всех, загружены один раз на вкладку (ShopSync в Shell) ── */

let rows: ShopRow[] = [];
let looks = new Map<string, Look>();
/** Примерка в Лавке: видна только вам, коллегам не уходит. */
let tryOn: Look = {};
let tick = 0;
const subs = new Set<() => void>();

function rebuild() {
  const m = new Map<string, Look>();
  for (const r of rows) {
    if (!r.equipped || !ITEMS.has(r.item)) continue;
    const l = m.get(r.ownerId) ?? {};
    l[r.slot] = r.item;
    m.set(r.ownerId, l);
  }
  looks = m;
  tick++;
  subs.forEach((f) => f());
}

export function setShopRows(next: ShopRow[]) {
  rows = next;
  rebuild();
}

export const shopRowKnown = (id: string) => rows.some((r) => r.id === id);

/** Пришла строка (покупка или «надел/снял») — заменить по id. */
export function putShopRow(r: ShopRow) {
  const i = rows.findIndex((x) => x.id === r.id);
  rows = i < 0 ? [...rows, r] : rows.map((x, k) => (k === i ? r : x));
  rebuild();
}

export function setTryOn(l: Look) {
  tryOn = l;
  rebuild();
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => void subs.delete(f);
};
const snap = () => tick;

/** Все покупки (для Лавки). */
export function useShopRows(): ShopRow[] {
  useSyncExternalStore(subscribe, snap, snap);
  return rows;
}

/** Что надето на аккаунте; для себя — с примеркой поверх. */
export function useLook(accountId: string | undefined, me?: string): Look {
  useSyncExternalStore(subscribe, snap, snap);
  if (!accountId) return {};
  const l = looks.get(accountId) ?? {};
  return accountId === me ? { ...l, ...tryOn } : l;
}

/** Все надетые образы: аккаунт → вещи (для курсоров коллег). */
export function useLooks(me?: string): (id: string) => Look {
  useSyncExternalStore(subscribe, snap, snap);
  return (id) => {
    const l = looks.get(id) ?? {};
    return id === me ? { ...l, ...tryOn } : l;
  };
}

/** Значок рядом с именем; нет — undefined. */
export const badgeOf = (l: Look) => (l.badge ? ITEMS.get(l.badge)?.glyph : undefined);

/** Градиент стиля имени; нет — undefined. */
export const namePaint = (l: Look) => (l.name ? ITEMS.get(l.name)?.paint : undefined);
