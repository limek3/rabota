import { capName } from "./format";

/**
 * Поля таблиц Supabase и перевод имён (camelCase приложения ↔ snake_case базы). Без браузерных
 * зависимостей — этим же пользуется функция registry-sheet на сервере (сборка scripts/build-registry-fn.mjs).
 */

export const TABLES = ["operators", "groups", "projects", "leads", "shifts", "plans", "adjustments", "accounts", "learn", "approves", "candidates", "notes", "audit"] as const;
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
    employment: "none", createdAt: NOW, updatedAt: NOW, deletedAt: null,
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
  notes: { id: "", operatorId: "", date: "", text: "", metric: "lph", authorId: "", authorName: "", createdAt: NOW, updatedAt: NOW, deletedAt: null },
  audit: { id: "", at: NOW, accountId: "", accountName: "", entity: "", entityId: "", summary: "", changes: OPT },
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
  // имя клиента с большой буквы — и у старых лидов, записанных как попало
  if (table === "leads" && typeof out.client === "string") out.client = capName(out.client);
  return out as T;
}
