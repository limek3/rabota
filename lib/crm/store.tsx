"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  Account,
  AccountPrefs,
  Adjustment,
  Approve,
  AuditEntry,
  DataState,
  DayKey,
  Group,
  ID,
  Lead,
  LeadStatus,
  MonthKey,
  MonthPlan,
  Operator,
  OperatorStatus,
  PayType,
  LearnProgress,
  Project,
  RateTier,
  Settings,
  Shift,
  Grade,
  Track,
} from "./types";
import { ADJ_LABEL, DAY_LABEL, LEAD_SOURCE, LEAD_STATUS_LABEL } from "./types";
import { buildIndex, freezePastMonths, type Index } from "./calc";
import { currentMonth, fmtDay, isoNow, monthOf, nowStamp, todayKey } from "./dates";
import { emptyState, newAccount, normalizePrefs, normalizeSettings } from "./defaults";
import {
  canCreateLeadFor,
  canEditLead,
  canEditPay,
  canEditPlan,
  canEditShift,
  canManageOperator,
  canReviewLead,
  computeAccess,
  scopeData,
  type Access,
} from "./access";
import { AUTH_ENABLED } from "@/lib/appMode";
import { planId, shiftId, uniqueId } from "./ids";
import * as db from "./db";
import * as remote from "./remote";
import { normPhone } from "./format";
import { counts, repair, sanitize, toSnapshot } from "./validate";
import { stripDemo } from "./purge";

/**
 * Состояние CRM.
 *
 * Исходные данные грузятся из IndexedDB один раз при старте. Каждое действие
 * пишет в базу ровно те записи, которые меняет (один лид, один оператор, одна
 * смена), и только после успешной записи обновляет память — экран всегда
 * показывает то, что реально сохранено.
 *
 * Аналитика не хранится: индекс (buildIndex) пересобирается из памяти после
 * изменения, а страницы считают показатели через useMemo.
 */

export type ToastTone = "ok" | "err" | "info";
export interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
  action?: { label: string; run: () => void };
}

export interface ConfirmOpts {
  title: string;
  text?: ReactNode;
  ok?: string;
  danger?: boolean;
}

export type LeadInput = Omit<Lead, "id" | "createdAt" | "updatedAt" | "source" | "groupId" | "status" | "statusReason" | "statusAt" | "statusBy"> & {
  id?: ID;
  groupId?: ID | null;
};
/** Предзаполнение окна лида; status — сразу открыть с выбранным статусом (кнопка «Не доведён» в списке). */
export type LeadPreset = Partial<LeadInput> & { status?: LeadStatus };
export type OperatorInput = Omit<Operator, "id" | "createdAt" | "updatedAt" | "deletedAt"> & { id?: ID };
export type GroupInput = Omit<Group, "id" | "createdAt" | "updatedAt" | "deletedAt"> & { id?: ID };
export type ProjectInput = Omit<Project, "id" | "createdAt" | "updatedAt" | "deletedAt" | "sort"> & { id?: ID; sort?: number };
export type AdjustmentInput = Omit<Adjustment, "id" | "createdAt" | "updatedAt"> & { id?: ID };
export type AccountInput = Omit<Account, "id" | "createdAt" | "updatedAt" | "deletedAt" | "lastSeenAt"> & { id?: ID };
export interface TermsInput {
  plan: number;
  normHours: number;
  payType: PayType;
  salary: number;
  hourlyRate: number;
  leadBonus: number;
  /** Снимок тарифной сетки и условий супервайзера на этот месяц. */
  tiers?: RateTier[];
  grade?: Grade;
  track?: Track;
  approvePct?: number;
  growth?: boolean | null;
}

type Modal =
  | { kind: "lead"; lead: Lead | null; preset?: LeadPreset }
  | { kind: "operator"; op: Operator | null; preset?: Partial<OperatorInput> }
  | { kind: "group"; group: Group | null }
  | null;

/** Что можно записать в прогресс обучения за один раз. */
export type LearnPatch = Partial<Pick<LearnProgress, "done" | "right" | "total" | "last" | "best" | "tries" | "pass" | "at" | "checks" | "note" | "fav" | "cert">>;

interface Store {
  ready: boolean;
  persistent: boolean;
  loadError: string | null;
  /** Данные в Supabase (вход по почте), а не в браузере. */
  remote: boolean;
  /** Вошёл, но почты нет среди аккаунтов CRM — показываем «нет доступа». */
  noAccess: string | null;
  /** Перенести данные, сохранённые в этом браузере, в Supabase (только РОП). */
  uploadLocal: () => Promise<void>;
  /** Данные в зоне видимости текущего аккаунта (у РОПа — все). */
  data: DataState;
  ix: Index;
  /** Все данные без среза — только для проверок и управления аккаунтами. */
  full: DataState;
  me: Account;
  access: Access;
  switchAccount: (id: ID) => void;
  saveAccount: (input: AccountInput) => Promise<Account | null>;
  deleteAccount: (id: ID) => Promise<void>;
  saveMyProfile: (patch: Partial<AccountPrefs> & { name?: string; login?: string }) => Promise<void>;
  createOperatorAccounts: () => Promise<number>;
  today: DayKey;
  month: MonthKey;
  setMonth: (m: MonthKey) => void;

  toasts: ToastItem[];
  toast: (text: string, tone?: ToastTone, action?: ToastItem["action"]) => void;
  dismissToast: (id: number) => void;
  confirm: (o: ConfirmOpts) => Promise<boolean>;
  confirmState: (ConfirmOpts & { resolve: (v: boolean) => void }) | null;
  answerConfirm: (v: boolean) => void;

  modal: Modal;
  openLead: (lead?: Lead | null, preset?: LeadPreset) => void;
  openOperator: (op?: Operator | null, preset?: Partial<OperatorInput>) => void;
  openGroup: (g?: Group | null) => void;
  closeModal: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;

  saveLead: (input: LeadInput) => Promise<Lead | null>;
  deleteLead: (id: ID) => Promise<void>;
  /** Статус лидов: «доведён» / «не доведён» (причина обязательна) / вернуть «в работе». Возвращает число изменённых. */
  setLeadStatus: (ids: ID[], status: LeadStatus, reason?: string) => Promise<number>;
  saveOperator: (input: OperatorInput) => Promise<Operator | null>;
  /** Перевести всех операторов на сетку «ставка и бонус по числу лидов в смене». */
  applyGridPay: () => Promise<number>;
  setOperatorStatus: (id: ID, status: OperatorStatus, date?: DayKey) => Promise<void>;
  moveOperator: (id: ID, groupId: ID | null) => Promise<void>;
  deleteOperator: (id: ID) => Promise<void>;
  restoreOperator: (id: ID) => Promise<void>;
  saveGroup: (input: GroupInput) => Promise<Group | null>;
  deleteGroup: (id: ID) => Promise<void>;
  saveProject: (input: ProjectInput) => Promise<Project | null>;
  deleteProject: (id: ID) => Promise<void>;
  restoreProject: (id: ID) => Promise<void>;
  saveShift: (date: DayKey, operatorId: ID, patch: Pick<Shift, "hours" | "type" | "comment"> | null) => Promise<void>;
  saveShifts: (items: { date: DayKey; operatorId: ID; hours: number; type: Shift["type"]; comment?: string }[]) => Promise<number>;
  /** Массово стереть смены (выделение в графике). */
  clearShifts: (items: { date: DayKey; operatorId: ID }[]) => Promise<number>;
  savePlan: (month: MonthKey, scope: MonthPlan["scope"], targetId: ID | null, plan: number | null) => Promise<void>;
  saveTerms: (month: MonthKey, operatorId: ID, t: TermsInput | null) => Promise<void>;
  saveAdjustment: (input: AdjustmentInput) => Promise<void>;
  deleteAdjustment: (id: ID) => Promise<void>;
  /** Апрув заказчика за месяц: по проекту или на весь месяц (projectId = ""). */
  saveApprove: (month: MonthKey, projectId: ID | "", pct: number, comment?: string) => Promise<void>;
  deleteApprove: (id: ID) => Promise<void>;
  /** Сохранить часть настроек (остальное не трогается). true — записано. */
  saveSettings: (patch: Partial<Settings>) => Promise<boolean>;

  /** Обучение: отметить материал пройденным, сохранить результат теста и чек-листы. */
  saveLearn: (courseId: string, itemId: string, patch: LearnPatch) => Promise<void>;
  /** Сбросить прогресс курса (свой или, для РОПа, чужого аккаунта). */
  resetLearn: (courseId: string, accountId?: ID) => Promise<void>;
  /** Сброс всего обучения аккаунта — как «Сбросить весь прогресс» в академии. */
  resetAllLearn: (accountId?: ID) => Promise<void>;

