import type { AuditChange, AuditEntity } from "./types";
import {
  ACCOUNT_ROLE_LABEL,
  ADJ_LABEL,
  CANDIDATE_STAGE_LABEL,
  DAY_LABEL,
  GRADE_LABEL,
  LEAD_STATUS_LABEL,
  PAY_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
  TRACK_LABEL,
} from "./types";
import { fmtPhone } from "./format";

/**
 * «Было → стало» для журнала изменений. Считается в момент правки и хранится в записи
 * журнала уже человеческими словами: «Проект: Авто → Недвижимость», «Оклад: 40 000 ₽ →
 * 45 000 ₽» — а не id и сырыми числами, которые через месяц никто не расшифрует.
 */

/** Как назвать id: оператора, группу, проект, сетку ставок. */
export interface AuditCtx {
  op: (id: string) => string | undefined;
  group: (id: string) => string | undefined;
  project: (id: string) => string | undefined;
  grid: (id: string) => string | undefined;
}

type Kind = "text" | "money" | "num" | "pct" | "date" | "stamp" | "bool" | "phone" | "op" | "group" | "project" | "grid" | "month" | Record<string, string>;
type Spec = [label: string, kind?: Kind];

const S = (kind: Kind, label: string): Spec => [label, kind];

/** Поля, которые показываем, — по типу объекта. Служебные (id, createdAt, updatedAt) не сравниваем. */
const FIELDS: Partial<Record<AuditEntity, Record<string, Spec>>> = {
  lead: {
    at: S("stamp", "Время передачи"),
    status: S(LEAD_STATUS_LABEL, "Статус"),
    statusReason: S("text", "Причина"),
    client: S("text", "Клиент"),
    phone: S("phone", "Телефон"),
    link: S("text", "Ссылка"),
    region: S("text", "Регион"),
    projectId: S("project", "Проект"),
    operatorId: S("op", "Оператор"),
    groupId: S("group", "Группа"),
    comment: S("text", "Комментарий"),
  },
  operator: {
    name: S("text", "ФИО"),
    groupId: S("group", "Группа"),
    role: S(ROLE_LABEL, "Роль"),
    status: S(STATUS_LABEL, "Статус"),
    hireDate: S("date", "Принят"),
    fireDate: S("date", "Уволен"),
    monthlyPlan: S("num", "Личный план"),
    normHours: S("num", "Норма часов"),
    payType: S(PAY_LABEL, "Схема оплаты"),
    salary: S("money", "Оклад"),
    hourlyRate: S("money", "Ставка в час"),
    leadBonus: S("money", "Бонус за лид"),
    rateGridId: S("grid", "Сетка ставок"),
    grade: S(GRADE_LABEL, "Грейд"),
    track: S(TRACK_LABEL, "Направление"),
    contact: S("text", "Контакт"),
    comment: S("text", "Комментарий"),
    deletedAt: S("bool", "Удалён"),
  },
  group: {
    name: S("text", "Название"),
    supervisorId: S("op", "Руководитель"),
    supervisorName: S("text", "Руководитель (ФИО)"),
    monthlyPlan: S("num", "План группы"),
    active: S("bool", "Активна"),
    deletedAt: S("bool", "Удалена"),
  },
  shift: {
    type: S(DAY_LABEL, "Тип дня"),
    hours: S("num", "Часы"),
    comment: S("text", "Комментарий"),
  },
  plan: {
    plan: S("num", "План"),
    normHours: S("num", "Норма часов"),
    payType: S(PAY_LABEL, "Схема оплаты"),
    salary: S("money", "Оклад"),
    hourlyRate: S("money", "Ставка в час"),
    leadBonus: S("money", "Бонус за лид"),
    grade: S(GRADE_LABEL, "Грейд"),
    track: S(TRACK_LABEL, "Направление"),
    approvePct: S("pct", "Апрув"),
    growth: S("bool", "Рост к прошлому месяцу"),
  },
  payroll: {
    type: S(ADJ_LABEL, "Тип"),
    amount: S("money", "Сумма"),
    date: S("date", "Дата"),
    month: S("month", "Ведомость"),
    comment: S("text", "Комментарий"),
  },
  approve: {
    pct: S("pct", "Апрув"),
    comment: S("text", "Комментарий"),
  },
  candidate: {
    name: S("text", "ФИО"),
    contact: S("text", "Контакт"),
    source: S("text", "Источник"),
    stage: S(CANDIDATE_STAGE_LABEL, "Этап"),
    groupId: S("group", "Группа"),
    reason: S("text", "Причина"),
    comment: S("text", "Комментарий"),
  },
  account: {
    name: S("text", "Имя"),
    login: S("text", "Логин"),
    role: S(ACCOUNT_ROLE_LABEL, "Роль"),
    operatorId: S("op", "Карточка сотрудника"),
    active: S("bool", "Вход разрешён"),
  },
};

