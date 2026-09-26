"use client";

import type { Backup, DataState } from "./types";
import { emptyState, normalizeSettings } from "./defaults";
import { cleanLeadExportLog, cleanLeadExports } from "./validate";
import { supabaseReady } from "@/lib/supabase";
import * as remote from "./remote";

/**
 * Хранилище исходных данных — IndexedDB (браузер / Electron).
 *
 * Каждая сущность — отдельное хранилище объектов с ключом id, поэтому:
 *   - сохранение одного лида = одна запись put, без перезаписи остальных;
 *   - изменение оператора меняет только его запись;
 *   - смена = одна запись с ключом `${дата}|${оператор}`.
 * Полная перезапись идёт только при импорте/восстановлении, одной транзакцией,
 * и перед ней всегда делается резервная копия.
 *
 * Если IndexedDB недоступна (приватный режим, запрет сайта) — работаем в
 * памяти и честно сообщаем, что данные не сохранятся (persistent = false).
 *
 * Если в .env.local прописан проект Supabase — данные живут там (lib/crm/remote.ts,
 * тот же интерфейс), а IndexedDB остаётся только для резервных копий и переноса
 * старых данных из браузера.
 */

/** Данные в Supabase (вход по почте), а не в браузере. */
export const REMOTE = supabaseReady;

const DB_NAME = "leadup-crm";
const LEGACY_DB_NAME = "rabota77-crm"; // имя до переименования — переносим один раз (см. adoptLegacy)
const DB_VERSION = 5; // 2: accounts, 3: learn (прогресс обучения), 4: approves + audit, 5: candidates

export const ENTITY_STORES = ["operators", "groups", "projects", "leads", "shifts", "plans", "adjustments", "accounts", "learn", "approves", "candidates", "audit"] as const;
export type EntityStore = (typeof ENTITY_STORES)[number];
const KV = "kv";
const BACKUPS = "backups";

type Rec = { id: string };

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory: Record<string, Map<string, unknown>> = {};

function mem(store: string): Map<string, unknown> {
  return (memory[store] ??= new Map());
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ENTITY_STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV, { keyPath: "key" });
        if (!db.objectStoreNames.contains(BACKUPS)) db.createObjectStore(BACKUPS, { keyPath: "id" });
      };
      req.onsuccess = () => {
        const db = req.result;
        // другая вкладка обновила схему — закрываемся, чтобы не блокировать её
        db.onversionchange = () => db.close();
        void adoptLegacy(db).then(() => resolve(db));
      };
      req.onerror = () => resolve(null);
      // обновление схемы ждёт, пока другие вкладки закроют старое соединение
      // (у них срабатывает onversionchange); если не дождались — работаем в памяти
      req.onblocked = () => window.setTimeout(() => resolve(null), 6000);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/**
 * База в браузере переехала с имени rabota77-crm на leadup-crm. Если новая пустая,
 * а старая в этом браузере ещё есть — переносим её содержимое один раз, чтобы не
 * потерять данные, которые не успели уехать в Supabase.
 */
async function adoptLegacy(db: IDBDatabase): Promise<void> {
  try {
    const stores = [...ENTITY_STORES, KV, BACKUPS].filter((s) => db.objectStoreNames.contains(s));
    if (!stores.length) return;
    const ctx = db.transaction(stores, "readonly");
    const counts = await Promise.all(stores.map((s) => reqP(ctx.objectStore(s).count())));
    if (counts.some((n) => n > 0)) return; // новая база уже с данными — переносить нечего

    const old = await new Promise<IDBDatabase | null>((res) => {
      let existed = true;
      const r = indexedDB.open(LEGACY_DB_NAME);
      r.onupgradeneeded = () => (existed = false); // открытие само создало пустую — старой базы не было
      r.onsuccess = () => {
        if (existed) return res(r.result);
        r.result.close();
        indexedDB.deleteDatabase(LEGACY_DB_NAME);
        res(null);
      };
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    });
    if (!old) return;

    const src = stores.filter((s) => old.objectStoreNames.contains(s));
    if (src.length) {
      const rtx = old.transaction(src, "readonly");
      const rows = await Promise.all(src.map((s) => reqP(rtx.objectStore(s).getAll())));
      const wtx = db.transaction(src, "readwrite");
      src.forEach((s, i) => {
        const os = wtx.objectStore(s);
        for (const r of rows[i]) os.put(r);
      });
      await txDone(wtx);
    }
    old.close();
  } catch {
    /* перенос не вышел — работаем с пустой базой, старая остаётся нетронутой */
  }
}

