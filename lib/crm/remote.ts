"use client";

import type { DataState, Settings } from "./types";
import { emptyState, normalizeSettings } from "./defaults";
import { supabase } from "@/lib/supabase";

/**
 * Хранилище в Supabase — тот же интерфейс, что у IndexedDB в db.ts.
 *
 * Таблицы и права — supabase/migrations/20260921000001_crm_schema.sql. Здесь только
 * перевод имён (camelCase приложения ↔ snake_case базы) и запросы. Что человеку
 * можно видеть и менять, решает база (RLS): загрузка возвращает только его зону.
 */

export const TABLES = ["operators", "groups", "projects", "leads", "shifts", "plans", "adjustments", "accounts", "learn", "approves", "candidates", "audit"] as const;
export type Table = (typeof TABLES)[number];

/** Пустое значение при отсутствии поля: OPT — необязательное поле (null из базы → undefined). */
const OPT = Symbol("optional");
const NOW = Symbol("now");
type Def = string | number | boolean | null | unknown[] | Record<string, unknown> | typeof OPT | typeof NOW;

// Поля каждой сущности (как в lib/crm/types.ts) и значение, если поля нет. Порядок не важен.
const SPEC: Record<Table, Record<string, Def>> = {
  operators: {
    id: "", name: "", groupId: null, role: "operator", status: "active", hireDate: "", fireDate: "", monthlyPlan: null, normHours: null,
    payType: "tiered", salary: 0, hourlyRate: 0, leadBonus: null, rateGridId: null, grade: "mid", track: "re", contact: "", comment: "",
    createdAt: NOW, updatedAt: NOW, deletedAt: null,
  },
  groups: { id: "", name: "", supervisorId: null, supervisorName: "", monthlyPlan: 0, active: true, color: "gray", createdAt: NOW, updatedAt: NOW, deletedAt: null },
  projects: { id: "", name: "", active: true, color: "gray", sort: 0, createdAt: NOW, updatedAt: NOW, deletedAt: null },
  leads: {
    id: "", at: "", client: "", phone: "", projectId: null, operatorId: "", groupId: null, direction: "", link: "", region: "", comment: "", source: "Скорозвон",
    status: "work", statusReason: "", statusAt: OPT, statusBy: OPT, createdAt: NOW, updatedAt: NOW,
  },
  shifts: { id: "", date: "", operatorId: "", groupId: null, hours: 0, type: "work", comment: "", updatedAt: NOW },
  plans: {
    id: "", month: "", scope: "team", targetId: null, plan: 0, normHours: OPT, payType: OPT, salary: OPT, hourlyRate: OPT, leadBonus: OPT,
    tiers: OPT, grade: OPT, track: OPT, approvePct: OPT, growth: OPT, auto: OPT, updatedAt: NOW,
  },
  adjustments: { id: "", month: "", operatorId: "", type: "accrual", amount: 0, date: "", comment: "", createdAt: NOW, updatedAt: NOW },
  accounts: {
    id: "", name: "", login: "", role: "operator", operatorId: null, groupIds: [], active: true, prefs: {}, createdAt: NOW, updatedAt: NOW,
    lastSeenAt: OPT, deletedAt: null,
  },
  learn: {
    id: "", accountId: "", courseId: "", itemId: "", done: false, right: OPT, total: OPT, last: OPT, best: OPT, tries: OPT, pass: OPT,
    at: OPT, checks: OPT, note: OPT, fav: OPT, cert: OPT, updatedAt: NOW,
  },
  approves: { id: "", month: "", projectId: "", pct: 0, comment: "", updatedAt: NOW },
  candidates: {
    id: "", name: "", contact: "", source: "", groupId: null, stage: "new", appliedAt: "", interviewAt: "", trainingAt: "", closedAt: "",
    operatorId: null, reason: "", comment: "", createdAt: NOW, updatedAt: NOW, deletedAt: null,
  },
  audit: { id: "", at: NOW, accountId: "", accountName: "", entity: "", entityId: "", summary: "" },
};

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());

/** Запись приложения → строка таблицы: все колонки, отсутствующие — значением по умолчанию. */
export function toRow(table: Table, rec: object): Record<string, unknown> {
  const src = rec as Record<string, unknown>;
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(SPEC[table])) {
    const v = src[k];
    row[snake(k)] = v !== undefined ? v : def === OPT ? null : def === NOW ? now : def;
  }
  return row;
}

/** Строка таблицы → запись приложения. */
export function fromRow<T>(table: Table, row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, def] of Object.entries(SPEC[table])) {
    const v = row[snake(k)];
    if (v === null || v === undefined) {
      if (def === OPT) continue;
      out[k] = def === NOW ? "" : def;
    } else out[k] = v;
  }
  return out as T;
}