/** Подписи настроек (ключи верхнего уровня); вложенное — «Регионы · Цена регионального лида». */
const SETTINGS_LABEL: Record<string, string> = {
  companyName: "Название отдела",
  reportMonth: "Отчётный месяц",
  teamPlan: "План команды",
  defaultOperatorPlan: "План оператора по умолчанию",
  defaultNormHours: "Норма часов",
  dayHours: "Часов в рабочем дне",
  workdays: "Рабочие дни",
  holidays: "Праздники",
  defaultPayType: "Схема оплаты по умолчанию",
  defaultSalary: "Оклад по умолчанию",
  defaultHourlyRate: "Ставка по умолчанию",
  defaultLeadBonus: "Бонус за лид по умолчанию",
  rateGrids: "Тарифные сетки",
  defaultGridId: "Сетка по умолчанию",
  svBonus: "Мотивация супервайзера",
  probationLeads: "Стажировка: лидов",
  probationHours: "Стажировка: часов",
  convNormPct: "Норма конверсии, %",
  withholdPct: "Удержание, %",
  leadRevenue: "Цена лида основы",
  payrollCapPct: "Норматив ФОТ, %",
  prorateSalary: "Оклад пропорционально часам",
  aheadPct: "Порог «выше плана», %",
  normalPct: "Порог «по плану», %",
  lagPct: "Порог «отстаёт», %",
  idleDays: "Дней без лидов — «не работает»",
  duplicateDays: "Проверка дублей, дней",
  theme: "Тема по умолчанию",
  backupsKeep: "Хранить копий",
  access: "Права ролей",
  sheets: "Выгрузка в таблицу",
  regions: "Регионы",
  "regions.main": "Города основы",
  "regions.regional": "Города регионов",
  "regions.regionalApprovePct": "Апрув регионов, %",
  "regions.regionalLeadRevenue": "Цена регионального лида",
  "svBonus.defaultApprovePct": "Апрув основы по умолчанию, %",
  "svBonus.salary": "Оклад супервайзера",
  "svBonus.minLeads": "Порог бонуса, лидов",
  "svBonus.noGrowthK": "Коэффициент без роста",
};
const MONEY_SETTINGS = new Set(["leadRevenue", "defaultSalary", "defaultHourlyRate", "defaultLeadBonus", "regions.regionalLeadRevenue", "svBonus.salary"]);

const MONTHS = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const empty = (v: unknown) => v === null || v === undefined || v === "";
const cut = (s: string) => (s.length > 300 ? s.slice(0, 299) + "…" : s);

function show(v: unknown, kind: Kind | undefined, ctx: AuditCtx): string {
  if (empty(v)) return "—";
  if (kind && typeof kind === "object") return kind[String(v)] ?? String(v);
  const num = (n: number) => n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  switch (kind) {
    case "money":
      return `${num(Number(v))} ₽`;
    case "num":
      return num(Number(v));
    case "pct":
      return `${num(Number(v))}%`;
    case "bool":
      return v ? "да" : "нет";
    case "phone":
      return fmtPhone(String(v)) || String(v);
    case "date": {
      const s = String(v);
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : s;
    }
    case "stamp": {
      const s = String(v);
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)} ${s.slice(11, 16)}` : s;
    }
    case "month": {
      const s = String(v);
      return /^\d{4}-\d{2}$/.test(s) ? `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : s;
    }
    case "op":
      return ctx.op(String(v)) ?? String(v);
    case "group":
      return ctx.group(String(v)) ?? String(v);
    case "project":
      return ctx.project(String(v)) ?? String(v);
    case "grid":
      return ctx.grid(String(v)) ?? String(v);
    default:
      if (typeof v === "boolean") return v ? "да" : "нет";
      if (typeof v === "number") return num(v);
      if (Array.isArray(v)) return v.every((x) => typeof x !== "object") ? v.join(", ") || "—" : `${v.length} шт.`;
      if (typeof v === "object") return "…";
      return String(v);
  }
}

/**
 * Что поменялось между двумя состояниями объекта. before = undefined — объект создан,
 * after = undefined — удалён (показываем, каким он был). Пустые пары пропускаем.
 */
export function diffRecords(entity: AuditEntity, before: object | null | undefined, after: object | null | undefined, ctx: AuditCtx): AuditChange[] {
  const spec = FIELDS[entity];
  if (!spec) return [];
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  const out: AuditChange[] = [];
  for (const [key, [label, kind]] of Object.entries(spec)) {
    const x = a[key];
    const y = b[key];
    if (JSON.stringify(x ?? null) === JSON.stringify(y ?? null)) continue;
    const from = before ? show(x, kind, ctx) : "—";
    const to = after ? show(y, kind, ctx) : "—";
    if (from === to) continue;
    out.push({ f: label, from: cut(from), to: cut(to) });
  }
  return out;
}

/** Изменения настроек: вложенные объекты раскрываем до конкретных полей, не больше 30 строк. */
export function diffSettings(before: object, after: object, keys: string[]): AuditChange[] {
  const out: AuditChange[] = [];
  const flat = (v: unknown, path: string, into: Map<string, unknown>) => {
    if (v && typeof v === "object" && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) flat(x, `${path}.${k}`, into);
    else into.set(path, v);
  };
  for (const k of keys) {
    const fa = new Map<string, unknown>();
    const fb = new Map<string, unknown>();
    flat((before as Record<string, unknown>)[k], k, fa);
    flat((after as Record<string, unknown>)[k], k, fb);
    for (const p of new Set([...fa.keys(), ...fb.keys()])) {
      const x = fa.get(p);
      const y = fb.get(p);
      if (JSON.stringify(x ?? null) === JSON.stringify(y ?? null)) continue;
      const label = SETTINGS_LABEL[p] ?? (p.includes(".") ? `${SETTINGS_LABEL[p.split(".")[0]] ?? p.split(".")[0]} · ${p.split(".").slice(1).join(".")}` : SETTINGS_LABEL[p] ?? p);
      const kind: Kind | undefined = MONEY_SETTINGS.has(p) ? "money" : undefined;
      const noCtx: AuditCtx = { op: () => undefined, group: () => undefined, project: () => undefined, grid: () => undefined };
      out.push({ f: label, from: cut(show(x, kind, noCtx)), to: cut(show(y, kind, noCtx)) });
      if (out.length >= 30) return out;
    }
  }
  return out;
}