function reqP<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error("Транзакция прервана"));
  });
}

export async function isPersistent(): Promise<boolean> {
  return REMOTE || (await openDb()) !== null;
}

/** Загрузка всех исходных данных одним проходом (по одному getAll на хранилище). */
export async function loadAll(): Promise<{ state: DataState; persistent: boolean }> {
  return REMOTE ? remote.loadAll() : loadLocal();
}

/** Данные, сохранённые в этом браузере, — в том числе когда основная база уже в Supabase (для переноса). */
export async function loadLocal(): Promise<{ state: DataState; persistent: boolean }> {
  const db = await openDb();
  const st = emptyState();
  if (!db) {
    for (const s of ENTITY_STORES) (st as unknown as Record<string, unknown[]>)[s] = Array.from(mem(s).values());
    const kv = mem(KV);
    st.settings = normalizeSettings(kv.get("settings") as never);
    st.frozenMonths = (kv.get("frozenMonths") as string[]) ?? [];
    st.leadExports = cleanLeadExports(kv.get("leadExports"));
    st.leadExportLog = cleanLeadExportLog(kv.get("leadExportLog"));
    return { state: st, persistent: false };
  }
  const tx = db.transaction([...ENTITY_STORES, KV], "readonly");
  const results = await Promise.all(ENTITY_STORES.map((s) => reqP(tx.objectStore(s).getAll())));
  ENTITY_STORES.forEach((s, i) => {
    (st as unknown as Record<string, unknown[]>)[s] = results[i] as unknown[];
  });
  const settings = await reqP(tx.objectStore(KV).get("settings"));
  const frozen = await reqP(tx.objectStore(KV).get("frozenMonths"));
  const exported = await reqP(tx.objectStore(KV).get("leadExports"));
  const exportLog = await reqP(tx.objectStore(KV).get("leadExportLog"));
  st.settings = normalizeSettings((settings as { value?: never })?.value);
  st.frozenMonths = ((frozen as { value?: string[] })?.value ?? []).filter((m) => typeof m === "string");
  st.leadExports = cleanLeadExports((exported as { value?: unknown })?.value);
  st.leadExportLog = cleanLeadExportLog((exportLog as { value?: unknown })?.value);
  return { state: st, persistent: true };
}

export async function putRecords(store: EntityStore, recs: Rec[]): Promise<void> {
  if (!recs.length) return;
  if (REMOTE) return remote.putRecords(store, recs);
  const db = await openDb();
  if (!db) {
    const m = mem(store);
    for (const r of recs) m.set(r.id, structuredClone(r));
    return;
  }
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  for (const r of recs) os.put(r);
  await txDone(tx);
}

export const putRecord = (store: EntityStore, rec: Rec) => putRecords(store, [rec]);

export async function deleteRecords(store: EntityStore, ids: string[]): Promise<void> {
  if (!ids.length) return;
  if (REMOTE) return remote.deleteRecords(store, ids);
  const db = await openDb();
  if (!db) {
    const m = mem(store);
    for (const id of ids) m.delete(id);
    return;
  }
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  for (const id of ids) os.delete(id);
  await txDone(tx);
}

/**
 * Несколько изменений в разных хранилищах — одной транзакцией: либо всё, либо
 * ничего (например, удаление группы + перевод её операторов в «Без группы»).
 */
export async function applyBatch(ops: { store: EntityStore; put?: Rec[]; del?: string[] }[]): Promise<void> {
  if (REMOTE) {
    // по очереди: справочники идут раньше записей, которые на них ссылаются (так их передаёт стор)
    for (const op of ops) {
      if (op.put?.length) await remote.putRecords(op.store, op.put);
      if (op.del?.length) await remote.deleteRecords(op.store, op.del);
    }
    return;
  }
  const db = await openDb();
  if (!db) {
    for (const op of ops) {
      const m = mem(op.store);
      op.put?.forEach((r) => m.set(r.id, structuredClone(r)));
      op.del?.forEach((id) => m.delete(id));
    }
    return;
  }
  const stores = Array.from(new Set(ops.map((o) => o.store)));
  if (!stores.length) return;
  const tx = db.transaction(stores, "readwrite");
  for (const op of ops) {
    const os = tx.objectStore(op.store);
    op.put?.forEach((r) => os.put(r));
    op.del?.forEach((id) => os.delete(id));
  }
  await txDone(tx);
}