/**
 * Таблица кандидатов появилась позже остальных. Пока схему в Supabase не перезапустили,
 * CRM работает как раньше, а раздел «Найм» просит обновить схему — вместо того чтобы
 * не пускать в систему целиком.
 */
let candidatesReady = true;
export const hasCandidatesTable = () => candidatesReady;

/**
 * Колонка leads.link (ссылка на лид) тоже появилась позже. Пока её нет в базе, лиды
 * сохраняются без ссылки — запись лидов не должна вставать из-за невыполненного SQL.
 */
let leadLinkReady = true;
export const hasLeadLinkColumn = () => leadLinkReady;
const isMissingLink = (e: { message: string; code?: string } | null) => !!e && (e.code === "PGRST204" || e.code === "42703") && /link/.test(e.message);
/** Колонка leads.region (регион лида) — ещё позже. Без неё лиды пишутся без региона. */
let leadRegionReady = true;
export const hasLeadRegionColumn = () => leadRegionReady;
const isMissingRegion = (e: { message: string; code?: string } | null) => !!e && (e.code === "PGRST204" || e.code === "42703") && /region/.test(e.message);
const dropCol = (rows: Record<string, unknown>[], col: string) => rows.map(({ [col]: _drop, ...rest }) => rest);
const CANDIDATES_MISSING = "В Supabase ещё нет таблицы кандидатов. Выполните supabase/migrations/20260924000001_candidates.sql в SQL Editor (повторный запуск безопасен).";

const isMissingTable = (e: { message: string; code?: string } | null) => e?.code === "PGRST205" || e?.code === "PGRST202" || /schema cache/i.test(e?.message ?? "");

function fail(e: { message: string; code?: string; details?: string | null; hint?: string | null } | null, table?: string): never {
  const msg = e?.message ?? "Ошибка базы";
  if (table === "candidates" && isMissingTable(e)) throw new Error(CANDIDATES_MISSING);
  if (isMissingTable(e))
    throw new Error("В Supabase ещё нет таблиц CRM. Выполните supabase/migrations/20260921000001_crm_schema.sql в SQL Editor проекта и нажмите «Повторить».");
  if (e?.code === "42501" || /row-level security/i.test(msg)) throw new Error(`Нет прав на это действие (${msg})`);
  throw new Error(msg);
}