  backup: (reason: string) => Promise<void>;
  restoreBackup: (id: string) => Promise<void>;
  importJson: (text: string) => Promise<string[]>;
  exportJson: () => string;
  wipeAll: () => Promise<void>;
  repairData: () => Promise<string[]>;
  reload: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useCrm(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useCrm вне CrmProvider");
  return s;
}

const TAB_ID = Math.random().toString(36).slice(2);
const CHANNEL = "leadup-crm";
const THEME_KEY = "leadup.theme";
const ACC_KEY = "leadup.account";
const DEFAULT_HEAD_ID = "acc_head";
const NO_RIGHTS = "Недостаточно прав для этого действия";

/** Пока база не загрузилась — временный РОП, чтобы интерфейсу было на что опереться. */
const BOOT_HEAD: Account = newAccount("__boot__", "head", "Руководитель отдела");

function pickAccount(list: Account[], id: string): Account {
  const live = list.filter((a) => !a.deletedAt && a.active);
  return live.find((a) => a.id === id) ?? live.find((a) => a.role === "head") ?? live[0] ?? BOOT_HEAD;
}

function readMe(): string {
  try {
    return typeof window === "undefined" ? "" : localStorage.getItem(ACC_KEY) || "";
  } catch {
    return "";
  }
}

function errText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

export function CrmProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<DataState>(emptyState);
  const [ready, setReady] = useState(false);
  const [persistent, setPersistent] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noAccess, setNoAccess] = useState<string | null>(null);
  const seenRef = useRef(false);
  const [today, setToday] = useState<DayKey>(() => todayKey());
  const [month, setMonthState] = useState<MonthKey>(() => currentMonth());
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirmState, setConfirmState] = useState<Store["confirmState"]>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [meId, setMeId] = useState<string>(readMe);

  // актуальные данные для async-действий без устаревших замыканий
  const dataRef = useRef(data);
  dataRef.current = data;
  const chanRef = useRef<BroadcastChannel | null>(null);

  // полный индекс — для действий; срез по правам — для экранов
  const fullIx = useMemo(() => buildIndex(data), [data]);
  const ixRef = useRef(fullIx);
  ixRef.current = fullIx;

  const me = useMemo(() => pickAccount(data.accounts, meId), [data.accounts, meId]);
  const access = useMemo(() => computeAccess(me, data), [me, data]);
  const accessRef = useRef(access);
  accessRef.current = access;
  const view = useMemo(() => scopeData(data, access), [data, access]);
  const ix = useMemo(() => (view === data ? fullIx : buildIndex(view)), [view, data, fullIx]);

  /* ── уведомления ───────────────────────────────────────────────── */
  const toastSeq = useRef(0);
  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback<Store["toast"]>(
    (text, tone = "ok", action) => {
      const id = ++toastSeq.current;
      setToasts((t) => [...t.slice(-3), { id, text, tone, action }]);
      window.setTimeout(() => dismissToast(id), action ? 7000 : tone === "err" ? 6000 : 3200);
    },
    [dismissToast],
  );
  const confirm = useCallback<Store["confirm"]>(
    (o) => new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve })),
    [],
  );
  const answerConfirm = useCallback((v: boolean) => {
    setConfirmState((cs) => {
      cs?.resolve(v);
      return null;
    });
  }, []);

  const broadcast = useCallback(() => {
    try {
      chanRef.current?.postMessage({ from: TAB_ID, type: "changed" });
    } catch {
      /* вкладка без BroadcastChannel — не страшно */
    }
  }, []);

  /** Запись в базу → обновление памяти → уведомление других вкладок. Ошибка — тост, память не трогаем. */
  const commit = useCallback(
    async (persist: () => Promise<void>, apply: (d: DataState) => DataState, errMsg = "Не удалось сохранить"): Promise<boolean> => {
      try {
        await persist();
      } catch (e) {
        console.error(e);
        toast(`${errMsg}: ${errText(e)}`, "err");
        return false;
      }
      setData(apply);
      broadcast();
      return true;
    },
    [toast, broadcast],
  );

  /**
   * Журнал изменений. Пишем коротко и по-человечески: кто, что и как изменил.
   * Хранится в базе рядом с данными, чтобы спор по зарплате решался фактом,
   * а не памятью. Старые записи подрезаем, чтобы журнал не рос бесконечно.
   */
  const AUDIT_KEEP = 3000;
  const log = useCallback(async (entity: AuditEntry["entity"], entityId: string, summary: string) => {
    const acc = accessRef.current.account;
    if (acc.id === "__boot__" || !summary) return;
    const rec: AuditEntry = {
      id: `au_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      at: isoNow(),
      accountId: acc.id,
      accountName: acc.name,
      entity,
      entityId,
      summary,
    };
    const old = dataRef.current.audit;
    const extra = old.length + 1 - AUDIT_KEEP;
    const drop = extra > 0 ? old.slice(0, extra).map((x) => x.id) : [];
    try {
      await db.putRecord("audit", rec);
      if (drop.length) await db.deleteRecords("audit", drop);
    } catch (e) {
      console.error(e);
      return;
    }
    setData((d) => ({ ...d, audit: [...(drop.length ? d.audit.filter((x) => !drop.includes(x.id)) : d.audit), rec] }));
  }, []);

  /** Короткое описание правки оператора: что было → что стало. */
  const opDiff = useCallback((prev: Operator | undefined, next: Operator): string => {
    if (!prev) return `Заведён оператор «${next.name}»`;
    const parts: string[] = [];
    const money = (n: number) => `${Math.round(n).toLocaleString("ru-RU")} ₽`;
    if (prev.name !== next.name) parts.push(`ФИО: ${prev.name} → ${next.name}`);
    if (prev.groupId !== next.groupId) parts.push("группа изменена");
    if (prev.status !== next.status) parts.push(`статус: ${prev.status} → ${next.status}`);
    if ((prev.monthlyPlan ?? null) !== (next.monthlyPlan ?? null)) parts.push(`план: ${prev.monthlyPlan ?? "—"} → ${next.monthlyPlan ?? "—"}`);
    if ((prev.normHours ?? null) !== (next.normHours ?? null)) parts.push(`норма часов: ${prev.normHours ?? "—"} → ${next.normHours ?? "—"}`);
    if (prev.payType !== next.payType) parts.push(`схема оплаты: ${prev.payType} → ${next.payType}`);
    if (prev.salary !== next.salary) parts.push(`оклад: ${money(prev.salary)} → ${money(next.salary)}`);
    if (prev.hourlyRate !== next.hourlyRate) parts.push(`ставка: ${money(prev.hourlyRate)} → ${money(next.hourlyRate)}`);
    if ((prev.leadBonus ?? null) !== (next.leadBonus ?? null)) parts.push(`бонус за лид: ${prev.leadBonus ?? "по умолчанию"} → ${next.leadBonus ?? "по умолчанию"}`);
    if ((prev.rateGridId ?? null) !== (next.rateGridId ?? null)) parts.push("тарифная сетка изменена");
    if (prev.grade !== next.grade) parts.push(`грейд: ${prev.grade ?? "—"} → ${next.grade ?? "—"}`);
    if (prev.track !== next.track) parts.push(`направление: ${prev.track ?? "—"} → ${next.track ?? "—"}`);
    if (prev.hireDate !== next.hireDate) parts.push(`приём: ${prev.hireDate || "—"} → ${next.hireDate || "—"}`);
    if (prev.fireDate !== next.fireDate) parts.push(`увольнение: ${prev.fireDate || "—"} → ${next.fireDate || "—"}`);
    return parts.length ? `${next.name}: ${parts.join(", ")}` : "";
  }, []);

  const deny = useCallback(() => {
    toast(NO_RIGHTS, "err");
  }, [toast]);

  /* ── загрузка ──────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    try {
      const loaded = await db.loadAll();
      let state = loaded.state;
      setPersistent(loaded.persistent);
      // локально управляет РОП; в Supabase — тот, чья почта в сессии
      let canPersistFreeze = true;
      if (db.REMOTE) {
        const who = await remote.sessionUser();
        const mine = (list: Account[]) => list.find((a) => !a.deletedAt && a.active && a.login && a.login.trim().toLowerCase() === who.email);
        let acc = mine(state.accounts);
        if (!acc && who.email) {
          // пустая база: первый вошедший становится РОПом
          const id = await remote.bootstrap(who.name);
          if (id) {
            state = (await db.loadAll()).state;
            acc = mine(state.accounts);
          }
        }
        if (!acc) {
          setNoAccess(who.email || "—");
          setData(state);
          setLoadError(null);
          return state;
        }
        setNoAccess(null);
        setMeId(acc.id);
        canPersistFreeze = acc.role === "head";
        if (!seenRef.current) {
          seenRef.current = true;
          const seen = { ...acc, lastSeenAt: isoNow() };
          state.accounts = state.accounts.map((a) => (a.id === seen.id ? seen : a));
          void db.putRecord("accounts", seen).catch((e) => console.warn("lastSeen", e));
        }
      }
      // демо-данные прежних версий: удаляем один раз, перед этим — резервная копия
      const pg = db.REMOTE ? null : stripDemo(state);
      if (pg?.any) {
        await db.saveBackup(
          { id: uniqueId("bk", new Set()), createdAt: isoNow(), reason: "Перед удалением демо-данных", counts: counts(state), data: toSnapshot(state) },
          state.settings.backupsKeep,
        );
        await db.replaceAll(pg.state);
        state = pg.state;
        const r = pg.removed;
        toast(`Демо-данные удалены: ${r.operators} операторов, ${r.leads} лидов, ${r.shifts} смен. Копия — в «Настройки → Данные»`, "info");
      }
      // лиды до появления статусов — «в работе», пока их не проверят
      if (state.leads.some((l) => !l.status)) state.leads = state.leads.map((l) => (l.status ? l : { ...l, status: "work", statusReason: l.statusReason ?? "" }));
      // фиксация прошедших месяцев: планы и ставки того времени больше не меняются задним числом
      const t = todayKey();
      const fz = freezePastMonths(state, buildIndex(state), t);
      if (fz.months.length) {
        const frozen = Array.from(new Set([...state.frozenMonths, ...fz.months])).sort();
        // в Supabase фиксирует РОП (у остальных нет прав писать планы всего отдела) — им только в памяти
        if (canPersistFreeze) {
          await db.putRecords("plans", fz.plans);
          await db.setKV("frozenMonths", frozen);
        }
        state.plans = [...state.plans, ...fz.plans];
        state.frozenMonths = frozen;
      }
      // аккаунты: у каждого — полные настройки; без РОПа система неуправляема — создаём его
      state.accounts = state.accounts.map((a) => ({ ...a, groupIds: a.groupIds ?? [], prefs: normalizePrefs(a.prefs, a.role, state.settings.theme) }));
      if (!db.REMOTE && !state.accounts.some((a) => !a.deletedAt && a.active && a.role === "head")) {
        // id фиксированный: повторная загрузка (в dev эффекты монтируются дважды)
        // перезапишет ту же запись, а не создаст второго РОПа
        const head = newAccount(DEFAULT_HEAD_ID, "head", "Руководитель отдела", {}, state.settings.theme);
        await db.putRecord("accounts", head);
        state.accounts = [...state.accounts.filter((a) => a.id !== head.id), head];
      }
      setData(state);
      setLoadError(null);
      return state;
    } catch (e) {
      console.error(e);
      setLoadError(errText(e));
      return null;
    }
  }, [toast]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const st = await load();
      if (!alive) return;
      if (st?.settings.reportMonth) setMonthState(st.settings.reportMonth);
      setReady(true);
      // ежедневная резервная копия — если последней больше суток
      if (st && (st.leads.length || st.operators.length)) {
        try {
          const list = await db.listBackups();
          const last = list[0]?.createdAt ?? "";
          if (!last || Date.now() - Date.parse(last) > 24 * 3600 * 1000) {
            await db.saveBackup(
              { id: uniqueId("bk", new Set()), createdAt: isoNow(), reason: "Ежедневная копия", counts: counts(st), data: toSnapshot(st) },
              st.settings.backupsKeep,
            );
          }
        } catch (e) {
          console.warn("auto-backup", e);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  // другие вкладки поменяли данные — перечитываем (с задержкой, чтобы пачку изменений забрать разом)
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    chanRef.current = ch;
    let t: number | undefined;
    ch.onmessage = (ev) => {
      if (ev.data?.from === TAB_ID) return;
      window.clearTimeout(t);
      t = window.setTimeout(() => void load(), 300);
    };
    return () => {
      window.clearTimeout(t);
      ch.close();
      chanRef.current = null;
    };
  }, [load]);

  // смена суток (и месяца) без перезагрузки страницы
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = todayKey();
      setToday((prev) => {
        if (prev === t) return prev;
        if (monthOf(prev) !== monthOf(t)) void load();
        return t;
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  /* ── тема ──────────────────────────────────────────────────────── */
  const theme = me.prefs.theme;
  const compact = me.prefs.compact;
  useEffect(() => {
    document.documentElement.dataset.density = compact ? "compact" : "normal";
  }, [compact]);
  useEffect(() => {
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && window.matchMedia?.("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
      try {
        localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
      } catch {
        /* ignore */
      }
    };
    apply();
    if (theme !== "system" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  /* ── резервные копии ───────────────────────────────────────────── */
  const backup = useCallback(async (reason: string) => {
    const st = dataRef.current;
    await db.saveBackup(
      { id: uniqueId("bk", new Set()), createdAt: isoNow(), reason, counts: counts(st), data: toSnapshot(st) },
      st.settings.backupsKeep,
    );
  }, []);

  /** Перед опасной операцией: без копии операция не выполняется. */
  const guardedBackup = useCallback(
    async (reason: string) => {
      try {
        await backup(reason);
        return true;
      } catch (e) {
        toast(`Не удалось сделать резервную копию — операция отменена: ${errText(e)}`, "err");
        return false;
      }
    },
    [backup, toast],
  );

  /* ── лиды ──────────────────────────────────────────────────────── */
  const saveLead = useCallback<Store["saveLead"]>(
    async (input) => {
      const st = dataRef.current;
      const op = ixRef.current.opById.get(input.operatorId);
      if (!op) {
        toast("Выберите оператора", "err");
        return null;
      }
      const now = isoNow();
      const prev = input.id ? st.leads.find((l) => l.id === input.id) : undefined;
      const a = accessRef.current;
      const allowed = prev
        ? canEditLead(a, prev, st) && (prev.operatorId === input.operatorId || canCreateLeadFor(a, input.operatorId))
        : canCreateLeadFor(a, input.operatorId);
      if (!allowed) {
        deny();
        return null;
      }
      // группа — снимок на момент передачи; при правке меняется только если сменили оператора
      const groupId =
        input.groupId !== undefined ? input.groupId : prev && prev.operatorId === input.operatorId ? prev.groupId : op.groupId;
      const lead: Lead = {
        id: prev?.id ?? uniqueId("ld", new Set(st.leads.map((l) => l.id))),
        at: input.at || nowStamp(),
        client: input.client.trim(),
        phone: normPhone(input.phone),
        projectId: input.projectId || null,
        operatorId: input.operatorId,
        groupId: groupId ?? null,
        direction: (input.direction || "").trim(),
        comment: (input.comment || "").trim(),
        source: LEAD_SOURCE,
        // новый лид — «в работе»; правка полей статус не меняет
        status: prev?.status ?? "work",
        statusReason: prev?.statusReason ?? "",
        ...(prev?.statusAt ? { statusAt: prev.statusAt } : {}),
        ...(prev?.statusBy ? { statusBy: prev.statusBy } : {}),
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      };
      const ok = await commit(
        () => db.putRecord("leads", lead),
        (d) => ({ ...d, leads: prev ? d.leads.map((l) => (l.id === lead.id ? lead : l)) : [...d.leads, lead] }),
      );
      if (ok && prev) {
        const who = ixRef.current.opById.get(lead.operatorId)?.name ?? lead.operatorId;
        void log("lead", lead.id, `Правка лида ${lead.phone || lead.client || lead.id} · ${who}`);
      }
      return ok ? lead : null;
    },
    [commit, toast, deny, log],
  );

  const deleteLead = useCallback<Store["deleteLead"]>(
    async (id) => {
      const lead = dataRef.current.leads.find((l) => l.id === id);
      if (!lead) return;
      if (!canEditLead(accessRef.current, lead, dataRef.current, true)) return deny();
      const ok = await commit(
        () => db.deleteRecords("leads", [id]),
        (d) => ({ ...d, leads: d.leads.filter((l) => l.id !== id) }),
      );
      if (ok)
        toast("Лид удалён", "info", {
          label: "Вернуть",
          run: () =>
            void commit(
              () => db.putRecord("leads", lead),
              (d) => ({ ...d, leads: d.leads.some((l) => l.id === id) ? d.leads : [...d.leads, lead] }),
            ),
        });
    },
    [commit, toast, deny],
  );

  const setLeadStatus = useCallback<Store["setLeadStatus"]>(
    async (ids, status, reason = "") => {
      const why = reason.trim();
      if (status === "failed" && !why) {
        toast("Укажите причину: почему лид не доведён", "err");
        return 0;
      }
      const a = accessRef.current;
      const want = new Set(ids);
      const targets = dataRef.current.leads.filter((l) => want.has(l.id));
      if (!targets.length) return 0;
      if (targets.some((l) => !canReviewLead(a, l))) {
        deny();
        return 0;
      }
      const now = isoNow();
      const recs: Lead[] = targets
        .filter((l) => l.status !== status || (status === "failed" && l.statusReason !== why))
        .map((l) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { statusAt, statusBy, ...rest } = l;
          return {
            ...rest,
            status,
            statusReason: status === "failed" ? why : "",
            ...(status !== "work" ? { statusAt: now, statusBy: a.account.name } : {}),
            updatedAt: now,
          };
        });
      if (!recs.length) return 0;
      const byId = new Map(recs.map((r) => [r.id, r]));
      const ok = await commit(
        () => db.putRecords("leads", recs),
        (d) => ({ ...d, leads: d.leads.map((l) => byId.get(l.id) ?? l) }),
      );
      if (!ok) return 0;
      const tail = `${LEAD_STATUS_LABEL[status]}${why ? ` (${why})` : ""}`;
      if (recs.length === 1) {
        const r = recs[0];
        const prev = targets.find((l) => l.id === r.id);
        const who = ixRef.current.opById.get(r.operatorId)?.name ?? r.operatorId;
        void log("lead", r.id, `Статус лида ${r.phone || r.client || r.id} · ${who}: ${prev ? LEAD_STATUS_LABEL[prev.status] : "—"} → ${tail}`);
      } else {
        void log("lead", recs.map((r) => r.id).join(","), `Статус ${recs.length} лидов → ${tail}`);
      }
      return recs.length;
    },
    [commit, toast, deny, log],
  );

  /* ── операторы ─────────────────────────────────────────────────── */
  /**
   * Смены уволенного/удалённого, запланированные наперёд: с даты ухода (но не раньше сегодня)
   * и только дни без лидов — в графике на их месте встанет «У». История не трогается.
   * Без права вести график у этого оператора — ничего не снимаем.
   */
  const plannedAfterLeave = useCallback((opId: ID, from: DayKey): ID[] => {
    if (!canEditShift(accessRef.current, opId)) return [];
    const t = todayKey();
    const cut = from > t ? from : t;
    const leads = ixRef.current.opDay.get(opId);
    return dataRef.current.shifts.filter((s) => s.operatorId === opId && s.date >= cut && !leads?.get(s.date)).map((s) => s.id);
  }, []);

  const saveOperator = useCallback<Store["saveOperator"]>(
    async (input) => {
      const st = dataRef.current;
      const name = input.name.trim();
      if (!name) {
        toast("Укажите ФИО", "err");
        return null;
      }
      const prev = input.id ? st.operators.find((o) => o.id === input.id) : undefined;
      if (!canManageOperator(accessRef.current, prev ?? null, prev && prev.groupId === input.groupId ? undefined : input.groupId)) {
        deny();
        return null;
      }
      const now = isoNow();
      const op: Operator = {
        ...input,
        name,
        contact: input.contact.trim(),
        comment: input.comment.trim(),
        fireDate: input.status === "fired" ? input.fireDate || todayKey() : input.fireDate,
        id: prev?.id ?? uniqueId("op", new Set(st.operators.map((o) => o.id))),
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        deletedAt: prev?.deletedAt ?? null,
      };
      // если в текущем месяце уже есть отдельный план оператора — меняем и его, чтобы правка была видна сразу
      const cur = currentMonth();
      const rec = st.plans.find((p) => p.id === planId(cur, "operator", op.id));
      const plans: MonthPlan[] = [];
      if (prev && rec && !rec.auto && prev.monthlyPlan !== op.monthlyPlan) {
        plans.push({ ...rec, plan: op.monthlyPlan ?? st.settings.defaultOperatorPlan, updatedAt: now });
      }
      const leaving = prev && op.status === "fired" && op.fireDate && (prev.status !== "fired" || prev.fireDate !== op.fireDate);
      const drop = leaving ? plannedAfterLeave(op.id, op.fireDate) : [];
      const ok = await commit(
        () => db.applyBatch([{ store: "operators", put: [op] }, { store: "plans", put: plans }, { store: "shifts", del: drop }]),
        (d) => ({
          ...d,
          operators: prev ? d.operators.map((o) => (o.id === op.id ? op : o)) : [...d.operators, op],
          plans: plans.length ? d.plans.map((p) => plans.find((x) => x.id === p.id) ?? p) : d.plans,
          shifts: drop.length ? d.shifts.filter((s) => !drop.includes(s.id)) : d.shifts,
        }),
      );
      if (ok) void log("operator", op.id, opDiff(prev, op) + (drop.length ? ` · снято плановых смен: ${drop.length}` : ""));
      return ok ? op : null;
    },
    [commit, toast, deny, log, opDiff, plannedAfterLeave],
  );

  const patchOperator = useCallback(
    async (id: ID, patch: Partial<Operator>, okText?: string) => {
      const prev = dataRef.current.operators.find((o) => o.id === id);
      if (!prev) return;
      if (!canManageOperator(accessRef.current, prev, "groupId" in patch ? patch.groupId : undefined)) return deny();
      const op = { ...prev, ...patch, updatedAt: isoNow() };
      // уволенный или удалённый оператор не должен входить в систему — его аккаунт выключаем
      const off = op.status === "fired" || !!op.deletedAt;
      const accs = off
        ? dataRef.current.accounts
            .filter((x) => x.operatorId === id && x.role === "operator" && x.active)
            .map((x) => ({ ...x, active: false, updatedAt: op.updatedAt }))
        : [];
      // уволили — запланированные наперёд смены снимаем, в графике будет «У»
      const leaving = op.status === "fired" && op.fireDate && (prev.status !== "fired" || prev.fireDate !== op.fireDate);
      const drop = leaving ? plannedAfterLeave(id, op.fireDate) : [];
      const ok = await commit(
        () => db.applyBatch([{ store: "operators", put: [op] }, { store: "accounts", put: accs }, { store: "shifts", del: drop }]),
        (d) => ({
          ...d,
          operators: d.operators.map((o) => (o.id === id ? op : o)),
          accounts: accs.length ? d.accounts.map((x) => accs.find((y) => y.id === x.id) ?? x) : d.accounts,
          shifts: drop.length ? d.shifts.filter((s) => !drop.includes(s.id)) : d.shifts,
        }),
      );
      if (ok) {
        void log("operator", id, opDiff(prev, op) + (drop.length ? ` · снято плановых смен: ${drop.length}` : ""));
        if (okText) toast(okText);
      }
    },
    [commit, toast, deny, log, opDiff, plannedAfterLeave],
  );

  const applyGridPay = useCallback<Store["applyGridPay"]>(async () => {
    if (!accessRef.current.can.systemSettings) {
      deny();
      return 0;
    }
    const now = isoNow();
    // супервайзеров не трогаем: у них своя схема «оклад + бонус за объём группы»
    const recs = dataRef.current.operators
      .filter((o) => !o.deletedAt && o.payType !== "sv_volume" && o.payType !== "tiered")
      .map((o) => ({ ...o, payType: "tiered" as const, salary: 0, hourlyRate: 0, leadBonus: null, updatedAt: now }));
    if (!recs.length) return 0;
    const ids = new Set(recs.map((r) => r.id));
    const ok = await commit(
      () => db.putRecords("operators", recs),
      (d) => ({ ...d, operators: d.operators.map((o) => (ids.has(o.id) ? recs.find((r) => r.id === o.id) ?? o : o)) }),
    );
    if (ok) toast(`Переведено на сетку: ${recs.length}`);
    return ok ? recs.length : 0;
  }, [commit, deny, toast]);

  const setOperatorStatus = useCallback<Store["setOperatorStatus"]>(
    async (id, status, date) => {
      const patch: Partial<Operator> = { status };
      if (status === "fired") patch.fireDate = date || todayKey();
      if (status !== "fired") patch.fireDate = "";
      await patchOperator(id, patch, `Статус: ${status === "active" ? "активен" : status === "pause" ? "пауза" : "уволен"}`);
    },
    [patchOperator],
  );

  const moveOperator = useCallback<Store["moveOperator"]>(
    async (id, groupId) => {
      const g = groupId ? ixRef.current.groupById.get(groupId) : null;
      await patchOperator(id, { groupId }, `Переведён: ${g ? g.name : "Без группы"}`);
    },
    [patchOperator],
  );

  const deleteOperator = useCallback<Store["deleteOperator"]>(
    async (id) => {
      const op = dataRef.current.operators.find((o) => o.id === id);
      if (!op) return;
      if (!canManageOperator(accessRef.current, op)) return deny();
      if (!(await guardedBackup(`Перед удалением оператора «${op.name}»`))) return;
      // мягкое удаление: лиды, смены и начисления остаются и продолжают ссылаться на оператора
      const now = isoNow();
      // удалили работающего — для графика и зарплаты это увольнение с сегодняшнего дня
      const upd: Operator = { ...op, deletedAt: now, updatedAt: now, ...(op.status !== "fired" ? { status: "fired" as const, fireDate: todayKey() } : {}) };
      const drop = plannedAfterLeave(id, upd.fireDate || todayKey());
      // если был руководителем группы — оставляем ФИО текстом
      const groups = dataRef.current.groups
        .filter((g) => g.supervisorId === id)
        .map((g) => ({ ...g, supervisorId: null, supervisorName: g.supervisorName || op.name, updatedAt: now }));
      const accs = dataRef.current.accounts
        .filter((x) => x.operatorId === id && x.role === "operator" && x.active)
        .map((x) => ({ ...x, active: false, updatedAt: now }));
      const ok = await commit(
        () =>
          db.applyBatch([
            { store: "operators", put: [upd] },
            { store: "groups", put: groups },
            { store: "accounts", put: accs },
            { store: "shifts", del: drop },
          ]),
        (d) => ({
          ...d,
          operators: d.operators.map((o) => (o.id === id ? upd : o)),
          groups: d.groups.map((g) => groups.find((x) => x.id === g.id) ?? g),
          accounts: d.accounts.map((x) => accs.find((y) => y.id === x.id) ?? x),
          shifts: drop.length ? d.shifts.filter((s) => !drop.includes(s.id)) : d.shifts,
        }),
      );
      if (ok) {
        void log("operator", id, `${op.name}: удалён${upd.status !== op.status ? ", уволен с сегодняшнего дня" : ""}${drop.length ? ` · снято плановых смен: ${drop.length}` : ""}`);
        toast(`Оператор удалён, история сохранена`, "info", {
          label: "Вернуть",
          // возвращаем и прежний статус (снятые плановые смены — нет, их проще поставить заново)
          run: () => void patchOperator(id, { deletedAt: null, status: op.status, fireDate: op.fireDate }, "Оператор восстановлен"),
        });
      }
    },
    [commit, guardedBackup, patchOperator, toast, deny, log, plannedAfterLeave],
  );

  const restoreOperator = useCallback<Store["restoreOperator"]>(
    (id) => patchOperator(id, { deletedAt: null }, "Оператор восстановлен"),
    [patchOperator],
  );

  /* ── группы ────────────────────────────────────────────────────── */
  const saveGroup = useCallback<Store["saveGroup"]>(
    async (input) => {
      const st = dataRef.current;
      if (!accessRef.current.can.manageGroups) {
        deny();
        return null;
      }
      const name = input.name.trim();
      if (!name) {
        toast("Укажите название группы", "err");
        return null;
      }
      if (st.groups.some((g) => !g.deletedAt && g.id !== input.id && g.name.trim().toLowerCase() === name.toLowerCase())) {
        toast("Группа с таким названием уже есть", "err");
        return null;
      }
      const prev = input.id ? st.groups.find((g) => g.id === input.id) : undefined;
      const now = isoNow();
      const g: Group = {
        ...input,
        name,
        supervisorName: input.supervisorName.trim(),
        monthlyPlan: Math.max(0, Number(input.monthlyPlan) || 0),
        id: prev?.id ?? uniqueId("gr", new Set(st.groups.map((x) => x.id))),
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        deletedAt: prev?.deletedAt ?? null,
      };
      const ok = await commit(
        () => db.putRecord("groups", g),
        (d) => ({ ...d, groups: prev ? d.groups.map((x) => (x.id === g.id ? g : x)) : [...d.groups, g] }),
      );
      if (ok) {
        const bits: string[] = [];
        if (!prev) bits.push("создана");
        else {
          if (prev.name !== g.name) bits.push(`имя: ${prev.name} → ${g.name}`);
          if (prev.supervisorId !== g.supervisorId || prev.supervisorName !== g.supervisorName) bits.push("руководитель изменён");
          if (prev.monthlyPlan !== g.monthlyPlan) bits.push(`план: ${prev.monthlyPlan || "сумма"} → ${g.monthlyPlan || "сумма"}`);
          if (prev.active !== g.active) bits.push(g.active ? "включена" : "выключена");
        }
        if (bits.length) void log("group", g.id, `Группа «${g.name}»: ${bits.join(", ")}`);
      }
      return ok ? g : null;
    },
    [commit, toast, log],
  );

  const deleteGroup = useCallback<Store["deleteGroup"]>(
    async (id) => {
      const g = dataRef.current.groups.find((x) => x.id === id);
      if (!g) return;
      if (!accessRef.current.can.manageGroups) return deny();
      if (!(await guardedBackup(`Перед удалением группы «${g.name}»`))) return;
      const now = isoNow();
      const upd: Group = { ...g, deletedAt: now, active: false, updatedAt: now };
      // сотрудники не удаляются — уходят в «Без группы»; лиды хранят снимок группы и остаются в её истории
      const moved = dataRef.current.operators
        .filter((o) => o.groupId === id)
        .map((o) => ({ ...o, groupId: null, updatedAt: now }));
      const ok = await commit(
        () => db.applyBatch([{ store: "groups", put: [upd] }, { store: "operators", put: moved }]),
        (d) => ({
          ...d,
          groups: d.groups.map((x) => (x.id === id ? upd : x)),
          operators: d.operators.map((o) => moved.find((m) => m.id === o.id) ?? o),
        }),
      );
      if (ok) toast(moved.length ? `Группа удалена, ${moved.length} чел. переведены в «Без группы»` : "Группа удалена", "info");
    },
    [commit, guardedBackup, toast],
  );

  /* ── проекты ───────────────────────────────────────────────────── */
  const saveProject = useCallback<Store["saveProject"]>(
    async (input) => {
      const st = dataRef.current;
      if (!accessRef.current.can.manageProjects) {
        deny();
        return null;
      }
      const name = input.name.trim();
      if (!name) {
        toast("Укажите название проекта", "err");
        return null;
      }
      if (st.projects.some((p) => !p.deletedAt && p.id !== input.id && p.name.trim().toLowerCase() === name.toLowerCase())) {
        toast("Проект с таким названием уже есть", "err");
        return null;
      }
      const prev = input.id ? st.projects.find((p) => p.id === input.id) : undefined;
      const now = isoNow();
      const p: Project = {
        ...input,
        name,
        sort: input.sort ?? prev?.sort ?? st.projects.length,
        id: prev?.id ?? uniqueId("pr", new Set(st.projects.map((x) => x.id))),
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        deletedAt: prev?.deletedAt ?? null,
      };
      const ok = await commit(
        () => db.putRecord("projects", p),
        (d) => ({ ...d, projects: prev ? d.projects.map((x) => (x.id === p.id ? p : x)) : [...d.projects, p] }),
      );
      return ok ? p : null;
    },
    [commit, toast],
  );

  const deleteProject = useCallback<Store["deleteProject"]>(
    async (id) => {
      const p = dataRef.current.projects.find((x) => x.id === id);
      if (!p) return;
      if (!accessRef.current.can.manageProjects) return deny();
      if (!(await guardedBackup(`Перед удалением проекта «${p.name}»`))) return;
      const now = isoNow();
      const upd = { ...p, deletedAt: now, active: false, updatedAt: now };
      const ok = await commit(
        () => db.putRecord("projects", upd),
        (d) => ({ ...d, projects: d.projects.map((x) => (x.id === id ? upd : x)) }),
      );
      if (ok) toast("Проект убран из списка, лиды по нему сохранены", "info");
    },
    [commit, guardedBackup, toast],
  );

  const restoreProject = useCallback<Store["restoreProject"]>(
    async (id) => {
      const p = dataRef.current.projects.find((x) => x.id === id);
      if (!p) return;
      if (!accessRef.current.can.manageProjects) return deny();
      const upd = { ...p, deletedAt: null, active: true, updatedAt: isoNow() };
      const ok = await commit(
        () => db.putRecord("projects", upd),
        (d) => ({ ...d, projects: d.projects.map((x) => (x.id === id ? upd : x)) }),
      );
      if (ok) toast("Проект возвращён в справочник");
    },
    [commit, toast],
  );

  /* ── смены ─────────────────────────────────────────────────────── */
  const saveShift = useCallback<Store["saveShift"]>(
    async (date, operatorId, patch) => {
      if (!canEditShift(accessRef.current, operatorId)) return deny();
      const id = shiftId(date, operatorId);
      if (!patch) {
        await commit(
          () => db.deleteRecords("shifts", [id]),
          (d) => ({ ...d, shifts: d.shifts.filter((s) => s.id !== id) }),
        );
        return;
      }
      const prev = ixRef.current.shift.get(id);
      const op = ixRef.current.opById.get(operatorId);
      const hours = Math.min(24, Math.max(0, Math.round((Number(patch.hours) || 0) * 100) / 100));
      const sh: Shift = {
        id,
        date,
        operatorId,
        // группа на день смены: у существующей записи сохраняем исходную
        groupId: prev ? prev.groupId : op?.groupId ?? null,
        hours,
        type: patch.type,
        comment: (patch.comment || "").trim(),
        updatedAt: isoNow(),
      };
      const ok = await commit(
        () => db.putRecord("shifts", sh),
        (d) => ({ ...d, shifts: prev ? d.shifts.map((s) => (s.id === id ? sh : s)) : [...d.shifts, sh] }),
      );
      if (ok) {
        const label = (t: Shift["type"], h: number) => `${DAY_LABEL[t]}${t === "work" || t === "training" ? ` ${h} ч` : ""}`;
        const was = prev ? label(prev.type, prev.hours) : "пусто";
        void log("shift", id, `${op?.name ?? operatorId}, ${fmtDay(date)}: ${was} → ${label(sh.type, sh.hours)}`);
      }
    },
    [commit, log],
  );

  const clearShifts = useCallback<Store["clearShifts"]>(
    async (items) => {
      const allowed = items.filter((it) => canEditShift(accessRef.current, it.operatorId));
      if (items.length && !allowed.length) {
        deny();
        return 0;
      }
      const ids = allowed.map((it) => shiftId(it.date, it.operatorId)).filter((id) => ixRef.current.shift.has(id));
      if (!ids.length) return 0;
      const gone = new Set(ids);
      const ok = await commit(
        () => db.deleteRecords("shifts", ids),
        (d) => ({ ...d, shifts: d.shifts.filter((s) => !gone.has(s.id)) }),
      );
      if (ok) void log("shift", ids[0], `Очищено клеток графика: ${ids.length}`);
      return ok ? ids.length : 0;
    },
    [commit, deny, log],
  );

  const saveShifts = useCallback<Store["saveShifts"]>(
    async (items) => {
      const now = isoNow();
      const allowed = items.filter((it) => canEditShift(accessRef.current, it.operatorId));
      if (items.length && !allowed.length) {
        deny();
        return 0;
      }
      const recs: Shift[] = allowed.map((it) => {
        const id = shiftId(it.date, it.operatorId);
        const prev = ixRef.current.shift.get(id);
        return {
          id,
          date: it.date,
          operatorId: it.operatorId,
          groupId: prev ? prev.groupId : ixRef.current.opById.get(it.operatorId)?.groupId ?? null,
          hours: Math.min(24, Math.max(0, it.hours)),
          type: it.type,
          comment: it.comment ?? prev?.comment ?? "",
          updatedAt: now,
        };
      });
      if (!recs.length) return 0;
      const ids = new Set(recs.map((r) => r.id));
      const ok = await commit(
        () => db.putRecords("shifts", recs),
        (d) => ({ ...d, shifts: [...d.shifts.filter((s) => !ids.has(s.id)), ...recs] }),
      );
      if (ok) {
        const people = new Set(recs.map((r) => r.operatorId)).size;
        const days = Array.from(new Set(recs.map((r) => r.date))).sort();
        void log(
          "shift",
          recs[0].id,
          `Записано смен: ${recs.length} · ${people} чел. · ${fmtDay(days[0])}${days.length > 1 ? ` — ${fmtDay(days[days.length - 1])}` : ""} · ${DAY_LABEL[recs[0].type]}`,
        );
      }
      return ok ? recs.length : 0;
    },
    [commit, log],
  );

  /* ── планы ─────────────────────────────────────────────────────── */
  const savePlan = useCallback<Store["savePlan"]>(
    async (m, scope, targetId, plan) => {
      if (!canEditPlan(accessRef.current, scope, targetId)) return deny();
      const id = planId(m, scope, targetId);
      const prev = dataRef.current.plans.find((p) => p.id === id);
      if (plan === null) {
        // у оператора в записи могут жить условия оплаты — план сбрасываем, запись не удаляем
        if (prev && scope === "operator" && (prev.payType || prev.salary != null || prev.hourlyRate != null)) {
          const op = ixRef.current.opById.get(targetId || "");
          const rec = { ...prev, plan: op?.monthlyPlan ?? dataRef.current.settings.defaultOperatorPlan, updatedAt: isoNow() };
          await commit(() => db.putRecord("plans", rec), (d) => ({ ...d, plans: d.plans.map((p) => (p.id === id ? rec : p)) }));
          return;
        }
        await commit(() => db.deleteRecords("plans", [id]), (d) => ({ ...d, plans: d.plans.filter((p) => p.id !== id) }));
        return;
      }
      const rec: MonthPlan = { ...(prev ?? { id, month: m, scope, targetId }), plan: Math.max(0, Math.round(plan)), auto: false, updatedAt: isoNow() };
      const ok = await commit(
        () => db.putRecord("plans", rec),
        (d) => ({ ...d, plans: prev ? d.plans.map((p) => (p.id === id ? rec : p)) : [...d.plans, rec] }),
      );
      if (ok) {
        const who =
          scope === "team" ? "команды" : scope === "group" ? `группы «${ixRef.current.groupById.get(targetId || "")?.name ?? targetId}»` : `${ixRef.current.opById.get(targetId || "")?.name ?? targetId}`;
        void log("plan", id, `План ${who} на ${m}: ${prev && !prev.auto ? prev.plan : "по умолчанию"} → ${rec.plan}`);
      }
    },
    [commit, log],
  );

  const saveTerms = useCallback<Store["saveTerms"]>(
    async (m, operatorId, t) => {
      if (!canEditPay(accessRef.current, operatorId)) return deny();
      const id = planId(m, "operator", operatorId);
      const prev = dataRef.current.plans.find((p) => p.id === id);
      if (!t) {
        if (!prev) return;
        await commit(() => db.deleteRecords("plans", [id]), (d) => ({ ...d, plans: d.plans.filter((p) => p.id !== id) }));
        return;
      }
      const rec: MonthPlan = {
        id,
        month: m,
        scope: "operator",
        targetId: operatorId,
        ...t,
        growth: t.growth ?? undefined,
        auto: false,
        updatedAt: isoNow(),
      };
      const ok = await commit(
        () => db.putRecord("plans", rec),
        (d) => ({ ...d, plans: prev ? d.plans.map((p) => (p.id === id ? rec : p)) : [...d.plans, rec] }),
      );
      if (ok) {
        const name = ixRef.current.opById.get(operatorId)?.name ?? operatorId;
        const bits: string[] = [];
        if (prev?.plan !== rec.plan) bits.push(`план ${prev?.plan ?? "—"} → ${rec.plan}`);
        if (prev?.payType !== rec.payType) bits.push(`схема ${prev?.payType ?? "—"} → ${rec.payType ?? "—"}`);
        if (prev?.salary !== rec.salary) bits.push(`оклад ${prev?.salary ?? "—"} → ${rec.salary ?? "—"}`);
        if (prev?.hourlyRate !== rec.hourlyRate) bits.push(`ставка ${prev?.hourlyRate ?? "—"} → ${rec.hourlyRate ?? "—"}`);
        if (prev?.approvePct !== rec.approvePct) bits.push(`апрув ${prev?.approvePct ?? "—"} → ${rec.approvePct ?? "—"}%`);
        void log("payroll", id, `Условия ${m}, ${name}${bits.length ? `: ${bits.join(", ")}` : " зафиксированы"}`);
      }
    },
    [commit, log],
  );

  /* ── корректировки зарплаты ────────────────────────────────────── */
  const saveAdjustment = useCallback<Store["saveAdjustment"]>(
    async (input) => {
      const st = dataRef.current;
      if (!canEditPay(accessRef.current, input.operatorId)) return deny();
      const prev = input.id ? st.adjustments.find((a) => a.id === input.id) : undefined;
      const now = isoNow();
      const amount = Math.round((Number(input.amount) || 0) * 100) / 100;
      if (!amount) {
        toast("Укажите сумму", "err");
        return;
      }
      const a: Adjustment = {
        ...input,
        amount: input.type === "correction" ? amount : Math.abs(amount),
        comment: input.comment.trim(),
        id: prev?.id ?? uniqueId("adj", new Set(st.adjustments.map((x) => x.id))),
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
      };
      const ok = await commit(
        () => db.putRecord("adjustments", a),
        (d) => ({ ...d, adjustments: prev ? d.adjustments.map((x) => (x.id === a.id ? a : x)) : [...d.adjustments, a] }),
      );
      if (ok) {
        const name = ixRef.current.opById.get(a.operatorId)?.name ?? a.operatorId;
        const what = `${ADJ_LABEL[a.type]} ${Math.round(a.amount).toLocaleString("ru-RU")} ₽`;
        void log("payroll", a.id, `${prev ? "Изменено" : "Добавлено"}: ${what} · ${name} · ${a.month}`);
        // сразу видно, что именно записано и кому — премия не «теряется» в остатке
        toast(`${what} · ${name} — ${prev ? "изменено" : "записано"}`);
      }
    },
    [commit, toast, log],
  );

  const deleteAdjustment = useCallback<Store["deleteAdjustment"]>(
    async (id) => {
      const a = dataRef.current.adjustments.find((x) => x.id === id);
      if (!a) return;
      if (!canEditPay(accessRef.current, a.operatorId)) return deny();
      const ok = await commit(
        () => db.deleteRecords("adjustments", [id]),
        (d) => ({ ...d, adjustments: d.adjustments.filter((x) => x.id !== id) }),
      );
      if (ok) {
        const name = ixRef.current.opById.get(a.operatorId)?.name ?? a.operatorId;
        void log("payroll", a.id, `Удалено начисление «${a.type}» ${Math.round(a.amount).toLocaleString("ru-RU")} ₽ · ${name} · ${a.month}`);
      }
      if (ok)
        toast("Начисление удалено", "info", {
          label: "Вернуть",
          run: () => void commit(() => db.putRecord("adjustments", a), (d) => ({ ...d, adjustments: [...d.adjustments, a] })),
        });
    },
    [commit, toast, log],
  );

  /* ── апрув заказчика ───────────────────────────────────────────── */
  const saveApprove = useCallback<Store["saveApprove"]>(
    async (month, projectId, pct, comment = "") => {
      if (!accessRef.current.can.editPayroll) return deny();
      const id = `${month}|${projectId || "all"}`;
      const prev = dataRef.current.approves.find((a) => a.id === id);
      const rec: Approve = { id, month, projectId, pct: Math.min(100, Math.max(0, pct)), comment: comment.trim(), updatedAt: isoNow() };
      const ok = await commit(
        () => db.putRecord("approves", rec),
        (d) => ({ ...d, approves: prev ? d.approves.map((a) => (a.id === id ? rec : a)) : [...d.approves, rec] }),
      );
      if (ok) {
        const pname = projectId ? ixRef.current.projectById.get(projectId)?.name ?? projectId : "весь месяц";
        void log("approve", id, `Апрув ${month} · ${pname}: ${prev ? `${prev.pct}%` : "—"} → ${rec.pct}%`);
      }
    },
    [commit, deny, log],
  );

  const deleteApprove = useCallback<Store["deleteApprove"]>(
    async (id) => {
      if (!accessRef.current.can.editPayroll) return deny();
      const prev = dataRef.current.approves.find((a) => a.id === id);
      if (!prev) return;
      const ok = await commit(
        () => db.deleteRecords("approves", [id]),
        (d) => ({ ...d, approves: d.approves.filter((a) => a.id !== id) }),
      );
      if (ok) void log("approve", id, `Апрув ${prev.month} удалён`);
    },
    [commit, deny, log],
  );

  /* ── настройки ─────────────────────────────────────────────────── */
  const saveSettings = useCallback<Store["saveSettings"]>(
    async (patch) => {
      if (!accessRef.current.can.systemSettings) {
        deny();
        return false;
      }
      const prev = dataRef.current.settings;
      const next = normalizeSettings({ ...prev, ...patch });
      const ok = await commit(() => db.setKV("settings", next), (d) => ({ ...d, settings: next }));
      if (ok) {
        const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => JSON.stringify(prev[k]) !== JSON.stringify(next[k]));
        const bits = changed.slice(0, 4).map((k) => {
          const a = prev[k];
          const b = next[k];
          const short = (v: unknown) => (typeof v === "object" ? "…" : String(v));
          return `${k}: ${short(a)} → ${short(b)}`;
        });
        if (bits.length) void log("settings", "settings", `Настройки — ${bits.join(", ")}${changed.length > 4 ? ` и ещё ${changed.length - 4}` : ""}`);
      }
      if (ok && patch.reportMonth !== undefined) setMonthState(next.reportMonth || currentMonth());
      return ok;
    },
    [commit, log, deny],
  );

  /* ── аккаунты ──────────────────────────────────────────────────── */
  const switchTo = useCallback((id: string) => {
    setMeId(id);
    try {
      localStorage.setItem(ACC_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  /** Переключение аккаунта без пароля — только пока вход выключен (режим тестирования). */
  const switchAccount = useCallback<Store["switchAccount"]>(
    (id) => {
      if (AUTH_ENABLED) return deny();
      const acc = dataRef.current.accounts.find((a) => a.id === id && a.active && !a.deletedAt);
      if (!acc) return;
      switchTo(id);
      const seen = { ...acc, lastSeenAt: isoNow() };
      void db.putRecord("accounts", seen).then(() =>
        setData((d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? seen : a)) })),
      );
      toast(`Вы вошли как ${acc.name}`, "info");
    },
    [switchTo, deny, toast],
  );

  const saveAccount = useCallback<Store["saveAccount"]>(
    async (input) => {
      if (!accessRef.current.can.manageAccounts) {
        deny();
        return null;
      }
      const st = dataRef.current;
      const name = input.name.trim();
      if (!name) {
        toast("Укажите имя", "err");
        return null;
      }
      if (input.role === "operator" && !input.operatorId) {
        toast("Аккаунт оператора нужно привязать к карточке оператора", "err");
        return null;
      }
      const live = st.accounts.filter((a) => !a.deletedAt && a.id !== input.id);
      if (input.operatorId && live.some((a) => a.operatorId === input.operatorId)) {
        toast("У этого сотрудника уже есть аккаунт", "err");
        return null;
      }
      const login = input.login.trim().toLowerCase();
      if (AUTH_ENABLED && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(login)) {
        toast("Укажите почту — с ней человек войдёт в CRM", "err");
        return null;
      }
      if (login && live.some((a) => a.login.trim().toLowerCase() === login)) {
        toast("Такой логин уже занят", "err");
        return null;
      }
      const prev = input.id ? st.accounts.find((a) => a.id === input.id) : undefined;
      // последнего активного РОПа нельзя разжаловать или выключить
      const heads = st.accounts.filter((a) => !a.deletedAt && a.active && a.role === "head");
      if (prev?.role === "head" && heads.length === 1 && heads[0].id === prev.id && (input.role !== "head" || !input.active)) {
        toast("Это единственный активный РОП — сначала назначьте другого", "err");
        return null;
      }
      const now = isoNow();
      const acc: Account = {
        ...input,
        name,
        login,
        groupIds: input.role === "supervisor" ? input.groupIds : [],
        prefs: normalizePrefs(input.prefs, input.role, st.settings.theme),
        id: prev?.id ?? uniqueId("acc", new Set(st.accounts.map((a) => a.id))),
        createdAt: prev?.createdAt ?? now,
        updatedAt: now,
        lastSeenAt: prev?.lastSeenAt,
        deletedAt: prev?.deletedAt ?? null,
      };
      const ok = await commit(
        () => db.putRecord("accounts", acc),
        (d) => ({ ...d, accounts: prev ? d.accounts.map((a) => (a.id === acc.id ? acc : a)) : [...d.accounts, acc] }),
      );
      if (ok) toast(prev ? "Аккаунт сохранён" : "Аккаунт создан");
      return ok ? acc : null;
    },
    [commit, toast, deny],
  );

  const deleteAccount = useCallback<Store["deleteAccount"]>(
    async (id) => {
      if (!accessRef.current.can.manageAccounts) return deny();
      const st = dataRef.current;
      const acc = st.accounts.find((a) => a.id === id);
      if (!acc) return;
      if (id === accessRef.current.account.id) {
        toast("Нельзя удалить аккаунт, под которым вы сейчас работаете", "err");
        return;
      }
      const heads = st.accounts.filter((a) => !a.deletedAt && a.active && a.role === "head");
      if (acc.role === "head" && heads.length === 1 && heads[0].id === id) {
        toast("Это единственный активный РОП", "err");
        return;
      }
      const upd = { ...acc, deletedAt: isoNow(), active: false, updatedAt: isoNow() };
      const ok = await commit(
        () => db.putRecord("accounts", upd),
        (d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === id ? upd : a)) }),
      );
      if (ok) toast("Аккаунт удалён");
    },
    [commit, toast, deny],
  );

  /** Своё имя, логин и личные настройки может менять каждый. */
  const saveMyProfile = useCallback<Store["saveMyProfile"]>(
    async (patch) => {
      const cur = accessRef.current.account;
      if (cur.id === "__boot__") return;
      const prev = dataRef.current.accounts.find((a) => a.id === cur.id) ?? cur;
      const { name, login, ...prefs } = patch;
      const acc: Account = {
        ...prev,
        name: name !== undefined ? name.trim() || prev.name : prev.name,
        login: login !== undefined && !AUTH_ENABLED ? login.trim().toLowerCase() : prev.login,
        prefs: normalizePrefs({ ...prev.prefs, ...prefs }, prev.role, dataRef.current.settings.theme),
        updatedAt: isoNow(),
      };
      await commit(
        () => db.putRecord("accounts", acc),
        (d) => ({ ...d, accounts: d.accounts.map((a) => (a.id === acc.id ? acc : a)) }),
      );
    },
    [commit],
  );

  /** Создать аккаунты всем работающим операторам, у которых их ещё нет. */
  const createOperatorAccounts = useCallback<Store["createOperatorAccounts"]>(async () => {
    if (!accessRef.current.can.manageAccounts) {
      deny();
      return 0;
    }
    const st = dataRef.current;
    const has = new Set(st.accounts.filter((a) => !a.deletedAt && a.operatorId).map((a) => a.operatorId));
    const taken = new Set(st.accounts.map((a) => a.id));
    const recs = st.operators
      .filter((o) => !o.deletedAt && o.status !== "fired" && !has.has(o.id))
      .map((o) => {
        const id = uniqueId("acc", taken);
        taken.add(id);
        return newAccount(id, o.role === "supervisor" ? "supervisor" : "operator", o.name, { operatorId: o.id }, st.settings.theme);
      });
    if (!recs.length) {
      toast("У всех работающих операторов уже есть аккаунты", "info");
      return 0;
    }
    const ok = await commit(
      () => db.putRecords("accounts", recs),
      (d) => ({ ...d, accounts: [...d.accounts, ...recs] }),
    );
    if (ok) toast(`Создано аккаунтов: ${recs.length}`);
    return ok ? recs.length : 0;
  }, [commit, toast, deny]);

  /* ── обучение ──────────────────────────────────────────────────── */
  const saveLearn = useCallback<Store["saveLearn"]>(
    async (courseId, itemId, patch) => {
      const acc = accessRef.current.account;
      if (acc.id === "__boot__") return;
      const id = `${acc.id}|${itemId}`;
      const prev = dataRef.current.learn.find((l) => l.id === id);
      const rec: LearnProgress = {
        ...(prev ?? { done: false }),
        ...patch,
        id,
        accountId: acc.id,
        courseId,
        itemId,
        done: patch.done ?? prev?.done ?? false,
        updatedAt: isoNow(),
      };
      await commit(
        () => db.putRecord("learn", rec),
        (d) => ({ ...d, learn: prev ? d.learn.map((l) => (l.id === id ? rec : l)) : [...d.learn, rec] }),
      );
    },
    [commit],
  );

  const resetLearn = useCallback<Store["resetLearn"]>(
    async (courseId, accountId) => {
      const a = accessRef.current;
      const target = accountId ?? a.account.id;
      if (target !== a.account.id && !a.can.manageAccounts) return deny();
      const gone = dataRef.current.learn.filter((l) => l.accountId === target && l.courseId === courseId);
      if (!gone.length) return;
      const ids = new Set(gone.map((l) => l.id));
      const ok = await commit(
        () => db.deleteRecords("learn", Array.from(ids)),
        (d) => ({ ...d, learn: d.learn.filter((l) => !ids.has(l.id)) }),
      );
      if (ok) toast("Прогресс курса сброшен", "info");
    },
    [commit, deny, toast],
  );

  const resetAllLearn = useCallback<Store["resetAllLearn"]>(
    async (accountId) => {
      const a = accessRef.current;
      const target = accountId ?? a.account.id;
      if (target !== a.account.id && !a.can.manageAccounts) return deny();
      const gone = dataRef.current.learn.filter((l) => l.accountId === target);
      if (!gone.length) return;
      const ids = new Set(gone.map((l) => l.id));
      const ok = await commit(
        () => db.deleteRecords("learn", Array.from(ids)),
        (d) => ({ ...d, learn: d.learn.filter((l) => !ids.has(l.id)) }),
      );
      if (ok) toast("Весь прогресс обучения сброшен", "info");
    },
    [commit, deny, toast],
  );

  /* ── данные целиком ────────────────────────────────────────────── */
  const replace = useCallback(
    async (state: DataState, okText: string) => {
      try {
        await db.replaceAll(state);
      } catch (e) {
        toast(`Не удалось записать данные: ${errText(e)}`, "err");
        return false;
      }
      await load();
      broadcast();
      toast(okText);
      return true;
    },
    [load, broadcast, toast],
  );

  const restoreBackup = useCallback<Store["restoreBackup"]>(
    async (id) => {
      if (!accessRef.current.can.manageData) return deny();
      const b = await db.getBackup(id);
      if (!b) {
        toast("Копия не найдена", "err");
        return;
      }
      if (!(await guardedBackup("Перед восстановлением из копии"))) return;
      const { state } = sanitize(b.data);
      const keepAudit = dataRef.current.audit;
      await replace({ ...state, audit: [...keepAudit, ...state.audit.filter((a) => !keepAudit.some((x) => x.id === a.id))] }, "Данные восстановлены из копии");
      void log("data", id, `Восстановление из копии от ${fmtDay(b.createdAt.slice(0, 10))} · ${b.reason}`);
    },
    [guardedBackup, replace, toast, deny, log],
  );

  const importJson = useCallback<Store["importJson"]>(
    async (text) => {
      if (!accessRef.current.can.manageData) {
        deny();
        return [];
      }
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        toast("Файл не похож на JSON-выгрузку", "err");
        return [];
      }
      // "rabota77-crm" — метка выгрузок до переименования, их тоже принимаем
      if (!raw || typeof raw !== "object" || !["leadup-crm", "rabota77-crm"].includes((raw as { app?: string }).app ?? "")) {
        toast("Это не выгрузка LEADUP CRM", "err");
        return [];
      }
      if (!(await guardedBackup("Перед импортом"))) return [];
      const { state, warnings } = sanitize(raw);
      const keepAudit = dataRef.current.audit;
      await replace({ ...state, audit: [...keepAudit, ...state.audit.filter((a) => !keepAudit.some((x) => x.id === a.id))] }, "Импорт завершён");
      void log("data", "import", `Импорт данных из файла${warnings.length ? ` · замечаний: ${warnings.length}` : ""}`);
      return warnings;
    },
    [guardedBackup, replace, toast, deny, log],
  );

  const exportJson = useCallback(() => (accessRef.current.can.manageData ? JSON.stringify(toSnapshot(dataRef.current), null, 1) : ""), []);

  const wipeAll = useCallback(async () => {
    if (!accessRef.current.can.manageData) return deny();
    if (!(await guardedBackup("Перед полной очисткой"))) return;
    const e = emptyState();
    e.settings = { ...dataRef.current.settings };
    // аккаунты РОПов оставляем — иначе в систему некому будет войти
    e.accounts = dataRef.current.accounts.filter((a) => a.role === "head" && !a.deletedAt);
    const keep = new Set(e.accounts.map((a) => a.id));
    e.learn = dataRef.current.learn.filter((l) => keep.has(l.accountId));
    // журнал не стираем: очистка — сама по себе событие, которое надо видеть
    e.audit = dataRef.current.audit;
    if (await replace(e, "Данные очищены. Резервная копия сохранена")) void log("data", "wipe", "Полная очистка данных");
  }, [guardedBackup, replace, deny, log]);

  const repairData = useCallback(async () => {
    if (!accessRef.current.can.manageData) {
      deny();
      return [];
    }
    const r = repair(dataRef.current);
    if (!r.notes.length) {
      toast("Проблем не найдено");
      return [];
    }
    if (!(await guardedBackup("Перед исправлением данных"))) return [];
    const ok = await commit(
      () =>
        db.applyBatch([
          { store: "operators", put: r.changed.operators },
          { store: "leads", put: r.changed.leads },
          { store: "shifts", put: r.changed.shifts },
          { store: "accounts", put: r.changed.accounts },
        ]),
      () => r.state,
    );
    if (ok) toast("Данные исправлены");
    return r.notes;
  }, [commit, guardedBackup, toast, deny]);

  const reload = useCallback(async () => {
    await load();
    toast("Данные перечитаны, расчёты обновлены");
  }, [load, toast]);

  /** Данные из IndexedDB этого браузера → Supabase: добавить/обновить по ID, ничего не удаляя. */
  const uploadLocal = useCallback<Store["uploadLocal"]>(async () => {
    if (!db.REMOTE || !accessRef.current.can.manageData) return deny();
    try {
      const local = await db.loadLocal();
      // через ту же проверку, что импорт: статусы лидов, ссылки, дубли; моки — не переносим
      const { state } = sanitize(JSON.parse(JSON.stringify(toSnapshot(local.state))));
      const clean = stripDemo(state).state;
      const n = counts(clean);
      if (!n.operators && !n.leads && !n.shifts && !clean.groups.length && !clean.projects.length) {
        toast("В этом браузере нет данных для переноса", "info");
        return;
      }
      if (!(await guardedBackup("Перед переносом данных из браузера"))) return;
      const who = await remote.sessionUser();
      const done = await remote.mergeUpload(clean, who.email);
      await load();
      toast(`Перенесено: ${done.operators} операторов, ${done.leads} лидов, ${done.shifts} смен, ${done.accounts} аккаунтов`);
      void log("data", "upload", `Перенос данных из браузера: ${done.operators} операторов, ${done.leads} лидов, ${done.shifts} смен`);
    } catch (e) {
      console.error(e);
      toast(`Не удалось перенести: ${errText(e)}`, "err");
    }
  }, [deny, toast, guardedBackup, load, log]);

  // Supabase: чужие изменения прилетают сразу. Записи — точечно, настройки и права — полной перезагрузкой
  useEffect(() => {
    if (!db.REMOTE || !ready || noAccess) return;
    let t: number | undefined;
    const reloadSoon = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => void load(), 500);
    };
    const off = remote.subscribe((c) => {
      if (c.table === "kv" || c.table === "accounts" || c.table === "groups") return reloadSoon();
      setData((d) => {
        const list = d[c.table] as { id: string }[];
        if (c.type === "DELETE") return list.some((x) => x.id === c.id) ? { ...d, [c.table]: list.filter((x) => x.id !== c.id) } : d;
        const rec = c.rec as { id: string };
        const i = list.findIndex((x) => x.id === rec.id);
        const next = i < 0 ? [...list, rec] : list.map((x, k) => (k === i ? rec : x));
        return { ...d, [c.table]: next };
      });
    });
    return () => {
      window.clearTimeout(t);
      off();
    };
  }, [ready, noAccess, load]);

  const setMonth = useCallback((m: MonthKey) => setMonthState(m), []);

  const value: Store = {
    ready,
    persistent,
    loadError,
    data: view,
    ix,
    full: data,
    me,
    access,
    switchAccount,
    remote: db.REMOTE,
    noAccess,
    uploadLocal,
    saveAccount,
    deleteAccount,
    saveMyProfile,
    createOperatorAccounts,
    today,
    month,
    setMonth,
    toasts,
    toast,
    dismissToast,
    confirm,
    confirmState,
    answerConfirm,
    modal,
    openLead: (lead = null, preset) => setModal({ kind: "lead", lead, preset }),
    openOperator: (op = null, preset) => setModal({ kind: "operator", op, preset }),
    openGroup: (group = null) => setModal({ kind: "group", group }),
    closeModal: () => setModal(null),
    paletteOpen,
    setPaletteOpen,
    saveLead,
    setLeadStatus,
    deleteLead,
    saveOperator,
    applyGridPay,
    setOperatorStatus,
    moveOperator,
    deleteOperator,
    restoreOperator,
    saveGroup,
    deleteGroup,
    saveProject,
    deleteProject,
    restoreProject,
    saveShift,
    saveShifts,
    clearShifts,
    savePlan,
    saveTerms,
    saveAdjustment,
    deleteAdjustment,
    saveApprove,
    deleteApprove,
    saveSettings,
    saveLearn,
    resetLearn,
    resetAllLearn,
    backup,
    restoreBackup,
    importJson,
    exportJson,
    wipeAll,
    repairData,
    reload,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