/** Свежее значение строки настроек прямо из хранилища (чтобы не затереть чужие изменения). */
export async function getKV(key: string): Promise<unknown> {
  if (REMOTE) return remote.getKV(key);
  const db = await openDb();
  if (!db) return structuredClone(mem(KV).get(key));
  const tx = db.transaction(KV, "readonly");
  const row = await reqP(tx.objectStore(KV).get(key));
  return (row as { value?: unknown } | undefined)?.value;
}

export async function setKV(key: string, value: unknown): Promise<void> {
  if (REMOTE) return remote.setKV(key, value);
  const db = await openDb();
  if (!db) {
    mem(KV).set(key, structuredClone(value));
    return;
  }
  const tx = db.transaction(KV, "readwrite");
  tx.objectStore(KV).put({ key, value });
  await txDone(tx);
}

/** Полная замена данных (импорт / восстановление) — одна транзакция. */
export async function replaceAll(state: DataState): Promise<void> {
  if (REMOTE) return remote.replaceAll(state);
  const db = await openDb();
  if (!db) {
    for (const s of ENTITY_STORES) {
      const m = mem(s);
      m.clear();
      for (const r of (state as unknown as Record<string, Rec[]>)[s]) m.set(r.id, structuredClone(r));
    }
    mem(KV).set("settings", structuredClone(state.settings));
    mem(KV).set("frozenMonths", [...state.frozenMonths]);
    mem(KV).set("leadExports", { ...state.leadExports });
    mem(KV).set("leadExportLog", [...state.leadExportLog]);
    return;
  }
  const tx = db.transaction([...ENTITY_STORES, KV], "readwrite");
  for (const s of ENTITY_STORES) {
    const os = tx.objectStore(s);
    os.clear();
    for (const r of (state as unknown as Record<string, Rec[]>)[s]) os.put(r);
  }
  tx.objectStore(KV).put({ key: "settings", value: state.settings });
  tx.objectStore(KV).put({ key: "frozenMonths", value: state.frozenMonths });
  tx.objectStore(KV).put({ key: "leadExports", value: state.leadExports });
  tx.objectStore(KV).put({ key: "leadExportLog", value: state.leadExportLog });
  await txDone(tx);
}

/* ── резервные копии ───────────────────────────────────────────────── */

export type BackupMeta = Omit<Backup, "data">;

export async function saveBackup(b: Backup, keep: number): Promise<void> {
  const db = await openDb();
  if (!db) {
    const m = mem(BACKUPS);
    m.set(b.id, structuredClone(b));
    const all = Array.from(m.values()) as Backup[];
    all.sort((a, z) => z.createdAt.localeCompare(a.createdAt)).slice(keep).forEach((x) => m.delete(x.id));
    return;
  }
  const tx = db.transaction(BACKUPS, "readwrite");
  const os = tx.objectStore(BACKUPS);
  os.put(b);
  const keys = (await reqP(os.getAllKeys())) as string[];
  // ID резервной копии начинается со времени создания — сортировка по ключу = по времени
  const old = keys.sort().reverse().slice(keep);
  for (const k of old) os.delete(k);
  await txDone(tx);
}

export async function listBackups(): Promise<BackupMeta[]> {
  const db = await openDb();
  let all: Backup[];
  if (!db) all = Array.from(mem(BACKUPS).values()) as Backup[];
  else {
    const tx = db.transaction(BACKUPS, "readonly");
    all = (await reqP(tx.objectStore(BACKUPS).getAll())) as Backup[];
  }
  return all
    .map(({ data: _d, ...meta }) => meta)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getBackup(id: string): Promise<Backup | null> {
  const db = await openDb();
  if (!db) return (mem(BACKUPS).get(id) as Backup) ?? null;
  const tx = db.transaction(BACKUPS, "readonly");
  return ((await reqP(tx.objectStore(BACKUPS).get(id))) as Backup) ?? null;
}

export async function deleteBackup(id: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    mem(BACKUPS).delete(id);
    return;
  }
  const tx = db.transaction(BACKUPS, "readwrite");
  tx.objectStore(BACKUPS).delete(id);
  await txDone(tx);
}

/** Примерный объём, занятый сайтом (если браузер умеет сказать). */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e) return null;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}