/** Все строки таблицы, постранично: API отдаёт не больше 1000 за раз. */
async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase().from(table).select("*").order(table === "kv" ? "key" : "id").range(from, from + PAGE - 1);
    if (error && table === "candidates" && isMissingTable(error)) {
      candidatesReady = false;
      return [];
    }
    if (error) fail(error);
    out.push(...(data as Record<string, unknown>[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function loadAll(): Promise<{ state: DataState; persistent: boolean }> {
  const st = emptyState();
  candidatesReady = true;
  const [kv, ...rows] = await Promise.all([fetchAll("kv"), ...TABLES.map((t) => fetchAll(t))]);
  TABLES.forEach((t, i) => {
    (st as unknown as Record<string, unknown[]>)[t] = rows[i].map((r) => fromRow(t, r));
  });
  // колонки link нет — видно уже по загруженным строкам, не дожидаясь неудачного сохранения
  const leadRows = rows[TABLES.indexOf("leads")];
  if (leadRows.length) {
    leadLinkReady = "link" in leadRows[0];
    leadRegionReady = "region" in leadRows[0];
  }
  const val = (key: string) => kv.find((r) => r.key === key)?.value as unknown;
  // секреты выгрузки лежат отдельно (читает только РОП) — собираем настройки обратно
  const settings = (val("settings") ?? {}) as Partial<Settings>;
  const sheets = val("sheets") as Settings["sheets"] | undefined;
  st.settings = normalizeSettings({ ...settings, ...(sheets ? { sheets } : {}) });
  st.frozenMonths = ((val("frozenMonths") as string[] | undefined) ?? []).filter((m) => typeof m === "string");
  return { state: st, persistent: true };
}

const chunks = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function putRecords(table: Table, recs: object[]): Promise<void> {
  if (!recs.length) return;
  // Аккаунты: upsert — это INSERT … ON CONFLICT, и RLS проверяет его по правилу вставки, а создавать
  // аккаунты может только РОП. Оператор и супервайзер меняют свой аккаунт (тема, стартовая страница,
  // время входа) — поэтому сначала UPDATE по id, вставка — только если такой строки ещё нет.
  if (table === "accounts") {
    for (const rec of recs) {
      const row = toRow(table, rec);
      const { data, error } = await supabase().from(table).update(row).eq("id", String(row.id)).select("id");
      if (error) fail(error);
      if (!data?.length) {
        const { error: insErr } = await supabase().from(table).insert(row);
        if (insErr) fail(insErr);
      }
    }
    return;
  }
  if (table === "leads") return putLeads(recs);
  for (const part of chunks(recs, 500)) {
    const rows = part.map((r) => toRow(table, r));
    // журнал — только добавление: читать его могут не все, а upsert требует права чтения
    const { error } = table === "audit" ? await supabase().from(table).insert(rows) : await supabase().from(table).upsert(rows, { onConflict: "id" });
    if (error) fail(error, table);
  }
}

/**
 * Лиды пишем двумя пачками: со ссылкой и без неё. У строк без ссылки колонки link
 * в запросе нет вовсе — upsert её не трогает. Иначе клиент со старой копией лида
 * (вкладка спала, realtime отвалился) затирал бы пустой строкой ссылку, которую
 * оператор уже вставил. Сервер страхует то же самое триггером (…_lead_link_required.sql).
 */
async function putLeads(recs: object[]): Promise<void> {
  let rows = recs.map((r) => toRow("leads", r));
  if (!leadRegionReady) rows = dropCol(rows, "region");
  const withLink = leadLinkReady ? rows.filter((r) => String(r.link ?? "").trim()) : [];
  const noLink = dropCol(rows.filter((r) => !withLink.includes(r)), "link");
  for (const batch of [withLink, noLink]) {
    for (let part of chunks(batch, 500)) {
      // колонки, которых в базе ещё нет, убираем и повторяем — запись лидов не встаёт из-за невыполненного SQL
      for (let attempt = 0; ; attempt++) {
        const { error } = await supabase().from("leads").upsert(part, { onConflict: "id" });
        if (!error) break;
        if (attempt < 2 && isMissingLink(error)) {
          leadLinkReady = false;
          part = dropCol(part, "link");
        } else if (attempt < 2 && isMissingRegion(error)) {
          leadRegionReady = false;
          part = dropCol(part, "region");
        } else fail(error, "leads");
      }
    }
  }
}

/**
 * Статус лидов — точечным UPDATE только полей статуса, а не всей строкой: проверяющий
 * не должен перезаписывать клиента, телефон и ссылку своей (возможно, устаревшей) копией.
 */
export async function updateLeadStatus(
  ids: string[],
  f: { status: string; statusReason: string; statusAt: string; statusBy: string; updatedAt: string },
): Promise<void> {
  for (const part of chunks(ids, 100)) {
    const { data, error } = await supabase()
      .from("leads")
      .update({ status: f.status, status_reason: f.statusReason, status_at: f.statusAt, status_by: f.statusBy, updated_at: f.updatedAt })
      .filter("id", "in", inList(part))
      .select("id");
    if (error) fail(error, "leads");
    // RLS молча пропускает чужие строки — считаем, что обновилось на самом деле
    if ((data?.length ?? 0) < part.length) throw new Error("Нет прав поставить статус части лидов — обновите страницу");
  }
}

/** Значения для фильтра in.(…) — в кавычках: в ID бывают «|» и точки. */
const inList = (ids: string[]) => `(${ids.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;

export async function deleteRecords(table: Table, ids: string[]): Promise<void> {
  for (const part of chunks(ids, 100)) {
    const { error } = await supabase().from(table).delete().filter("id", "in", inList(part));
    if (error) fail(error, table);
  }
}

export async function setKV(key: string, value: unknown): Promise<void> {
  const rows: { key: string; value: unknown; updated_at: string }[] = [];
  const now = new Date().toISOString();
  if (key === "settings") {
    // секреты выгрузки в Google — отдельной строкой, её видит только РОП
    const { sheets, ...rest } = value as Settings;
    rows.push({ key: "settings", value: rest, updated_at: now });
    if (sheets) rows.push({ key: "sheets", value: sheets, updated_at: now });
  } else rows.push({ key, value, updated_at: now });
  const { error } = await supabase().from("kv").upsert(rows, { onConflict: "key" });
  if (error) fail(error);
}

/** Полная замена (импорт, восстановление, очистка) — одной транзакцией на сервере, только РОП. */
export async function replaceAll(state: DataState): Promise<void> {
  const payload: Record<string, unknown> = {};
  for (const t of TABLES) payload[t] = ((state as unknown as Record<string, object[]>)[t] ?? []).map((r) => toRow(t, r));
  const { sheets, ...settings } = state.settings;
  payload.settings = settings;
  payload.sheets = sheets;
  payload.frozenMonths = state.frozenMonths;
  const { error } = await supabase().rpc("crm_replace_all", { p: payload });
  if (error) fail(error);
}

/**
 * Перенос данных из браузера (IndexedDB) в Supabase — без удаления того, что уже в базе:
 * записи добавляются или обновляются по ID. Аккаунты без почты не переносятся — войти
 * в них всё равно нельзя. Только РОП.
 */
export async function mergeUpload(state: DataState, myEmail: string): Promise<Record<Table, number>> {
  const counts = {} as Record<Table, number>;
  // порядок важен: сначала справочники, потом то, что на них ссылается
  const order: Table[] = ["groups", "projects", "operators", "accounts", "leads", "shifts", "plans", "adjustments", "approves", "candidates", "learn", "audit"];
  const me = myEmail.trim().toLowerCase();
  for (const t of order) {
    if (t === "candidates" && !candidatesReady) continue;
    let recs = (state as unknown as Record<string, { id: string; login?: string }[]>)[t] ?? [];
    if (t === "accounts") recs = recs.filter((a) => a.login && a.login.trim().toLowerCase() !== me);
    if (t === "audit") {
      // журнал: только новые записи (insert), повтор переноса не должен падать
      const have = new Set((await fetchAll("audit")).map((r) => String(r.id)));
      recs = recs.filter((a) => !have.has(a.id));
    }
    await putRecords(t, recs);
    counts[t] = recs.length;
  }
  await setKV("settings", state.settings);
  if (state.frozenMonths.length) await setKV("frozenMonths", state.frozenMonths);
  return counts;
}

/** Первый вход: если РОПа ещё нет — вошедший становится РОПом. Возвращает id своего аккаунта или null. */
export async function bootstrap(name: string): Promise<string | null> {
  const { data, error } = await supabase().rpc("crm_bootstrap", { p_name: name });
  if (error) fail(error);
  return (data as string | null) ?? null;
}

/**
 * Вход сотрудника (почта + пароль) — через серверную функцию crm-users: пользователя Supabase
 * создаёт только секретный ключ, а он живёт на сервере. Нет пользователя — создаст, есть — сменит пароль.
 */
export async function setLogin(email: string, password: string, name: string): Promise<"created" | "updated"> {
  const { data, error } = await supabase().functions.invoke("crm-users", { body: { email, password, name } });
  if (error) {
    // тело ответа функции — там понятная причина
    let msg = error.message;
    try {
      const ctx = (error as { context?: Response }).context;
      if (ctx && typeof ctx.json === "function") msg = (await ctx.json()).error ?? msg;
    } catch {
      /* не JSON */
    }
    if (/not found|404|Failed to send|FunctionsFetchError|FunctionsRelayError/i.test(`${error.name} ${msg}`))
      msg = "Функция crm-users не развёрнута в Supabase (см. supabase/README.md). Пока можно создать вход вручную: Supabase → Authentication → Users → Add user.";
    throw new Error(msg);
  }
  return (data as { created?: boolean })?.created ? "created" : "updated";
}

/** Кто вошёл: почта (к ней привязан аккаунт CRM) и имя, указанное при регистрации. */
export async function sessionUser(): Promise<{ email: string; name: string }> {
  const { data } = await supabase().auth.getSession();
  const u = data.session?.user;
  return { email: (u?.email ?? "").trim().toLowerCase(), name: String(u?.user_metadata?.name ?? "") };
}

export type Change = { table: Table; type: "INSERT" | "UPDATE" | "DELETE"; rec?: unknown; id?: string } | { table: "kv" };

/** Изменения от других пользователей в реальном времени (RLS соблюдается: приходит только своя зона). */
export function subscribe(onChange: (c: Change) => void): () => void {
  const ch = supabase().channel("crm-db");
  // таблицы кандидатов может ещё не быть — подписка на несуществующую таблицу ломает весь канал
  for (const t of [...TABLES.filter((x) => x !== "candidates" || candidatesReady), "kv"] as const) {
    ch.on("postgres_changes", { event: "*", schema: "public", table: t }, (p) => {
      if (t === "kv") return onChange({ table: "kv" });
      if (p.eventType === "DELETE") onChange({ table: t, type: "DELETE", id: String((p.old as { id?: string })?.id ?? "") });
      else onChange({ table: t, type: p.eventType, rec: fromRow(t, p.new as Record<string, unknown>) });
    });
  }
  ch.subscribe();
  return () => {
    void supabase().removeChannel(ch);
  };
}
